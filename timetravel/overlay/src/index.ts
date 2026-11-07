/**
 * Overlay time travel for Solid 2, in userland.
 *
 * Recording works like the "commit" variant: each recorded primitive owns one
 * effect that receives the committed value after a flush (the signal's value,
 * a plain copy of the store, or a memo's resolved value) and appends it to the
 * open step. A step groups everything recorded in one tick. It closes on a
 * microtask, or early when the same source records twice in that tick (a
 * second synchronous `flush()`).
 *
 * Traveling writes NOTHING to the recorded sources. `goto` moves a cursor.
 * Every recorded getter is a memo, `cursor === LIVE ? live() : recordedAt(cursor)`.
 * The store's `state` is a projection that returns the live store's plain
 * copy or the recorded one, and its keyed reconcile notifies only the leaves
 * that differ (rows keep their proxies). The live primitives keep running
 * underneath: writes go to them, their effects keep recording, and async memos
 * keep resolving. `resume` moves the cursor back, and the view picks up
 * whatever the present is now.
 *
 * Two details:
 * - The cursor is co-written: a plain signal plus a `createOptimistic`
 *   overlay derived from it. A plain cursor write is held when an action is
 *   holding a write to a viewed source, because the view memo reads both. The
 *   optimistic layer shows the move at once, and the plain write lands when
 *   the hold releases.
 * - Recorded memos compute in the "live lane". A read of a recorded getter
 *   whose observer is a recorded memo's own computation returns the live
 *   value, not the overlay, so a traveling view doesn't feed the past into the
 *   present (no refetch on goto). Reads that go through plain memos or a
 *   recorded store still see the overlay (see README).
 */
import {
  createEffect,
  createMemo,
  createOptimistic,
  createProjection,
  createSignal,
  createStore,
  getObserver,
  getOwner,
  onCleanup,
  reconcile,
  runWithOwner,
  untrack
} from "solid-js";

export type Step = { id: number; changes: Record<string, unknown> }; // committed values per source name

export interface Timeline {
  steps(): readonly Step[]; // reactive; excludes the initial state
  goto(id: number): void; // view the state right after step `id` (0 = the initial state)
  resume(): void; // back to the latest state
  branch(): void; // continue live from the viewed step, dropping later steps
  traveling(): boolean; // reactive; true between goto and resume/branch
}

type Options = { name: string; timeline: Timeline };

const LIVE = -1;
const NONE: unknown = Symbol("none"); // "no baseline yet" (an async memo before its first value)

/** One recorded primitive's history inside a timeline. */
class Source {
  ids: number[] = []; // ascending step ids where this source changed
  values: unknown[] = [];
  last: unknown;
  first = true; // the effect's first run sets or confirms the baseline
  restoring = false; // after branch(): skip the restore echo if structurally equal

  constructor(
    public name: string,
    public baseline: unknown,
    public restore: ((value: unknown) => void) | undefined
  ) {
    this.last = baseline;
  }

  /** The committed value right after step `id`. */
  at(id: number): unknown {
    let lo = 0;
    let hi = this.ids.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.ids[mid] <= id) (found = mid), (lo = mid + 1);
      else hi = mid - 1;
    }
    const v = found < 0 ? this.baseline : this.values[found];
    return v === NONE ? undefined : v;
  }
}

/** Timeline state that the public Timeline interface doesn't expose. */
type Internals = {
  cursor: () => number;
  register(name: string, baseline: unknown, restore?: (value: unknown) => void): Source;
  record(src: Source, value: unknown): void;
};
const internals = new WeakMap<Timeline, Internals>();
const inner = (timeline: Timeline): Internals => {
  const i = internals.get(timeline);
  if (!i) throw new Error("not a timeline from createTimeline()");
  return i;
};

/** Copies plain objects and arrays; anything else is kept by reference. */
function clonePlain(v: any): any {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(clonePlain);
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = clonePlain(v[k]);
  return out;
}

/** Structural equality (drops the baseline and branch()'s own restore echo). */
function same(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => same(a[k], b[k]));
}

export function createTimeline(): Timeline {
  // Co-written cursor: `base` is the committed position, `cursor` shows a move
  // at once even while a transition holds `base` (see the header).
  const [base, setBase] = createSignal(LIVE);
  const [cursor, setCursor] = createOptimistic<number>(() => base());
  const move = (id: number) => {
    setBase(id);
    setCursor(id);
  };
  const traveling = createMemo(() => cursor() !== LIVE);

  const sources = new Map<string, Source>();
  const closed: Step[] = []; // mutable log; `steps` publishes copies
  const [steps, setSteps] = createSignal<readonly Step[]>([]);
  let open: Step | null = null;
  let nextId = 1;
  let queued = false;

  const close = () => {
    if (open) closed.push(open), (open = null);
  };
  const publish = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      close();
      setSteps(closed.slice());
    });
  };

  const record = (src: Source, value: unknown) => {
    if (src.first) {
      src.first = false;
      if (src.baseline === NONE) return void ((src.baseline = value), (src.last = value));
      if (same(value, src.last)) return; // the baseline itself
    }
    if (src.restoring) {
      src.restoring = false;
      if (same(value, src.last)) return; // branch()'s own write coming back
    }
    if (Object.is(value, src.last)) return;
    if (open && src.name in open.changes) close(); // a second flush in the same tick
    if (!open) open = { id: nextId++, changes: {} };
    open.changes[src.name] = value;
    src.ids.push(open.id);
    src.values.push(value);
    src.last = value;
    publish();
  };

  const register = (name: string, baseline: unknown, restore?: (value: unknown) => void) => {
    const src = new Source(name, baseline, restore);
    sources.set(name, src);
    if (getOwner()) onCleanup(() => sources.get(name) === src && sources.delete(name));
    return src;
  };

  const timeline: Timeline = {
    steps,
    traveling,
    goto(id) {
      close();
      move(Math.max(0, Math.min(id, nextId - 1)));
    },
    resume() {
      move(LIVE);
    },
    branch() {
      const at = untrack(cursor);
      if (at === LIVE) return;
      close();
      const cut = closed.findIndex(s => s.id > at);
      if (cut >= 0) closed.length = cut;
      nextId = at + 1;
      for (const src of sources.values()) {
        while (src.ids.length && src.ids[src.ids.length - 1] > at) src.ids.pop(), src.values.pop();
        src.last = src.at(at);
        src.restoring = true;
        src.restore?.(src.last); // the past becomes the present (memos re-derive)
      }
      setSteps(closed.slice());
      // Only the plain cursor: if an action holds a restored source, the
      // restore lands with it, and until then the optimistic layer keeps
      // showing the branch point instead of the abandoned present.
      setBase(LIVE);
    }
  };
  internals.set(timeline, { cursor, register, record });
  return timeline;
}

// The live lane: computations of recorded memos. A recorded getter read
// directly by one of them returns the live value instead of the overlay.
const lane = new WeakSet<object>();
let laneDepth = 0;
const inLane = () => {
  if (laneDepth === 0) return false;
  const o = getObserver();
  return o != null && lane.has(o);
};

export function createRecordedSignal<T>(
  initial: T,
  options: Options
): [get: () => T, set: (value: T | ((prev: T) => T)) => T] {
  const tl = inner(options.timeline);
  const [live, setLive] = createSignal<T>(initial as any);
  const src = tl.register(options.name, initial, v => void setLive(() => v as T));
  createEffect(live, v => void tl.record(src, v));
  const view = createMemo<T>(() => {
    const c = tl.cursor();
    return c === LIVE ? live() : (src.at(c) as T);
  });
  const get = () => (inLane() ? live() : view());
  return [get, (value => setLive(value as any)) as (value: T | ((prev: T) => T)) => T];
}

/**
 * A tree of memos, one per object in a store, each returning a plain copy of
 * its object (children come from their own memos). A write recomputes only the
 * memos on its path. Unchanged objects keep their copy, so steps share them and
 * reconcile skips them by reference. Why not `snapshot()`/`deep()`: inside a
 * computation, at the commit of a held transition, they return the
 * pre-transition state, while proxy reads are current (test/experiments).
 */
function plainTree(owner: ReturnType<typeof getOwner>) {
  const memos = new WeakMap<object, () => unknown>();
  const plain = (node: any): any => {
    if (node === null || typeof node !== "object") return node;
    const isArr = Array.isArray(node);
    const proto = isArr ? null : Object.getPrototypeOf(node);
    if (proto !== null && proto !== Object.prototype) return node; // not wrappable: by reference
    let memo = memos.get(node);
    if (!memo) {
      memo = runWithOwner(owner, () =>
        createMemo(() => {
          if (isArr) return Array.from(node as unknown[], plain);
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(node)) out[k] = plain(node[k]);
          return out;
        })
      )!;
      memos.set(node, memo);
    }
    return memo();
  };
  return plain;
}

export function createRecordedStore<T extends object>(
  initial: T,
  options: Options
): [state: T, setState: (fn: (draft: T) => void) => void] {
  const tl = inner(options.timeline);
  const [live, setLive] = createStore<T>(initial as any);
  const plain = plainTree(getOwner());
  const liveSnap = () => plain(live) as T;
  const src = tl.register(options.name, untrack(liveSnap), v =>
    setLive(d => {
      // A clone, so recorded objects never become the live store's backing.
      // A keyed reconcile throws when the root's own `id` differs.
      try {
        reconcile(clonePlain(v), "id")(d);
      } catch {
        reconcile(clonePlain(v), null)(d);
      }
    })
  );
  createEffect(liveSnap, v => void tl.record(src, v));
  const state = createProjection<T>(
    () => {
      const c = tl.cursor();
      return c === LIVE ? liveSnap() : (src.at(c) as T);
    },
    (Array.isArray(initial) ? [] : {}) as any,
    { key: "id" }
  ) as T;
  return [state, fn => void setLive(d => void fn(d as T))];
}

export function createRecordedMemo<T>(fn: () => T | Promise<T>, options: Options): () => T {
  const tl = inner(options.timeline);
  const live = createMemo<T>(() => {
    lane.add(getObserver()!);
    laneDepth++;
    try {
      return fn() as T;
    } finally {
      laneDepth--;
    }
  });
  const src = tl.register(options.name, NONE);
  createEffect(live, v => void tl.record(src, v));
  const view = createMemo<T>(() => {
    const c = tl.cursor();
    return c === LIVE ? live() : (src.at(c) as T);
  });
  return () => (inLane() ? live() : view());
}
