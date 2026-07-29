-- Espelha dados relevantes da fonte e mantém o controle operacional separado.
BEGIN;

CREATE TABLE IF NOT EXISTS followup.lead_followup_control (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES followup.leads(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES followup.sources(id) ON DELETE RESTRICT,
  source_chat_id text NOT NULL,

  source_followup_enabled boolean,
  source_stage integer,
  source_legacy_stage text,
  source_followup_date timestamptz,
  source_last_message_at timestamptz,
  source_created_at timestamptz,
  anchor_at timestamptz NOT NULL,

  control_status text NOT NULL DEFAULT 'pending'
    CHECK (control_status IN ('pending', 'in_progress', 'completed', 'paused', 'blocked')),
  control_stage integer NOT NULL DEFAULT 0 CHECK (control_stage >= 0),
  followup_count integer NOT NULL DEFAULT 0 CHECK (followup_count >= 0),
  last_followup_at timestamptz,
  next_followup_at timestamptz,
  last_message_id uuid REFERENCES followup.messages(id) ON DELETE SET NULL,
  completed_at timestamptz,
  last_source_sync_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_followup_control_source_stage_idx
  ON followup.lead_followup_control (source_id, source_stage);
CREATE INDEX IF NOT EXISTS lead_followup_control_status_idx
  ON followup.lead_followup_control (control_status, next_followup_at);
CREATE INDEX IF NOT EXISTS lead_followup_control_anchor_idx
  ON followup.lead_followup_control (anchor_at);

DROP TRIGGER IF EXISTS lead_followup_control_set_updated_at ON followup.lead_followup_control;
CREATE TRIGGER lead_followup_control_set_updated_at
  BEFORE UPDATE ON followup.lead_followup_control
  FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();

-- Vincula inscrições existentes ao controle sem inventar que uma mensagem foi enviada.
INSERT INTO followup.lead_followup_control
  (lead_id, source_id, source_chat_id, anchor_at, control_status, control_stage, next_followup_at)
SELECT l.id, l.source_id, COALESCE(l.source_chat_id, l.external_id), l.reference_at,
  CASE e.state
    WHEN 'active' THEN 'in_progress'
    WHEN 'completed' THEN 'completed'
    WHEN 'paused' THEN 'paused'
    WHEN 'blocked' THEN 'blocked'
    ELSE 'pending'
  END,
  GREATEST(COALESCE(e.current_step_order, 1) - 1, 0),
  e.next_send_at
FROM followup.leads l
LEFT JOIN LATERAL (
  SELECT enrollment.state, enrollment.current_step_order, enrollment.next_send_at
  FROM followup.enrollments enrollment
  WHERE enrollment.lead_id = l.id
  ORDER BY enrollment.created_at DESC
  LIMIT 1
) e ON true
ON CONFLICT (lead_id) DO NOTHING;

COMMIT;
