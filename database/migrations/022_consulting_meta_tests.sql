BEGIN;
CREATE TABLE followup.consulting_meta_settings (
 unit text PRIMARY KEY REFERENCES followup.meta_unit_settings(unit),
 page_id text CHECK(page_id IS NULL OR page_id ~ '^[0-9]{5,30}$'),
 dataset_id text CHECK(dataset_id IS NULL OR dataset_id ~ '^[0-9]{5,30}$'),
 test_code text NOT NULL DEFAULT 'TEST28037' CHECK(test_code ~ '^TEST[A-Za-z0-9_-]{1,50}$'),
 capture_started_at timestamptz NOT NULL DEFAULT now(),
 test_only boolean NOT NULL DEFAULT true CHECK(test_only)
);
INSERT INTO followup.consulting_meta_settings(unit) SELECT unit FROM followup.meta_unit_settings;
CREATE TABLE followup.consulting_meta_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), unit text NOT NULL REFERENCES followup.consulting_meta_settings(unit),
 event_type text NOT NULL CHECK(event_type IN ('conversation_started','lead_qualified','payment_requested','payment_pending','payment_confirmed','appointment_confirmed')),
 source_event_id text NOT NULL, input_hash text NOT NULL, chat_hash text NOT NULL,
 occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 conversation_id uuid REFERENCES followup.consulting_meta_events(id),
 encrypted_ctwa text, source_id text, ph_hash text, fn_hash text, ln_hash text,
 transaction_hash text, value numeric(12,2),
 test_state text NOT NULL DEFAULT 'new' CHECK(test_state IN ('new','sending','accepted','failed','unknown')),
 test_result jsonb, tested_at timestamptz,
 UNIQUE(unit,event_type,source_event_id)
);
CREATE INDEX consulting_click_history ON followup.consulting_meta_events(unit,chat_hash,occurred_at DESC) WHERE event_type='conversation_started';
CREATE UNIQUE INDEX consulting_one_purchase_per_transaction ON followup.consulting_meta_events(unit,transaction_hash) WHERE event_type='appointment_confirmed';
COMMIT;
