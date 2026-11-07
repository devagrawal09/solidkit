# solidkit

Experiments toward **solid-kit**: a Solid 2–native layer that adds time travel, devtools and domain testing to Solid apps without moving async out of Solid's reactive graph.

> **Status: research and prototypes.** Nothing here is published to npm and no API is settled. Read [HANDOFF.md](HANDOFF.md) first: it has the decisions, the results, what didn't work and the roadmap.

## What's in here

| Folder | What it is |
|---|---|
| [`timetravel/`](timetravel) | Three userland time-travel prototypes (`setter`, `commit`, `overlay`) built against one [spec](timetravel/SPEC.md). Overlay is the one to continue. |
| [`variants/`](variants) | Three API styles (`slices`, `messages`, `blocks`): a small core each, plus ports of the Solid todos, effect and hackernews examples. Slices is the chosen direction. |
| [`kernel/`](kernel) | The time-travel, devtools and testing kernel the variants share. It predates the userland design. |
| [`template/`](template) | A bare Vite + Solid 2 app skeleton wired to the kernel. |
| [`foldkit-examples/`](foldkit-examples) | The same three apps ported to Foldkit's Blocks and Effect Layers preview, for comparison. Standalone projects, outside the workspace. |

## Run it

Built against Solid 2.0.0-rc.19; developed on Node 24 with pnpm 11 (pinned in `packageManager`).

```sh
pnpm install
pnpm typecheck   # every workspace package
pnpm test
pnpm build
```

One package: `pnpm --filter @solidkit-tt/overlay test`. An example app: `pnpm --filter @solidkit/slices-todos dev`.

The Foldkit ports have their own lockfiles; see [foldkit-examples/README.md](foldkit-examples/README.md).

## Where to start

- [HANDOFF.md](HANDOFF.md): summary, decisions, findings and roadmap.
- [timetravel/overlay/README.md](timetravel/overlay/README.md): the time-travel design to continue.
- [variants/slices/NOTES.md](variants/slices/NOTES.md): the chosen API style, what was easy and what was hard.

## Provenance and license

Most of the code was written by coding-agent sessions working from shared briefs; typecheck and tests were re-run independently before results were recorded (see section 11 of HANDOFF.md). No license is attached yet, so by default all rights are reserved. Add one before taking contributions.
