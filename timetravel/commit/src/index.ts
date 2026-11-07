/**
 * @solidkit-tt/commit — userland time travel for Solid 2, "commit" variant.
 *
 * Recording happens after Solid commits, never in the setter:
 * - every recorded primitive registers one `createEffect`; its compute phase reads
 *   the committed value (a signal's value, a memo's resolved value; a store is
 *   tracked with `deep()` and recorded as a `snapshot()` taken in the apply phase,
 *   see createRecordedStore) and its apply phase hands it to the timeline;
 * - the first value recorded in a flush opens a step and queues a microtask that
 *   publishes it, so everything one flush commits (including writes cascading from
 *   its effects) becomes one step;
 * - values equal to the source's latest recorded value are skipped, and so is
 *   everything that commits while traveling.
 *
 * Travel writes the past back into the live primitives: signals through their raw
 * setter, stores through a positional `reconcile` (only what differs notifies).
 * Recorded memos serve their recorded value instead of running `fn`. Writes made
 * through the wrapped setters while traveling are queued; `resume` restores the
 * pre-travel values and then applies them, `branch` keeps the viewed state,
 * drops later steps, then applies them.
 */
import { createEffect, createMemo, createSignal, createStore, deep, getOwner, onCleanup, reconcile, snapshot } from "solid-js";

export type Step = { id: number; changes: Record<string, unknown> }; // committed values per source name

export interface Timeline {
  steps(): readonly Step[]; // reactive; excludes the initial state
  goto(id: number): void; // view the state right after step `id` (0 = the initial state)
  resume(): void; // back to the latest state
  branch(): void; // continue live from the viewed step, dropping later steps
  traveling(): boolean; // reactive; true between goto and resume/branch
}

type Options = { name: string; timeline: Timeline };
type Entry = { id: number; value: unknown };

/** What the timeline needs from one recorded primitive. */
interface Source {
  name: string;
  /** Recorded values in step order; entry 0 (id 0) is the initial value. */
  history: Entry[];
  same(a: unknown, b: unknown): boolean;
  save?(): void; // first goto: remember the live value
  show?(value: unknown): void; // goto: write a recorded value back
  restore?(): void; // resume: write the remembered live value back
  adopt?(value: unknown): void; // branch: the viewed value becomes the live one
}

/** The viewed position: a step id, LATEST (serve the latest recorded values) or null (live). */
type View = number | typeof LATEST | null;
const LATEST = "latest";
const NONE = Symbol("none");

interface Core {
  sources: Map<string, Source>;
  traveling: boolean; // untracked mirror of traveling(), read by setters and recorders
  queue: (() => void)[]; // writes made while traveling, in call order
  view: () => View;
  record(source: Source, value: unknown): void;
}

const cores = new WeakMap<Timeline, Core>();

function coreOf(timeline: Timeline): Core {
  const core = cores.get(timeline);
  if (!core) throw new Error("timeline must come from createTimeline()");
  return core;
}

/** Latest history entry with id <= `id` (binary search), or NONE. */
function valueAt(source: Source, id: number): unknown {
  const h = source.history;
  let lo = 0;
  let hi = h.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (h[mid].id <= id) (found = mid), (lo = mid + 1);
    else hi = mid - 1;
  }
  return found < 0 ? NONE : h[found].value;
}

/** Structural equality for plain snapshots; unchanged branches short-circuit on identity. */
function sameDeep(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b, k) || !sameDeep((a as any)[k], (b as any)[k])) return false;
  }
  return true;
}

export function createTimeline(): Timeline {
  // Published steps: the backing array only grows (branch swaps in a new one), so a
  // published { list, n } pair stays a valid view and steps() copies only when read.
  let list: Step[] = [];
  const [published, setPublished] = createSignal({ list, n: 0 });
  const [traveling, setTraveling] = createSignal(false);
  const [view, setView] = createSignal<View>(null);
  let open: Step | null = null; // the step the current flush is filling
  let viewed = 0;
  let epoch = 0; // bumps on every goto/resume/branch, so a stale phase-2 resume is dropped
  let cacheKey: object | undefined;
  let cache: readonly Step[] = [];

  const publish = () => {
    if (!open) return;
    list.push(open);
    open = null;
    setPublished({ list, n: list.length });
  };
  const drain = () => {
    const writes = core.queue;
    core.queue = [];
    for (const write of writes) write();
  };
  /** Leave travel: recorded memos serve the latest recorded value for one flush, then go
   * live, so a memo refetching on resume holds only its own view write (not the restore). */
  const leave = () => {
    core.traveling = false;
    setTraveling(false);
    setView(LATEST);
    const at = ++epoch;
    queueMicrotask(() => {
      if (at === epoch) setView(null);
    });
  };

  const core: Core = {
    sources: new Map(),
    traveling: false,
    queue: [],
    view,
    record(source, value) {
      const h = source.history;
      if (h.length === 0) {
        h.push({ id: 0, value }); // an async memo's first resolved value is its initial state
        return;
      }
      if (core.traveling) return;
      const last = h[h.length - 1];
      if (source.same(last.value, value)) return;
      if (!open) {
        open = { id: list.length + 1, changes: {} };
        queueMicrotask(publish);
      }
      open.changes[source.name] = value;
      if (last.id === open.id) last.value = value;
      else h.push({ id: open.id, value });
    }
  };

  const timeline: Timeline = {
    steps() {
      const p = published();
      if (p !== cacheKey) {
        cacheKey = p;
        cache = Object.freeze(p.list.slice(0, p.n));
      }
      return cache;
    },
    goto(id) {
      publish(); // a step still being filled is part of the past
      if (!Number.isInteger(id) || id < 0 || id > list.length) throw new RangeError(`no step ${id}`);
      if (!core.traveling) {
        for (const s of core.sources.values()) s.save?.();
        core.traveling = true;
        setTraveling(true);
      }
      viewed = id;
      epoch++;
      setView(id);
      for (const s of core.sources.values()) {
        const value = valueAt(s, id);
        if (value !== NONE) s.show?.(value);
      }
    },
    resume() {
      if (!core.traveling) return;
      leave();
      for (const s of core.sources.values()) s.restore?.();
      drain();
    },
    branch() {
      if (!core.traveling) return;
      leave();
      publish();
      list = list.slice(0, viewed);
      setPublished({ list, n: list.length });
      for (const s of core.sources.values()) {
        const h = s.history;
        while (h.length > 1 && h[h.length - 1].id > viewed) h.pop();
        s.adopt?.(h[h.length - 1]?.value);
      }
      drain();
    },
    traveling: () => traveling()
  };
  cores.set(timeline, core);
  return timeline;
}

function register(core: Core, source: Source) {
  if (core.sources.has(source.name)) throw new Error(`a recorded source named "${source.name}" already exists`);
  core.sources.set(source.name, source);
  if (getOwner()) onCleanup(() => core.sources.delete(source.name));
}

/** One recorder per source: compute tracks the committed value, apply records it. */
function recordCommits<T>(core: Core, source: Source, track: () => T, read: (tracked: T) => unknown = v => v) {
  createEffect(track, {
    effect: value => {
      core.record(source, read(value));
    },
    error: () => {} // a failing source is its readers' business; nothing is recorded
  });
}

export function createRecordedSignal<T>(
  initial: T,
  options: { name: string; timeline: Timeline }
): [get: () => T, set: (value: T | ((prev: T) => T)) => T] {
  const core = coreOf(options.timeline);
  const [get, rawSet] = createSignal<T>(initial as any);
  const write = (value: unknown): T => (rawSet as (v: unknown) => T)(value);
  let live = initial; // the latest value written in the live timeline (uncommitted included)
  let saved = initial; // what resume restores
  let pending = initial; // saved + queued writes: what a write during travel returns
  const source: Source = {
    name: options.name,
    history: [{ id: 0, value: initial }],
    same: Object.is,
    save: () => void (saved = pending = live),
    show: value => void write(() => value),
    restore: () => void (live = write(() => saved)),
    adopt: value => void (live = value as T)
  };
  register(core, source);
  recordCommits(core, source, get);
  const set = (value: T | ((prev: T) => T)): T => {
    if (core.traveling) {
      pending = typeof value === "function" ? (value as (prev: T) => T)(pending) : value;
      core.queue.push(() => void (live = write(value)));
      return pending;
    }
    return (live = write(value));
  };
  return [get, set];
}

export function createRecordedStore<T extends object>(
  initial: T,
  options: { name: string; timeline: Timeline }
): [state: T, setState: (fn: (draft: T) => void) => void] {
  const core = coreOf(options.timeline);
  const [state, rawSet] = createStore(initial as any) as unknown as [T, (fn: (draft: T) => T | void) => void];
  const restoreTo = (value: unknown) =>
    rawSet(draft => {
      reconcile(value as T, null)(draft); // positional: only changed leaves notify
    });
  let saved: unknown;
  const source: Source = {
    name: options.name,
    history: [{ id: 0, value: snapshot(state) }],
    same: sameDeep,
    save: () => void (saved = snapshot(state)), // sees this batch's pending (not held) writes
    show: restoreTo,
    restore: () => void (saved !== undefined && restoreTo(saved)), // nothing saved if created mid-travel
    adopt: () => void (saved = undefined)
  };
  register(core, source);
  // deep() subscribes to every nested property, but the snapshot it returns can be stale
  // when an action's writes land (writes made before a yield are missing), so the value
  // recorded is a snapshot() taken in the apply phase, after the commit.
  recordCommits(
    core,
    source,
    () => void deep(state),
    () => snapshot(state)
  );
  const setState = (fn: (draft: T) => void) => {
    if (core.traveling) core.queue.push(() => rawSet(fn));
    else rawSet(fn);
  };
  return [state, setState];
}

export function createRecordedMemo<T>(
  fn: () => T | Promise<T>,
  options: { name: string; timeline: Timeline }
): () => T {
  const core = coreOf(options.timeline);
  const source: Source = { name: options.name, history: [], same: sameDeep };
  register(core, source);
  const memo = createMemo<T>(() => {
    const at = core.view();
    if (at !== null) {
      const h = source.history;
      const value = at === LATEST ? (h.length ? h[h.length - 1].value : NONE) : valueAt(source, at);
      if (value !== NONE) return value as T; // traveling: serve the record, don't run fn
    }
    return fn();
  });
  recordCommits(core, source, memo);
  return memo;
}
