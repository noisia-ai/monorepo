import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { buildStudySourcePreviewFromBuffer } from "@/lib/study-source-preview";

export const runtime = "nodejs";

const MAX_PREVIEW_FILES = 12;
const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return Response.json(
      { error: "invalid_form", message: "No se pudo leer el formulario de fuentes." },
      { status: 400 }
    );
  }

  const sourceKind = String(formData.get("source_kind") ?? "spreadsheet_archive").slice(0, 80);
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);
  if (files.length === 0) {
    return Response.json({ data: [] });
  }

  let totalBytes = 0;
  const previews = [];
  for (const file of files.slice(0, MAX_PREVIEW_FILES)) {
    totalBytes += file.size;
    if (totalBytes > MAX_PREVIEW_BYTES) {
      previews.push({
        name: file.name,
        kind: sourceKind,
        mime_type: file.type,
        size_bytes: file.size,
        status: "error",
        summary: "",
        text: "",
        dataset_inventory: [],
        sheet_count: 0,
        row_count: 0,
        field_names: [],
        error: "La previsualización superó el límite de 50MB. El archivo puede subirse al crear el corpus, pero no se usará para preparar el objetivo."
      });
      continue;
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    previews.push(buildStudySourcePreviewFromBuffer({
      name: file.name,
      kind: sourceKind,
      mimeType: file.type,
      sizeBytes: file.size,
      buffer
    }));
  }

  return Response.json({ data: previews });
}
