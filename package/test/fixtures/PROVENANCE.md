# Fixture provenance

All `*.json` vector fixtures are verbatim entry subsets of the SANTA corpus
(`vectors/wire/v5/vendored/`), and `santa-wire.actuals.schema.json` is a verbatim
copy of SANTA's schema — both taken at santa commit `a66af91`. They are committed
samples for the runner's own unit tests; the corpus in the santa repo is the
source of truth. Re-extract (don't hand-edit) if the corpus moves.
