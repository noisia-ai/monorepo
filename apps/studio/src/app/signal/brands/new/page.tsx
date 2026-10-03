import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Buildings } from "@phosphor-icons/react/dist/ssr";

import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { BrandOsForm } from "@/components/brands/BrandOsForm";
import { requirePortalUser } from "@/lib/auth/guards";
import { loadClientBrandCreationContextV1 } from "@/lib/auth/client-brand-self-service-server";

export const dynamic = "force-dynamic";

export default async function NewClientBrandPage() {
  const session = await requirePortalUser("/signal/brands/new");
  const context = await loadClientBrandCreationContextV1(session.appUser);
  if (!context) redirect("/unauthorized?next=%2Fsignal%2Fbrands%2Fnew");
  const [t, tBrandOs] = await Promise.all([
    getTranslations("AdminWorkspace"),
    getTranslations("BrandOs")
  ]);
  return <main className="signal-page">
    <div className="admin-workspace-page admin-workspace-page--form">
      <AdminWorkspaceHeader
        actions={<Link className="admin-button" href="/signal" prefetch={false}>
          <ArrowLeft aria-hidden size={14} />{tBrandOs("new.back")}
        </Link>}
        eyebrow={t("createBrand.eyebrow")}
        icon={<Buildings aria-hidden size={21} weight="fill" />}
        subtitle={tBrandOs("new.subtitle")}
        title={tBrandOs("new.title")}
      />
      <BrandOsForm clientContext={context} />
    </div>
  </main>;
}
