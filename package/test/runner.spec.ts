import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runWireEntry } from "../src/runner.js";

type Fixture = { entries: { name: string; kind: string; bytes_hex: string; version: { activated: number; ergoTree: number } }[] };

export const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

describe("Constant round-trip", () => {
  for (const e of fixture("Constant").entries) {
    it(`round-trips ${e.name}`, () => {
      expect(runWireEntry(e)).toEqual({ bytes_hex: e.bytes_hex, error: null });
    });
  }
});

describe("echo-pin", () => {
  // Fleet's readVLQ accepts non-minimal encodings (it just accumulates 7-bit
  // groups), so SInt(0) padded as VLQ [0x80, 0x00] parses to 0 and re-serializes
  // minimal: input 048000 → output 0400. If Constant round-trip ever returns the
  // input-byte cache (SConstant's `.bytes` getter) instead of `.serialize()`,
  // the output would echo 048000 and this test fails. Crafted input — committed
  // corpus vectors are canonical, so they could never catch the echo.
  it("re-serializes a non-minimal VLQ encoding to canonical bytes", () => {
    const e = {
      name: "echo-pin",
      kind: "Constant",
      bytes_hex: "048000",
      version: { activated: 2, ergoTree: 2 }
    };
    expect(runWireEntry(e)).toEqual({ bytes_hex: "0400", error: null });
  });
});
