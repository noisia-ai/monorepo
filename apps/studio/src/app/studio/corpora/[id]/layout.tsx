import type { ReactNode } from "react";

import { CorpusNavTabs } from "@/components/corpus/CorpusNavTabs";
import { SessionBadge } from "@/components/layout/SessionBadge";
import { requireStudioUser } from "@/lib/auth/guards";
import { getCorpusForUser } from "@/lib/data/corpora";

export default async function CorpusLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStudioUser(`/studio/corpora/${id}/engine`);

  // If corpus is null the child page's own notFound() will fire; the layout
  // still renders the nav shell so the transition feels smooth.
  const corpus = await getCorpusForUser(session.appUser, id);

  const corpusName = corpus
    ? (corpus.name ?? corpus.brandName ?? corpus.themeName ?? "Corpus")
    : null;

  return (
    <>
      <nav className="corpus-navbar" aria-label="Noisia Studio">
        <a href="/studio" className="corpus-navbar-logo" aria-label="Ir al inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/logos/logo_black.svg"
            alt="Noisia"
            width={84}
            height={29}
          />
        </a>
        {corpusName && (
          <>
            <span className="corpus-navbar-divider" aria-hidden="true" />
            <div className="corpus-navbar-center">
              <span className="corpus-navbar-name">{corpusName}</span>
              {corpus?.methodologyName && (
                <span className="corpus-navbar-meta">{corpus.methodologyName}</span>
              )}
            </div>
          </>
        )}
        <CorpusNavTabs corpusId={id} />
        <SessionBadge user={session.appUser} compact />
      </nav>
      <main className="app-content">{children}</main>
    </>
  );
}
