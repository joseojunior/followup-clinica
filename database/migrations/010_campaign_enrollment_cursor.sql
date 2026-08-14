-- Controla de onde cada campanha deve ler novos eventos da fonte.
-- O cursor evita revisitar sempre os mesmos leads e impede backfill retroativo acidental.
BEGIN;

ALTER TABLE followup.campaigns
  ADD COLUMN IF NOT EXISTS auto_enroll_from timestamptz,
  ADD COLUMN IF NOT EXISTS auto_enroll_cursor_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_enroll_cursor_chat_id text;

UPDATE followup.campaigns
SET auto_enroll_from = COALESCE(auto_enroll_from, updated_at),
  auto_enroll_cursor_at = COALESCE(auto_enroll_cursor_at, updated_at)
WHERE auto_enroll = true
  AND auto_enroll_from IS NULL;

CREATE INDEX IF NOT EXISTS campaigns_auto_enroll_cursor_idx
  ON followup.campaigns (status, auto_enroll_cursor_at)
  WHERE auto_enroll = true;

COMMIT;
