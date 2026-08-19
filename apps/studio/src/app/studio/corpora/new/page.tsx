import { Flask, Plus, SquaresFour } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { NewStudyForm } from "@/components/corpus/NewStudyForm";
import { requireStudioUser } from "@/lib/auth/guards";
import { listBrandsForUser } from "@/lib/data/brands";
import { listActiveMethodologies, listReusableBaselineCorporaForUser } from "@/lib/data/corpora";
import { listThemesForUser } from "@/lib/data/themes";
import { getSearchParam, resolveSearchParams, type StudioSearchParams } from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function NewStudyPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const t = await getTranslations("NewStudyPage");
  const session = await requireStudioUser("/studio/corpora/new");
  const params = await resolveSearchParams(searchParams);
  const defaultBrandId = getSearchParam(params, "brand") ?? undefined;
  const defaultSubjectType = getSearchParam(params, "subject") === "theme" ? "theme" : undefined;

  const [brands, themes, methodologies, baselineCorpora] = await Promise.all([
    listBrandsForUser(session.appUser, { status: "active", pageSize: 500 }),
    listThemesForUser(session.appUser, { status: "active", pageSize: 500 }),
    listActiveMethodologies(),
    listReusableBaselineCorporaForUser(session.appUser)
  ]);

  return (
    <div className="admin-workspace-page admin-study-intake-page">
      <AdminWorkspaceHeader
        actions={(
          <>
            <Link prefetch={false} className="admin-button" href="/studio">
              <SquaresFour aria-hidden size={15} /> {t("workspace")}
            </Link>
            <Link prefetch={false} className="admin-button" href="/studio/brands/new">
              <Plus aria-hidden size={15} /> {t("newBrand")}
            </Link>
          </>
        )}
        eyebrow={t("eyebrow")}
        icon={<Flask aria-hidden />}
        subtitle={t("subtitle")}
        title={t("title")}
      />

      <NewStudyForm
        brands={brands.data}
        themes={themes.data}
        baselineCorpora={baselineCorpora}
        methodologies={methodologies}
        defaultBrandId={defaultBrandId}
        defaultSubjectType={defaultSubjectType}
      />
    </div>
  );
}
