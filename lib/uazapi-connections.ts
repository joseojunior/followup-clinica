import { getFollowupPool, withTransaction } from "@/lib/followup-db";

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "hibernated" | "unavailable" | "unknown";

export type SenderConnection = {
  code: string;
  name: string;
  whatsappNumber: string | null;
  instanceName: string | null;
  profileName: string | null;
  profilePicUrl: string | null;
  status: ConnectionStatus;
  checkedAt: string | null;
  statusChangedAt: string | null;
  lastDisconnectAt: string | null;
  lastDisconnectReason: string | null;
  error: string | null;
  qrcode?: string | null;
};

type SenderRow = {
  id: string;
  code: string;
  name: string;
  whatsapp_number: string | null;
  credential_key: string;
  provider_instance_name: string | null;
  provider_status: string | null;
  provider_checked_at: Date | string | null;
  provider_profile_name: string | null;
  provider_profile_pic_url: string | null;
  provider_last_disconnect_at: Date | string | null;
  provider_last_disconnect_reason: string | null;
  provider_status_error: string | null;
  provider_status_changed_at: Date | string | null;
};

type ProviderPayload = Record<string, unknown> & {
  instance?: Record<string, unknown>;
  status?: Record<string, unknown>;
};

const validStatuses = new Set<ConnectionStatus>(["connected", "connecting", "disconnected", "hibernated"]);

function providerBaseUrl() {
  const value = process.env.WHATSAPP_API_BASE_URL?.trim();
  if (!value) throw new Error("WHATSAPP_API_BASE_URL não configurada.");
  return value.replace(/\/$/, "");
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asIso(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function qrDataUrl(value: unknown) {
  const qr = asString(value);
  if (!qr) return null;
  if (qr.startsWith("data:image/")) return qr;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(qr)) return `data:image/png;base64,${qr.replace(/\s/g, "")}`;
  return null;
}

function normalizeProvider(payload: ProviderPayload) {
  const instance = payload.instance && typeof payload.instance === "object" ? payload.instance : {};
  const statusData = payload.status && typeof payload.status === "object" ? payload.status : {};
  const rawStatus = asString(instance.status) ?? asString(payload.status);
  const connected = statusData.connected === true || payload.connected === true;
  const loggedIn = statusData.loggedIn === true || payload.loggedIn === true;
  const status: ConnectionStatus = rawStatus && validStatuses.has(rawStatus as ConnectionStatus)
    ? rawStatus as ConnectionStatus
    : connected && loggedIn ? "connected" : "disconnected";
  return {
    status,
    instanceName: asString(instance.name),
    profileName: asString(instance.profileName),
    profilePicUrl: asString(instance.profilePicUrl),
    whatsappNumber: asString((statusData.jid as Record<string, unknown> | undefined)?.user)
      ?? asString((payload.jid as Record<string, unknown> | undefined)?.user),
    lastDisconnectAt: asString(instance.lastDisconnect),
    lastDisconnectReason: asString(instance.lastDisconnectReason),
    qrcode: qrDataUrl(instance.qrcode ?? payload.qrcode),
  };
}

async function providerRequest(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${providerBaseUrl()}${path}`, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", token, ...init?.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* resposta não JSON */ }
  if (!response.ok) throw new Error(`Uazapi retornou HTTP ${response.status}.`);
  if (!body || typeof body !== "object") throw new Error("Uazapi retornou uma resposta inválida.");
  return body as ProviderPayload;
}

async function senderByCode(code: string) {
  const result = await getFollowupPool().query<SenderRow>(
    `SELECT id, code, name, whatsapp_number, credential_key, provider_instance_name,
      provider_status, provider_checked_at, provider_profile_name, provider_profile_pic_url,
      provider_last_disconnect_at, provider_last_disconnect_reason, provider_status_error,
      provider_status_changed_at
     FROM followup.senders WHERE code = $1 AND is_active = true`,
    [code],
  );
  if (!result.rowCount) throw new Error("Clínica não cadastrada.");
  return result.rows[0];
}

function senderToken(sender: SenderRow) {
  const token = process.env[sender.credential_key]?.trim();
  if (!token) throw new Error(`Credencial da ${sender.name} não configurada.`);
  return token;
}

function publicConnection(sender: SenderRow, qrcode: string | null = null): SenderConnection {
  const status = validStatuses.has(sender.provider_status as ConnectionStatus)
    ? sender.provider_status as ConnectionStatus
    : sender.provider_status === "unavailable" ? "unavailable" : "unknown";
  return {
    code: sender.code,
    name: sender.name,
    whatsappNumber: sender.whatsapp_number,
    instanceName: sender.provider_instance_name,
    profileName: sender.provider_profile_name,
    profilePicUrl: sender.provider_profile_pic_url,
    status,
    checkedAt: asIso(sender.provider_checked_at),
    statusChangedAt: asIso(sender.provider_status_changed_at),
    lastDisconnectAt: asIso(sender.provider_last_disconnect_at),
    lastDisconnectReason: sender.provider_last_disconnect_reason,
    error: sender.provider_status_error,
    ...(qrcode ? { qrcode } : {}),
  };
}

async function persistStatus(sender: SenderRow, provider: ReturnType<typeof normalizeProvider>) {
  const result = await withTransaction(async (client) => {
    const updated = await client.query<SenderRow>(
      `UPDATE followup.senders SET
        whatsapp_number = COALESCE($2, whatsapp_number), provider_instance_name = COALESCE($3, provider_instance_name),
        provider_profile_name = COALESCE($4, provider_profile_name), provider_profile_pic_url = COALESCE($5, provider_profile_pic_url),
        provider_status = $6, provider_checked_at = NOW(), provider_status_error = NULL,
        provider_last_disconnect_at = COALESCE($7::timestamptz, provider_last_disconnect_at),
        provider_last_disconnect_reason = COALESCE($8, provider_last_disconnect_reason),
        provider_status_changed_at = CASE WHEN provider_status IS DISTINCT FROM $6 THEN NOW() ELSE provider_status_changed_at END
       WHERE id = $1
       RETURNING id, code, name, whatsapp_number, credential_key, provider_instance_name,
        provider_status, provider_checked_at, provider_profile_name, provider_profile_pic_url,
        provider_last_disconnect_at, provider_last_disconnect_reason, provider_status_error, provider_status_changed_at`,
      [sender.id, provider.whatsappNumber, provider.instanceName, provider.profileName, provider.profilePicUrl,
        provider.status, provider.lastDisconnectAt, provider.lastDisconnectReason],
    );
    if (sender.provider_status !== provider.status) {
      await client.query(
        `INSERT INTO followup.audit_log (entity_type, entity_id, action, metadata)
         VALUES ('sender', $1, 'connection_status_changed', $2::jsonb)`,
        [sender.id, JSON.stringify({ code: sender.code, from: sender.provider_status, to: provider.status, reason: provider.lastDisconnectReason })],
      );
    }
    return updated.rows[0];
  });
  return publicConnection(result, provider.qrcode);
}

async function persistFailure(sender: SenderRow, error: Error) {
  const result = await getFollowupPool().query<SenderRow>(
    `UPDATE followup.senders SET provider_status = 'unavailable', provider_checked_at = NOW(),
      provider_status_error = $2,
      provider_status_changed_at = CASE WHEN provider_status IS DISTINCT FROM 'unavailable' THEN NOW() ELSE provider_status_changed_at END
     WHERE id = $1
     RETURNING id, code, name, whatsapp_number, credential_key, provider_instance_name,
      provider_status, provider_checked_at, provider_profile_name, provider_profile_pic_url,
      provider_last_disconnect_at, provider_last_disconnect_reason, provider_status_error, provider_status_changed_at`,
    [sender.id, error.message],
  );
  return publicConnection(result.rows[0]);
}

export async function refreshSenderConnection(code: string) {
  const sender = await senderByCode(code);
  try {
    return await persistStatus(sender, normalizeProvider(await providerRequest(senderToken(sender), "/instance/status")));
  } catch (error) {
    return persistFailure(sender, error instanceof Error ? error : new Error("Falha ao consultar a Uazapi."));
  }
}

export async function refreshAllSenderConnections() {
  const senders = await getFollowupPool().query<{ code: string }>("SELECT code FROM followup.senders WHERE is_active = true ORDER BY code");
  return Promise.all(senders.rows.map(({ code }) => refreshSenderConnection(code)));
}

export async function connectSender(code: string) {
  const sender = await senderByCode(code);
  try {
    const provider = normalizeProvider(await providerRequest(senderToken(sender), "/instance/connect", {
      method: "POST",
      body: JSON.stringify({ browser: "auto" }),
    }));
    return await persistStatus(sender, provider);
  } catch (error) {
    return persistFailure(sender, error instanceof Error ? error : new Error("Falha ao iniciar a conexão."));
  }
}
