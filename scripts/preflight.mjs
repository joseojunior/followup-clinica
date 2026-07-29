import { Pool } from "pg";

const supportedSourceTables = new Set([
  "public.usuarios_sdr",
  "public.usuarios_sdr_clinica_nova",
]);

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não foi preenchida em .env.local.`);
  return value;
}

async function checkDatabase(label, connectionString, query) {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const result = await pool.query(query);
    console.log(`✓ ${label} conectado (${result.rows[0]?.database ?? "ok"})`);
  } finally {
    await pool.end();
  }
}

try {
  const databaseUrl = requireValue("DATABASE_URL");
  const usuariosSdrUrl = requireValue("SOURCE_USUARIOS_SDR_DATABASE_URL");
  const clinicaNovaUrl = requireValue("SOURCE_CLINICA_NOVA_DATABASE_URL");

  await checkDatabase(
    "Banco do follow-up",
    databaseUrl,
    "SELECT current_database() AS database, current_user AS user",
  );
  await checkDatabase("Fonte usuários SDR (somente leitura)", usuariosSdrUrl, `SELECT current_database() AS database, current_user AS user FROM public.usuarios_sdr LIMIT 1`);
  await checkDatabase("Fonte clínica nova (somente leitura)", clinicaNovaUrl, `SELECT current_database() AS database, current_user AS user FROM public.usuarios_sdr_clinica_nova LIMIT 1`);

  console.log("✓ Configuração validada. Você pode executar: npm run db:migrate");
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : "Falha de configuração"}`);
  process.exitCode = 1;
}
