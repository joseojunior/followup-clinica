import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.join(currentDirectory, "..", "database", "migrations");
const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error("DATABASE_URL não foi preenchida em .env.local.");
  process.exit(1);
}

const client = new Client({ connectionString });

try {
  await client.connect();
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const migrationFile of migrationFiles) {
    const alreadyApplied = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'followup' AND table_name = 'schema_migrations'",
    );
    if (alreadyApplied.rowCount) {
      const result = await client.query("SELECT 1 FROM followup.schema_migrations WHERE filename = $1", [migrationFile]);
      if (result.rowCount) continue;
    }

    const sql = await readFile(path.join(migrationDirectory, migrationFile), "utf8");
    await client.query(sql);
    await client.query("CREATE TABLE IF NOT EXISTS followup.schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT NOW())");
    await client.query("INSERT INTO followup.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", [migrationFile]);
    console.log(`✓ Aplicada: ${migrationFile}`);
  }
  console.log("✓ Schema followup atualizado com sucesso.");
} catch (error) {
  console.error(`✗ Migration não aplicada: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
