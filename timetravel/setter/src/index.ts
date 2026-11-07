/**
 * Userland time travel for Solid 2: the "setter" variant.
 *
 * Recording happens in the wrapped setters. Each call hands the value the raw setter returned
 * (for a store, `snapshot(draft)` taken inside the raw setter) to the timeline, which puts it in
 * the open step. The open step closes in a microtask, so every write made in one synchronous
 * tick lands in one step. An async memo has no setter: its "setter" is the moment its promise
 * resolves (a superseded run is ignored).
 *
 * `goto(id)` writes the values of step `id` back through the raw setters (stores with a
 * positional `reconcile`, memos through an overlay signal that stops them calling their
 * function), so nothing is recorded. While traveling, the wrapped setters queue their writes;
 * `resume()` restores the latest values, then replays the queue through the wrapped setters.
 * Public Solid 2 APIs only.
 */
import { createMemo, createSignal, createStore, reconcile, snapshot } from "solid-js";

export type Step = { id: number; changes: Record<string, unknown> }; // committed values per source name

export interface Timeline {
  steps(): readonly Step[]; // reactive; excludes the initial state
  goto(id: number): void; // view the state right after step `id` (0 = the initial state)
  resume(): void; // back to the latest state
  branch(): void; // continue live from the viewed step, dropping later steps
  traveling(): boolean; // reactive; true between goto and resume/branch
}

type Options = { name: string; timeline: Timeline };

/** How the timeline drives one recorded primitive. */
type Source = {
  initial: unknown; // value before step 1 (UNSET for a memo until its first value)
  equals(a: unknown, b: unknown): boolean;
  restore(value: unknown): void; // the raw write: never recorded
  live?(): void; // memos: drop the overlay and run the memo's function again
};

type Internals = {
  register(name: string, source: Source): void;
  record(name: string, value: unknown): void;
  traveling(): boolean; // plain flag, readable inside setters without tracking
  defer(write: () => void, name?: string, value?: unknown): void;
  pending(name: string): unknown; // latest value including writes queued while traveling
};

const UNSET = Symbol("unset");
const internals = new WeakMap<Timeline, Internals>();

function internalsOf(timeline: Timeline): Internals {
  const found = internals.get(timeline);
  if (!found) throw new Error("timeline was not created by createTimeline()");
  return found;
}

export function createTimeline(): Timeline {
  const sources = new Map<string, Source>();
  const [traveling, setTraveling] = createSignal(false);
  let log: Step[] = []; // source of truth: append-only within a branch
  // Publishing a length instead of a copy keeps a write O(1); steps() copies once per version read.
  type Published = { log: Step[]; n: number };
  const [published, setPublished] = createSignal<Published>({ log, n: 0 });
  const publish = () => setPublished({ log, n: log.length });
  let cached: { key: Published | null; steps: readonly Step[] } = { key: null, steps: [] };
  const steps = () => {
    const p = published();
    if (cached.key !== p) cached = { key: p, steps: Object.freeze(p.log.slice(0, p.n)) };
    return cached.steps;
  };
  let head = new Map<string, unknown>(); // latest recorded value per source
  let open: Record<string, unknown> | null = null; // this tick's step
  let openBase = new Map<string, unknown>(); // value of each written source before this tick
  let viewed = -1; // step shown while traveling, -1 when live
  let shown = head; // what the primitives currently hold
  let queue: (() => void)[] = []; // writes made while traveling
  let queuedHead = new Map<string, unknown>();

  const close = () => {
    const changes = open;
    open = null;
    if (!changes || Object.keys(changes).length === 0) return;
    log.push(Object.freeze({ id: log.length + 1, changes: Object.freeze(changes) }));
    publish();
  };

  const stateAt = (k: number) => {
    const state = new Map<string, unknown>();
    for (let i = k - 1; i >= 0 && state.size < sources.size; i--)
      for (const name in log[i].changes) if (!state.has(name)) state.set(name, log[i].changes[name]);
    for (const [name, s] of sources) if (!state.has(name)) state.set(name, s.initial);
    return state;
  };

  const show = (target: Map<string, unknown>) => {
    for (const [name, s] of sources) {
      const value = target.get(name);
      if (value !== UNSET && !s.equals(shown.get(name), value)) s.restore(value);
    }
    shown = target;
  };

  // Memos leave their overlay one microtask later, so they show the recorded value (not the
  // viewed one) while their function runs again.
  const goLive = () =>
    queueMicrotask(() => {
      if (viewed < 0) for (const s of sources.values()) s.live?.();
    });

  const timeline: Timeline = {
    steps,
    traveling,
    goto(id) {
      close(); // finish this tick's step first
      const k = Math.max(0, Math.min(Math.trunc(id), log.length));
      if (viewed < 0) queuedHead = new Map(head);
      viewed = k;
      show(stateAt(k));
      setTraveling(true);
    },
    resume() {
      if (viewed < 0) return;
      viewed = -1;
      show(head);
      setTraveling(false);
      goLive();
      const writes = queue;
      queue = [];
      for (const write of writes) write(); // through the wrapped setters: recorded
    },
    branch() {
      if (viewed < 0) return;
      log = log.slice(0, viewed);
      head = shown;
      viewed = -1;
      queue = []; // writes made against the dropped future are dropped with it
      publish();
      setTraveling(false);
      goLive();
    }
  };

  internals.set(timeline, {
    register(name, source) {
      sources.set(name, source);
      head.set(name, source.initial);
    },
    record(name, value) {
      const s = sources.get(name);
      if (!s || viewed >= 0) return;
      if (s.initial === UNSET) {
        s.initial = value; // a memo's first value is its initial state
        head.set(name, value);
        return;
      }
      const prev = head.get(name);
      if (s.equals(prev, value)) return; // an equal write records nothing
      if (!open) {
        open = {};
        openBase = new Map();
        queueMicrotask(close); // one step per tick
      }
      if (!openBase.has(name)) openBase.set(name, prev);
      head.set(name, value);
      if (s.equals(openBase.get(name), value)) delete open[name];
      else open[name] = value;
    },
    traveling: () => viewed >= 0,
    defer(write, name, value) {
      if (name !== undefined) queuedHead.set(name, value);
      queue.push(write);
    },
    pending: name => queuedHead.get(name)
  });
  return timeline;
}

export function createRecordedSignal<T>(
  initial: T,
  options: Options
): [get: () => T, set: (value: T | ((prev: T) => T)) => T] {
  const tl = internalsOf(options.timeline);
  const { name } = options;
  const [get, rawSet] = createSignal<T>(initial as Exclude<T, Function>);
  tl.register(name, { initial, equals: Object.is, restore: v => rawSet(() => v as T) });
  const set = (value: T | ((prev: T) => T)): T => {
    if (tl.traveling()) {
      const next =
        typeof value === "function" ? (value as (prev: T) => T)(tl.pending(name) as T) : value;
      tl.defer(() => set(() => next), name, next);
      return next;
    }
    const next = (rawSet as (v: unknown) => T)(value);
    tl.record(name, next);
    return next;
  };
  return [get, set];
}

export function createRecordedStore<T extends object>(
  initial: T,
  options: Options
): [state: T, setState: (fn: (draft: T) => void) => void] {
  const tl = internalsOf(options.timeline);
  const { name } = options;
  const [state, rawSet] = createStore<T>(initial as never);
  tl.register(name, {
    initial: snapshot(state),
    equals: sameTree,
    // Positional: keeps unchanged rows' proxies and notifies only what differs. (A keyed
    // reconcile throws when an object's id changes, e.g. a root with an id.)
    restore: v =>
      rawSet(draft => {
        reconcile(v as T, null)(draft);
      })
  });
  const setState = (fn: (draft: T) => void) => {
    if (tl.traveling()) return tl.defer(() => setState(fn));
    let next: unknown;
    rawSet(draft => {
      fn(draft);
      next = snapshot(draft); // sees this setter's writes even when an action holds them
    });
    tl.record(name, next);
  };
  return [state, setState];
}

export function createRecordedMemo<T>(fn: () => T | Promise<T>, options: Options): () => T {
  const tl = internalsOf(options.timeline);
  const { name } = options;
  const [overlay, setOverlay] = createSignal<{ value: T } | null>(null);
  let run = 0;
  tl.register(name, {
    initial: UNSET,
    equals: Object.is,
    restore: v => setOverlay({ value: v as T }),
    live: () => setOverlay(null)
  });
  const produced = (r: number, value: T) => {
    if (r === run) tl.record(name, value); // ignore superseded runs
  };
  return createMemo<T>(() => {
    const o = overlay();
    if (o) return o.value; // traveling: the recorded value, without calling fn
    const r = ++run;
    const result = fn();
    if (isThenable<T>(result))
      return result.then(value => {
        produced(r, value);
        return value;
      });
    produced(r, result);
    return result;
  });
}

function isThenable<T>(value: unknown): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T> | null)?.then === "function";
}

/** Structural equality that short-circuits on shared branches (snapshots share them). */
function sameTree(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!sameTree((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}
