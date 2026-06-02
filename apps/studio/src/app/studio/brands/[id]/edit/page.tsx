import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BrandEditForm } from "@/components/brands/BrandEditForm";
import { KnowledgeBaseManager } from "@/components/brands/KnowledgeBaseManager";
import { StudioNav } from "@/components/layout/StudioNav";
import { Icon } from "@/components/ui/Icon";
import { requireStudioUser } from "@/lib/auth/guards";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { listOrganizationsForPicker } from "@/lib/data/team";

export const dynamic = "force-dynamic";

export default async function EditBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("BrandEdit");
  const tBrands = await getTranslations("Brands");
  const { id } = await params;
  const session = await requireStudioUser(`/studio/brands/${id}/edit`);
  const [brand, organizations] = await Promise.all([
    getBrandDetailForUser(session.appUser, id),
    listOrganizationsForPicker()
  ]);

  if (!brand) {
    notFound();
  }

  const brandLabel = brand.displayName ?? brand.name;

  return (
    <>
      <StudioNav
        activeSection="brands"
        crumbs={[
          { label: tBrands("crumb"), href: "/studio/brands" },
          { label: brandLabel, href: `/studio/brands/${brand.id}` },
          { label: t("edit") }
        ]}
        user={session.appUser}
      />
      <main className="app-content">
        <div className="studio-page">
          <header className="page-head">
            <div>
              <p className="vitals-eyebrow">{t("eyebrow")}</p>
              <h1>{t("title", { brand: brandLabel })}</h1>
              <p>{t("subtitle")}</p>
            </div>
            <Link prefetch={false} className="wizard-cta wizard-cta--ghost" href={`/studio/brands/${brand.id}`}>
              <Icon name="arrow-right" size={13} className="icon--flip" /> {t("back")}
            </Link>
          </header>

          <BrandEditForm
            brand={brand}
            organizations={organizations.map((organization) => ({
              id: organization.id,
              name: organization.name ?? organization.legalName
            }))}
          />
          <KnowledgeBaseManager brandId={brand.id} sources={brand.knowledgeSources} />
        </div>
      </main>
    </>
  );
}
