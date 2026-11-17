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
FLEET_IMPL=~/projects/fleet ./dev test     # sync → install → build → vitest
./dev run <vectors-dir> <out-dir>          # exercise the real santa-run path

# what the orchestrator calls (runner-integration contract §3):
./santa-run <impl-path> <vectors-dir> <out-dir>
```

## SANTA integration (wiring steps, santa-side)

1. Push this repo to GitHub.
2. In santa: `git submodule add <url> runners/comet` — `./conform` discovers it
   (presence-as-state: `runner.json` + executable `santa-run`).
3. Scoreboard: wire slices grade with the shared comparator; nothing
   comet-specific to configure.

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
