/**
 * PostgreSQL implementation of the research-job store.
 *
 * The interface mirrors `InMemoryJobStore` so the worker and API do not care
 * which one they hold. Transitions are still validated by `jobLifecycle.js`
 * before SQL runs: the database is not the only guard against an illegal state.
 *
 * Status: implemented, exercised against a stub client in unit tests, and
 * **not yet run against a live PostgreSQL instance** in this environment.
 * Migration `001_init.sql` must be applied first.
 */

import { createResearchJob, applyGate, transitionJob, isTerminalJobStatus } from "../orchestrator/jobLifecycle.js";
import { REQUIRED_MODULES_BY_DEPTH } from "../../shared/schemas/research.js";
import { JobNotFoundError } from "../jobs/store.js";
import { saveReport, getReportForJob } from "./reports.js";

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapJob(row, history = []) {
  return {
    jobId: row.job_id,
    instrumentId: row.instrument_id,
    depth: row.depth,
    timeframe: row.timeframe,
    historyPeriod: row.history_period,
    newsLookbackDays: row.news_lookback_days,
    requestedModules: row.requested_modules,
    status: row.status,
    gate: row.gate ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    history: history.map((event) => ({
      from: event.from_status ?? null,
      to: event.to_status,
      at: iso(event.at),
      reason: event.reason ?? null
    }))
  };
}

async function insertEvent(client, jobId, event) {
  await client.query(
    `INSERT INTO research_job_events (job_id, from_status, to_status, at, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [jobId, event.from, event.to, event.at, event.reason]
  );
}

async function persistTransition(client, updated, previousStatus, event) {
  await client.query(
    `UPDATE research_jobs SET status = $2, gate = $3, updated_at = $4 WHERE job_id = $1`,
    [updated.jobId, updated.status, updated.gate ? JSON.stringify(updated.gate) : null, updated.updatedAt]
  );
  await insertEvent(client, updated.jobId, {
    from: previousStatus,
    to: updated.status,
    at: event.at ?? updated.updatedAt,
    reason: event.reason ?? null
  });
}

export function createPgJobStore(client, { now = () => new Date().toISOString() } = {}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("createPgJobStore requires a pg client or pool.");
  }

  async function loadJob(jobId) {
    const { rows } = await client.query(`SELECT * FROM research_jobs WHERE job_id = $1`, [jobId]);
    if (!rows.length) throw new JobNotFoundError(jobId);

    const events = await client.query(
      `SELECT from_status, to_status, at, reason FROM research_job_events WHERE job_id = $1 ORDER BY at, id`,
      [jobId]
    );

    return mapJob(rows[0], events.rows);
  }

  return {
    kind: "postgres",

    async setOwner(jobId, hash) {
      if (!hash) return;
      await client.query(`UPDATE research_jobs SET owner_hash = $1 WHERE job_id = $2`, [hash, jobId]);
    },

    async getOwnerHash(jobId) {
      const { rows } = await client.query(`SELECT owner_hash FROM research_jobs WHERE job_id = $1`, [jobId]);
      return rows[0]?.owner_hash ?? null;
    },

    async create({ instrumentId, depth, timeframe, historyPeriod, newsLookbackDays, jobId } = {}) {
      const job = createResearchJob({
        instrumentId,
        depth,
        requestedModules: REQUIRED_MODULES_BY_DEPTH[depth],
        timeframe,
        historyPeriod,
        newsLookbackDays,
        now: now(),
        ...(jobId ? { jobId } : {})
      });

      await client.query(
        `INSERT INTO research_jobs
           (job_id, instrument_id, depth, timeframe, history_period, news_lookback_days,
            requested_modules, status, gate, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$9)`,
        [
          job.jobId,
          job.instrumentId,
          job.depth,
          job.timeframe,
          job.historyPeriod,
          job.newsLookbackDays,
          JSON.stringify(job.requestedModules),
          job.status,
          job.createdAt
        ]
      );

      await insertEvent(client, job.jobId, { from: null, to: job.status, at: job.createdAt, reason: null });
      return job;
    },

    async get(jobId) {
      return loadJob(jobId);
    },

    async has(jobId) {
      const { rows } = await client.query(`SELECT 1 FROM research_jobs WHERE job_id = $1`, [jobId]);
      return rows.length > 0;
    },

    async list({ limit = 20, status = null, ownerHash = null } = {}) {
      const safeLimit = Math.min(Math.max(limit, 1), 100);
      const clauses = [];
      const params = [];
      if (status) {
        params.push(status);
        clauses.push(`status = $${params.length}`);
      }
      if (ownerHash) {
        params.push(ownerHash);
        clauses.push(`owner_hash = $${params.length}`);
      } else {
        clauses.push("owner_hash IS NULL");
      }
      params.push(safeLimit);
      const { rows } = await client.query(
        `SELECT * FROM research_jobs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT $${params.length}`,
        params
      );
      return rows.map((row) => mapJob(row));
    },

    async transition(jobId, status, options = {}) {
      const job = await loadJob(jobId);
      const at = options.at ?? now();
      const updated = transitionJob(job, status, { at, reason: options.reason ?? null, gate: options.gate });

      await client.query("BEGIN");
      try {
        await persistTransition(client, updated, job.status, { at, reason: options.reason ?? null });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      return updated;
    },

    async claimNext() {
      await client.query("BEGIN");
      try {
        const { rows } = await client.query(
          `UPDATE research_jobs
              SET status = 'RUNNING', updated_at = $1
            WHERE job_id = (
              SELECT job_id FROM research_jobs
               WHERE status = 'QUEUED'
               ORDER BY created_at
               LIMIT 1
               FOR UPDATE SKIP LOCKED
            )
            RETURNING *`,
          [now()]
        );

        if (!rows.length) {
          await client.query("COMMIT");
          return null;
        }

        const job = mapJob(rows[0]);
        await insertEvent(client, job.jobId, { from: "QUEUED", to: "RUNNING", at: job.updatedAt, reason: "worker claimed job" });
        await client.query("COMMIT");
        return job;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },

    async complete(jobId, gate, { partial = false, reason = null } = {}) {
      const job = await loadJob(jobId);
      const updated = applyGate(job, gate, { at: now(), reason, partial });

      await client.query("BEGIN");
      try {
        await persistTransition(client, updated, job.status, { at: updated.updatedAt, reason });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      return updated;
    },

    async fail(jobId, reason) {
      const job = await loadJob(jobId);
      if (isTerminalJobStatus(job.status)) return job;
      return this.transition(jobId, "FAILED", { reason: String(reason).slice(0, 500) });
    },

    async cancel(jobId) {
      const job = await loadJob(jobId);
      if (isTerminalJobStatus(job.status)) return job;
      return this.transition(jobId, "CANCELLED", { reason: "cancelled by operator" });
    },

    async saveAgentRuns(jobId, runs) {
      for (const run of Object.values(runs)) {
        await client.query(
          `INSERT INTO agent_runs
             (job_id, agent, status, provider, model, prompt_version, schema_version,
              started_at, completed_at, duration_ms, error, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            jobId,
            run.agent,
            run.status,
            run.provider ?? null,
            run.model ?? null,
            run.promptVersion ?? null,
            run.schemaVersion ?? null,
            run.startedAt ?? null,
            run.completedAt ?? null,
            run.durationMs ?? null,
            run.error ?? null,
            JSON.stringify(run)
          ]
        );
      }
    },

    async getAgentRuns(jobId) {
      const { rows } = await client.query(
        `SELECT agent, payload FROM agent_runs WHERE job_id = $1 ORDER BY id`,
        [jobId]
      );
      return Object.fromEntries(rows.map((row) => [row.agent, row.payload]));
    },

    async saveResult(jobId, result) {
      if (result?.report) {
        await saveReport(client, { report: result.report, versions: result.versions ?? null });
      }

      const evidenceItems = result?.evidenceForStorage?.items ?? [];

      for (const item of evidenceItems) {
        if (!item?.id || !item?.dedupeFingerprint) continue;
        await client.query(
          `INSERT INTO evidence_items
             (evidence_id, job_id, source_type, publisher, url, published_at, retrieved_at,
              excerpt, verification, dedupe_fingerprint, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (evidence_id) DO NOTHING`,
          [
            item.id,
            jobId,
            item.sourceType,
            item.publisher,
            item.url ?? null,
            item.publishedAt ?? null,
            item.retrievedAt,
            item.excerpt ?? null,
            item.verification,
            item.dedupeFingerprint,
            item.metadata ? JSON.stringify(item.metadata) : null
          ]
        );
      }
    },

    async getResult(jobId) {
      const report = await getReportForJob(client, jobId);
      return report ? { report } : null;
    }
  };
}
