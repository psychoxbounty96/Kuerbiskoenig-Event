import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the public event website", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Kürbiskönig/);
  assert.match(html, /Mehrere Streams/);
  assert.match(html, /Community-Rangliste/);
  assert.match(html, /Zuschauer/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("renders the stream overlay", async () => {
  const response = await render("/overlay");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Overlay erfolgreich verbunden/);
  assert.match(html, /Event startet bald/);
  assert.match(html, /data-identity-status="resolved"/);
});

test("renders the local admin panel", async () => {
  const response = await render("/admin");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Eventsteuerung/);
  assert.match(html, /Minion Debugger/);
  assert.match(html, /CHAT-SIMULATOR/i);
  assert.match(html, /Streamer-Verwaltung/i);
  assert.match(html, /Twitch Status/);
  assert.match(html, /Simulate Raid/);
  assert.match(html, /TEST-EVENT/);
});
