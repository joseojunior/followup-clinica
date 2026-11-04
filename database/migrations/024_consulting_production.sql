BEGIN;
ALTER TABLE followup.consulting_meta_settings DROP CONSTRAINT consulting_meta_settings_test_only_check;
ALTER TABLE followup.consulting_meta_settings
 ADD COLUMN production_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN production_enabled_at timestamptz,
 ADD CONSTRAINT consulting_production_mode CHECK(test_only = NOT production_enabled AND (production_enabled = (production_enabled_at IS NOT NULL)));
CREATE TABLE followup.consulting_meta_policy (
 unit text NOT NULL REFERENCES followup.consulting_meta_settings(unit),
 event_type text NOT NULL CHECK(event_type IN ('conversation_started','lead_qualified','payment_requested','appointment_confirmed')),
 enabled boolean NOT NULL DEFAULT false, enabled_at timestamptz,
 PRIMARY KEY(unit,event_type), CHECK(enabled = (enabled_at IS NOT NULL))
);
INSERT INTO followup.consulting_meta_policy(unit,event_type)
SELECT unit,event_type FROM followup.consulting_meta_settings CROSS JOIN (VALUES ('conversation_started'),('lead_qualified'),('payment_requested'),('appointment_confirmed')) AS stages(event_type);
ALTER TABLE followup.consulting_meta_events
 ADD COLUMN is_synthetic boolean NOT NULL DEFAULT false,
 ADD COLUMN production_eligible boolean NOT NULL DEFAULT false,
 ADD COLUMN production_activation_at timestamptz,
 ADD COLUMN production_state text NOT NULL DEFAULT 'excluded' CHECK(production_state IN ('excluded','internal','no_ctwa','queued','preparing','sending','accepted','failed','unknown')),
 ADD COLUMN production_result jsonb,
 ADD COLUMN production_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN production_preflights integer NOT NULL DEFAULT 0,
 ADD COLUMN production_next_at timestamptz,
 ADD COLUMN production_started_at timestamptz,
 ADD CONSTRAINT consulting_synthetic_never_live CHECK(NOT is_synthetic OR NOT production_eligible);
-- All existing rows remain ineligible. Only identify synthetic rows; never enqueue history.
UPDATE followup.consulting_meta_events SET is_synthetic=true
WHERE test_state<>'new' OR source_event_id ~* '^(synthetic|test|teste)[-_:]' OR COALESCE((test_result->>'synthetic')::boolean,false);
CREATE INDEX consulting_production_queue ON followup.consulting_meta_events(production_next_at) WHERE production_state='queued';
CREATE TABLE followup.consulting_meta_delivery_attempts (
 id bigserial PRIMARY KEY, event_id uuid NOT NULL REFERENCES followup.consulting_meta_events(id),
 attempt integer NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 outcome text NOT NULL DEFAULT 'sending', result jsonb, UNIQUE(event_id,attempt)
);
COMMIT;
