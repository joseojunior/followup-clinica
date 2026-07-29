-- Compatibilidade com bancos que receberam a migration 001 antes da descoberta
-- automática da identidade da instância UazAPI.
BEGIN;

ALTER TABLE followup.senders
  ALTER COLUMN whatsapp_number DROP NOT NULL;

ALTER TABLE followup.senders
  ADD COLUMN IF NOT EXISTS provider_instance_name text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_checked_at timestamptz;

COMMIT;

