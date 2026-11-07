// Experiments behind the design choices (Solid 2.0.0-rc.19). Each asserts the
// behavior observed, so a Solid change that alters it shows up here.
import { describe, expect, test } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createProjection,
  createRoot,
  createSignal,
  createStore,
  deep,
  flush,
  getObserver,
  onFlush,
  snapshot,
  untrack
} from "solid-js";
import { delay, settled } from "./helpers.ts";

const LIVE = -1;

describe("experiments", () => {
  test("a projection CHAINED to the live store loses row identity when it switches to a snapshot", () => {
    const [live] = createStore({ rows: [{ id: 1, text: "a" }, { id: 2, text: "b" }] });
    const [cur, setCur] = createSignal<any>(undefined);
    let row1Runs = 0;
    const view = createRoot(() => {
      const view = createProjection<any>(() => (cur() === undefined ? live : cur()), { rows: [] }, { key: "id" });
      createEffect(() => view.rows[0].text, () => void row1Runs++);
      return view;
    });
    flush();
    const row1 = view.rows[0];
    setCur({ rows: [{ id: 1, text: "a" }, { id: 2, text: "B" }] });
    flush();
    expect(view.rows[0]).not.toBe(row1); // new proxy for the same row
    expect(row1Runs).toBe(2); // re-ran with an equal value
  });

  test("a projection over PLAIN snapshots keeps rows and notifies only changed leaves", () => {
    const [live, setLive] = createStore({ rows: [{ id: 1, text: "a" }, { id: 2, text: "b" }] });
    const [cur, setCur] = createSignal<any>(undefined);
    let row1Runs = 0;
    const view = createRoot(() => {
      const liveSnap = createMemo(() => deep(live));
      const view = createProjection<any>(() => (cur() === undefined ? liveSnap() : cur()), { rows: [] }, { key: "id" });
      createEffect(() => view.rows[0].text, () => void row1Runs++);
      return view;
    });
    flush();
    setLive(d => void (d.rows[1].text = "B"));
    flush();
    const row1 = view.rows[0];
    setCur({ rows: [{ id: 1, text: "a" }, { id: 2, text: "b" }] });
    flush();
    expect(view.rows[1].text).toBe("b");
    expect(view.rows[0]).toBe(row1);
    expect(row1Runs).toBe(1);
  });

  test("a PLAIN cursor write is held behind an action that holds a write to a viewed source", async () => {
    const [x, setX] = createSignal(0);
    const [cur, setCur] = createSignal(LIVE);
    const view = createRoot(() => createMemo(() => (cur() === LIVE ? x() : -cur())));
    flush();
    const done = action(function* () {
      setX(5);
      yield delay(30);
    })();
    await settled(2);
    setCur(1);
    await settled(2);
    expect(view()).toBe(0); // goto did not show
    await done;
    await settled(2);
    expect(view()).toBe(-1); // it landed with the action
  });

  test("a CO-WRITTEN cursor (plain + createOptimistic over it) shows at once and survives the settle", async () => {
    const [x, setX] = createSignal(0);
    const [base, setBase] = createSignal(LIVE);
    const [cur, setCur] = createOptimistic<number>(() => base());
    const view = createRoot(() => createMemo(() => (cur() === LIVE ? x() : -cur())));
    flush();
    const done = action(function* () {
      setX(5);
      yield delay(30);
    })();
    await settled(2);
    setBase(1);
    setCur(1);
    await settled(2);
    expect(view()).toBe(-1);
    await done;
    await settled(2);
    expect(view()).toBe(-1);
    expect(base()).toBe(1);
  });

  test("a bare createOptimistic write from a handler (no transition) is dropped", async () => {
    const [cur, setCur] = createOptimistic(LIVE);
    setCur(2);
    await settled(2);
    expect(cur()).toBe(LIVE);
  });

  test("deep()/snapshot() inside a computation at a held action's commit return the PRE-action state", async () => {
    const [live, setLive] = createStore({ n: 0, tags: ["a"] });
    const seen: Record<string, any> = {};
    createRoot(() => {
      const viaDeep = createMemo(() => deep(live));
      const viaSnapshot = createMemo(() => {
        deep(live);
        return untrack(() => snapshot(live));
      });
      const viaReads = createMemo(() => {
        deep(live);
        return untrack(() => ({ n: live.n, tags: [...live.tags] }));
      });
      createEffect(viaDeep, v => void (seen.deep = v));
      createEffect(viaSnapshot, v => void (seen.snapshot = v));
      createEffect(viaReads, v => void (seen.reads = v));
      createEffect(
        () => void deep(live),
        () => void (seen.applySnapshot = snapshot(live))
      );
    });
    await settled();
    const done = action(function* () {
      setLive(d => {
        d.n = 1;
        d.tags.push("b");
      });
      yield delay(20);
      setLive(d => void (d.n = 2));
    })();
    await done;
    await settled();
    expect(snapshot(live)).toEqual({ n: 2, tags: ["a", "b"] });
    expect(seen.deep).toEqual({ n: 0, tags: ["a"] }); // stale
    expect(seen.snapshot).toEqual({ n: 0, tags: ["a"] }); // stale
    expect(seen.reads).toEqual({ n: 2, tags: ["a", "b"] }); // proxy reads are current
    expect(seen.applySnapshot).toEqual({ n: 2, tags: ["a", "b"] }); // so is snapshot() in apply
  });

  test("a root dispatch proxy gives recorded memos a live lane for stores, but breaks deep(state)", () => {
    const lane = new WeakSet<object>();
    let depth = 0;
    const inLane = () => depth > 0 && lane.has(getObserver() as object);
    const [live, setLive] = createStore({ n: 0 });
    const [cur, setCur] = createSignal<any>(undefined);
    let computes = 0;
    let deepRuns = 0;
    const h = createRoot(() => {
      const view = createProjection<any>(() => (cur() === undefined ? deep(live) : cur()), {}, {});
      const state: any = new Proxy(view, { get: (t, k) => (inLane() ? (live as any)[k] : t[k]) });
      const m = createMemo(() => {
        lane.add(getObserver() as object);
        depth++;
        try {
          computes++;
          return state.n * 10;
        } finally {
          depth--;
        }
      });
      createEffect(m, () => {});
      createEffect(
        () => deep(state),
        () => void deepRuns++
      );
      return { state, m };
    });
    flush();
    setLive(d => void (d.n = 1));
    flush();
    const before = computes;
    setCur({ n: 0 });
    flush();
    expect(h.state.n).toBe(0);
    expect(h.m()).toBe(10);
    setCur(undefined);
    flush();
    expect(computes).toBe(before); // the memo never saw the overlay
    expect(deepRuns).toBe(1); // deep(state) returned the proxy itself and tracked nothing
  });

  test("onFlush called from an effect callback runs after the synchronous flush, not inside it", async () => {
    const seq: string[] = [];
    const [a, setA] = createSignal(0);
    createRoot(() =>
      createEffect(a, v => {
        seq.push("effect " + v);
        onFlush(() => void seq.push("onFlush " + v));
      })
    );
    flush();
    seq.push("| flush() returned");
    setA(1);
    flush();
    seq.push("| flush() returned");
    await Promise.resolve();
    seq.push("| microtask");
    await settled();
    seq.push("| settled");
    console.log("onFlush sequence: " + seq.join(", "));
    expect(seq.indexOf("onFlush 1")).toBeGreaterThan(seq.indexOf("effect 1") + 1); // not in the same flush() call
  });
});
