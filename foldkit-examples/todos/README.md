# todos

Foldkit port of `solid/examples/todos`, on the Blocks and Effect Layers
preview (`foldkit@0.169.0-canary.f3be22cfeefe`). TodoMVC with a mock API (localStorage, 400 ms, about 33% failed saves), optimistic writes, per-item retries, bulk calls and hash routing.

```sh
pnpm install
pnpm dev         # http://localhost:3102
pnpm typecheck   # tsc --noEmit, tests included
pnpm lint
pnpm test
pnpm build
```

Structure, parity gaps and verification results are in the
[root README](../README.md); field notes are in [NOTES.md](../NOTES.md).
`AGENTS.md` and `FOLDKIT.md` come from the scaffold.
