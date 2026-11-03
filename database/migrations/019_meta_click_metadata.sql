BEGIN;
ALTER TABLE followup.meta_clicks
  ADD COLUMN attribution jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attribution) = 'object');
ALTER TABLE followup.meta_events
  ADD COLUMN attribution jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attribution) = 'object');
COMMENT ON COLUMN followup.meta_clicks.attribution IS 'Optional first-contact marketing metadata; internal only, never exported to Meta.';
COMMENT ON COLUMN followup.meta_events.attribution IS 'Original first-contact metadata, including organic contacts without CTWA.';
COMMIT;
