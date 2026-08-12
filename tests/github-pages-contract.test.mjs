import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("GitHub Actions deploys only the static Pages artifact", async () => {
  const workflow = await read(".github/workflows/deploy-pages.yml");
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /path: github-pages-dist/);
  assert.match(workflow, /VITE_DATA_PROVIDER: supabase/);
  assert.match(workflow, /vars\.SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(workflow, /SERVICE_ROLE|TWITCH_CLIENT_SECRET|PARTICIPANT_PEPPER/);
});

test("static build keeps privileged values out of browser configuration", async () => {
  const config = await read("vite.config.ts");
  assert.match(config, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(config, /github-pages-dist/);
  assert.doesNotMatch(config, /SERVICE_ROLE|TWITCH_CLIENT_SECRET|EVENTSUB_SECRET|PARTICIPANT_PEPPER/);
});

test("deployment kit separates GitHub, Supabase and StreamElements", async () => {
  const start = await read("deployment/START_HIER.md");
  const packager = await read("scripts/create-deployment-kit.mjs");
  assert.match(start, /1\. GitHub/);
  assert.match(start, /2\. Supabase/);
  assert.match(start, /3\. StreamElements/);
  assert.match(packager, /01_GITHUB_REPOSITORY/);
  assert.match(packager, /02_SUPABASE_BACKEND/);
  assert.match(packager, /03_STREAMELEMENTS_WIDGET/);
});

test("public page hides placeholder boss data until Supabase has synced", async () => {
  const page = await read("app/components/PublicEventPage.tsx");
  assert.match(page, /if \(!runtime\.lastSyncedAt\)/);
  assert.match(page, /Event in Vorbereitung/);
  assert.match(page, /startet bald/);
});
