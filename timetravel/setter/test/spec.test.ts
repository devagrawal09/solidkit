import { describe, expect, test } from "vitest";
import { action, createEffect, createMemo, createRoot, createSignal, flush } from "solid-js";
import {
  createRecordedMemo,
  createRecordedSignal,
  createRecordedStore,
  createTimeline
} from "../src/index.ts";
import { delay, settled, waitFor } from "./helpers.ts";
import { renderCounter } from "./view.tsx";

describe("setter variant", () => {
  test("S1 one step per flush", async () => {
    const timeline = createTimeline();
    const [a, setA] = createRecordedSignal(0, { name: "a", timeline });
    const [b, setB] = createRecordedSignal("x", { name: "b", timeline });
    setA(1);
    setB("y");
    await settled();
    expect([a(), b()]).toEqual([1, "y"]);
    expect(timeline.steps()).toEqual([{ id: 1, changes: { a: 1, b: "y" } }]);
    setA(2);
    await settled();
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { a: 1, b: "y" } },
      { id: 2, changes: { a: 2 } }
    ]);
  });

  test("S2 updater and equality", async () => {
    const timeline = createTimeline();
    const [count, setCount] = createRecordedSignal(1, { name: "count", timeline });
    expect(setCount(c => c + 1)).toBe(2);
    await settled();
    expect(count()).toBe(2);
    expect(timeline.steps()).toEqual([{ id: 1, changes: { count: 2 } }]);
    setCount(2); // equal value
    setCount(c => c); // equal through the updater
    await settled();
    expect(timeline.steps()).toHaveLength(1);
  });

  test("S3 goto and resume add no steps; memos and DOM follow", async () => {
    const timeline = createTimeline();
    const [count, setCount] = createRecordedSignal(1, { name: "count", timeline });
    let doubled!: () => number;
    const disposeRoot = createRoot(dispose => {
      doubled = createMemo(() => count() * 2);
      return dispose;
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    const disposeView = renderCounter(el, count, doubled);
    for (const n of [2, 3, 4]) {
      setCount(n);
      await settled();
    }
    expect(timeline.steps()).toHaveLength(3);
    expect(el.textContent).toBe("count=4 doubled=8");

    timeline.goto(1);
    await settled();
    expect(count()).toBe(2);
    expect(doubled()).toBe(4);
    expect(el.textContent).toBe("count=2 doubled=4");
    expect(timeline.steps()).toHaveLength(3);

    timeline.resume();
    await settled();
    expect(count()).toBe(4);
    expect(doubled()).toBe(8);
    expect(el.textContent).toBe("count=4 doubled=8");
    expect(timeline.steps()).toHaveLength(3);
    disposeView();
    disposeRoot();
    el.remove();
  });

  test("S4 stores restore fine-grained", async () => {
    const timeline = createTimeline();
    const [store, setStore] = createRecordedStore(
      { rows: [{ id: 1, text: "a" }, { id: 2, text: "b" }] },
      { name: "todos", timeline }
    );
    setStore(d => {
      d.rows[0].text = "a1";
    });
    await settled();
    setStore(d => {
      d.rows[1].text = "b2";
    });
    await settled();
    expect(timeline.steps().map(s => s.changes.todos)).toEqual([
      { rows: [{ id: 1, text: "a1" }, { id: 2, text: "b" }] },
      { rows: [{ id: 1, text: "a1" }, { id: 2, text: "b2" }] }
    ]);
    let row1Runs = 0;
    const dispose = createRoot(dispose => {
      createEffect(
        () => store.rows[0].text,
        () => {
          row1Runs++;
        }
      );
      return dispose;
    });
    flush();
    const row1 = store.rows[0];
    const runsBefore = row1Runs;

    timeline.goto(1);
    await settled();
    expect(store.rows[1].text).toBe("b");
    expect(store.rows[0].text).toBe("a1");
    expect(row1Runs).toBe(runsBefore);
    expect(store.rows[0]).toBe(row1);

    timeline.resume();
    await settled();
    expect(store.rows[1].text).toBe("b2");
    expect(row1Runs).toBe(runsBefore);
    expect(store.rows[0]).toBe(row1);
    expect(timeline.steps()).toHaveLength(2);
    dispose();
  });

  test("S5 writes during travel don't touch the past", async () => {
    const timeline = createTimeline();
    const [x, setX] = createRecordedSignal(1, { name: "x", timeline });
    setX(2);
    await settled();
    setX(3);
    await settled();
    timeline.goto(1);
    await settled();
    expect(x()).toBe(2);

    setTimeout(() => setX(c => c * 10), 0); // as a timer would: computed from the live value (3)
    await settled();
    expect(x()).toBe(2);
    expect(timeline.steps()).toHaveLength(2);

    timeline.resume();
    await settled();
    expect(x()).toBe(30);
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { x: 2 } },
      { id: 2, changes: { x: 3 } },
      { id: 3, changes: { x: 30 } }
    ]);
  });

  // Known failure. This variant records a write when its setter is called. Inside an action that
  // is while Solid still holds the write (x() is still 0 below), so the step { x: 5 } exists
  // while the action is in flight. Once the action settles the steps are what this test expects
  // (findings F1): the step is right, just recorded about 20 ms before the write commits.
  test.fails("S6 writes held by an action are recorded when they commit", async () => {
    const timeline = createTimeline();
    const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
    const run = action(function* () {
      setX(5);
      yield delay(20);
    });
    const done = run();
    await settled(); // the action is still in flight (about 4 ms of its 20)
    expect(x()).toBe(0); // Solid holds the write
    console.log(`S6 steps while the action is in flight: ${JSON.stringify(timeline.steps())}`);
    expect(timeline.steps()).toHaveLength(0);
    await done;
    await settled();
    expect(x()).toBe(5);
    expect(timeline.steps()).toEqual([{ id: 1, changes: { x: 5 } }]);
  });

  // Known failure. Steps close once per tick (a microtask) and the action writes in two ticks,
  // so this records { x: 1 } and then { x: 2 }. x = 1 never committed (the effect below never
  // sees it), yet goto(1) shows it (findings F2).
  test.fails("S7 one step per action, final value only", async () => {
    const timeline = createTimeline();
    const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
    const seen: number[] = [];
    const dispose = createRoot(dispose => {
      createEffect(x, v => {
        seen.push(v);
      });
      return dispose;
    });
    flush(); // the effect's first run, before the action starts
    const run = action(function* () {
      setX(1);
      yield delay(10);
      setX(2);
      yield delay(10);
    });
    await run();
    await settled();
    expect(x()).toBe(2);
    expect(seen).toEqual([0, 2]); // 1 never committed
    console.log(`S7 steps: ${JSON.stringify(timeline.steps())}`);
    expect(timeline.steps()).toEqual([{ id: 1, changes: { x: 2 } }]);
    dispose();
  });

  test("S8 recorded async memo", async () => {
    const timeline = createTimeline();
    let calls = 0;
    const fetchFn = (q: string) => {
      calls++;
      return delay(10).then(() => q.toUpperCase());
    };
    const [q, setQ] = createSignal("a");
    let result!: () => string;
    const dispose = createRoot(dispose => {
      result = createRecordedMemo(() => fetchFn(q()), { name: "result", timeline });
      createEffect(result, () => {}); // keep it observed, as a view would
      return dispose;
    });
    await waitFor(() => result() === "A");
    setQ("b");
    await waitFor(() => result() === "B");
    setQ("c");
    await waitFor(() => result() === "C");
    await settled();
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { result: "B" } },
      { id: 2, changes: { result: "C" } }
    ]);

    const before = calls;
    timeline.goto(1);
    await settled();
    expect(result()).toBe("B");
    timeline.goto(0);
    await settled();
    expect(result()).toBe("A");
    expect(calls).toBe(before);

    timeline.resume();
    await settled();
    expect(result()).toBe("C"); // the latest state, even while it refetches
    await delay(15);
    await settled();
    expect(result()).toBe("C");
    console.log(`S8 fetchFn calls caused by resume(): ${calls - before}`);
    expect(timeline.steps()).toHaveLength(2);

    setQ("d"); // live again
    await waitFor(() => result() === "D");
    await settled();
    expect(timeline.steps().at(-1)).toEqual({ id: 3, changes: { result: "D" } });
    dispose();
  });

  test("S9 a result landing during travel", async () => {
    const timeline = createTimeline();
    const [x, setX] = createRecordedSignal(1, { name: "x", timeline });
    setX(2);
    await settled();
    setX(3);
    await settled();
    let resolve!: (v: number) => void;
    const response = new Promise<number>(r => (resolve = r));
    const save = action(async function* () {
      const v = await response;
      yield;
      setX(v);
    });
    const done = save();
    await settled();
    timeline.goto(1);
    await settled();
    expect(x()).toBe(2);

    resolve(42);
    await done;
    await settled();
    expect(x()).toBe(2);
    expect(timeline.steps()).toHaveLength(2);

    timeline.resume();
    await settled();
    expect(x()).toBe(42);
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { x: 2 } },
      { id: 2, changes: { x: 3 } },
      { id: 3, changes: { x: 42 } }
    ]);
  });

  test("S10 branch", async () => {
    const timeline = createTimeline();
    const [x, setX] = createRecordedSignal(1, { name: "x", timeline });
    for (const n of [2, 3, 4]) {
      setX(n);
      await settled();
    }
    timeline.goto(1);
    await settled();
    timeline.branch();
    await settled();
    expect(timeline.steps()).toEqual([{ id: 1, changes: { x: 2 } }]);
    expect(x()).toBe(2);
    expect(timeline.traveling()).toBe(false);
    setX(10);
    await settled();
    expect(x()).toBe(10);
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { x: 2 } },
      { id: 2, changes: { x: 10 } }
    ]);
  });

  test("S11 traveling flag and effect re-runs", async () => {
    const timeline = createTimeline();
    const [a, setA] = createRecordedSignal(1, { name: "a", timeline });
    const [s, setS] = createRecordedStore({ n: 1 }, { name: "s", timeline });
    const flags: boolean[] = [];
    let runs = 0;
    const dispose = createRoot(dispose => {
      createEffect(timeline.traveling, v => {
        flags.push(v);
      });
      createEffect(
        () => [a(), s.n],
        () => {
          runs++;
        }
      );
      return dispose;
    });
    flush();
    setA(2);
    setS(d => {
      d.n = 2;
    });
    await settled();
    setA(3);
    await settled();
    const before = runs;
    timeline.goto(1);
    await settled();
    expect(timeline.traveling()).toBe(true);
    expect([a(), s.n]).toEqual([2, 2]);
    timeline.resume();
    await settled();
    expect(timeline.traveling()).toBe(false);
    expect([a(), s.n]).toEqual([3, 2]);
    expect(flags).toEqual([false, true, false]);
    console.log(`S11 plain effect re-runs across one goto + resume: ${runs - before}`);
    dispose();
  });
});
