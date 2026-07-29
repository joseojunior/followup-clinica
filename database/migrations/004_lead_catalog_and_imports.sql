-- Catálogo próprio do follow-up. As tabelas public.* continuam somente leitura.
BEGIN;

CREATE TABLE IF NOT EXISTS followup.csv_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES followup.sources(id) ON DELETE RESTRICT,
  filename text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'completed_with_errors', 'failed')),
  total_rows integer NOT NULL DEFAULT 0,
  imported_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS followup.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES followup.sources(id) ON DELETE RESTRICT,
  origin_kind text NOT NULL CHECK (origin_kind IN ('database', 'csv')),
  external_id text NOT NULL,
  source_chat_id text,
  name text,
  phone text,
  email text,
  reference_at timestamptz NOT NULL,
  is_eligible boolean NOT NULL DEFAULT true,
  eligibility_reason text,
  csv_import_id uuid REFERENCES followup.csv_imports(id) ON DELETE SET NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, origin_kind, external_id)
);

CREATE INDEX IF NOT EXISTS leads_origin_source_idx
  ON followup.leads (origin_kind, source_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS leads_reference_idx
  ON followup.leads (reference_at)
  WHERE is_eligible = true;

ALTER TABLE followup.enrollments
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES followup.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_kind text NOT NULL DEFAULT 'database'
    CHECK (origin_kind IN ('database', 'csv')),
  ADD COLUMN IF NOT EXISTS anchor_at timestamptz;

CREATE INDEX IF NOT EXISTS enrollments_lead_idx ON followup.enrollments (lead_id);

DROP TRIGGER IF EXISTS leads_set_updated_at ON followup.leads;
CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON followup.leads
  FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();

COMMIT;
