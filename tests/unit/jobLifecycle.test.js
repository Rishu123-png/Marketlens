import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_TRANSITIONS,
  JOB_TRANSITIONS,
  TERMINAL_JOB_STATUSES,
  JobTransitionError,
  applyGate,
  assertAgentTransition,
  assertJobTransition,
  canTransitionJob,
  createResearchJob,
  isTerminalJobStatus,
  transitionJob
} from "../../server/orchestrator/jobLifecycle.js";
import { JOB_STATUSES } from "../../shared/schemas/research.js";
import { AGENT_STATUSES } from "../../shared/schemas/agent.js";

const NOW = "2026-11-12T10:00:00.000Z";
const LATER = "2026-11-12T10:01:00.000Z";

const passGate = {
  verdict: "PASS",
  rulesVersion: "1.0.0",
  evaluatedAt: NOW,
  checks: [{ rule: "quote.present", status: "pass", detail: "ok" }],
  blocking: [],
  warnings: []
};

const blockedGate = {
  verdict: "BLOCKED",
  rulesVersion: "1.0.0",
  evaluatedAt: NOW,
  checks: [{ rule: "quote.present", status: "block", detail: "missing" }],
  blocking: [{ rule: "quote.present", message: "missing" }],
  warnings: []
};

const baseJobInput = {
  instrumentId: "IN-EQ-RELIANCE",
  depth: "quick",
  timeframe: "1D",
  historyPeriod: "1Y",
  newsLookbackDays: 30,
  requestedModules: ["quote", "technical", "chart", "risk"],
  now: NOW,
  jobId: "research_abcdef12"
};

function jobAt(status) {
  const job = createResearchJob(baseJobInput);
  return { ...job, status };
}

test("createResearchJob produces a schema-valid job starting in CREATED", () => {
  const job = createResearchJob(baseJobInput);

  assert.equal(job.status, "CREATED");
  assert.equal(job.history.length, 1);
  assert.deepEqual(job.history[0], { from: null, to: "CREATED", at: NOW, reason: null });
  assert.match(job.jobId, /^research_[a-z0-9]{8,}$/);
  assert.equal(job.updatedAt, NOW);
});

test("generated job ids are unique", () => {
  const { jobId, ...withoutId } = baseJobInput;
  const ids = new Set(Array.from({ length: 50 }, () => createResearchJob(withoutId).jobId));
  assert.equal(ids.size, 50);
});

test("the transition table contains exactly the declared legal moves", () => {
  const expected = {
    CREATED: ["VALIDATING", "CANCELLED", "FAILED"],
    VALIDATING: ["QUEUED", "BLOCKED", "FAILED", "CANCELLED"],
    QUEUED: ["RUNNING", "CANCELLED", "FAILED"],
    RUNNING: ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED", "CANCELLED"],
    PARTIAL: [],
    COMPLETED: [],
    BLOCKED: [],
    FAILED: [],
    CANCELLED: []
  };

  assert.deepEqual(Object.keys(JOB_TRANSITIONS).sort(), [...JOB_STATUSES].sort());

  for (const [from, targets] of Object.entries(expected)) {
    assert.deepEqual([...JOB_TRANSITIONS[from]].sort(), [...targets].sort(), `targets for ${from}`);
    for (const to of targets) {
      assert.equal(canTransitionJob(from, to), true, `${from} → ${to} should be legal`);
      assert.equal(assertJobTransition(from, to), true);
    }
  }
});

test("every transition not in the table is rejected", () => {
  for (const from of JOB_STATUSES) {
    for (const to of JOB_STATUSES) {
      const legal = JOB_TRANSITIONS[from].includes(to);
      if (legal) continue;

      assert.equal(canTransitionJob(from, to), false, `${from} → ${to} should be illegal`);
      assert.throws(
        () => assertJobTransition(from, to),
        (error) => {
          assert.ok(error instanceof JobTransitionError);
          assert.equal(error.code, "ILLEGAL_JOB_TRANSITION");
          assert.equal(error.statusCode, 409);
          assert.equal(error.from, from);
          assert.equal(error.to, to);
          return true;
        },
        `${from} → ${to} must throw`
      );
    }
  }
});

test("unknown statuses are rejected rather than treated as strings", () => {
  assert.throws(() => assertJobTransition("CREATED", "FINISHED"), JobTransitionError);
  assert.equal(canTransitionJob("CREATED", undefined), false);
});

test("the happy path moves CREATED → VALIDATING → QUEUED → RUNNING → COMPLETED", () => {
  let job = createResearchJob(baseJobInput);

  job = transitionJob(job, "VALIDATING", { at: LATER });
  job = transitionJob(job, "QUEUED", { at: LATER });
  job = transitionJob(job, "RUNNING", { at: LATER });
  job = transitionJob(job, "COMPLETED", { at: LATER, gate: passGate });

  assert.equal(job.status, "COMPLETED");
  assert.equal(job.gate.verdict, "PASS");
  assert.equal(job.history.length, 5);
  assert.deepEqual(
    job.history.map((event) => event.to),
    ["CREATED", "VALIDATING", "QUEUED", "RUNNING", "COMPLETED"]
  );
  assert.equal(job.updatedAt, LATER);
});

test("a gate result is mandatory for terminal outcomes", () => {
  const running = jobAt("RUNNING");

  for (const target of ["COMPLETED", "PARTIAL", "BLOCKED"]) {
    assert.throws(
      () => transitionJob(running, target, { at: LATER }),
      JobTransitionError,
      `${target} without a gate must throw`
    );
  }
});

test("the job verdict can never contradict the gate verdict", () => {
  const running = jobAt("RUNNING");

  assert.throws(
    () => transitionJob(running, "COMPLETED", { gate: blockedGate, at: LATER }),
    /cannot carry a BLOCKED gate verdict/
  );

  assert.throws(
    () => transitionJob(running, "BLOCKED", { gate: passGate, at: LATER }),
    /requires a BLOCKED gate verdict/
  );

  const blocked = transitionJob(running, "BLOCKED", { gate: blockedGate, at: LATER });
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.gate.verdict, "BLOCKED");
});

test("terminal statuses cannot be moved", () => {
  for (const status of TERMINAL_JOB_STATUSES) {
    for (const to of JOB_STATUSES) {
      assert.throws(() => transitionJob(jobAt(status), to, { at: LATER, gate: passGate }), JobTransitionError);
    }
    assert.equal(isTerminalJobStatus(status), true);
  }

  assert.equal(isTerminalJobStatus("RUNNING"), false);
});

test("a transition keeps the recorded history immutable", () => {
  const job = createResearchJob(baseJobInput);
  const before = job.history.length;

  const next = transitionJob(job, "VALIDATING", { at: LATER, reason: "data checks" });

  assert.equal(job.history.length, before, "original job must not be mutated");
  assert.equal(next.history.length, before + 1);
  assert.equal(next.history.at(-1).reason, "data checks");
});

test("applyGate derives the outcome from the verdict", () => {
  const running = jobAt("RUNNING");

  assert.equal(applyGate(running, passGate, { at: LATER }).status, "COMPLETED");
  assert.equal(applyGate(running, passGate, { at: LATER, partial: true }).status, "PARTIAL");
  assert.equal(applyGate(running, blockedGate, { at: LATER }).status, "BLOCKED");
});

test("agent lifecycle allows recovery only through RETRYING", () => {
  assert.equal(AGENT_TRANSITIONS.RUNNING.includes("RETRYING"), true);
  assert.equal(AGENT_TRANSITIONS.RETRYING.includes("RUNNING"), true);
  assert.equal(AGENT_TRANSITIONS.FAILED.length, 0);

  for (const from of AGENT_STATUSES) {
    for (const to of AGENT_STATUSES) {
      const legal = AGENT_TRANSITIONS[from].includes(to);
      if (legal) assert.equal(assertAgentTransition(from, to), true);
      else assert.throws(() => assertAgentTransition(from, to), /Illegal agent transition/);
    }
  }
});

test("an agent cannot be retried straight from FAILED", () => {
  assert.throws(() => assertAgentTransition("FAILED", "RUNNING"), /Illegal agent transition/);
  assert.throws(() => assertAgentTransition("COMPLETED", "RUNNING"), /Illegal agent transition/);
});
