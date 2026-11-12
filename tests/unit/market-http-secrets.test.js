import test from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "../../server/market-data/http.js";

test("provider error bodies cannot echo apikey query values", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "bad key SECRET-VALUE-123 for apikey=SECRET-VALUE-123" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });

  await assert.rejects(
    () => fetchJson("https://provider.example/quote?symbol=TCS&apikey=SECRET-VALUE-123"),
    (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.message.includes("SECRET-VALUE-123"), false);
      assert.match(error.message, /\[redacted\]/);
      return true;
    }
  );
});
