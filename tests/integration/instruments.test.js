import test from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../../scripts/api-server.js";

async function withServer(callback) {
  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("instruments endpoint lists the catalog with stable ids", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/instruments`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.total >= 30);
    assert.equal(body.count, Math.min(50, body.total));

    const reliance = body.instruments.find((instrument) => instrument.symbol === "RELIANCE");
    assert.equal(reliance.id, "IN-EQ-RELIANCE");
    assert.equal(reliance.country, "IN");
    assert.equal(reliance.currency, "INR");
    assert.equal(reliance.assetType, "equity");
  });
});

test("instruments endpoint filters by asset type and country", async () => {
  await withServer(async (base) => {
    const indices = await (await fetch(`${base}/api/instruments?assetType=index`)).json();
    assert.ok(indices.total >= 5);
    assert.ok(indices.instruments.every((instrument) => instrument.assetType === "index"));

    const usEtfs = await (await fetch(`${base}/api/instruments?country=US&assetType=etf`)).json();
    assert.deepEqual(
      usEtfs.instruments.map((instrument) => instrument.symbol).sort(),
      ["QQQ", "SPY"]
    );
  });
});

test("instruments endpoint searches by ticker and company name", async () => {
  await withServer(async (base) => {
    const byTicker = await (await fetch(`${base}/api/instruments?q=NVDA`)).json();
    assert.equal(byTicker.instruments[0].symbol, "NVDA");

    const byName = await (await fetch(`${base}/api/instruments?q=microsoft`)).json();
    assert.equal(byName.instruments[0].symbol, "MSFT");

    const none = await (await fetch(`${base}/api/instruments?q=zzzzzz`)).json();
    assert.equal(none.total, 0);
    assert.deepEqual(none.instruments, []);
  });
});

test("instruments endpoint resolves a single instrument by id", async () => {
  await withServer(async (base) => {
    const found = await fetch(`${base}/api/instruments?id=US-EQ-AAPL`);
    const body = await found.json();
    assert.equal(found.status, 200);
    assert.equal(body.instrument.symbol, "AAPL");
    assert.equal(body.instrument.exchange, "NASDAQ");

    const missing = await fetch(`${base}/api/instruments?id=US-EQ-NOPE`);
    assert.equal(missing.status, 404);
  });
});

test("instruments endpoint validates filters and paginates", async () => {
  await withServer(async (base) => {
    const badType = await fetch(`${base}/api/instruments?assetType=crypto`);
    assert.equal(badType.status, 400);
    assert.deepEqual((await badType.json()).supported, ["equity", "index", "etf"]);

    const page = await (await fetch(`${base}/api/instruments?limit=5&offset=3`)).json();
    assert.equal(page.count, 5);
    assert.equal(page.offset, 3);
    assert.equal(page.limit, 5);

    const oversized = await (await fetch(`${base}/api/instruments?limit=5000`)).json();
    assert.equal(oversized.limit, 200);
  });
});

test("instrument discovery is rate limited", async () => {
  await withServer(async (base) => {
    let last;
    for (let index = 0; index < 121; index += 1) {
      last = await fetch(`${base}/api/instruments?limit=1`);
      if (last.status === 429) break;
    }

    assert.equal(last.status, 429);
    const body = await last.json();
    assert.match(body.error, /Too many instrument requests/);
    assert.ok(Number(last.headers.get("retry-after")) > 0);
  });
});
