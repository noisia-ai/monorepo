import Link from "next/link";

import { NewStudyForm } from "@/components/corpus/NewStudyForm";
import { StudioNav } from "@/components/layout/StudioNav";
import { Icon } from "@/components/ui/Icon";
import { requireStudioUser } from "@/lib/auth/guards";
import { listBrandsForUser } from "@/lib/data/brands";
import { listActiveMethodologies } from "@/lib/data/corpora";
import { getSearchParam, resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function NewStudyPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const session = await requireStudioUser("/studio/corpora/new");
  const params = await resolveSearchParams(searchParams);
  const defaultBrandId = getSearchParam(params, "brand") ?? undefined;

  const [brands, methodologies] = await Promise.all([
    listBrandsForUser(session.appUser, { status: "active", pageSize: 500 }),
    listActiveMethodologies()
  ]);

  return (
    <>
      <StudioNav
        activeSection={null}
        crumbs={[
          { label: "Studio", href: "/studio" },
          { label: "Nuevo estudio" }
        ]}
        user={session.appUser}
      />
      <main className="app-content">
        <div className="studio-page">
          <header className="page-head">
            <div>
              <p className="vitals-eyebrow">Corpus setup</p>
              <h1 className="page-head-title">Nuevo estudio</h1>
              <p className="page-head-sub">
                Crea el contenedor del estudio y abre el Engine para generar queries, importar CSVs y aprobar el corpus.
              </p>
            </div>
            <Link className="wizard-cta wizard-cta--ghost" href="/studio">
              <Icon name="arrow-right" size={13} className="icon--flip" /> Workspace
            </Link>
            <Link className="wizard-cta wizard-cta--secondary" href="/studio/brands/new">
              <Icon name="tag" size={13} /> Nueva marca
            </Link>
          </header>

          <NewStudyForm
            brands={brands.data}
            methodologies={methodologies}
            defaultBrandId={defaultBrandId}
          />
        </div>
      </main>
    </>
  );
}
