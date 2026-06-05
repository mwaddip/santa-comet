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

describe("Box round-trip", () => {
  // sbox_minimal is ergots-sourced, box_0 fleet-sourced — one slice, two origins.
  for (const e of fixture("Box").entries) {
    it(`round-trips ${e.name}`, () => {
      expect(runWireEntry(e)).toEqual({ bytes_hex: e.bytes_hex, error: null });
    });
  }
});

describe("Transaction round-trip", () => {
  // FINDING (2026-06-05, fleet @ master): all 17 corpus transactions error in
  // fleet's deserializer — a corpus-level fact verified externally; this suite
  // pins only the fixture entry's classification. Verified mechanism (tx_466f1aef): readErgoTree
  // (boxSerializer.ts) handles only the fee contract, P2PK, and size-flagged
  // trees — a general-script output without the size bit throws "ErgoTree
  // parsing without the size flag is not supported." The bytes are verbatim
  // from fleet's own _test-vectors (JVM canonicalization changed nothing), so
  // fleet's specs never deserialize these. The runner's faithful outcome is
  // `errored` — fleet HAS a Transaction serializer; it rejected blessed bytes
  // (a per-input divergence), which is not the kind-level `not-implemented`.
  // This test pins the CLASSIFICATION, not the divergence: when fleet grows
  // unsized-tree parsing, flip this to the round-trip assertion the other
  // suites use. The corpus-wide grade lives in the e2e tally, not here.
  for (const e of fixture("Transaction").entries) {
    it(`faithfully reports fleet's parse rejection of ${e.name} as errored`, () => {
      expect(runWireEntry(e)).toEqual({ bytes_hex: null, error: "errored" });
    });
  }
});
