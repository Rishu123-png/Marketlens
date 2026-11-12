/**
 * Report repository.
 *
 * Reports are immutable artefacts. Inserting an existing report id does
 * nothing; a correction is recorded in `report_revisions` and published as a
 * new report row with its own timestamp. Stored evidence keeps the excerpt and
 * retrieval time observed when the analysis ran, so history is never rewritten
 * to match a source that has since changed.
 */

export async function saveReport(client, { report, versions = null } = {}) {
  if (!report?.reportId) throw new TypeError("A report with a reportId is required.");

  const result = await client.query(
    `INSERT INTO reports
       (report_id, job_id, instrument_id, depth, sections, agent_status, evidence_ids,
        gate, methodology, versions, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (report_id) DO NOTHING
     RETURNING report_id`,
    [
      report.reportId,
      report.jobId,
      report.instrumentId,
      report.depth,
      JSON.stringify(report.sections),
      JSON.stringify(report.agentStatus),
      JSON.stringify(report.evidenceIds),
      JSON.stringify(report.gate),
      report.methodology,
      versions ? JSON.stringify(versions) : null,
      report.createdAt
    ]
  );

  return { reportId: report.reportId, inserted: result.rowCount === 1 };
}

function mapReport(row) {
  return {
    reportId: row.report_id,
    jobId: row.job_id,
    instrumentId: row.instrument_id,
    depth: row.depth,
    sections: row.sections,
    agentStatus: row.agent_status,
    evidenceIds: row.evidence_ids,
    gate: row.gate,
    methodology: row.methodology,
    versions: row.versions ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

export async function getReport(client, reportId) {
  const { rows } = await client.query(`SELECT * FROM reports WHERE report_id = $1`, [reportId]);
  return rows.length ? mapReport(rows[0]) : null;
}

export async function getReportForJob(client, jobId) {
  const { rows } = await client.query(
    `SELECT * FROM reports WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [jobId]
  );
  return rows.length ? mapReport(rows[0]) : null;
}

export async function listReports(client, { instrumentId = null, limit = 20 } = {}) {
  const capped = Math.min(Math.max(limit, 1), 100);
  const { rows } = instrumentId
    ? await client.query(
        `SELECT * FROM reports WHERE instrument_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [instrumentId, capped]
      )
    : await client.query(`SELECT * FROM reports ORDER BY created_at DESC LIMIT $1`, [capped]);

  return rows.map(mapReport);
}

/**
 * Record that a report was superseded. The original row is untouched.
 */
export async function addRevision(client, { reportId, reason }) {
  if (!reportId) throw new TypeError("reportId is required.");
  if (!reason) throw new TypeError("A revision reason is required.");

  await client.query(`INSERT INTO report_revisions (report_id, reason) VALUES ($1, $2)`, [reportId, reason]);
  return { reportId, reason, recordedAt: new Date().toISOString() };
}
