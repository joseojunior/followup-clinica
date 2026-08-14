export const libraryContentTypes = ["text", "sticker", "image"] as const;
export type LibraryContentType = (typeof libraryContentTypes)[number];

export type LibraryItemInput = {
  name: string;
  contentType: LibraryContentType;
  textTemplate: string | null;
  mediaUrl: string | null;
  storagePath: string | null;
};

export function validateLibraryItem(value: unknown): LibraryItemInput {
  if (!value || typeof value !== "object") throw new Error("Conteúdo inválido.");
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const contentType = input.contentType as LibraryContentType;
  const textTemplate = typeof input.textTemplate === "string" ? input.textTemplate.trim() || null : null;
  const mediaUrl = typeof input.mediaUrl === "string" ? input.mediaUrl.trim() || null : null;
  const storagePath = typeof input.storagePath === "string" ? input.storagePath.trim() || null : null;

  if (!name || name.length > 100) throw new Error("Informe um nome com até 100 caracteres.");
  if (!libraryContentTypes.includes(contentType)) throw new Error("Tipo de conteúdo inválido.");
  if (textTemplate && textTemplate.length > 4_000) throw new Error("O texto deve ter até 4.000 caracteres.");
  if (contentType === "text" && !textTemplate) throw new Error("Escreva o texto da mensagem.");
  if (contentType !== "text" && !mediaUrl) throw new Error("Envie a imagem ou o sticker.");
  if (mediaUrl) {
    let parsed: URL;
    try { parsed = new URL(mediaUrl); } catch { throw new Error("URL da mídia inválida."); }
    if (parsed.protocol !== "https:") throw new Error("A mídia precisa usar uma URL HTTPS.");
  }
  if (storagePath && (storagePath.length > 500 || storagePath.startsWith("/") || storagePath.includes(".."))) {
    throw new Error("Caminho da mídia inválido.");
  }
  return { name, contentType, textTemplate, mediaUrl, storagePath };
}
