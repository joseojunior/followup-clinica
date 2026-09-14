BEGIN;

CREATE TABLE IF NOT EXISTS followup.ai_provider_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  encrypted_api_key text,
  default_model text NOT NULL DEFAULT 'gpt-5.6-luna',
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS followup.ai_usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('conversation_analysis', 'bottleneck_chat')),
  lead_id uuid REFERENCES followup.leads(id) ON DELETE SET NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  calculated_cost_usd numeric(14, 8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_usage_records_created_idx ON followup.ai_usage_records (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_records_lead_idx ON followup.ai_usage_records (lead_id, created_at DESC);

ALTER TABLE followup.conversation_insights
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS calculated_cost_usd numeric(14, 8);

COMMIT;
