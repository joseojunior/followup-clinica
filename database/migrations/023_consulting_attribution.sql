BEGIN;
ALTER TABLE followup.consulting_meta_events
  ADD COLUMN attribution jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(attribution) = 'object');
COMMENT ON COLUMN followup.consulting_meta_events.attribution IS
  'Optional first-contact consulting marketing metadata for internal reports only; never exported to Meta or fetched as URLs.';
COMMIT;
