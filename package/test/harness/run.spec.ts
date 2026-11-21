import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Json, type JsonObject, isObject } from "../../src/harness/grading.js";
import { type RunFile, mainRun } from "../../src/harness/run.js";
import { santaDir } from "./santa.js";

const santa = santaDir();

/** A wire answer that is right by construction: the reject arm errored, else the blessed bytes. */
const honest: RunFile = (_path, doc) => {
  const out: Record<string, Json> = {};
  for (const e of (isObject(doc) && Array.isArray(doc.entries) ? doc.entries : []).filter(isObject))
    out[e.name as string] = e.error === "errored"
      ? { bytes_hex: null, error: "errored" }
      : { bytes_hex: (e.expected_bytes_hex ?? e.bytes_hex) as Json, error: null };
  return out;
};

describe("mainRun", () => {
  it("an honest run writes results.json and one actuals file per selected file, with no reds", async () => {
    const d = mkdtempSync(join(tmpdir(), "comet-run-"));
    const rj = join(d, "runner.json");
    writeFileSync(rj, `{"name": "t", "version": "v5", "tiers": ["wire"], "kinds": ["Box"]}`);
    const out = join(d, "out");
    await mainRun(rj, santa, out, honest, () => ["false"]);
    const r = JSON.parse(readFileSync(join(out, "results.json"), "utf8")) as JsonObject;
    expect(r.schema).toBe("santa-runner-results/v1");
    expect(r.santa).toBe(execFileSync("git", ["-C", santa, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
    expect(r.scope).toEqual({ version: "v5", tiers: ["wire"], cost: true, kinds: ["Box"] });
    expect(r.totals).toEqual({ red: 0, not_implemented: 0 });
    const slices = r.slices as JsonObject;
    expect(Object.keys(slices).length).toBeGreaterThan(0);
    for (const [k, s] of Object.entries(slices) as [string, JsonObject][]) {
      expect(k).toMatch(/^wire\/(any|v4|v5)\/[a-z]+$/);
      for (const f of s.files as string[]) {
        expect(f).toMatch(/\/Box[.\w]*\.json$/);
        expect(existsSync(join(out, "actuals", f)), f).toBe(true);
      }
      expect(s.red).toEqual([]);
      expect(Object.keys(s.dims as JsonObject).length).toBeGreaterThan(0);
    }
    expect(existsSync(join(out, ".children"))).toBe(false);
  });
});
