"use client";
import {useTranslations} from "next-intl";
import {mfpQuoteParts,mfpSafeUrl,type MfpEvidence as Evidence} from "@/lib/data-os/mfp-ui";
export function MfpHighlightedText({text,quotes}:{text:string;quotes:string[]}) {
  return <>{mfpQuoteParts(text,quotes).map((part,index)=>part.highlight?<mark key={index}>{part.text}</mark>:<span key={index}>{part.text}</span>)}</>;
}
export function MfpEvidence({item,mentionHref}:{item:Evidence;mentionHref:string}) {
  const t=useTranslations("Mfp"); const original=mfpSafeUrl(item.url);
  return <article className="mfp-evidence">
    <div className="mfp-evidence__meta"><strong>{t(`verdicts.${item.verdict}`)}</strong><span>{item.platform}</span>
      <span>{t(`sources.${item.source}`)}</span></div>
    {item.requires_override_review?<p role="status">{t("overrideReview")}</p>:null}
    {item.title?<h4>{item.title}</h4>:null}
    {item.text?<p className="mfp-evidence__text"><MfpHighlightedText text={item.text} quotes={item.citations.map(c=>c.quote)}/></p>:<p>{t("withheld")}</p>}
    {item.rationale?<p>{item.rationale}</p>:null}
    <div className="admin-form-actions"><a href={mentionHref}>{t("openMention")}</a>
      {original?<a href={original} target="_blank" rel="noreferrer">{t("openOriginal")}</a>:null}</div>
  </article>;
}
