-- Configurações operacionais do motor de follow-up.
BEGIN;

ALTER TABLE followup.campaigns
  ADD COLUMN IF NOT EXISTS auto_enroll boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trigger_mode text NOT NULL DEFAULT 'manual'
    CHECK (trigger_mode IN ('manual', 'eligible_source_lead')),
  ADD COLUMN IF NOT EXISTS source_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS max_send_attempts integer NOT NULL DEFAULT 3
    CHECK (max_send_attempts BETWEEN 1 AND 10);

ALTER TABLE followup.enrollments
  ADD COLUMN IF NOT EXISTS source_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS dispatch_lock_at timestamptz;

ALTER TABLE followup.messages
  ADD COLUMN IF NOT EXISTS provider_response jsonb,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE INDEX IF NOT EXISTS messages_retry_idx
  ON followup.messages (next_retry_at)
  WHERE state = 'scheduled';

CREATE TABLE IF NOT EXISTS followup.provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid REFERENCES followup.senders(id) ON DELETE SET NULL,
  provider_event_id text,
  event_type text NOT NULL,
  source_chat_id text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT NOW(),
  processed_at timestamptz,
  processing_error text
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_events_sender_event_unique
  ON followup.provider_events (sender_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_events_unprocessed_idx
  ON followup.provider_events (received_at)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS followup.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON followup.audit_log (entity_type, entity_id, created_at DESC);

COMMIT;
