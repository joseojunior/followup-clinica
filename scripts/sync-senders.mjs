import { Client } from "pg";

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não foi preenchida em .env.local.`);
  return value;
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL não foi preenchida em .env.local.");
  requireValue("WHATSAPP_SENDER_1_TOKEN");
  requireValue("WHATSAPP_SENDER_2_TOKEN");

  await client.connect();
  await client.query("BEGIN");

  const upsertSender = async (code, name, credentialKey) => {
    const result = await client.query(
      `INSERT INTO followup.senders (code, name, whatsapp_number, credential_key)
       VALUES ($1, $2, NULL, $3)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         whatsapp_number = EXCLUDED.whatsapp_number,
         credential_key = EXCLUDED.credential_key,
         is_active = true
       RETURNING id`,
      [code, name, credentialKey],
    );
    return result.rows[0].id;
  };

  const sender1Id = await upsertSender("sender_1", "Unidade 1 · Usuários SDR", "WHATSAPP_SENDER_1_TOKEN");
  const sender2Id = await upsertSender("sender_2", "Unidade 2 · Clínica nova", "WHATSAPP_SENDER_2_TOKEN");

  await client.query("UPDATE followup.sources SET default_sender_id = $1 WHERE code = 'usuarios_sdr'", [sender1Id]);
  await client.query("UPDATE followup.sources SET default_sender_id = $1 WHERE code = 'clinica_nova'", [sender2Id]);
  await client.query("COMMIT");

  console.log("✓ Remetentes cadastrados e vinculados às duas fontes.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(`✗ Remetentes não sincronizados: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
