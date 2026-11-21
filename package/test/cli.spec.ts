import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { santaDir } from "./harness/santa.js";

// The CLI runs the BUILT runner (dist/) — what santa-run executes — not the TS source.
const RUNNER = new URL("../dist/runner.js", import.meta.url).pathname;
const FIXTURES = new URL("./fixtures", import.meta.url).pathname;
// The actuals' shape is not checked here: SANTA's conform holds every runner's actuals to its tier's actuals schema,
// so a copy of the schema here would only drift.

describe("CLI", () => {
  it("dir mode: one actuals file per vector, same filename", () => {
    const out = mkdtempSync(join(tmpdir(), "comet-"));
    execFileSync("node", [RUNNER, FIXTURES, out]);
    const files = readdirSync(out).sort();
    expect(files).toEqual(["Box.json", "Constant.json", "SigmaBoolean.json", "Transaction.json"]);
    for (const f of files) {
      const actuals = JSON.parse(readFileSync(join(out, f), "utf8"));
      expect(Object.keys(actuals).length).toBeGreaterThan(0);
    }
  });

  it("file mode: single vector → single actuals file", () => {
    const out = mkdtempSync(join(tmpdir(), "comet-"));
    execFileSync("node", [RUNNER, join(FIXTURES, "Box.json"), out]);
    const actuals = JSON.parse(readFileSync(join(out, "Box.json"), "utf8"));
    expect(Object.keys(actuals)).toEqual(["sbox_minimal", "box_0"]);
  });

  it("exits 2 without args", () => {
    // Pin the exact code: execFileSync throws on ANY non-zero exit, so a bare
    // toThrowError() would also pass on an uncaught-crash exit 1.
    let status: number | null = null;
    try {
      execFileSync("node", [RUNNER], { stdio: "pipe" });
    } catch (e) {
      status = (e as { status: number }).status;
    }
    expect(status).toBe(2);
  });

  it("exits 2 on a verb with the wrong arguments", () => {
    for (const args of [["run", "runner.json"], ["one", "santa"], ["run", "a", "b"]]) {
      let status: number | null = null, said = "";
      try {
        execFileSync("node", [RUNNER, ...args], { stdio: "pipe" });
      } catch (e) {
        status = (e as { status: number }).status;
        said = String((e as { stderr: Buffer }).stderr);
      }
      expect(status, args.join(" ")).toBe(2);
      expect(said).toMatch(/usage: runner run <runner.json> <santa-dir> <out-dir>/);
    }
  });
});

describe("the verbs (a self-contained runner)", () => {
  const santa = santaDir();

  it("one: a file's actuals and the child's own peak", () => {
    const out = join(mkdtempSync(join(tmpdir(), "comet-")), "a.json");
    execFileSync("node", [RUNNER, "one", santa, "wire/v5/vendored/Box.json", out]);
    expect(Object.keys(JSON.parse(readFileSync(out, "utf8")))).toContain("sbox_minimal");
    expect(Number(readFileSync(`${out}.peak`, "utf8"))).toBeGreaterThan(0);
  });

  it("run: every bounded file runs as this runner's own `one` child (eval: not-implemented, never exceeded or panicked)", () => {
    const d = mkdtempSync(join(tmpdir(), "comet-"));
    writeFileSync(join(d, "runner.json"), `{"version": "v6", "tiers": ["eval"]}`);
    execFileSync("node", [RUNNER, "run", join(d, "runner.json"), santa, join(d, "out")], { stdio: "pipe" });
    const r = JSON.parse(readFileSync(join(d, "out", "results.json"), "utf8"));
    const slices = Object.values(r.slices) as { exceeded: number; panicked: number }[];
    expect(slices.reduce((n, s) => n + s.exceeded + s.panicked, 0)).toBe(0);
    const bounded = "eval/v6/authored/Global.serialize_shared_nested_bounded_G_size_only_32768x4096.json";
    expect(Object.values(JSON.parse(readFileSync(join(d, "out", "actuals", bounded), "utf8")))).toEqual([{ error: "not-implemented" }]);
  }, 120_000);
});
