import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => vite.close());

const profile = await vite.ssrLoadModule("/lib/professional-profile.ts");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const discovery = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8");
const workspace = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8");
const alumniSearch = await readFile(new URL("../lib/alumni-search.ts", import.meta.url), "utf8");

test("profile URL 1: scheme-less LinkedIn URLs receive an HTTPS scheme", () => {
  assert.equal(profile.normalizeProfessionalProfileUrl("linkedin.com/in/example"), "https://linkedin.com/in/example");
  assert.equal(profile.normalizeProfessionalProfileUrl("www.linkedin.com/in/example"), "https://www.linkedin.com/in/example");
});

test("profile URL 2: already-correct HTTPS profile URLs remain unchanged", () => {
  assert.equal(profile.normalizeProfessionalProfileUrl("https://linkedin.com/in/example"), "https://linkedin.com/in/example");
  assert.equal(profile.normalizeProfessionalProfileUrl("https://www.linkedin.com/in/example"), "https://www.linkedin.com/in/example");
});

test("profile URL 3: unsafe protocols and malformed values are disabled", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,unsafe", "ftp://linkedin.com/in/example", "not a valid url", "https://localhost/profile"]) {
    assert.equal(profile.normalizeProfessionalProfileUrl(value), "", value);
  }
});

test("profile URL 4: external profile links never use the application public URL", () => {
  const normalized = profile.normalizeProfessionalProfileUrl("linkedin.com/in/sahilb");
  assert.equal(normalized, "https://linkedin.com/in/sahilb");
  assert.doesNotMatch(normalized, /network\.teamsynapse\.app|chatgpt\.site/);
  assert.match(page, /href=\{selectedProfessionalProfileUrl\}/);
  assert.match(page, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(page, /appConfig\.publicUrl[^\n]*linkedinUrl|APP_PUBLIC_URL[^\n]*linkedinUrl/);
});

test("profile URL 5: ingestion and API rendering both normalize legacy values", () => {
  assert.match(alumniSearch, /linkedinUrl: normalizeProfessionalProfileUrl\(record\.linkedin_url\)/);
  assert.match(discovery, /linkedinUrl: normalizeProfessionalProfileUrl\(result\.linkedinUrl\)/);
  assert.match(workspace, /linkedinUrl: normalizeProfessionalProfileUrl\(row\.linkedinUrl\)/);
  assert.match(page, /"Coresignal"\} sourced professional profile/);
});

test("profile display 6: missing experience is not presented as a known zero", () => {
  const missing = profile.professionalExperienceSummary(0, "");
  assert.equal(missing, "Experience history not available");
  assert.doesNotMatch(missing, /0 years/);
  assert.equal(profile.professionalExperienceSummary(0, "Microsoft"), "Experience duration not available · Previously Microsoft");
  assert.equal(profile.professionalExperienceSummary(8, "Microsoft"), "8 years · Previously Microsoft");
  assert.doesNotMatch(page, /selected\.experience\} years/);
});
