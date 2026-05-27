import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandEditForm } from "@/components/brands/BrandEditForm";
import { KnowledgeBaseManager } from "@/components/brands/KnowledgeBaseManager";
import { StudioNav } from "@/components/layout/StudioNav";
import { Icon } from "@/components/ui/Icon";
import { requireStudioUser } from "@/lib/auth/guards";
import { getBrandDetailForUser } from "@/lib/data/brands";

export const dynamic = "force-dynamic";

export default async function EditBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStudioUser(`/studio/brands/${id}/edit`);
  const brand = await getBrandDetailForUser(session.appUser, id);

  if (!brand) {
    notFound();
  }

  const brandLabel = brand.displayName ?? brand.name;

  return (
    <>
      <StudioNav
        activeSection="brands"
        crumbs={[
          { label: "Marcas", href: "/studio/brands" },
          { label: brandLabel, href: `/studio/brands/${brand.id}` },
          { label: "Editar" }
        ]}
        user={session.appUser}
      />
      <main className="app-content">
        <div className="studio-page">
          <header className="page-head">
            <div>
              <p className="vitals-eyebrow">Brand OS</p>
              <h1>Editar {brandLabel}</h1>
              <p>Actualiza identidad, categoría, relaciones y Knowledge Base sin recrear la marca.</p>
            </div>
            <Link className="wizard-cta wizard-cta--ghost" href={`/studio/brands/${brand.id}`}>
              <Icon name="arrow-right" size={13} className="icon--flip" /> Volver a marca
            </Link>
          </header>

          <BrandEditForm brand={brand} />
          <KnowledgeBaseManager brandId={brand.id} sources={brand.knowledgeSources} />
        </div>
      </main>
    </>
  );
}
