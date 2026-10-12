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
      <span>{t(item.source==="human" ? `decisionOrigin.${item.decided_via??"unknown"}` : `sources.${item.source}`)}</span></div>
    {item.requires_override_review?<p role="status">{t("overrideReview")}</p>:null}
    {item.title?<h4>{item.title}</h4>:null}
    {item.text?<p className="mfp-evidence__text"><MfpHighlightedText text={item.text} quotes={item.citations.map(c=>c.quote)}/></p>:<p>{t("withheld")}</p>}
    {item.rationale?<p>{item.rationale}</p>:null}
    {item.hybrid_review?<section aria-label={t("hybridReview.title")}>
      <h5>{t("hybridReview.title")}</h5>
      {([['first',item.hybrid_review.jev],['verification',item.hybrid_review.claude]] as const).map(([side,decision])=>{
        const citation=decision?.citation;
        const verified=item.text&&citation&&Number.isSafeInteger(citation.start)&&Number.isSafeInteger(citation.end)
          &&citation.start>=0&&citation.end>citation.start&&item.text.slice(citation.start,citation.end)===citation.quote&&citation.quote.trim().length>0;
        return <div key={side}><strong>{t(`hybridReview.${side}`)}</strong><p>{t(`verdicts.${decision?.verdict??"pending"}`)}</p>
          {verified?<blockquote>{citation!.quote}</blockquote>:<p>{t("hybridReview.withoutCitation")}</p>}</div>;
      })}
    </section>:null}
    <div className="admin-form-actions"><a href={mentionHref}>{t("openMention")}</a>
      {original?<a href={original} target="_blank" rel="noreferrer">{t("openOriginal")}</a>:null}</div>
  </article>;
}
