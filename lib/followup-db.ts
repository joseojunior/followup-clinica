import { Pool, type PoolClient } from "pg";

let followupPool: Pool | undefined;

export function getFollowupPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não configurada.");
  followupPool ??= new Pool({ connectionString, max: 5, application_name: "followup-app" });
  return followupPool;
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await getFollowupPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

