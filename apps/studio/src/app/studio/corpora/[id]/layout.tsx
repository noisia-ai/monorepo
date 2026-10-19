import type { ReactNode } from "react";
import { requireStudioUser } from "@/lib/auth/guards";
import { getCorpusForUser } from "@/lib/data/corpora";

export default async function CorpusLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStudioUser(`/studio/corpora/${id}/engine`);

  // If corpus is null the child page's own notFound() will fire; the layout
  // still renders the nav shell so the transition feels smooth.
  const corpus = await getCorpusForUser(session.appUser, id);

  void corpus;
  return children;
}
