"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function CorpusNavTabs({ corpusId }: { corpusId: string }) {
  const pathname = usePathname();

  const tabs = [
    { label: "Engine",    href: `/studio/corpora/${corpusId}/engine` },
    { label: "Menciones", href: `/studio/corpora/${corpusId}/mentions` },
    { label: "Review", href: `/studio/corpora/${corpusId}/analysis` },
  ] as const;

  return (
    <div className="corpus-navbar-tabs" role="tablist">
      {tabs.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`corpus-tab${isActive ? " corpus-tab--active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            role="tab"
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
