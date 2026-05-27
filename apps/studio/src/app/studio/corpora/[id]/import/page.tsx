import { redirect } from "next/navigation";

export default async function CorpusImportRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/studio/corpora/${id}/engine`);
}
