import { getFollowupPool } from "@/lib/followup-db";
import type { LibraryItemInput } from "@/lib/library-validation";

export { validateLibraryItem } from "@/lib/library-validation";

export async function listLibraryItems() {
  const result = await getFollowupPool().query(
    `SELECT id, name, content_type, text_template, media_url, storage_path, is_active, created_at
     FROM followup.library_items
     WHERE is_active = true
     ORDER BY created_at DESC, name ASC`,
  );
  return result.rows;
}

export async function createLibraryItem(input: LibraryItemInput) {
  const result = await getFollowupPool().query(
    `INSERT INTO followup.library_items (name, content_type, text_template, media_url, storage_path)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, content_type, text_template, media_url, storage_path, is_active, created_at`,
    [input.name, input.contentType, input.textTemplate, input.mediaUrl, input.storagePath],
  );
  return result.rows[0];
}

export async function archiveLibraryItem(itemId: string) {
  const result = await getFollowupPool().query(
    `UPDATE followup.library_items SET is_active = false WHERE id = $1 AND is_active = true RETURNING id`,
    [itemId],
  );
  if (!result.rowCount) throw new Error("Conteúdo não encontrado.");
  return { id: itemId, archived: true };
}
