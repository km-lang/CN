import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("build includes development preview metadata", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const serverBundle = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.match(layout, /"codex-preview":\s*"development"/);
  assert.match(serverBundle, /codex-preview/);
  assert.match(serverBundle, /development/);
});
