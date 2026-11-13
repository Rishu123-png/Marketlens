import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createApiServer, loadLocalEnvironment } from "./api-server.js";
import { startDevWorker } from "./dev-worker.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await loadLocalEnvironment();
const apiServer = createApiServer();
const apiPort = Number(process.env.API_PORT || 8787);
const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
let vite;
let worker;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  vite?.kill("SIGTERM");
  worker?.stop();
  apiServer.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 2_000).unref();
}

apiServer.listen(apiPort, "127.0.0.1", () => {
  // QStash delivers to its own configured worker. Otherwise local development
  // needs a poller in this process to see the default in-memory job store.
  const externalQueue = Boolean(process.env.QSTASH_TOKEN && process.env.WORKER_URL);
  const localWorkerDisabled = /^(off|false|0|disabled)$/i.test(process.env.DEV_RESEARCH_WORKER || "");
  if (!externalQueue && !localWorkerDisabled) {
    worker = startDevWorker();
    console.log("[dev worker] polling research jobs in the API process");
  }
  vite = spawn(process.execPath, [viteEntry, "--host", "0.0.0.0"], {
    cwd: root,
    env: { ...process.env, API_PORT: String(apiPort) },
    stdio: "inherit"
  });
  vite.on("error", (error) => {
    console.error("Could not start Vite:", error.message);
    shutdown(1);
  });
  vite.on("exit", (code) => shutdown(code || 0));
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
