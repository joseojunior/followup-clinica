BEGIN;

CREATE TABLE IF NOT EXISTS followup.n8n_monitor_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  encrypted_api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMIT;
