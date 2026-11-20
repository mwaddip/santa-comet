import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runWireEntry, runWireVector } from "../src/runner.js";

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

describe("outcome mapping", () => {
  const v = (over: Partial<{ name: string; kind: string; bytes_hex: string }>) => ({
    name: "t",
    kind: "Constant",
    bytes_hex: "0400",
    version: { activated: 2, ergoTree: 2 },
    ...over
  });

  it("SigmaBoolean kind → not-implemented (no bare entry point in fleet)", () => {
    for (const e of fixture("SigmaBoolean").entries) {
      expect(runWireEntry(e)).toEqual({ bytes_hex: null, error: "not-implemented" });
    }
  });

  it("unknown kind → not-implemented", () => {
    expect(runWireEntry(v({ kind: "Header" }))).toEqual({
      bytes_hex: null,
      error: "not-implemented"
    });
  });

  it("fleet's own 'not implemented' error → not-implemented (SigmaProp beyond ProveDlog)", () => {
    // SSigmaProp constant (type 0x08) whose proposition byte is 0xce (ProveDHTuple),
    // not 0xcd (ProveDlog): fleet's dataSerializer breaks without returning and falls
    // to its bottom-of-function throw "Parsing error: '0x8' type not implemented."
    // — the '0x8' is the SigmaProp TYPE code, not the 0xce proposition byte.
    expect(runWireEntry(v({ bytes_hex: "08ce" }))).toEqual({
      bytes_hex: null,
      error: "not-implemented"
    });
  });

  it("fleet codec throw without a gap message → errored", () => {
    // Empty bytes: SConstant.from throws "Empty constant bytes." — a recognized
    // codec rejection. (A committed vector can't be empty — schema forbids it —
    // this pins the classifier, not a corpus case.)
    const r = runWireEntry(v({ bytes_hex: "" }));
    expect(r.bytes_hex).toBeNull();
    expect(r.error).toBe("errored");
    // The codec's message now rides in `reason` (diagnostic, never graded).
    expect(r.reason).toMatch(/empty/i);
  });

  it("malformed entry (bad hex) → panicked with note, run continues", () => {
    const r = runWireEntry(v({ bytes_hex: "zz" }));
    expect(r.bytes_hex).toBeNull();
    expect(r.error).toBe("panicked");
    // Note carries fleet's hex error ("Error: Invalid byte sequence.") — pin
    // diagnostic content, not just presence, so a swallowed message is visible.
    expect(r.note).toMatch(/invalid/i);
  });

  it("totality: one result per entry, keyed by name, nothing aborts the file", () => {
    const doc = {
      schema: "santa-wire/v1",
      op: "Mixed",
      entries: [
        v({ name: "good" }),
        v({ name: "bad-hex", bytes_hex: "zz" }),
        v({ name: "gap", kind: "SigmaBoolean" })
      ]
    };
    const actuals = runWireVector(doc);
    expect(Object.keys(actuals)).toEqual(["good", "bad-hex", "gap"]);
    expect(actuals["good"]).toEqual({ bytes_hex: "0400", error: null });
    expect(actuals["bad-hex"].error).toBe("panicked");
    expect(actuals["gap"].error).toBe("not-implemented");
  });
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
      const r = runWireEntry(e);
      expect(r.bytes_hex).toBeNull();
      expect(r.error).toBe("errored");
      // fleet's rejection message (e.g. the unsized-tree error) rides in `reason`.
      expect(r.reason).toBeTruthy();
    });
  }
});

describe("a schema the runner was not written for", () => {
  // SANTA runner-integration §3: a newer version of santa-wire, a tier this runner does not mount, or no schema at
  // all answers the tier-neutral not-implemented for every entry, and is never read as santa-wire/v1 (here an entry
  // the wire arm would happily round-trip): a new envelope read as an old one shows as false divergences.
  const e = fixture("Constant").entries[0];
  for (const schema of ["santa-wire/v2", "santa-eval/v2", undefined]) {
    it(`answers not-implemented for ${schema ?? "no schema"}`, () => {
      const doc = { ...(schema === undefined ? {} : { schema }), op: "x", entries: [e] };
      expect(runWireVector(doc as Parameters<typeof runWireVector>[0])).toEqual({ [e.name]: { error: "not-implemented" } });
    });
  }
});
