BEGIN;
CREATE TABLE followup.meta_contacts (
  unit text NOT NULL REFERENCES followup.meta_unit_settings(unit),
  chat_hash text NOT NULL,
  phone_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(unit,chat_hash)
);
CREATE INDEX meta_contacts_phone ON followup.meta_contacts(unit,phone_hash);
ALTER TABLE followup.meta_clicks
  ADD COLUMN source_id text,
  ADD COLUMN dataset_id text,
  ADD COLUMN page_id text,
  ADD COLUMN resolution_state text NOT NULL DEFAULT 'pending' CHECK(resolution_state IN ('pending','resolved','review')),
  ADD COLUMN resolution_reason text,
  ADD COLUMN resolution_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN next_resolution_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE followup.meta_events
  ADD COLUMN input_hash text,
  ADD COLUMN click_id uuid REFERENCES followup.meta_clicks(id),
  ADD COLUMN phone_hash text,
  ADD COLUMN identity_conflict boolean NOT NULL DEFAULT false,
  ADD COLUMN source_id text,
  ADD COLUMN dataset_id text,
  ADD COLUMN page_id text,
  ADD COLUMN export_eligible_at_ingest boolean NOT NULL DEFAULT false;
COMMIT;
