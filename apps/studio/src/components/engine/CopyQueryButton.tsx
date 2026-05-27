"use client";

import { useState } from "react";

import { Icon } from "@/components/ui/Icon";

export function CopyQueryButton({ queryText }: { queryText: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(queryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const preview = queryText.length > 80 ? queryText.slice(0, 80) + "…" : queryText;

  return (
    <span className="copy-query-wrap">
      <span className="copy-query-preview">
        <code className="iteration-query-cell" title={queryText}>
          {expanded ? queryText : preview}
        </code>
        <span className="copy-query-actions">
          {queryText.length > 80 && (
            <button
              className="btn-micro"
              onClick={() => setExpanded((v) => !v)}
              type="button"
              title={expanded ? "Colapsar" : "Ver completa"}
            >
              <Icon name="chevron-down" size={12} className={expanded ? "icon--flip" : undefined} />
              {expanded ? "Colapsar" : "Ver todo"}
            </button>
          )}
          <button
            className={`btn-micro${copied ? " btn-copied" : ""}`}
            onClick={copy}
            type="button"
            title="Copiar query"
          >
            {copied ? <Icon name="check" size={12} /> : <Icon name="copy" size={12} />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        </span>
      </span>
    </span>
  );
}
