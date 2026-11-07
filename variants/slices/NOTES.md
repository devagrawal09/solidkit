# Notes: the Slices variant

## Verdict

The idea holds up and costs little code. Slices, named actions and ordinary
Solid derivations port all three examples at about the size of the
originals. Every test passes, and all three production builds work in
Chrome, time travel included.

The interesting part was not the API. Solid 2 *holds* store writes that ride
a pending transition, and that breaks the obvious way to snapshot client
state for a timeline. Slices work around it in core. The kernel should
change so the next variant doesn't have to (below).

## What was easy

- **Mapping intent to code.** The view calls `toggleTodo(id, done)` or
  `navigated(route)`, and go-to-definition lands on the action or the
  mutation. Nothing sits in between.
- **The todos layering.** The original's three layers survived intact:
  - server truth is a `createProjection`;
  - the errors layer is a derived `createOptimisticStore` over the
    projection and the slice;
  - the optimistic layer is writes inside actions.
  Only the middle layer moved, from a plain `Errors` object re-applied on
  refresh to a reactive, time-travelling slice.
- **The HN hold.** One async memo keyed on `nav.route` keeps the current
  page on screen while the next loads, and `isPending` reports it, with no
  router.
- **Tests.**
  - Pure tests are plain function calls (`given(slice)`).
  - Scenario tests reuse `Feature.create` with a scripted kernel and need no
    fakes: the real optimistic stores, reverts and refreshes run.
  - `expectReplayable(kernel)`, one line in every scenario test, proves the
    timeline is exact.
- **Readable timelines** came free from naming: `todos · failed`,
  `action placeOrder failed`, `backend.chargeCard error`.

## What was hard

1. **Held writes make kernel snapshots stale (the big one).** A plain store
   write in an action's first frame, or in the same frame as a navigation
   that suspends, is held until the transition settles. So is any later
   write to that store, or to anything read together with it. While held,
   `snapshot(store)` returns the *committed* value; only inside that
   store's own draft are held writes visible (R27 in the signals source).
   `kernel.commit()` snapshots with `snapshot(store)`, so:
   - a commit made during the hold records the wrong state;
   - if nothing commits after the hold releases, rewind + resume can drop
     the write from the head.

   I confirmed this with experiments before writing core: two quick
   navigations in HN, or a mutation during a pending save, would have done
   it. Slices take `snapshot(draft)` inside each write's own setter and
   overwrite the kernel's fresh snapshot through the object `stateAt()`
   returns. A core test ("the timeline records logical state even while
   Solid holds the write") pins this down.

2. **Holds shape where mutations can go.** Writes inside an action are
   invisible until it settles, so in-flight UI must be optimistic, and
   optimistic state is not part of a rewound view.
   - The effect demo's checkout phase stays a `createOptimistic` signal.
   - Writing a slice in the same frame that starts an action holds the
     whole slice. Clearing `notice` at the start of the saga, as the
     original does, would freeze the decline checkbox for ~4 s, so the saga
     only writes the notice when it ends.

   The rule I ended up with: client facts from an action go *after* its
   first `yield`.

3. **Cancelling through the kernel.** The kernel wraps recorded
   AsyncIterables in an async generator. Calling `return()` on it queues
   behind the pending `next()` (verified), so Solid closing a superseded
   search would not reach `runEffect`'s iterator until the search finished.
   Instead, the backend Effects are Promise services that take an
   `AbortSignal`:
   - `Effect.tryPromise` aborts on interrupt;
   - `runtime.runPromiseExit(effect, { signal })` interrupts the backend
     fiber, whose own finalizers log it.

   That works (checked in the tests and in Chrome), but the signal is a
   recorded argument: `{}` in browsers, `{"onabort":null}` in happy-dom, so
   tests build the expected key from a real `AbortSignal`.

4. **Error boundary reset.** The feature is created outside `<Errored>` so
   a reset doesn't remount slices (that would break replay). Resetting a
   boundary doesn't re-run an errored projection created outside it, so the
   todos Reset button calls `refresh(server)` first.

5. **Small Solid 2 lessons.**
   - A JSX prop containing a call (`<App todos={Todos.create(…)} />`)
     compiles to a getter and would build the feature on every read; create
     it first.
   - Feature-level memos are eager, so the typeahead shows "Searching…"
     beside the previous empty result rather than the `Loading` fallback.
     The original does the same.

## Line counts

`wc -l` of source files, without tests, CSS or the JSON capture.

| | Solid original | Slices | Foldkit port |
| --- | --- | --- | --- |
| todos | 417 (5 files) | 416 (5 files) | 1,286 (14 files) |
| effect | 876 (7 files) | 945 (10 files) | 1,844 (13 files) |
| hackernews | 395 (10 files) | 466 (10 files) | 1,071 (13 files) |
| without blanks/comments | 339 / 671 / 330 | 360 / 735 / 413 | 1,053 / 1,553 / 896 |
| tests | — | 265 / 299 / 247 | 594 / 659 / 297 |

Core is 183 lines (115 without blanks or comments), plus 179 lines of tests.

- **effect**: 419 of the 945 lines are the original `api.ts` and
  `solid-effect.ts`, reused. The rest is 526 lines, against the original's
  460.
- **hackernews**: the extra ~70 lines replace the router: typed routes (37),
  link, back and preload handling, and a response cache.

## Tests

| Package | Files | Tests |
| --- | --- | --- |
| core | 1 | 9 |
| todos | 3 (pure, scenarios, view) | 14 |
| effect | 3 (pure, scenarios + live backend, view) | 13 |
| hackernews | 3 (pure, scenarios, view) | 11 |

## Production JS (vite build)

| | JS raw | JS gzip | CSS |
| --- | --- | --- | --- |
| todos | 96.64 kB | 35.82 kB | 5.93 kB |
| effect | 237.16 kB | 81.53 kB | 6.00 kB |
| hackernews | 85.69 kB | 31.72 kB | 3.73 kB (+ 626 KB capture as a static file) |

The originals' existing `dist` folders, measured with `gzip -9`, give a
rough reference:
- todos: 86.65 kB raw / 31.4 kB gzip;
- effect: 234.3 kB / 78.3 kB;
- hackernews-spa: an SSR build in chunks, not comparable.

They were built earlier, maybe from a different Solid build. Read the
difference, about +10 kB raw / +4 kB gzip for kernel, devtools and slices, as
approximate.

## Checked in a real browser

I ran each production build (`vite preview`) in headless Chrome, driven over
the DevTools protocol by a throwaway script in `/tmp`. Not part of the repo.
Chrome logged no errors or warnings in any of them.

- **todos**: adds show pending, then failed adds stay with retry. Retries,
  toggle, hash filter, then rewind (the hash follows), input ignored, resume.
- **effect**: typing "solid" quickly shows each superseded search's fiber
  logging "interrupted". Cancel mid-charge voids the authorization and
  releases the hold. An order succeeds. Rewind restores the query, results
  and log from the recording; resume.
- **hackernews**, against the live APIs:
  - 30 stories; hover records a preload;
  - the list stays on screen while a story loads;
  - the cached 1,406-comment thread renders in ~106 ms;
  - back, user page, `/new?page=2`;
  - rewind (the URL follows, the list is replayed), a click while rewound is
    ignored, resume.

CORS: `node-hnapi.herokuapp.com` answers `access-control-allow-origin: *`
and Firebase echoes the origin, so no proxy is needed. Both were up on
2026-10-28.

## What I'd change in the kernel

1. **Let a tracker supply its own state.** For example
   `track(name, read, restore)`, or `commit(source, name, payload, state)`.
   `snapshot(store)` at commit time is wrong for held stores (above).
   Slices patch the object `stateAt()` returns, which works but reaches past
   the API.
2. **Forward `return()` at once on recorded iterables.** Use a hand-written
   iterator instead of an async generator, so Solid's cancellation reaches
   the source while its first value is pending.
3. **Replay keys.** Let a service mark arguments that aren't part of the key
   (an `AbortSignal`), or key on JSON-safe arguments only, so keys are the
   same in every environment.
4. **Record when the transition settles**, not only when the action's
   promise does. Today "settled" can come before the refresh it started
   lands.
5. **Async completions while rewound.** These are dropped as input today, so
   a save that fails while you are rewound loses its client fact. Queueing
   them for `resume()` (or applying them to the head snapshot) would fix it.
   Notes for ignored calls could also be rate-limited; an Effect backend
   logging while rewound fills the timeline.
6. **`untrack`/remount**, so a feature can be rebuilt (after an error
   boundary reset, or by HMR) without leaving a stale tracked store behind.
   Slices remount by replacing their registry slot and leave a note.

## Dependencies

None added. `@solidjs/router` is installed in the hackernews example but
unused, because routes are client state here.
