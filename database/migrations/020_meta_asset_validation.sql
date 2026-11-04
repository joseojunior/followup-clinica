BEGIN;
-- Diagnostic only: never reused as WABA/number verification or export approval.
ALTER TABLE followup.meta_unit_settings
  ADD COLUMN asset_validation jsonb CHECK (asset_validation IS NULL OR jsonb_typeof(asset_validation) = 'object');
COMMIT;
