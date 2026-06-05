import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

// The CLI runs the BUILT runner (dist/) — what santa-run executes — not the TS source.
const RUNNER = new URL("../dist/runner.js", import.meta.url).pathname;
const FIXTURES = new URL("./fixtures", import.meta.url).pathname;
const SCHEMA = new URL("./schema/santa-wire.actuals.schema.json", import.meta.url).pathname;

const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
const validate = new Ajv2020().compile(schema);

describe("CLI", () => {
  it("dir mode: one actuals file per vector, same filename, schema-valid", () => {
    const out = mkdtempSync(join(tmpdir(), "comet-"));
    execFileSync("node", [RUNNER, FIXTURES, out]);
    const files = readdirSync(out).sort();
    expect(files).toEqual(["Box.json", "Constant.json", "SigmaBoolean.json", "Transaction.json"]);
    for (const f of files) {
      const actuals = JSON.parse(readFileSync(join(out, f), "utf8"));
      expect(validate(actuals), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("file mode: single vector → single actuals file", () => {
    const out = mkdtempSync(join(tmpdir(), "comet-"));
    execFileSync("node", [RUNNER, join(FIXTURES, "Box.json"), out]);
    const actuals = JSON.parse(readFileSync(join(out, "Box.json"), "utf8"));
    expect(Object.keys(actuals)).toEqual(["sbox_minimal", "box_0"]);
    expect(validate(actuals), JSON.stringify(validate.errors)).toBe(true);
  });

  it("exits 2 without args", () => {
    expect(() => execFileSync("node", [RUNNER], { stdio: "pipe" })).toThrowError();
  });
});
