import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
});
