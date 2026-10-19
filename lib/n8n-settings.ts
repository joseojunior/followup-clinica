import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { getFollowupPool } from "@/lib/followup-db";

type SettingsRow = { encrypted_api_key: string; updated_at: Date };

function masterKey() {
  const value = process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim();
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

function encrypt(value: string) {
  const key = masterKey();
  if (!key) throw new Error("Configure AI_SETTINGS_ENCRYPTION_KEY no servidor antes de salvar a chave do n8n.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}

function decrypt(value: string) {
  const key = masterKey();
  if (!key) throw new Error("A proteção de chaves do servidor não está disponível.");
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("A chave armazenada do n8n está inválida.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
}

async function storedSettings() {
  const result = await getFollowupPool().query<SettingsRow>("SELECT encrypted_api_key, updated_at FROM followup.n8n_monitor_settings WHERE id = true");
  return result.rows[0];
}

export async function getN8nSettings() {
  const stored = await storedSettings();
  const envKey = Boolean(process.env.N8N_API_KEY?.trim());
  return {
    keyConfigured: Boolean(stored) || envKey,
    keySource: stored ? "admin" : envKey ? "environment" : null,
    encryptionReady: Boolean(masterKey()),
    baseUrl: process.env.N8N_API_BASE_URL?.trim() || null,
    updatedAt: stored?.updated_at ? new Date(stored.updated_at).toISOString() : null,
  };
}

export async function getN8nApiKey() {
  const stored = await storedSettings();
  if (stored) return decrypt(stored.encrypted_api_key);
  return process.env.N8N_API_KEY?.trim() || null;
}

export async function saveN8nApiKey(apiKey: string) {
  const key = apiKey.trim();
  if (key.length < 30 || /\s/.test(key)) throw new Error("Informe uma chave de API válida do n8n.");
  await getFollowupPool().query(
    `INSERT INTO followup.n8n_monitor_settings (id, encrypted_api_key)
     VALUES (true, $1)
     ON CONFLICT (id) DO UPDATE SET encrypted_api_key = EXCLUDED.encrypted_api_key, updated_at = NOW()`,
    [encrypt(key)],
  );
  return getN8nSettings();
}
