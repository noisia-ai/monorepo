-- Read the current human revision once per statement, in the same STABLE snapshot.
-- Membership precedence, raw classifier answers and all authorization bindings
-- remain unchanged. This materialization is never shared across statements.
CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(w uuid,cid uuid,mid uuid,ctx text,roots uuid[],purpose text)
RETURNS TABLE(root_id uuid,input_digest text,body text,published_at timestamptz,platform text,
 question_key text,question_digest text,definition jsonb,wire jsonb,candidate boolean,scope_state text,
 answer jsonb,cache_call_id uuid,scope_basis text,effective_belongs boolean,human_belongs boolean,
 human_decision_id uuid,legacy_manual_id uuid,label_source text,human_edit_revision bigint)
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH revision AS MATERIALIZED(SELECT signal_listening_human_revision_v1(cid) n),
 population AS MATERIALIZED(SELECT * FROM signal_listening_population_roots_v1(w,cid,mid,ctx,roots,purpose))
 SELECT p.root_id,p.input_digest,p.body,p.published_at,p.platform,p.question_key,p.question_digest,p.definition,p.wire,
  p.candidate OR decision.id IS NOT NULL OR legacy.id IS NOT NULL,p.scope_state,
  CASE WHEN revision.n>0 THEN raw.answer ELSE p.answer END,
  CASE WHEN revision.n>0 THEN raw.call_id ELSE p.cache_call_id END,p.scope_basis,
  CASE WHEN p.definition ? 'topic_source' THEN COALESCE(decision.belongs,legacy.belongs,(raw.answer->>'noul')::double precision>=0.7) END,
  COALESCE(decision.belongs,legacy.belongs),decision.id,legacy.id,
  CASE WHEN decision.id IS NOT NULL THEN 'human' WHEN legacy.id IS NOT NULL THEN 'legacy_human' WHEN raw.call_id IS NOT NULL THEN 'jev' ELSE 'pending' END,
  decision.revision
 FROM population p CROSS JOIN revision
 LEFT JOIN signal_listening_answers raw ON raw.workspace_id=w AND raw.root_id=p.root_id AND raw.input_digest=p.input_digest AND raw.entity_context_digest=ctx AND raw.question_digest=p.question_digest
 LEFT JOIN LATERAL(SELECT d.*,e.revision FROM signal_listening_human_memberships d JOIN signal_listening_human_edits e ON e.id=d.edit_id AND e.workspace_id=d.workspace_id
  WHERE d.workspace_id=w AND d.map_id=mid AND d.root_id=p.root_id AND d.input_digest=p.input_digest AND d.entity_context_digest=ctx AND d.question_digest=p.question_digest
   AND e.revision<=revision.n ORDER BY e.revision DESC,d.id DESC LIMIT 1)decision ON true
 LEFT JOIN LATERAL(SELECT d.* FROM signal_listening_discovery_manual d WHERE d.workspace_id=w AND d.map_id=mid AND d.root_id=p.root_id AND d.input_digest=p.input_digest AND d.entity_context_digest=ctx AND d.question_digest=p.question_digest
  ORDER BY d.created_at DESC,d.id DESC LIMIT 1)legacy ON true
$$;
