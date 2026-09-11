import type { SignalSemanticContextQueryable } from './signal-semantic-context-proposal';
import { SignalSemanticContextProposalExecutionError } from './signal-semantic-context-proposal';
import { signalSemanticContextProposalDigestV1 } from '@noisia/query-engine';
import {readSignalBrandOsCanonicalSnapshotV1,signalBrandOsCanonicalSnapshotHashV1} from './signal-brand-os-snapshot';
export type BrandContextWorkspaceV1={id:string;organizationId:string;subject:{type:'brand';id:string};timezone:string};
export type SignalBrandContextAuthorityV1={brandOsProfileId:string;brandOsProfileVersion:number;brandOsDigest:string;
knowledgeGenerationKey:string;knowledgeDigest:string;localeContextDigest:string;primaryLocale:string;
localeVariants:string[];markets:string[];timezone:string;sourceAuthorityDigest:string};
const digestPattern=/^sha256:[0-9a-f]{64}$/u;
const localePattern=/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?$/u;
const countryPattern=/^[A-Z]{2}$/u;
export function canonicalBrandContextLocaleV1(value:string):string {
  try { const locale=new Intl.Locale(value); const canonical=locale.region?`${locale.language}-${locale.region}`:locale.language;
    if(!localePattern.test(canonical))throw new Error(); return canonical;
  } catch {throw new SignalSemanticContextProposalExecutionError('locale_market_authority_required',422);}
}
function inferredCountryLocale(country:string):string {
  try {
    // Persisted/imported snapshots can predate API validation. Do not let Intl
    // parse arbitrary region subtags or leak RangeError out of the authority.
    if(!countryPattern.test(country))throw new RangeError();
    return canonicalBrandContextLocaleV1(new Intl.Locale(`und-${country}`).maximize().baseName);
  } catch {
    throw new SignalSemanticContextProposalExecutionError('locale_market_authority_required',422);
  }
}
const normalizeStrings=(value:unknown):string[]=>Array.isArray(value)?[...new Set(value.filter((v):v is string=>typeof v==='string'&&v.trim().length>0).map(v=>v.trim()))].sort():[];
const canonicalDigest=signalSemanticContextProposalDigestV1;
export async function resolveSignalBrandContextAuthorityV1(args:{queryable:SignalSemanticContextQueryable;
  workspace:BrandContextWorkspaceV1;primary_locale?:string}):Promise<SignalBrandContextAuthorityV1>{
  if(args.workspace.subject.type!=="brand")throw new SignalSemanticContextProposalExecutionError("brand_workspace_required",422);
  const profile=await args.queryable.query<{id:string;version:number;digest:string|null;countries:string[]}>(`
    SELECT profile.id::text,profile.version,(profile.metadata->>'snapshot_hash')::text digest,profile.metadata->'countries' countries
    FROM brand_os_profiles profile WHERE profile.brand_id=$1::uuid AND profile.organization_id=$2::uuid AND profile.status='active'
    ORDER BY profile.version DESC LIMIT 1`,[args.workspace.subject.id,args.workspace.organizationId]);
  const active=profile.rows[0];if(!active||!digestPattern.test(active.digest??"")){
    throw new SignalSemanticContextProposalExecutionError("brand_os_snapshot_required",409);
  }
  const current=await readSignalBrandOsCanonicalSnapshotV1({queryable:args.queryable,brand_id:args.workspace.subject.id,organization_id:args.workspace.organizationId});
  if(!current||signalBrandOsCanonicalSnapshotHashV1(current)!==active.digest
    ||!Array.isArray(active.countries)||active.countries.some(country=>typeof country!=='string')
    ||JSON.stringify(active.countries)!==JSON.stringify(current.countries)){
    throw new SignalSemanticContextProposalExecutionError('brand_os_snapshot_stale',409);
  }
  const plan=await args.queryable.query<{brief:Record<string,unknown>}>(`
    SELECT acquisition_brief brief FROM signal_acquisition_plans
    WHERE workspace_id=$1::uuid AND acquisition_brief IS NOT NULL
      AND status IN ('current','draft')
    ORDER BY CASE status WHEN 'current' THEN 0 ELSE 1 END,plan_version DESC LIMIT 1`,[args.workspace.id]);
  const inferred=active.countries.map(inferredCountryLocale);
  // A generated locale is an output of the current Brand OS authority, not a
  // durable user override. Reusing it from an older preparation would pin the
  // first country forever after the brand changes. An explicit request or a
  // governed acquisition plan remains the only override provenance.
  const explicit=args.primary_locale;
  const brief=plan.rows[0]?.brief??{languages:explicit?[explicit,...inferred]:inferred,
    primary_locale:explicit??inferred[0],countries:active.countries,timezone:args.workspace.timezone};
  const locales=normalizeStrings(brief.languages);const markets=normalizeStrings(brief.countries);
  const primaryLocale=typeof brief.primary_locale==="string"?brief.primary_locale:
    locales[0]?.includes("-")?locales[0]:markets[0]&&locales[0]?`${locales[0].slice(0,2).toLowerCase()}-${markets[0]}`:"";
  const timezone=typeof brief.timezone==="string"?brief.timezone:args.workspace.timezone;
  if(!localePattern.test(primaryLocale)||locales.length<1||markets.length<1||markets.some(market=>!countryPattern.test(market))||!timezone){
    throw new SignalSemanticContextProposalExecutionError("locale_market_authority_required",409);
  }
  const localeVariants=[...new Set([primaryLocale,...locales.filter((value)=>localePattern.test(value))])].sort();
  const sources=await args.queryable.query<{id:string;source_kind:string;file_hash:string|null;
    content_digest:string;updated_at:Date|string}>(`
    SELECT source.id::text,source.source_kind,source.file_hash,
      'sha256:'||encode(digest(COALESCE(source.raw_text,'')||source.extracted_payload::text,'sha256'),'hex') content_digest,
      source.updated_at
    FROM brand_knowledge_sources source
    WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid
      AND source.study_corpus_id IS NULL AND source.status IN ('processed','profiled','active')
    ORDER BY source.id`,[args.workspace.organizationId,args.workspace.subject.id]);
  const chunks=await args.queryable.query<{id:string;source_id:string;content_digest:string}>(`
    SELECT chunk.id::text,chunk.knowledge_source_id::text source_id,
      'sha256:'||encode(digest(chunk.chunk_text,'sha256'),'hex') content_digest
    FROM knowledge_chunks chunk JOIN brand_knowledge_sources source ON source.id=chunk.knowledge_source_id
    WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid
      AND source.study_corpus_id IS NULL AND source.status IN ('processed','profiled','active')
    ORDER BY chunk.id`,[args.workspace.organizationId,args.workspace.subject.id]);
  const knowledgeDigest=canonicalDigest({sources:sources.rows.map((row)=>({id:row.id,kind:row.source_kind,
      digest:digestPattern.test(row.file_hash??"")?row.file_hash:row.content_digest})),chunks:chunks.rows});
  const knowledgeGenerationKey=`knowledge-${knowledgeDigest.slice(7,23)}`;
  const localeContextDigest=canonicalDigest({primary_locale:primaryLocale,locale_variants:localeVariants,
    markets:[...markets].sort(),timezone});
  const sourceAuthorityDigest=canonicalDigest({brand_os_profile_id:active.id,
    brand_os_profile_version:active.version,brand_os_digest:active.digest,knowledge_generation_key:knowledgeGenerationKey,
    knowledge_digest:knowledgeDigest,locale_context_digest:localeContextDigest});
  return{brandOsProfileId:active.id,brandOsProfileVersion:active.version,brandOsDigest:active.digest!,
    knowledgeGenerationKey,knowledgeDigest,localeContextDigest,primaryLocale,localeVariants,
    markets:[...markets].sort(),timezone,sourceAuthorityDigest};
}
