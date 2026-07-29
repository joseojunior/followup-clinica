BEGIN;

CREATE TABLE IF NOT EXISTS followup.campaign_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES followup.campaigns(id) ON DELETE SET NULL,
  campaign_name text NOT NULL,
  sender_id uuid REFERENCES followup.senders(id) ON DELETE SET NULL,
  sender_name text NOT NULL,
  recipient_phone text NOT NULL,
  step_order integer NOT NULL CHECK (step_order > 0),
  variant_id uuid REFERENCES followup.content_variants(id) ON DELETE SET NULL,
  content_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_mode text NOT NULL CHECK (send_mode IN ('dry_run', 'live')),
  state text NOT NULL CHECK (state IN ('prepared', 'simulated', 'sent', 'failed')),
  provider_message_id text,
  provider_response jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS campaign_test_runs_campaign_idx
  ON followup.campaign_test_runs (campaign_id, created_at DESC);

COMMIT;
