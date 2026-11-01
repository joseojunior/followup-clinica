BEGIN;

CREATE TABLE followup.meta_unit_settings (
  unit text PRIMARY KEY CHECK (unit IN ('sender_1', 'sender_2')),
  inbound_token_hash text UNIQUE,
  encrypted_access_token text,
  dataset_id text,
  waba_id text,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  verified_at timestamptz,
  verified_number text,
  capture_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO followup.meta_unit_settings (unit) VALUES ('sender_1'), ('sender_2');

CREATE TABLE followup.meta_event_policy (
  unit text NOT NULL REFERENCES followup.meta_unit_settings(unit),
  event_type text NOT NULL CHECK (event_type IN ('conversation_started', 'lead_qualified', 'appointment_confirmed', 'payment_confirmed')),
  approved boolean NOT NULL DEFAULT false,
  export_enabled boolean NOT NULL DEFAULT false,
  approved_by text,
  approved_at timestamptz,
  enabled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (unit, event_type)
);
INSERT INTO followup.meta_event_policy (unit, event_type)
SELECT unit, event_type FROM followup.meta_unit_settings
CROSS JOIN (VALUES ('conversation_started'), ('lead_qualified'), ('appointment_confirmed'), ('payment_confirmed')) AS types(event_type);

CREATE TABLE followup.meta_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit text NOT NULL REFERENCES followup.meta_unit_settings(unit),
  chat_hash text NOT NULL,
  ctwa_hash text NOT NULL,
  encrypted_ctwa text NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit, chat_hash, ctwa_hash)
);
CREATE INDEX meta_clicks_lookup ON followup.meta_clicks(unit, chat_hash, observed_at DESC);

CREATE TABLE followup.meta_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit text NOT NULL REFERENCES followup.meta_unit_settings(unit),
  event_type text NOT NULL CHECK (event_type IN ('conversation_started', 'lead_qualified', 'appointment_confirmed', 'payment_confirmed')),
  source_event_id text NOT NULL,
  chat_hash text NOT NULL,
  chat_mask text NOT NULL,
  occurred_at timestamptz NOT NULL,
  ctwa_hash text,
  encrypted_ctwa text,
  ctwa_origin text CHECK (ctwa_origin IN ('history', 'source')),
  state text NOT NULL CHECK (state IN ('no_ctwa', 'internal_only', 'awaiting_approval', 'queued', 'sending', 'accepted', 'failed')),
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  auto_retry_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  accepted_at timestamptz,
  fbtrace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit, event_type, source_event_id)
);
CREATE INDEX meta_events_queue ON followup.meta_events(next_attempt_at) WHERE state = 'queued';
CREATE INDEX meta_events_dashboard ON followup.meta_events(unit, occurred_at DESC);

CREATE TABLE followup.meta_delivery_attempts (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES followup.meta_events(id),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  http_status integer,
  outcome text NOT NULL,
  error_code text,
  fbtrace_id text
);

CREATE TABLE followup.meta_ingest_rate (
  unit text NOT NULL REFERENCES followup.meta_unit_settings(unit),
  minute_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (unit, minute_at)
);

CREATE TABLE followup.meta_admin_audit (
  id bigserial PRIMARY KEY,
  unit text NOT NULL REFERENCES followup.meta_unit_settings(unit),
  action text NOT NULL,
  actor text NOT NULL,
  event_type text,
  event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
