BEGIN;
ALTER TABLE followup.meta_events DROP CONSTRAINT meta_events_event_type_check;
ALTER TABLE followup.meta_events ADD CONSTRAINT meta_events_event_type_check
  CHECK (event_type IN ('conversation_started','lead_qualified','appointment_confirmed','payment_confirmed','payment_requested','payment_pending'));
ALTER TABLE followup.meta_event_policy DROP CONSTRAINT meta_event_policy_event_type_check;
ALTER TABLE followup.meta_event_policy ADD CONSTRAINT meta_event_policy_event_type_check
  CHECK (event_type IN ('conversation_started','lead_qualified','appointment_confirmed','payment_confirmed','payment_requested','payment_pending'));

INSERT INTO followup.meta_event_policy(unit,event_type)
SELECT unit,event_type FROM followup.meta_unit_settings
CROSS JOIN (VALUES ('payment_requested'),('payment_pending')) AS types(event_type)
ON CONFLICT DO NOTHING;

-- New payment stages cannot acquire approval, enter a delivery queue or carry ad identifiers.
ALTER TABLE followup.meta_event_policy ADD CONSTRAINT meta_payment_stages_internal_policy
  CHECK (event_type NOT IN ('payment_requested','payment_pending') OR
    (NOT approved AND NOT export_enabled AND enabled_at IS NULL));
ALTER TABLE followup.meta_events ADD CONSTRAINT meta_payment_stages_internal_event
  CHECK (event_type NOT IN ('payment_requested','payment_pending') OR
    (state='internal_only' AND NOT export_eligible_at_ingest AND ctwa_hash IS NULL
     AND encrypted_ctwa IS NULL AND click_id IS NULL AND dataset_id IS NULL AND page_id IS NULL AND source_id IS NULL));
COMMIT;
