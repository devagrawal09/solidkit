# hackernews

Foldkit port of `solid/examples/hackernews-spa`, on the Blocks and Effect Layers
preview (`foldkit@0.169.0-canary.f3be22cfeefe`). A client-rendered HackerNews reader with typed routes, KeyedQuery caching, hover/focus preload and collapsible comment threads.

```sh
pnpm install
pnpm dev         # http://localhost:3105
pnpm typecheck   # tsc --noEmit, tests included
pnpm lint
pnpm test
pnpm build
```

Structure, parity gaps and verification results are in the
[root README](../README.md); field notes are in [NOTES.md](../NOTES.md).
`AGENTS.md` and `FOLDKIT.md` come from the scaffold.
