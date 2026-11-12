import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => readFile(path.join(root, file), "utf8");

/** Strip comments so documentation that mentions a module is not mistaken for an import. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * These tests protect the layering that the publication gate depends on:
 * deterministic calculations and publication decisions must not be able to
 * consult a model, directly or transitively.
 */

test("the publication gate does not import the AI layer", async () => {
  const source = stripComments(await read("server/reports/gate.js"));

  assert.doesNotMatch(source, /server\/ai/);
  assert.doesNotMatch(source, /providers\/groq/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\.completeJson\s*\(/);
});

test("the lifecycle module does not import the AI layer", async () => {
  const source = stripComments(await read("server/orchestrator/jobLifecycle.js"));
  assert.doesNotMatch(source, /server\/ai/);
});

test("indicator calculations stay deterministic and model-free", async () => {
  const source = stripComments(await read("server/indicators/index.js"));

  assert.doesNotMatch(source, /server\/ai/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /groq/i);
  assert.doesNotMatch(source, /from "zod"/);
});

test("the AI layer never decides publication", async () => {
  for (const file of ["server/ai/runAgent.js", "server/ai/config.js", "server/ai/providers/groq.js"]) {
    const source = stripComments(await read(file));
    assert.doesNotMatch(source, /reports\/gate/, `${file} must not import or evaluate the gate`);
  }
});

test("the report endpoint delegates to the AI abstraction instead of calling Groq directly", async () => {
  const source = stripComments(await read("api/report.js"));

  assert.match(source, /runStructuredCompletion/);
  assert.doesNotMatch(source, /api\.groq\.com/);
  assert.doesNotMatch(source, /Authorization:/);
});

test("shared schemas never reach into server code", async () => {
  for (const file of [
    "shared/schemas/index.js",
    "shared/schemas/quote.js",
    "shared/schemas/research.js",
    "shared/schemas/gate.js",
    "shared/instruments/catalog.js"
  ]) {
    const source = await read(file);
    assert.doesNotMatch(source, /from "\.\.\/\.\.\/server/, `${file} must not import server code`);
  }
});

test("the client bundle entry does not import validation or server modules", async () => {
  const source = await read("src/main.jsx");

  assert.doesNotMatch(source, /shared\/schemas/, "zod must stay out of the browser bundle");
  assert.doesNotMatch(source, /server\//);
});
