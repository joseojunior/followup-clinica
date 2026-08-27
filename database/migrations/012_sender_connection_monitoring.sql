BEGIN;

ALTER TABLE followup.senders
  ADD COLUMN IF NOT EXISTS provider_profile_name text,
  ADD COLUMN IF NOT EXISTS provider_profile_pic_url text,
  ADD COLUMN IF NOT EXISTS provider_last_disconnect_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_last_disconnect_reason text,
  ADD COLUMN IF NOT EXISTS provider_status_error text,
  ADD COLUMN IF NOT EXISTS provider_status_changed_at timestamptz;

CREATE INDEX IF NOT EXISTS senders_provider_status_idx
  ON followup.senders (provider_status, provider_checked_at)
  WHERE is_active = true;

COMMIT;
