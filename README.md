# Comet

The **Fleet SDK** wire-tier runner for the [SANTA](https://github.com/mwaddip/santa)
Ergo consensus conformance suite. Comet round-trips SANTA's committed
`santa-wire/v1` vectors through `@fleet-sdk/serializer` — parse the JVM-canonical
bytes, reserialize, report `{ bytes_hex, error }` per entry (the runner half of
`run(vector) → actuals`, per SANTA's `docs/contract/runner-contract-wire.md`).
The JVM reference is canonical; where Fleet diverges, that divergence is a
**finding surfaced**, never a bug hidden. The goal is an accurate view of what
Fleet supports — not an all-green scoreboard.

Reindeer naming: Rudolph = the JVM reference, Dasher = ergots, Blitzen =
sigma-rust, **Comet = Fleet SDK** (*fleet*, adj.: swift; and fleets steer by
celestial bodies).

## How it consumes Fleet

Fleet is a pnpm monorepo with `workspace:^` inter-deps, which don't resolve from
outside the workspace — so Comet **joins it**: `santa-run` rsyncs [`package/`](package/)
into the checkout as `packages/santa-comet/` (fleet's workspace globs `packages/*`),
then `pnpm install` + a filtered build resolve everything natively. The
implementation under test is whatever checkout SANTA provides (`runner.json`'s
`impl`: `fleet-sdk/fleet#master`).

## Scope

Comet is graded on Fleet's **public API, at full depth**: anything Fleet exports
and a user could call. A failure there on bytes the node produces is coal (e.g.
`deserializeTransaction` refusing an unsized ErgoTree), a gap to fix in Fleet.
What Fleet's API does not offer at all is declared out of scope in `runner.json`
(SANTA runner-integration §2), each with its reason:

| `runner.json` | declares | why |
|---|---|---|
| `tiers: ["wire"]`, `version: "v5"`, `cost: false` | serialization only, v5 | Fleet is a serialization / transaction-building SDK: it evaluates no script (its compiler and mock chain delegate to sigmastate-js), and its type system has no v6 data types (`UnsignedBigInt`, `Header`, `Option` constants). |
| `kinds: ["Constant", "Box", "Transaction"]` | the wire kinds graded | Fleet's serializer covers constants (`SConstant`), boxes and transactions. It parses no ErgoTree body (its `ErgoTree` class reads the header, constants and template, never the body), and has no bare `SigmaBoolean`, `Header` or block-transactions entry point. |
| `activation: false` | no rule tied to the activated script version | Fleet has no notion of the activated version: it does not validate consensus, so refusing a box whose tree is above it is the node's job. |

Kinds `Constant`, `Box`, `Transaction` dispatch to fleet's serializers.

## Build / run

```bash
# dev loop (ambient node+pnpm; mise only lives in santa-run):
SANTA_DIR=~/projects/santa FLEET_IMPL=~/projects/fleet ./dev test   # sync → install → build → vitest
./dev run <santa-dir> <out-dir>            # exercise the real santa-run path

# what SANTA's conform calls (runner-integration §3):
./santa-run <impl-path> <santa-dir> <out-dir>
```

## A self-contained runner

Comet runs as a self-contained runner (SANTA's `docs/contract/runner-integration.md` §3): given a SANTA checkout, it
checks its own grader and selection against the checkout's `oracle/`, selects the vector files its `runner.json` declares,
runs each through Fleet, grades every entry by `vectors/grading.json` and writes `results.json` and `actuals/<rel>`.
SANTA's conform reads those, re-grades the actuals with its own grader (the canary) and puts the row on the board.

The machinery is in [`package/src/harness/`](package/src/harness/), and it is meant to be copied: it uses Node's
standard library only, nothing from Fleet. A TypeScript runner for another implementation takes the directory as it is
and supplies one function, its per-file function: a vector file's path and parsed document → its actuals by entry name.

| file | what it does |
|---|---|
| `grading.ts` | the grading language (`santa-grading/v1`): a strict parser and the interpreter |
| `selection.ts` | `runner.json`'s scope (refused as conform refuses it) and selection |
| `oracle.ts` | the self-checks against `oracle/` (every verdict case, every selection case) |
| `bounds.ts` | the bounded-file watchdog (§3a): a child per `limits` file in its own process group, killed past `memory_mb` or `wall_s`; Linux only |
| `results.ts` | `results.json` (`santa-runner-results/v1`) |
| `run.ts` | the verbs: `mainRun` (`run <runner.json> <santa-dir> <out-dir>`) and `mainOne` (`one <santa-dir> <relpath> <out-file>`, a bounded file's child, which writes its own peak to `<out-file>.peak`) |

[`package/src/runner.ts`](package/src/runner.ts) shows the wiring: the per-file function, the child's command (this
same script under the same Node flags, as `one`), and the two verbs. The tests in
[`package/test/harness/`](package/test/harness/) come along with it; they need only vitest and a SANTA checkout
(`SANTA_DIR`), not Fleet.

## SANTA integration

SANTA carries this repo as the submodule `runners/comet`; its `./conform` finds it there (presence-as-state:
`runner.json` + an executable `santa-run`) and calls `santa-run` with Fleet's checkout, the SANTA checkout and an
output directory.

## Status

First full run over `vectors/wire/v5/vendored` (213 entries): **185 round-trips
green, zero byte-mismatches** — when fleet can parse, it re-serializes
byte-identically. The honest gaps:

| kind | grade | why |
|---|---|---|
| Box | 10/11 | `box_6` errored — same root cause as Transaction |
| Constant | 175/178 | 3 × `not-implemented` — **finding:** SigmaProp constants (all ProveDlog). Fleet deserializes them fine, but its serialize side can't consume its own deserialized form (raw 33-byte point vs the nested `SConstant` the constructor API produces) and throws its "SigmaProp operation not implemented" gap error — a deserialize→serialize asymmetry that breaks `SConstant.from().serialize()` for every SigmaProp constant. |
| Transaction | 0/17 errored | **finding:** fleet's `readErgoTree` parses only the fee contract, P2PK, and size-flagged trees; every corpus tx carries a general-script output without the size bit. The bytes are verbatim from fleet's own `_test-vectors` — fleet's specs never deserialize them. |
| SigmaBoolean | 0/7 | `not-implemented` ×7 — no bare entry point |

Zero `panicked`. The Transaction limitation is pinned (as classification) in
`package/test/runner.spec.ts` and flips to a round-trip assertion when fleet
grows unsized-tree parsing.
