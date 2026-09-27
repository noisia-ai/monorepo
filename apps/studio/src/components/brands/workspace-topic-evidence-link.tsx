import Link from "next/link";

export function workspaceTopicEvidenceHref(mentionsHref: string, rootId: string): string {
  return `${mentionsHref}?mention=${encodeURIComponent(rootId)}`;
}

export function WorkspaceTopicEvidenceMentionLink({ mentionsHref, rootId, children }: {
  mentionsHref: string; rootId: string; children?: React.ReactNode;
}) {
  return <Link href={workspaceTopicEvidenceHref(mentionsHref, rootId)} prefetch={false}>{children}</Link>;
}
