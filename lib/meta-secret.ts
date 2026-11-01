import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function metaEncryptionReady() {
  const text = process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim() || "";
  return Buffer.from(text, "base64").length === 32;
}

function key() {
  const text = process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim() || "";
  const buffer = Buffer.from(text, "base64");
  if (buffer.length !== 32) throw new Error("Configure AI_SETTINGS_ENCRYPTION_KEY (32 bytes em base64) no servidor.");
  return buffer;
}

export function encryptMetaSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}

export function decryptMetaSecret(value: string) {
  const [iv, tag, data] = value.split(".");
  if (!iv || !tag || !data) throw new Error("Segredo criptografado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
