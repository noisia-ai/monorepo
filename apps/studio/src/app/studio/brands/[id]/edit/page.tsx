import { redirect } from "next/navigation";

export default async function LegacyEditBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/studio/brands/${id}/brand-os`);
}
