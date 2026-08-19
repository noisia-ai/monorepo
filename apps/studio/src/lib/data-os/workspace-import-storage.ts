import { createHash } from "node:crypto";

type SignedUploadResponse = {
  token?: string;
  url?: string;
  signedURL?: string;
  signedUrl?: string;
};

export type WorkspaceImportUploadPartAuthorityV1 = {
  partNumber: number;
  expectedSizeBytes: number;
  objectKey: string;
  uploadUrl: string;
};

export type WorkspaceImportUploadAuthorityV1 = {
  bucket: string;
  objectPrefix: string;
  expiresInSeconds: number;
  partSizeBytes: number;
  parts: WorkspaceImportUploadPartAuthorityV1[];
};

// Staging intentionally retains Supabase's 50 MB organization spend-cap
// ceiling. A 48 MB object ceiling leaves room below that platform boundary
// while allowing one logical CSV to span deterministic private objects.
export const WORKSPACE_IMPORT_PART_BYTES = 48 * 1024 * 1024;

export function resolveWorkspaceImportStorageV1() {
  const baseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/u, "");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bucket = (
    process.env.SUPABASE_STORAGE_BUCKET_IMPORTS?.trim()
    || process.env.SUPABASE_STORAGE_BUCKET_CORPUS_FILES?.trim()
    || "corpus-files"
  );
  const projectRef = new URL(baseUrl).hostname.split(".")[0];
  if (!projectRef) throw new WorkspaceImportStorageError("storage_configuration_unavailable");
  return {
    baseUrl,
    serviceRoleKey,
    bucket,
    projectRef
  };
}

export async function createWorkspaceImportSignedUploadsV1(args: {
  objectPrefix: string;
  fileSizeBytes: number;
}): Promise<WorkspaceImportUploadAuthorityV1> {
  const storage = resolveWorkspaceImportStorageV1();
  const partCount = Math.ceil(args.fileSizeBytes/WORKSPACE_IMPORT_PART_BYTES);
  const parts: WorkspaceImportUploadPartAuthorityV1[] = [];
  for (let index=0;index<partCount;index+=1) {
    const objectKey = workspaceImportPartObjectKeyV1(args.objectPrefix,index+1);
    const response = await fetch(
      `${storage.baseUrl}/storage/v1/object/upload/sign/${encodePath(storage.bucket)}/${encodePath(objectKey)}`,
      {
        method: "POST",
        headers: storageHeaders(storage.serviceRoleKey),
        body: JSON.stringify({ upsert: false })
      }
    );
    if (!response.ok) {
      throw new WorkspaceImportStorageError("signed_upload_unavailable",response.status);
    }
    const payload = await response.json() as SignedUploadResponse;
    const signedPath = payload.url ?? payload.signedURL ?? payload.signedUrl;
    const token = payload.token ?? tokenFromUrl(signedPath);
    if (!token) throw new WorkspaceImportStorageError("signed_upload_unavailable");
    const uploadUrl = signedPath
      ? new URL(
        signedPath.startsWith("/object/") ? `/storage/v1${signedPath}` : signedPath,
        storage.baseUrl
      ).toString()
      : `${storage.baseUrl}/storage/v1/object/upload/sign/${encodePath(storage.bucket)}/${encodePath(objectKey)}?token=${encodeURIComponent(token)}`;
    parts.push({
      partNumber: index+1,
      expectedSizeBytes: Math.min(
        WORKSPACE_IMPORT_PART_BYTES,args.fileSizeBytes-(index*WORKSPACE_IMPORT_PART_BYTES)
      ),
      objectKey,
      uploadUrl
    });
  }
  return {
    bucket: storage.bucket,
    objectPrefix: args.objectPrefix,
    expiresInSeconds: 2 * 60 * 60,
    partSizeBytes: WORKSPACE_IMPORT_PART_BYTES,
    parts
  };
}

export async function uploadWorkspaceImportMultipartStreamV1(args: {
  upload: WorkspaceImportUploadAuthorityV1;
  body: ReadableStream<Uint8Array>;
  contentType: string;
}) {
  const storage = resolveWorkspaceImportStorageV1();
  if (storage.bucket!==args.upload.bucket) {
    throw new WorkspaceImportStorageError("storage_authority_mismatch");
  }
  const reader = args.body.getReader();
  let pending = new Uint8Array(0);
  try {
    for (const part of args.upload.parts) {
      const bytes = new Uint8Array(part.expectedSizeBytes);
      let offset = 0;
      if (pending.byteLength>0) {
        const take = Math.min(pending.byteLength,bytes.byteLength);
        bytes.set(pending.subarray(0,take),0);offset=take;pending=pending.subarray(take);
      }
      while (offset<bytes.byteLength) {
        const next = await reader.read();
        if (next.done) throw new WorkspaceImportStorageError("upload_size_mismatch");
        const take = Math.min(next.value.byteLength,bytes.byteLength-offset);
        bytes.set(next.value.subarray(0,take),offset);offset+=take;
        if (take<next.value.byteLength) pending=new Uint8Array(next.value.subarray(take));
      }
      const response = await fetch(
        `${storage.baseUrl}/storage/v1/object/${encodePath(storage.bucket)}/${encodePath(part.objectKey)}`,
        {
          method: "POST",
          headers: {
            ...storageHeaders(storage.serviceRoleKey),
            "Content-Type": args.contentType,
            "x-upsert": "false"
          },
          body: bytes
        }
      );
      if (!response.ok) throw new WorkspaceImportStorageError("upload_failed",response.status);
    }
    const trailing = pending.byteLength>0 ? { done: false } : await reader.read();
    if (!trailing.done) throw new WorkspaceImportStorageError("upload_size_mismatch");
  } finally {
    reader.releaseLock();
  }
}

export async function statWorkspaceImportObjectV1(args: {
  bucket: string;
  objectKey: string;
}) {
  const storage = resolveWorkspaceImportStorageV1();
  if (args.bucket !== storage.bucket) {
    throw new WorkspaceImportStorageError("storage_authority_mismatch");
  }
  const url = `${storage.baseUrl}/storage/v1/object/authenticated/${encodePath(args.bucket)}/${encodePath(args.objectKey)}`;
  let response = await fetch(url,{
    method: "HEAD",headers: storageHeaders(storage.serviceRoleKey)
  });
  if (response.status === 405) {
    response = await fetch(url,{
      method: "GET",
      headers: { ...storageHeaders(storage.serviceRoleKey),Range: "bytes=0-0" }
    });
  }
  if (!response.ok) throw new WorkspaceImportStorageError("uploaded_object_unavailable",response.status);
  const range = response.headers.get("content-range")?.match(/\/(\d+)$/u)?.[1];
  const length = range ?? response.headers.get("content-length");
  const size = length ? Number(length) : Number.NaN;
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new WorkspaceImportStorageError("uploaded_object_size_unavailable");
  }
  await response.body?.cancel().catch(() => undefined);
  return { sizeBytes: size,etag: response.headers.get("etag") };
}

export async function verifyWorkspaceImportStoredPartsV1(args: {
  bucket: string;
  objectPrefix: string;
  partCount: number;
  partSizeBytes: number;
  expectedSizeBytes: number;
}) {
  const storage=resolveWorkspaceImportStorageV1();
  if (args.bucket!==storage.bucket || !Number.isSafeInteger(args.partCount)
      || args.partCount<1 || args.partCount>10_000
      || !Number.isSafeInteger(args.partSizeBytes) || args.partSizeBytes<1
      || !Number.isSafeInteger(args.expectedSizeBytes) || args.expectedSizeBytes<1) {
    throw new WorkspaceImportStorageError("storage_authority_mismatch");
  }
  const hash=createHash("sha256");
  let totalBytes=0;
  for (let index=0;index<args.partCount;index+=1) {
    const objectKey=workspaceImportPartObjectKeyV1(args.objectPrefix,index+1);
    const response=await fetch(
      `${storage.baseUrl}/storage/v1/object/authenticated/${encodePath(args.bucket)}/${encodePath(objectKey)}`,
      { headers: storageHeaders(storage.serviceRoleKey) }
    );
    if (!response.ok || !response.body) {
      throw new WorkspaceImportStorageError("uploaded_object_unavailable",response.status);
    }
    const expectedPartBytes=Math.min(
      args.partSizeBytes,args.expectedSizeBytes-(index*args.partSizeBytes)
    );
    const reader=response.body.getReader();
    let partBytes=0;
    try {
      while (true) {
        const { done,value }=await reader.read();
        if (done) break;
        if (!value) continue;
        partBytes+=value.byteLength;totalBytes+=value.byteLength;hash.update(value);
      }
    } finally { reader.releaseLock(); }
    if (partBytes!==expectedPartBytes) {
      throw new WorkspaceImportStorageError("upload_size_mismatch");
    }
  }
  if (totalBytes!==args.expectedSizeBytes) {
    throw new WorkspaceImportStorageError("upload_size_mismatch");
  }
  return { sizeBytes: totalBytes,contentHash: hash.digest("hex") };
}

export function workspaceImportObjectKeyV1(args: {
  workspaceId: string;
  importBatchId: string;
  fileName: string;
}) {
  const safeName = args.fileName
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/gu,"-")
    .replace(/^-+|-+$/gu,"")
    .slice(0,180) || "workspace-import.csv";
  return `workspace-imports/${args.workspaceId}/${args.importBatchId}/${safeName}`;
}

export function workspaceImportPartObjectKeyV1(objectPrefix: string,partNumber: number) {
  if (!Number.isSafeInteger(partNumber) || partNumber<1 || partNumber>10_000) {
    throw new WorkspaceImportStorageError("storage_authority_mismatch");
  }
  return `${objectPrefix}.part-${String(partNumber).padStart(5,"0")}`;
}

export class WorkspaceImportStorageError extends Error {
  constructor(public readonly code: string,public readonly status?: number) {
    super(code);
    this.name = "WorkspaceImportStorageError";
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new WorkspaceImportStorageError("storage_configuration_unavailable");
  return value;
}

function storageHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    ...(serviceRoleKey.startsWith("eyJ")
      ? { Authorization: `Bearer ${serviceRoleKey}` }
      : {}),
    "Content-Type": "application/json"
  };
}

function encodePath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function tokenFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try { return new URL(value,"https://storage.invalid").searchParams.get("token") ?? undefined; }
  catch { return undefined; }
}
