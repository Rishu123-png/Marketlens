/**
 * Migration runner.
 *
 * Migrations are plain SQL files applied in filename order and recorded in
 * `schema_migrations`. Applying an already-applied version is a no-op, so the
 * runner is safe to call on every worker boot.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function listMigrations(directory = MIGRATIONS_DIR) {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return files.map((file) => ({ version: file.replace(/\.sql$/, ""), file: path.join(directory, file) }));
}

export async function runMigrations(client, { directory = MIGRATIONS_DIR, logger = console } = {}) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const applied = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((row) => row.version));
  const migrations = await listMigrations(directory);
  const ran = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const sql = await readFile(migration.file, "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
      await client.query("COMMIT");
      ran.push(migration.version);
      logger?.log?.(`[storage] applied migration ${migration.version}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  return { applied: ran, total: migrations.length };
}
