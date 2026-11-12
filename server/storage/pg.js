/**
 * PostgreSQL pool factory.
 *
 * `pg` is a runtime dependency but the pool is only created when
 * `DATABASE_URL` is present, so the app keeps working without a database.
 *
 * TLS: managed providers usually require it. `DATABASE_SSL=require` enables
 * strict verification; `DATABASE_SSL=no-verify` accepts a provider certificate
 * that Node cannot chain; unset means no TLS (local development).
 */

export function databaseConfigured(env = process.env) {
  return Boolean(env.DATABASE_URL);
}

export function sslOptions(env = process.env) {
  const mode = String(env.DATABASE_SSL || "").toLowerCase();
  if (mode === "require") return { rejectUnauthorized: true };
  if (mode === "no-verify") return { rejectUnauthorized: false };
  return undefined;
}

/**
 * @param {{env?:object, PoolClass?:Function}} [options]
 */
export async function createPool({ env = process.env, PoolClass } = {}) {
  if (!databaseConfigured(env)) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const Pool = PoolClass ?? (await import("pg")).default.Pool;
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: Number(env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslOptions(env),
    application_name: "marketlens",
    allowExitOnIdle: true
  });
}
