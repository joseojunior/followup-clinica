BEGIN;

CREATE TABLE IF NOT EXISTS followup.broadcast_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sender_id uuid NOT NULL REFERENCES followup.senders(id) ON DELETE RESTRICT,
  content_type text NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'sticker', 'image')),
  text_template text,
  media_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'cancelled')),
  scheduled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz,
  CHECK (text_template IS NOT NULL OR media_url IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS followup.broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_campaign_id uuid NOT NULL REFERENCES followup.broadcast_campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES followup.leads(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES followup.sources(id) ON DELETE RESTRICT,
  source_chat_id text,
  origin_kind text NOT NULL CHECK (origin_kind IN ('database', 'csv')),
  phone text NOT NULL,
  recipient_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'sending', 'simulated', 'sent', 'failed', 'cancelled')),
  provider_message_id text,
  provider_response jsonb,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (broadcast_campaign_id, lead_id)
);

CREATE INDEX IF NOT EXISTS broadcast_recipients_due_idx
  ON followup.broadcast_recipients (state, created_at)
  WHERE state = 'scheduled';

DROP TRIGGER IF EXISTS broadcast_recipients_set_updated_at ON followup.broadcast_recipients;
CREATE TRIGGER broadcast_recipients_set_updated_at
  BEFORE UPDATE ON followup.broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();

COMMIT;
