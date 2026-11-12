/**
 * Storage composition.
 *
 * Without `DATABASE_URL` the app uses the in-memory job store and the
 * filesystem object store: fine for local development and tests, not for
 * production. With a database configured, jobs, agent runs, evidence and
 * reports are durable and shared between the API and the worker.
 *
 * `getStorage()` is async because the PostgreSQL pool is created lazily and
 * migrations are applied on first use.
 */

import { createPool, databaseConfigured } from "./pg.js";
import { runMigrations } from "./migrations.js";
import { createPgJobStore } from "./pgJobStore.js";
import { getJobStore } from "../jobs/store.js";
import { createFilesystemObjectStore, createS3ObjectStore, objectStorageStatus } from "./objects.js";
import * as reports from "./reports.js";

let cached = null;

export async function getStorage(options = {}) {
  const env = options.env ?? process.env;

  if (!databaseConfigured(env)) {
    if (!cached || cached.kind !== "memory") {
      cached = {
        kind: "memory",
        reports,
        objects: createFilesystemObjectStore({
          root: env.OBJECT_STORE_ROOT || ".data/objects"
        }),
        migrated: false
      };
    }
    // The shared memory store can be replaced (tests, restart); read it fresh.
    cached.jobStore = getJobStore();
    return cached;
  }

  if (cached && cached.kind === "postgres" && !options.refresh) return cached;

  const pool = options.pool ?? (await createPool({ env }));
  const migrated = options.skipMigrations ? { applied: [], total: 0 } : await runMigrations(pool, { logger: options.logger });

  cached = {
    kind: "postgres",
    pool,
    jobStore: createPgJobStore(pool),
    reports,
    objects: env.S3_BUCKET ? createS3ObjectStore({ ...env }) : createFilesystemObjectStore({
      root: env.OBJECT_STORE_ROOT || ".data/objects"
    }),
    migrated: true,
    migrations: migrated
  };

  return cached;
}

export function storageStatus(env = process.env) {
  return {
    database: {
      configured: databaseConfigured(env),
      implementation: databaseConfigured(env) ? "postgres" : "memory",
      verification: databaseConfigured(env) ? "implemented-unverified" : "local-only",
      note: databaseConfigured(env)
        ? "Schema and repositories are implemented; run migrations and validate against your instance."
        : "Set DATABASE_URL to persist jobs, runs, evidence and reports."
    },
    objects: objectStorageStatus(env)
  };
}

export function resetStorageForTests() {
  cached = null;
}
