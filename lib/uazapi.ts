type MessageContent = {
  type: string;
  text?: string;
  mediaUrl?: string;
};

export type ProviderSendResult = {
  providerMessageId: string | null;
  response: unknown;
};

function baseUrl() {
  const value = process.env.WHATSAPP_API_BASE_URL?.trim();
  if (!value) throw new Error("WHATSAPP_API_BASE_URL não configurada.");
  return value.replace(/\/$/, "");
}

export async function sendWithUazapi(token: string, phone: string, content: MessageContent): Promise<ProviderSendResult> {
  // O padrão é simulação: nenhum envio externo ocorre sem ativação explícita.
  if (process.env.FOLLOWUP_SEND_MODE !== "live") {
    return {
      providerMessageId: `dry-run-${crypto.randomUUID()}`,
      response: { mode: "dry_run", type: content.type },
    };
  }

  const headers = { Accept: "application/json", "Content-Type": "application/json", token };
  let endpoint: string;
  let body: Record<string, unknown>;
  if (content.mediaUrl) {
    endpoint = "/send/media";
    body = {
      number: phone,
      type: content.type === "sticker" ? "sticker" : "image",
      file: content.mediaUrl,
      ...(content.type === "image" && content.text ? { text: content.text } : {}),
      delay: 10_000,
    };
  } else {
    endpoint = "/send/text";
    body = { number: phone, text: content.text ?? "", linkPreview: false, delay: 10_000, async: true };
  }

  const response = await fetch(`${baseUrl()}${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  const responseText = await response.text();
  let responseBody: unknown = responseText;
  try { responseBody = JSON.parse(responseText); } catch { /* resposta não JSON */ }
  if (!response.ok) throw new Error(`UazAPI retornou HTTP ${response.status}.`);

  const data = responseBody as Record<string, unknown>;
  const providerMessageId = typeof data?.id === "string" ? data.id : typeof data?.messageId === "string" ? data.messageId : null;
  return { providerMessageId, response: responseBody };
}

