import { Client } from "pg";

const definitions = [
  ["Unidade 1", "SOURCE_USUARIOS_SDR_DATABASE_URL", "usuarios_sdr"],
  ["Unidade 2", "SOURCE_CLINICA_NOVA_DATABASE_URL", "usuarios_sdr_clinica_nova"],
];

for (const [name, environmentVariable, table] of definitions) {
  const client = new Client({ connectionString: process.env[environmentVariable] });
  await client.connect();
  try {
    const columns = await client.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      ["public", table],
    );
    const count = await client.query(`SELECT COUNT(*)::int AS total FROM public.${table}`);
    console.log(JSON.stringify({ name, table, total: count.rows[0].total, columns: columns.rows }));
  } finally {
    await client.end();
  }
}
