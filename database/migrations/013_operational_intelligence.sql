BEGIN;

CREATE TABLE IF NOT EXISTS followup.conversation_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES followup.leads(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES followup.sources(id) ON DELETE RESTRICT,
  source_chat_id text NOT NULL,
  session_id text NOT NULL,
  source_hash text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  model text,
  message_count integer NOT NULL DEFAULT 0,
  human_message_count integer NOT NULL DEFAULT 0,
  ai_message_count integer NOT NULL DEFAULT 0,
  tool_call_count integer NOT NULL DEFAULT 0,
  tool_failure_count integer NOT NULL DEFAULT 0,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  analyzed_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_insights_source_analyzed_idx
  ON followup.conversation_insights (source_id, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS conversation_insights_status_idx
  ON followup.conversation_insights (status, analyzed_at DESC);

DROP TRIGGER IF EXISTS conversation_insights_set_updated_at ON followup.conversation_insights;
CREATE TRIGGER conversation_insights_set_updated_at
  BEFORE UPDATE ON followup.conversation_insights
  FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();

CREATE TABLE IF NOT EXISTS followup.intelligence_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intelligence_chat_messages_created_idx
  ON followup.intelligence_chat_messages (created_at DESC);

COMMIT;
