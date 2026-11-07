import test from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../scripts/api-server.js";

test("local API adapter dispatches Vercel-style health routes", async () => {
  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.service, "marketlens-api");

    const universeResponse = await fetch(`http://127.0.0.1:${port}/api/universe`);
    const universe = await universeResponse.json();
    assert.equal(universeResponse.status, 200);
    assert.equal(universe.count, 20);
    assert.equal(universe.stocks[0].symbol, "RELIANCE");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
