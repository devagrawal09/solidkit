# effect

Foldkit port of `solid/examples/effect`, on the Blocks and Effect Layers
preview (`foldkit@0.169.0-canary.f3be22cfeefe`). A typeahead whose superseded searches are interrupted, a cancellable checkout saga with compensation, and a fiber event log.

```sh
pnpm install
pnpm dev         # http://localhost:3107
pnpm typecheck   # tsc --noEmit, tests included
pnpm lint
pnpm test
pnpm build
```

Structure, parity gaps and verification results are in the
[root README](../README.md); field notes are in [NOTES.md](../NOTES.md).
`AGENTS.md` and `FOLDKIT.md` come from the scaffold.
