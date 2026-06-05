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

Scope: `tiers: ["wire"]`, `version: v5`. Kinds: `Constant`, `Box`, `Transaction`
dispatch to fleet's serializers; `SigmaBoolean` and `Header` are `not-implemented`
— fleet exposes no bare-SigmaBoolean entry point (its SigmaProp codec is
ProveDlog-only) and no header serializer. Honest coverage gaps, graded as coal
by contract.

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
| Constant | 175/178 | 3 × `not-implemented`: non-ProveDlog SigmaProp constants |
| Transaction | 0/17 errored | **finding:** fleet's `readErgoTree` parses only the fee contract, P2PK, and size-flagged trees; every corpus tx carries a general-script output without the size bit. The bytes are verbatim from fleet's own `_test-vectors` — fleet's specs never deserialize them. |
| SigmaBoolean | 0/7 | `not-implemented` ×7 — no bare entry point |

Zero `panicked`. The Transaction limitation is pinned (as classification) in
`package/test/runner.spec.ts` and flips to a round-trip assertion when fleet
grows unsized-tree parsing.
