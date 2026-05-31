import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BrandOsForm } from "@/components/brands/BrandOsForm";
import { StudioNav } from "@/components/layout/StudioNav";
import { Icon } from "@/components/ui/Icon";
import { requireStudioUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function NewBrandPage() {
  const t = await getTranslations("BrandOs");
  const session = await requireStudioUser("/studio/brands/new");

  return (
    <>
      <StudioNav
        activeSection="brands"
        crumbs={[
          { label: t("new.back"), href: "/studio/brands" },
          { label: t("new.crumb") }
        ]}
        user={session.appUser}
      />
      <main className="app-content">
        <div className="studio-page">
          <header className="page-head">
            <div>
              <p className="vitals-eyebrow">{t("new.eyebrow")}</p>
              <h1 className="page-head-title">{t("new.title")}</h1>
              <p className="page-head-sub">{t("new.subtitle")}</p>
            </div>
            <Link prefetch={false} className="wizard-cta wizard-cta--ghost" href="/studio/brands">
              <Icon name="arrow-right" size={13} className="icon--flip" /> {t("new.back")}
            </Link>
          </header>
          <BrandOsForm />
        </div>
      </main>
    </>
  );
}
