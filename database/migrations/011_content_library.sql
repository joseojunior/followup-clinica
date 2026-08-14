BEGIN;

CREATE TABLE IF NOT EXISTS followup.library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('text', 'sticker', 'image')),
  text_template text,
  media_url text,
  storage_path text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (text_template IS NOT NULL OR media_url IS NOT NULL),
  CHECK (content_type <> 'text' OR text_template IS NOT NULL),
  CHECK (content_type = 'text' OR media_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS library_items_active_type_idx
  ON followup.library_items (content_type, created_at DESC)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS library_items_set_updated_at ON followup.library_items;
CREATE TRIGGER library_items_set_updated_at
  BEFORE UPDATE ON followup.library_items
  FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();

-- A mídia precisa ser pública para que o provedor de WhatsApp consiga baixá-la.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'followup-library',
  'followup-library',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "followup_library_authenticated_insert" ON storage.objects;
CREATE POLICY "followup_library_authenticated_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'followup-library');

DROP POLICY IF EXISTS "followup_library_authenticated_update" ON storage.objects;
CREATE POLICY "followup_library_authenticated_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'followup-library')
  WITH CHECK (bucket_id = 'followup-library');

DROP POLICY IF EXISTS "followup_library_authenticated_delete" ON storage.objects;
CREATE POLICY "followup_library_authenticated_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'followup-library');

COMMIT;
