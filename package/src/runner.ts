import { hex } from "@fleet-sdk/crypto";
import {
  SConstant,
  deserializeBox,
  deserializeTransaction,
  serializeBox,
  serializeTransaction
} from "@fleet-sdk/serializer";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Budget } from "./harness/bounds.js";
import type { Json } from "./harness/grading.js";
import { type RunFile, mainOne, mainRun } from "./harness/run.js";

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
 *    error "errored"         → fleet's codec threw on parse/reserialize; message in `reason`
 *    error "not-implemented" → no serializer for this kind reachable via fleet's
 *                              public API (or fleet's own explicit gap error)
 *    error "panicked"        → any other uncaught throw, caught so the run
 *                              continues; message in `note` (coal unconditionally) */
export type WireResult = {
  bytes_hex: string | null;
  error: null | "errored" | "not-implemented" | "panicked";
  reason?: string;
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
    // Surface the throw's message so an `errored` round-trip is diagnosable (real
    // codec divergence vs an unsupported shape), not an opaque bucket. `reason` is
    // the diagnostic channel (tx-tier parity); `note` stays panic-only. Additive
    // only — the verdict stays coal regardless.
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { bytes_hex: null, error: "errored", reason };
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
    case "Transaction":
      // ErgoLikeTransaction wire form (signed): inputs(+proofs) · dataInputs ·
      // distinct tokenIds · outputs as embedded boxes.
      return roundtrip(e, (b) => serializeTransaction(deserializeTransaction(b)).toBytes());
    default:
      // A kind outside runner.json's declared `kinds` (SigmaBoolean, Header, ErgoTree,
      // BlockTransactions: fleet has no entry point for them) is not staged by conform
      // (SANTA runner-integration §2). One reaching this runner anyway (a direct
      // santa-run over other vectors) is a coverage gap, never a silent skip
      // (runner-contract-wire §5).
      return NOT_IMPL;
  }
}

/** The tier-neutral not-implemented (SANTA runner-integration §3): this runner's answer for every entry of a vector
 *  whose schema it was not written for, since it cannot know that schema's actual shape. */
export type NotImplemented = { error: "not-implemented" };

/** run(vector) → actuals: exactly one result per entry, keyed by name, insertion
 *  order = entry order (deterministic — no clocks, no RNG, no ambient state). Only santa-wire/v1, by exact name
 *  and version, is read as a wire vector: any other schema (a newer version, a tier this runner does not mount, or
 *  none) is not-implemented for every entry, never read as santa-wire/v1 (a new envelope read as an old one shows
 *  as false divergences). */
export function runWireVector(doc: WireVector): Record<string, WireResult | NotImplemented> {
  const known = doc.schema === "santa-wire/v1";
  const actuals: Record<string, WireResult | NotImplemented> = {};
  for (const e of doc.entries) actuals[e.name] = known ? runWireEntry(e) : { error: "not-implemented" };
  return actuals;
}

// ---- CLI ----
//   runner run <runner.json> <santa-dir> <out-dir>   the self-contained runner (SANTA runner-integration §3), through
//                                                    the harness (src/harness/): oracle checks, selection, grading,
//                                                    results.json + actuals/
//   runner one <santa-dir> <relpath> <out-file>      a bounded file's child (runner-integration §3a)
//   runner <vectors-dir|vector.json> <out-dir>       one actuals file per vector, same filename (a local look)

/** The per-file function the harness calls: one santa-wire/v1 document → its actuals. */
const perFile: RunFile = (_path, doc) => runWireVector(doc as unknown as WireVector) as unknown as Record<string, Json>;

/** A bounded file's child: this same runner, under the same Node flags, as `one`. */
const child = (santa: string) => (_b: Budget, rel: string, out: string): string[] =>
  [process.execPath, ...process.execArgv, fileURLToPath(import.meta.url), "one", santa, rel, out];

function runFile(vecPath: string, outPath: string): void {
  const doc = JSON.parse(readFileSync(vecPath, "utf8")) as WireVector;
  writeFileSync(outPath, JSON.stringify(runWireVector(doc), null, 2));
}

function main(argv: string[]): void {
  const fail = (e: unknown): never => { console.error(`comet: ${(e as Error).message}`); process.exit(1); };
  if (argv[2] === "run" && argv.length === 6) { mainRun(argv[3], argv[4], argv[5], perFile, child(argv[4])).catch(fail); return; }
  if (argv[2] === "one" && argv.length === 6) { mainOne(argv[3], argv[4], argv[5], perFile).catch(fail); return; }
  const input = argv[2];
  const outDir = argv[3];
  if (!input || !outDir || argv.length !== 4) {
    console.error("usage: runner run <runner.json> <santa-dir> <out-dir> | one <santa-dir> <relpath> <out-file> | <vectors-dir|vector.json> <out-dir>");
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  const files = statSync(input).isDirectory()
    ? readdirSync(input)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => join(input, f))
    : [input];
  for (const f of files) runFile(f, join(outDir, basename(f)));
}

// Run only when invoked as the bin, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
