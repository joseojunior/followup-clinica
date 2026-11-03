export const META_EVENT_BODY_MAX_BYTES = 16 * 1024;

/** Bound streamed bodies too; Content-Length alone is untrusted/optional. */
export async function readMetaEventBody(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > META_EVENT_BODY_MAX_BYTES) throw new RangeError("body_too_large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0; let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > META_EVENT_BODY_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError("body_too_large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
