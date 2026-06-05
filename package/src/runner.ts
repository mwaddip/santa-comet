import { hex } from "@fleet-sdk/crypto";
import { SConstant, deserializeBox, serializeBox } from "@fleet-sdk/serializer";

/** One wire entry of a santa-wire/v1 vector (runner-contract-wire §1). The runner
 *  trusts the vector shape (schema-validated upstream); version is an input the
 *  contract requires us to accept — fleet's serializers have no version knob, so
 *  it does not alter behavior here (v5 corpus == fleet's v5-era behavior). */
export interface WireEntry {
  name: string;
  kind: string;
  bytes_hex: string;
  version: { activated: number; ergoTree: number };
}
export interface WireVector {
  schema: string;
  op: string;
  entries: WireEntry[];
}

/** One entry's faithful outcome (runner-contract-wire §2). Exactly one per entry:
 *    error null              → reserialized; bytes_hex present
 *    error "errored"         → fleet's codec threw on parse/reserialize
 *    error "not-implemented" → no serializer for this kind reachable via fleet's
 *                              public API (or fleet's own explicit gap error)
 *    error "panicked"        → any other uncaught throw, caught so the run
 *                              continues; message in `note` (coal unconditionally) */
export type WireResult = {
  bytes_hex: string | null;
  error: null | "errored" | "not-implemented" | "panicked";
  note?: string;
};

// Frozen: returned by reference on every gap hit; a consumer must not mutate it.
const NOT_IMPL: WireResult = Object.freeze({ bytes_hex: null, error: "not-implemented" });

/** Fleet's coverage-gap errors are untyped `Error`s — match its own message
 *  ("…type not implemented.", "SigmaProp operation not implemented."). Fragility
 *  is one-directional: a reword degrades toward errored/panicked (visible coal),
 *  never toward false-green. The reverse miscategorization (a genuine fleet
 *  failure whose message happens to contain "not implemented" landing as a
 *  coverage gap instead of errored) shifts the coal BUCKET, never the verdict —
 *  not-implemented never matches a blessed expected, so it's coal either way. */
const isFleetNotImplemented = (err: unknown): boolean =>
  err instanceof Error && /not implemented/i.test(err.message);

/** Parse-and-reserialize with the wire outcome mapping. hex.decode stays OUTSIDE
 *  the try: malformed input hex is OUR precondition failing, not fleet's codec →
 *  it propagates to runWireEntry's panic net. Inside the try, any non-gap throw
 *  is `errored` — fleet rejecting bytes the JVM blessed is a real divergence. */
function roundtrip(e: WireEntry, fn: (bytes: Uint8Array) => Uint8Array): WireResult {
  const bytes = hex.decode(e.bytes_hex);
  try {
    // hex.encode is lower-case (property-tested in fleet); toLowerCase makes the
    // contract requirement (lower-case hex, §2) hold locally regardless.
    return { bytes_hex: hex.encode(fn(bytes)).toLowerCase(), error: null };
  } catch (err) {
    if (isFleetNotImplemented(err)) return NOT_IMPL;
    return { bytes_hex: null, error: "errored" };
  }
}

/** Run one entry → exactly one WireResult. Never-panic invariant (eval contract §3,
 *  inherited): any otherwise-uncaught throw is caught and surfaced as `panicked`
 *  so the run continues — no single entry may abort the file. */
export function runWireEntry(e: WireEntry): WireResult {
  try {
    return runWireEntryInner(e);
  } catch (err) {
    const note = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { bytes_hex: null, error: "panicked", note };
  }
}

function runWireEntryInner(e: WireEntry): WireResult {
  switch (e.kind) {
    case "Constant":
      // ECHO TRAP (load-bearing): SConstant.from() caches the INPUT bytes and the
      // `.bytes` getter returns that cache — using it would echo the input and
      // pass every vector vacuously. `.serialize()` unconditionally re-serializes
      // from the parsed (type, data). Pinned by the "echo-pin" test.
      return roundtrip(e, (b) => SConstant.from(b).serialize());
    case "Box":
      // Full ErgoBox.sigmaSerializer form (value … tx_id + index) — deserializeBox,
      // NOT deserializeEmbeddedBox (that's the in-transaction candidate form).
      // serializeBox without distinctTokenIds re-emits all fields incl. tx_id+index.
      return roundtrip(e, (b) => serializeBox(deserializeBox(b)).toBytes());
    default:
      // SigmaBoolean: fleet exposes no bare-SigmaBoolean entry point (its SigmaProp
      // data codec is ProveDlog-only, constants-embedded). Header: no serializer.
      // A faithful coverage gap, never a silent skip (runner-contract-wire §5).
      return NOT_IMPL;
  }
}

/** run(vector) → actuals: exactly one result per entry, keyed by name, insertion
 *  order = entry order (deterministic — no clocks, no RNG, no ambient state). */
export function runWireVector(doc: WireVector): Record<string, WireResult> {
  const actuals: Record<string, WireResult> = {};
  for (const e of doc.entries) actuals[e.name] = runWireEntry(e);
  return actuals;
}
