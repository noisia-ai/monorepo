import Link from "next/link";

import { BrandOsForm } from "@/components/brands/BrandOsForm";
import { StudioNav } from "@/components/layout/StudioNav";
import { Icon } from "@/components/ui/Icon";
import { requireStudioUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function NewBrandPage() {
  const session = await requireStudioUser("/studio/brands/new");

  return (
    <>
      <StudioNav
        activeSection="brands"
        crumbs={[
          { label: "Marcas", href: "/studio/brands" },
          { label: "Nueva marca" }
        ]}
        user={session.appUser}
      />
      <main className="app-content">
        <div className="studio-page">
          <header className="page-head">
            <div>
              <p className="vitals-eyebrow">Control plane</p>
              <h1 className="page-head-title">Nueva marca</h1>
              <p className="page-head-sub">
                Crea la entidad base: organización, aliases, competidores y conocimiento inicial para futuros estudios.
              </p>
            </div>
            <Link className="wizard-cta wizard-cta--ghost" href="/studio/brands">
              <Icon name="arrow-right" size={13} className="icon--flip" /> Marcas
            </Link>
          </header>
          <BrandOsForm />
        </div>
      </main>
    </>
  );
}
