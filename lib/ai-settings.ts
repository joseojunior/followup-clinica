import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { getFollowupPool } from "@/lib/followup-db";

export const AI_MODELS = [
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", inputPerMillionUsd: 0.2, outputPerMillionUsd: 1.2, description: "Mais econômico para leituras rotineiras" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", inputPerMillionUsd: 2, outputPerMillionUsd: 12, description: "Equilíbrio entre qualidade e custo" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", inputPerMillionUsd: 4, outputPerMillionUsd: 20, description: "Maior profundidade para casos complexos" },
  { id: "gpt-6-astra", label: "GPT-6 Astra", inputPerMillionUsd: 10, outputPerMillionUsd: 50, description: "Raciocínio mais avançado" },
] as const;

export type AIModel = (typeof AI_MODELS)[number]["id"];
export type AICost = { inputTokens: number; outputTokens: number; usd: number };

type SettingsRow = { encrypted_api_key: string | null; default_model: string; updated_at: Date | null };

function encryptionKey() {
  const value = process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim();
  if (!value) return null;
  try {
    const key = Buffer.from(value, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function encrypt(value: string) {
  const key = encryptionKey();
  if (!key) throw new Error("A proteção de chaves do servidor ainda não está configurada.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}

function decrypt(value: string) {
  const key = encryptionKey();
  if (!key) throw new Error("A proteção de chaves do servidor ainda não está configurada.");
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("A chave de IA armazenada está em formato inválido.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
}

export function isAIModel(value: string | undefined | null): value is AIModel {
  return AI_MODELS.some((model) => model.id === value);
}

export function defaultAIModel(value?: string | null): AIModel {
  return isAIModel(value) ? value : "gpt-5.6-luna";
}

export function calculateAICost(model: AIModel, inputTokens: number, outputTokens: number): AICost {
  const pricing = AI_MODELS.find((item) => item.id === model)!;
  const usd = (Math.max(0, inputTokens) * pricing.inputPerMillionUsd + Math.max(0, outputTokens) * pricing.outputPerMillionUsd) / 1_000_000;
  return { inputTokens: Math.max(0, inputTokens), outputTokens: Math.max(0, outputTokens), usd: Number(usd.toFixed(8)) };
}

export async function getAISettings() {
  const result = await getFollowupPool().query<SettingsRow>("SELECT encrypted_api_key, default_model, updated_at FROM followup.ai_provider_settings WHERE id = true");
  const row = result.rows[0];
  const storedKey = Boolean(row?.encrypted_api_key);
  const envKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  return {
    keyConfigured: storedKey || envKey,
    keySource: storedKey ? "admin" : envKey ? "environment" : null,
    encryptionReady: Boolean(encryptionKey()),
    defaultModel: defaultAIModel(row?.default_model || process.env.OPENAI_MODEL),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function getAIConfiguration(model?: string) {
  const result = await getFollowupPool().query<SettingsRow>("SELECT encrypted_api_key, default_model, updated_at FROM followup.ai_provider_settings WHERE id = true");
  const row = result.rows[0];
  const requestedModel = model?.trim();
  if (requestedModel && !isAIModel(requestedModel)) throw new Error("Escolha um modelo disponível no painel.");
  const selectedModel: AIModel = requestedModel && isAIModel(requestedModel) ? requestedModel : defaultAIModel(row?.default_model || process.env.OPENAI_MODEL);
  if (row?.encrypted_api_key) return { key: decrypt(row.encrypted_api_key), model: selectedModel };
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (!envKey) throw new Error("A IA ainda não está configurada. Cadastre uma chave no painel administrativo.");
  return { key: envKey, model: selectedModel };
}

export async function saveAISettings({ apiKey, defaultModel }: { apiKey?: string; defaultModel?: string }) {
  const key = apiKey?.trim();
  if (key && (!key.startsWith("sk-") || key.length < 20)) throw new Error("Informe uma chave de API válida.");
  if (defaultModel && !isAIModel(defaultModel)) throw new Error("Escolha um modelo disponível no painel.");
  const current = await getAISettings();
  if (!key && !current.keyConfigured) throw new Error("Informe a chave de API para concluir a configuração.");
  if (key && !encryptionKey()) throw new Error("A proteção de chaves do servidor ainda não está configurada.");
  await getFollowupPool().query(
    `INSERT INTO followup.ai_provider_settings (id, encrypted_api_key, default_model)
     VALUES (true, $1, $2)
     ON CONFLICT (id) DO UPDATE SET
       encrypted_api_key = COALESCE(EXCLUDED.encrypted_api_key, followup.ai_provider_settings.encrypted_api_key),
       default_model = EXCLUDED.default_model, updated_at = NOW()`,
    [key ? encrypt(key) : null, defaultAIModel(defaultModel || current.defaultModel)],
  );
  return getAISettings();
}
