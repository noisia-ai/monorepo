-- Data OS Signal serving entities.
-- Keep strategic opportunities and Action Studio separate from the operational
-- tb_recommendations playbook, while preserving finding-level provenance.

CREATE TABLE IF NOT EXISTS tb_strategic_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tb_analysis_id uuid NOT NULL REFERENCES tb_analyses(id) ON DELETE CASCADE,
  opportunity_id text NOT NULL,
  title text NOT NULL,
  decision text NOT NULL,
  why_now text NOT NULL,
  level text NOT NULL,
  source_mix text[] NOT NULL DEFAULT ARRAY[]::text[],
  evidence_summary text NOT NULL,
  what_to_do text NOT NULL,
  success_signal text NOT NULL,
  confidence text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tb_strategic_opportunities_analysis_id UNIQUE (tb_analysis_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_tb_strategic_opportunities_analysis
  ON tb_strategic_opportunities (tb_analysis_id, position);
CREATE INDEX IF NOT EXISTS idx_tb_strategic_opportunities_level
  ON tb_strategic_opportunities (tb_analysis_id, level, confidence);

CREATE TABLE IF NOT EXISTS tb_opportunity_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES tb_strategic_opportunities(id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES tb_findings(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tb_opportunity_findings_pair UNIQUE (opportunity_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_tb_opportunity_findings_finding
  ON tb_opportunity_findings (finding_id);

CREATE TABLE IF NOT EXISTS tb_action_studio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tb_analysis_id uuid NOT NULL REFERENCES tb_analyses(id) ON DELETE CASCADE,
  action_id text NOT NULL,
  target_team text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  primary_finding_id uuid REFERENCES tb_findings(id) ON DELETE SET NULL,
  rationale text NOT NULL,
  action_text text NOT NULL,
  suggested_channel text,
  suggested_format text,
  success_signal text NOT NULL,
  estimated_effort text NOT NULL,
  estimated_impact text NOT NULL,
  confidence text NOT NULL,
  priority_rank integer NOT NULL DEFAULT 0,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tb_action_studio_analysis_id UNIQUE (tb_analysis_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_tb_action_studio_analysis
  ON tb_action_studio (tb_analysis_id, priority_rank);
CREATE INDEX IF NOT EXISTS idx_tb_action_studio_target
  ON tb_action_studio (tb_analysis_id, target_team, kind);

CREATE TABLE IF NOT EXISTS tb_action_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES tb_action_studio(id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES tb_findings(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tb_action_findings_pair UNIQUE (action_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_tb_action_findings_finding
  ON tb_action_findings (finding_id);
