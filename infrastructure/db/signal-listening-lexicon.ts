import {rankSignalLexiconEvidenceV1, type SignalLexiconEvidenceCountsV1} from '@noisia/query-engine';
import {mapCurrent} from './signal-mass-labeling';
import {authorizeSignalListeningV1,loadSignalListeningConfigurationWithClientV1,listeningTransactionV1,
  listeningFailV1 as fail,type SignalListeningAccessV1} from './signal-listening-configuration';

/** Aggregate-only evidence from the same rights-scoped listening population.
 * Foreground uses effective category membership, with human decisions taking precedence;
 * background is all classified consumer conversation. No methodology is required. */
export async function loadSignalListeningLexiconSuggestionsV1(args:SignalListeningAccessV1&{
  configuration_id:string;map_id:string;limit?:number;
}) {
  const limit=args.limit??100;
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)fail('lexicon_suggestion_invalid',422);
  return listeningTransactionV1(args.database,async client=>{
    await authorizeSignalListeningV1(client,args);
    const configuration=await loadSignalListeningConfigurationWithClientV1(client,args.workspace_id,args.configuration_id);
    if(!configuration||configuration.state!=='published')return fail('listening_configuration_unavailable');
    const map=await mapCurrent(client,args.workspace_id,args.map_id);
    const row=(await client.query<{foreground_size:number;background_size:number;category_topics:number;items:SignalLexiconEvidenceCountsV1[]}>(`
      WITH population AS MATERIALIZED (
        SELECT * FROM signal_listening_effective_population_roots_v2($1::uuid,$2::uuid,$3::uuid,$4,NULL::uuid[],'client-derived-metrics')
      ), roots AS MATERIALIZED (
        SELECT root_id,
          bool_or(question_key='voice' AND answer->>'choice'='individual') consumer,
          bool_or(question_key='promotion' AND (answer->>'noul')::double precision<=.7) not_promotional,
          bool_or(candidate AND scope_state='included' AND definition->>'domain'='category'
            AND definition ? 'topic_source' AND effective_belongs IS TRUE) category_confirmed
        FROM population GROUP BY root_id
      ), conversation AS MATERIALIZED (
        SELECT roots.root_id,mention.language,
          normalize(lower(mention.text_clean),NFKC) text,
          COALESCE(roots.category_confirmed,false) AND NOT signal_mass_labeling_category_matches_v1(
            mention.text_clean,ARRAY(SELECT jsonb_array_elements_text($5::jsonb))) foreground
        FROM roots JOIN mentions mention ON mention.workspace_id=$1::uuid AND mention.id=roots.root_id
        WHERE roots.consumer AND roots.not_promotional AND NOT signal_mass_labeling_r13_hashtags_v1(mention.text_clean)
      ), words AS MATERIALIZED (
        SELECT root_id,language,foreground,token.word,token.position,
          lead(token.word) OVER(PARTITION BY root_id ORDER BY token.position) following
        FROM conversation CROSS JOIN LATERAL regexp_split_to_table(
          btrim(regexp_replace(text,'[^[:alnum:]]+',' ','g')),' +') WITH ORDINALITY token(word,position)
      ), terms AS MATERIALIZED (
        SELECT DISTINCT root_id,language,foreground,candidate.term
        FROM words CROSS JOIN LATERAL (VALUES(word),(word||' '||following)) candidate(term)
        WHERE char_length(candidate.term) BETWEEN 2 AND 200 AND candidate.term ~ '[[:alpha:]]'
      ), counts AS (
        SELECT term,language,count(*) FILTER(WHERE foreground)::int foreground_roots,count(*)::int background_roots
        FROM terms GROUP BY term,language HAVING count(*) FILTER(WHERE foreground)>=3
      ) SELECT (SELECT count(*)::int FROM conversation WHERE foreground) foreground_size,
        (SELECT count(*)::int FROM conversation) background_size,
        (SELECT count(*)::int FROM signal_listening_questions WHERE configuration_id=$2::uuid
          AND definition->>'domain'='category' AND definition ? 'topic_source') category_topics,
        COALESCE((SELECT jsonb_agg(counts ORDER BY term,language) FROM counts),'[]'::jsonb) items`,
      [args.workspace_id,configuration.id,map.id,map.entity_context_digest,JSON.stringify(configuration.configuration.lexicon_terms)])).rows[0]!;
    return {contract_version:'signal-listening-lexicon-suggestions-v1' as const,configuration_id:configuration.id,
      configuration_revision:configuration.revision,workspace_id:args.workspace_id,available:row.category_topics>0,
      foreground_size:row.foreground_size,background_size:row.background_size,minimum_roots:3,
      items:rankSignalLexiconEvidenceV1({...row,existing_terms:configuration.configuration.lexicon_terms,limit}),
      basis:'Confirmed category topics outside the lexicon versus all classified consumer conversation; distinct canonical roots.'};
  });
}
