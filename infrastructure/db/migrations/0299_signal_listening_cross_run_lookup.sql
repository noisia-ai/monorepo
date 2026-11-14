-- Call validation probes prior receipts by semantic question within a tenant/root.
-- Cover the complete lookup without scanning unrelated runs or call history.
CREATE INDEX signal_listening_call_questions_scope_lookup
 ON signal_listening_call_questions(workspace_id,root_id,question_digest)
 INCLUDE(run_id,call_id);
