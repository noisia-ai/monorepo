import type {Pool, PoolClient} from 'pg';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {signalWorkspaceFeatureEnabledV1} from './signal-workspace-features';
import {mapCurrent} from './signal-mass-labeling';
import {SignalLabelingError} from './signal-labeling-runs';

export type MassLabelingLocalizationR13V1 = {
  topic_key: string; original_language: string;
  original: {name: string; definition: string};
  en: {name: string; definition: string}; es: {name: string; definition: string};
};
type Receipt = {root_id: string; input_digest: string; request_digest: string; response_digest: string;
  usage: {input_tokens: number; output_tokens: number}};
export type MassLabelingConsumerResultR13V1 = Receipt & {trigger_barrier: {
  type: 'choice'; choice: 'trigger' | 'barrier' | 'none'; confidence: number;
  probabilities: {trigger: number; barrier: number; none: number};
}};
export type MassLabelingInterestR13V1 = {interest_key: string; name: string; definition: string; localization?: Omit<MassLabelingLocalizationR13V1,'topic_key'>;
  results: Array<Receipt & {probability: number}>};
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const sha = /^sha256:[a-f0-9]{64}$/u;
function fail(code: string): never {throw new SignalLabelingError(code,409);}
const probability = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
function assertNoScopeOverride(row: object, allowInterestKey = false) {
  const forbidden = ['workspace_id','map_id','created_by_user_id','actor_user_id',...(allowInterestKey ? [] : ['interest_key'])];
  if (forbidden.some(field => Object.hasOwn(row,field))) fail('r13_scope_override');
}
function projectReceipt(row: Receipt) {
  return {root_id:row.root_id,input_digest:row.input_digest,request_digest:row.request_digest,
    response_digest:row.response_digest,usage:{input_tokens:row.usage.input_tokens,output_tokens:row.usage.output_tokens}};
}
function projectLocalization(row: Omit<MassLabelingLocalizationR13V1,'topic_key'>) {
  return {original_language:row.original_language,
    original:{name:row.original.name,definition:row.original.definition},
    en:{name:row.en.name,definition:row.en.definition},es:{name:row.es.name,definition:row.es.definition}};
}
function validateReceipt(row: Receipt) {
  assertNoScopeOverride(row);
  if (!uuid.test(row.root_id) || ![row.input_digest,row.request_digest,row.response_digest].every(x => sha.test(x))
    || !row.usage || ![row.usage.input_tokens,row.usage.output_tokens].every(x => Number.isSafeInteger(x) && x >= 0))
    fail('r13_receipt_invalid');
}
function validateTranslation(row: MassLabelingLocalizationR13V1) {
  assertNoScopeOverride(row);
  if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/u.test(row.original_language)) fail('r13_language_invalid');
  for (const text of [row.original,row.en,row.es]) {
    if (!text || typeof text.name !== 'string' || typeof text.definition !== 'string'
      || !text.name.trim() || text.name.length > 160 || !text.definition.trim() || text.definition.length > 1200)
      fail('r13_translation_invalid');
  }
}
/** Imports completed provider evidence. This operation does not start provider calls or
 * modify frozen maps, model decisions, selections, centroids or memberships. */
export async function importMassLabelingR13V1(args: {
  database: Pick<Pool,'connect'>; workspace_id: string; map_id: string; actor_user_id: string;
  translations?: MassLabelingLocalizationR13V1[]; results?: MassLabelingConsumerResultR13V1[];
  interests?: MassLabelingInterestR13V1[];
}) {
  if (![args.workspace_id,args.map_id,args.actor_user_id].every(x => uuid.test(x))) fail('r13_scope_invalid');
  const results = args.results ?? [], translations = args.translations ?? [], interests = args.interests ?? [];
  if (results.length > 2000 || translations.length > 200 || interests.length > 50
    || interests.some(x => x.results.length > 2000)) fail('r13_batch_invalid');
  for (const row of results) {
    validateReceipt(row); const answer = row.trigger_barrier;
    if (!answer || answer.type !== 'choice' || !['trigger','barrier','none'].includes(answer.choice)
      || !probability(answer.confidence) || !answer.probabilities
      || Object.keys(answer.probabilities).sort().join(',') !== 'barrier,none,trigger'
      || !Object.values(answer.probabilities).every(probability)
      || Math.abs(Object.values(answer.probabilities).reduce((a,b) => a+b,0)-1) > .010000000001)
      fail('r13_answer_invalid');
  }
  translations.forEach(validateTranslation);
  for (const interest of interests) {
    assertNoScopeOverride(interest,true);
    if (!/^[a-z][a-z0-9_]{0,119}$/u.test(interest.interest_key) || !interest.name.trim() || interest.name.length > 160
      || !interest.definition.trim() || interest.definition.length > 1200) fail('r13_interest_invalid');
    if (interest.localization) {
      validateTranslation({...interest.localization,topic_key:interest.interest_key});
      if (interest.localization.original.name !== interest.name || interest.localization.original.definition !== interest.definition)
        fail('r13_original_changed');
    }
    for (const row of interest.results) {validateReceipt(row); if (!probability(row.probability)) fail('r13_probability_invalid');}
  }
  const client = await args.database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mass-r13:'||$1,0))",[args.map_id]);
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,
      actor_user_id:args.actor_user_id,lock_authority:true});
    if (!caps.can_request_processing || !caps.can_edit_topics) throw new SignalLabelingError('r13_forbidden',403);
    if (!await signalWorkspaceFeatureEnabledV1({queryable:client,workspace_id:args.workspace_id,feature:'mass_labeling'}))
      throw new SignalLabelingError('r13_unavailable',404);
    const map = await mapCurrent(client,args.workspace_id,args.map_id);
    const catalog = new Map(map.catalog.map(t => [t.topic_key,t]));
    for (const row of translations) {
      const topic = catalog.get(row.topic_key);
      if (!topic || topic.name !== row.original.name || topic.definition !== row.original.definition) fail('r13_original_changed');
    }
    for (const interest of interests) if (catalog.has(interest.interest_key)) fail('r13_interest_conflicts_with_topic');
    const scope = {workspace_id:args.workspace_id,map_id:args.map_id,created_by_user_id:args.actor_user_id};
    await insertReceipts(client,'signal_mass_labeling_localizations',translations.map(row =>
      ({topic_key:row.topic_key,localization:projectLocalization(row),...scope})), 'topic_key text,localization jsonb', ['topic_key','localization']);
    await insertReceipts(client,'signal_mass_labeling_r13_results',results.map(row => ({...projectReceipt(row),trigger_barrier:{type:row.trigger_barrier.type,
      choice:row.trigger_barrier.choice,confidence:row.trigger_barrier.confidence,
      probabilities:{trigger:row.trigger_barrier.probabilities.trigger,barrier:row.trigger_barrier.probabilities.barrier,none:row.trigger_barrier.probabilities.none}},...scope})),
      'root_id uuid,input_digest text,trigger_barrier jsonb,request_digest text,response_digest text,usage jsonb',
      ['root_id','input_digest','trigger_barrier','request_digest','response_digest','usage']);
    for (const interest of interests) {
      await insertReceipts(client,'signal_mass_labeling_r13_interests',
        [{...scope,interest_key:interest.interest_key,name:interest.name,definition:interest.definition,localization:interest.localization ? projectLocalization(interest.localization) : null}],
        'interest_key text,name text,definition text,localization jsonb',['interest_key','name','definition','localization']);
      await insertReceipts(client,'signal_mass_labeling_r13_interest_results',interest.results.map(row =>
        ({...projectReceipt(row),probability:row.probability,...scope,interest_key:interest.interest_key})),
        'interest_key text,root_id uuid,input_digest text,probability double precision,request_digest text,response_digest text,usage jsonb',
        ['interest_key','root_id','input_digest','probability','request_digest','response_digest','usage']);
    }
    await client.query('COMMIT');
    return {map_digest:map.map_digest,translations:translations.length,results:results.length,
      interests:interests.length,interest_results:interests.reduce((n,i) => n+i.results.length,0)};
  } catch (error) {await client.query('ROLLBACK'); throw error;}
  finally {client.release();}
}
/** Table and column names are exclusively internal literals above. A receipt replay
 * accepts identical data and fails atomically if any stored evidence differs. */
async function insertReceipts(client: PoolClient, table: string, rows: Array<Record<string,unknown>>,
  definition: string, fields: string[]) {
  if (!rows.length) return;
  const input = JSON.stringify(rows), columns = ['workspace_id','map_id',...fields,'created_by_user_id'];
  const keys = table.endsWith('localizations') ? ['topic_key'] : table.endsWith('_interests') ? ['interest_key']
    : table.endsWith('interest_results') ? ['interest_key','root_id'] : ['root_id'];
  const unique = new Map<string,string>();
  for (const row of rows) {
    const key = keys.map(k => row[k]).join(':'), fingerprint = digest(row);
    if (unique.has(key)) fail('r13_duplicate_receipt');
    unique.set(key,fingerprint);
  }
  const cte = `WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb)
    r(workspace_id uuid,map_id uuid,${definition},created_by_user_id uuid))`;
  if (fields.includes('input_digest')) {
    const invalid = await client.query(`${cte} SELECT 1 FROM incoming r LEFT JOIN signal_mass_labeling_items item
      ON item.workspace_id=r.workspace_id AND item.map_id=r.map_id AND item.root_id=r.root_id
      WHERE item.root_id IS NULL OR item.input_digest<>r.input_digest LIMIT 1`,[input]);
    if (invalid.rowCount) fail('r13_input_changed');
  }
  const conflict = await client.query(`${cte} SELECT 1 FROM incoming r JOIN ${table} stored
    ON stored.workspace_id=r.workspace_id AND stored.map_id=r.map_id AND ${keys.map(k => `stored.${k}=r.${k}`).join(' AND ')}
    WHERE ${fields.filter(k => !keys.includes(k)).map(k => `stored.${k} IS DISTINCT FROM r.${k}`).join(' OR ')} LIMIT 1`,[input]);
  if (conflict.rowCount) fail('r13_receipt_conflict');
  await client.query(`${cte} INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.join(',')} FROM incoming
    ON CONFLICT DO NOTHING`,[input]);
}
