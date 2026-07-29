-- Este arquivo cria APENAS o schema followup.
-- Não altera nenhuma tabela do sistema principal em public.*.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS followup;

CREATE OR REPLACE FUNCTION followup.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS followup.senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  -- Descoberto na UazAPI pelo token; não é preenchido manualmente.
  whatsapp_number text UNIQUE,
  credential_key text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  daily_limit integer NOT NULL DEFAULT 100 CHECK (daily_limit > 0),
  min_interval_seconds integer NOT NULL DEFAULT 45 CHECK (min_interval_seconds >= 0),
  timezone text NOT NULL DEFAULT 'America/Manaus',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Cada fonte é uma operação independente, mesmo quando ambas vivem no mesmo Supabase.
CREATE TABLE IF NOT EXISTS followup.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code IN ('usuarios_sdr', 'clinica_nova')),
  name text NOT NULL,
  source_table text NOT NULL UNIQUE CHECK (source_table IN ('public.usuarios_sdr', 'public.usuarios_sdr_clinica_nova')),
  default_sender_id uuid REFERENCES followup.senders(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO followup.sources (code, name, source_table)
VALUES
  ('usuarios_sdr', 'Usuários SDR', 'public.usuarios_sdr'),
  ('clinica_nova', 'Clínica nova', 'public.usuarios_sdr_clinica_nova')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  source_table = EXCLUDED.source_table;

CREATE TABLE IF NOT EXISTS followup.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES followup.sources(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  source_followup_required boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'America/Manaus',
  allowed_start_time time NOT NULL DEFAULT '09:00',
  allowed_end_time time NOT NULL DEFAULT '18:00',
  weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6],
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (allowed_start_time < allowed_end_time),
  CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);

CREATE TABLE IF NOT EXISTS followup.campaign_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES followup.campaigns(id) ON DELETE CASCADE,
  step_order integer NOT NULL CHECK (step_order > 0),
  delay_minutes integer NOT NULL CHECK (delay_minutes >= 0),
  content_mode text NOT NULL CHECK (content_mode IN ('text', 'sticker_text', 'image_text', 'sequence')),
  sender_rule text NOT NULL DEFAULT 'balanced' CHECK (sender_rule IN ('sender_1', 'sender_2', 'balanced')),
  rotation_rule text NOT NULL DEFAULT 'no_repeat' CHECK (rotation_rule IN ('sequential', 'random', 'no_repeat')),
  use_ai_personalization boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, step_order)
);

CREATE TABLE IF NOT EXISTS followup.content_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL REFERENCES followup.campaign_steps(id) ON DELETE CASCADE,
  variant_order integer NOT NULL DEFAULT 1 CHECK (variant_order > 0),
  content_type text NOT NULL CHECK (content_type IN ('text', 'sticker', 'image', 'sequence')),
  text_template text,
  media_url text,
  weight integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (text_template IS NOT NULL OR media_url IS NOT NULL),
  UNIQUE (step_id, variant_order)
);

-- Dados personalizados inseridos pelo administrador, sem modificar a fonte.
CREATE TABLE IF NOT EXISTS followup.contact_data (
  source_id uuid NOT NULL REFERENCES followup.sources(id) ON DELETE CASCADE,
  source_chat_id text NOT NULL,
  preferred_name text,
  interest text,
  preferred_contact_window text,
  admin_note text,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  custom_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, source_chat_id)
);

CREATE TABLE IF NOT EXISTS followup.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES followup.sources(id) ON DELETE RESTRICT,
  source_chat_id text NOT NULL,
  source_lead_id text,
  campaign_id uuid NOT NULL REFERENCES followup.campaigns(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'completed', 'blocked', 'pending_data')),
  current_step_order integer NOT NULL DEFAULT 1 CHECK (current_step_order > 0),
  next_send_at timestamptz,
  paused_reason text,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz
);

-- Nunca permitir duas cadências ativas/pendentes para o mesmo lead e campanha.
CREATE UNIQUE INDEX IF NOT EXISTS enrollments_one_open_campaign_per_lead
  ON followup.enrollments (source_id, source_chat_id, campaign_id)
  WHERE state IN ('active', 'paused', 'pending_data');
CREATE INDEX IF NOT EXISTS enrollments_due_idx
  ON followup.enrollments (next_send_at)
  WHERE state = 'active';

CREATE TABLE IF NOT EXISTS followup.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES followup.enrollments(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES followup.campaign_steps(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES followup.content_variants(id) ON DELETE SET NULL,
  sender_id uuid REFERENCES followup.senders(id) ON DELETE SET NULL,
  phone text NOT NULL,
  content_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'reserved', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_at timestamptz NOT NULL,
  reserved_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_id text,
  error_message text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_dispatch_idx
  ON followup.messages (scheduled_at)
  WHERE state = 'scheduled';
CREATE INDEX IF NOT EXISTS messages_enrollment_idx
  ON followup.messages (enrollment_id, created_at DESC);

-- Permite a regra "sem repetir" por lead e etapa, preservando o histórico.
CREATE TABLE IF NOT EXISTS followup.variant_usage (
  enrollment_id uuid NOT NULL REFERENCES followup.enrollments(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES followup.campaign_steps(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES followup.content_variants(id) ON DELETE CASCADE,
  rotation_cycle integer NOT NULL DEFAULT 1 CHECK (rotation_cycle > 0),
  used_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (enrollment_id, step_id, variant_id, rotation_cycle)
);

CREATE TABLE IF NOT EXISTS followup.source_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz,
  imported_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_message text
);

DROP TRIGGER IF EXISTS senders_set_updated_at ON followup.senders;
CREATE TRIGGER senders_set_updated_at BEFORE UPDATE ON followup.senders FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();
DROP TRIGGER IF EXISTS sources_set_updated_at ON followup.sources;
CREATE TRIGGER sources_set_updated_at BEFORE UPDATE ON followup.sources FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();
DROP TRIGGER IF EXISTS campaigns_set_updated_at ON followup.campaigns;
CREATE TRIGGER campaigns_set_updated_at BEFORE UPDATE ON followup.campaigns FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();
DROP TRIGGER IF EXISTS campaign_steps_set_updated_at ON followup.campaign_steps;
CREATE TRIGGER campaign_steps_set_updated_at BEFORE UPDATE ON followup.campaign_steps FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();
DROP TRIGGER IF EXISTS content_variants_set_updated_at ON followup.content_variants;
CREATE TRIGGER content_variants_set_updated_at BEFORE UPDATE ON followup.content_variants FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();
DROP TRIGGER IF EXISTS contact_data_set_updated_at ON followup.contact_data;
CREATE TRIGGER contact_data_set_updated_at BEFORE UPDATE ON followup.contact_data FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();
DROP TRIGGER IF EXISTS enrollments_set_updated_at ON followup.enrollments;
CREATE TRIGGER enrollments_set_updated_at BEFORE UPDATE ON followup.enrollments FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();
DROP TRIGGER IF EXISTS messages_set_updated_at ON followup.messages;
CREATE TRIGGER messages_set_updated_at BEFORE UPDATE ON followup.messages FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();

COMMIT;
