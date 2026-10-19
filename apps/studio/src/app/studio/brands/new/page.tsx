import Link from "next/link";
import { ArrowLeft, Buildings } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";

import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { BrandOsForm } from "@/components/brands/BrandOsForm";
import { requireStudioUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function NewBrandPage() {
  const [t, tBrandOs] = await Promise.all([
    getTranslations("AdminWorkspace"),
    getTranslations("BrandOs")
  ]);
  await requireStudioUser("/studio/brands/new");

  return (
    <div className="admin-workspace-page admin-workspace-page--form">
      <AdminWorkspaceHeader
        actions={(
          <Link className="admin-button" href="/studio/brands" prefetch={false}>
            <ArrowLeft aria-hidden size={14} />{tBrandOs("new.back")}
          </Link>
        )}
        eyebrow={t("createBrand.eyebrow")}
        icon={<Buildings aria-hidden size={21} weight="fill" />}
        subtitle={tBrandOs("new.subtitle")}
        title={tBrandOs("new.title")}
      />
      <BrandOsForm />
    </div>
  );
}
