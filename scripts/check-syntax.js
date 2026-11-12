#!/usr/bin/env node
// Parse every server-side module without executing it.
// Catches the class of defect that shipped in api/history.js: a file the build
// never touches, which fails at import time with a 500 at runtime.
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["api", "handlers", "server", "shared", "lib", "scripts", "test", "tests"];

async function collect(directory) {
  const files = [];
  let entries;

  try {
    entries = await readdir(path.join(root, directory), { withFileTypes: true });
  } catch {
    return files; // directory may not exist yet
  }

  for (const entry of entries) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(relative)));
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) files.push(relative);
  }

  return files;
}

const files = (await Promise.all(targets.map(collect))).flat().sort();
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
  } catch (error) {
    failures.push({
      file,
      message: String(error.stderr || error.message).trim().split("\n").slice(0, 6).join("\n")
    });
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`✗ ${failure.file}\n${failure.message}\n`);
  }
  console.error(`${failures.length} of ${files.length} files failed to parse.`);
  process.exit(1);
}

console.log(`✓ ${files.length} files parse cleanly.`);
