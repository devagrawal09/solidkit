import { describe, expect, test } from "vitest";
import { action, createEffect, createMemo, createRoot, createSignal } from "solid-js";
import {
  createRecordedMemo,
  createRecordedSignal,
  createRecordedStore,
  createTimeline
} from "../src/index.ts";
import { delay, settled, waitFor } from "./helpers.ts";
import { renderCounter } from "./view.tsx";

describe("overlay", () => {
  test("S1 one step per flush", async () => {
    const { timeline, setA, setB, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [, setA] = createRecordedSignal(0, { name: "a", timeline });
      const [, setB] = createRecordedSignal("x", { name: "b", timeline });
      return { timeline, setA, setB, dispose };
    });
    await settled();
    expect(timeline.steps()).toEqual([]);

    setA(1);
    setB("y");
    await settled();
    expect(timeline.steps()).toEqual([{ id: 1, changes: { a: 1, b: "y" } }]);

    setA(2);
    await settled();
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { a: 1, b: "y" } },
      { id: 2, changes: { a: 2 } }
    ]);
    dispose();
  });

  test("S2 updater and equality", async () => {
    const { timeline, c, setC, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [c, setC] = createRecordedSignal(0, { name: "c", timeline });
      return { timeline, c, setC, dispose };
    });
    await settled();
    expect(setC(v => v + 1)).toBe(1); // the setter returns the computed value
    await settled();
    expect(c()).toBe(1);
    expect(timeline.steps()).toEqual([{ id: 1, changes: { c: 1 } }]);

    setC(1); // equal: nothing to record
    await settled();
    setC(v => v); // equal through the updater too
    await settled();
    expect(timeline.steps()).toEqual([{ id: 1, changes: { c: 1 } }]);
    dispose();
  });

  test("S3 goto and resume add no steps; memos and DOM follow", async () => {
    const { timeline, count, setCount, doubled, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [count, setCount] = createRecordedSignal(0, { name: "count", timeline });
      const doubled = createMemo(() => count() * 2);
      return { timeline, count, setCount, doubled, dispose };
    });
    const el = document.createElement("div");
    const unmount = renderCounter(el, count, doubled);
    await settled();
    expect(el.textContent).toBe("count=0 doubled=0");
    for (const v of [1, 2, 3]) {
      setCount(v);
      await settled();
    }
    expect(timeline.steps()).toHaveLength(3);
    expect(el.textContent).toBe("count=3 doubled=6");

    timeline.goto(1);
    await settled();
    expect(timeline.traveling()).toBe(true);
    expect(count()).toBe(1);
    expect(doubled()).toBe(2);
    expect(el.textContent).toBe("count=1 doubled=2");
    expect(timeline.steps()).toHaveLength(3);

    timeline.resume();
    await settled();
    expect(count()).toBe(3);
    expect(doubled()).toBe(6);
    expect(el.textContent).toBe("count=3 doubled=6");
    expect(timeline.steps()).toHaveLength(3);
    unmount();
    dispose();
  });

  test("S4 stores restore fine-grained", async () => {
    let row1Runs = 0;
    const { timeline, state, setState, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [state, setState] = createRecordedStore(
        { rows: [{ id: 1, text: "a" }, { id: 2, text: "b" }] },
        { name: "todos", timeline }
      );
      createEffect(
        () => state.rows[0].text,
        () => {
          row1Runs++;
        }
      );
      return { timeline, state, setState, dispose };
    });
    await settled();
    setState(d => {
      d.rows[0].text = "A";
    });
    await settled();
    setState(d => {
      d.rows[1].text = "B";
    });
    await settled();
    expect(timeline.steps().map(s => s.id)).toEqual([1, 2]);
    expect(timeline.steps()[1].changes.todos).toEqual({ rows: [{ id: 1, text: "A" }, { id: 2, text: "B" }] });

    const row1 = state.rows[0];
    const runsBefore = row1Runs;
    timeline.goto(1);
    await settled();
    expect(state.rows[1].text).toBe("b"); // row 2 restored
    expect(state.rows[0].text).toBe("A");
    expect(row1Runs).toBe(runsBefore); // row 1's effect did not re-run
    expect(state.rows[0]).toBe(row1); // row 1 kept its identity

    timeline.resume();
    await settled();
    expect(state.rows[1].text).toBe("B");
    expect(state.rows[0]).toBe(row1);
    expect(row1Runs).toBe(runsBefore);
    expect(timeline.steps()).toHaveLength(2);
    dispose();
  });

  test("S5 writes during travel don't touch the past", async () => {
    const { timeline, x, setX, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
      return { timeline, x, setX, dispose };
    });
    await settled();
    setX(1);
    await settled();
    setX(2);
    await settled();

    timeline.goto(1);
    await settled();
    expect(x()).toBe(1);
    setTimeout(() => setX(99), 0); // as a timer would
    await settled();
    expect(x()).toBe(1); // the viewed past is unchanged
    console.log(`S5 steps while traveling, after the write: ${timeline.steps().length} (recorded during travel)`);

    timeline.resume();
    await settled();
    expect(x()).toBe(99);
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { x: 1 } },
      { id: 2, changes: { x: 2 } },
      { id: 3, changes: { x: 99 } }
    ]);
    dispose();
  });

  test("S6 writes held by an action are recorded when they commit", async () => {
    const { timeline, x, setX, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
      return { timeline, x, setX, dispose };
    });
    await settled();
    const run = action(function* () {
      setX(5);
      yield delay(20);
    });
    const done = run();
    await settled();
    expect(timeline.steps()).toEqual([]); // in flight: not recorded yet
    await done;
    await settled();
    expect(x()).toBe(5);
    expect(timeline.steps()).toEqual([{ id: 1, changes: { x: 5 } }]);
    dispose();
  });

  test("S7 one step per action, final value only", async () => {
    const { timeline, setX, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
      return { timeline, x, setX, dispose };
    });
    await settled();
    const run = action(function* () {
      setX(1);
      yield delay(10);
      setX(2);
    });
    await run();
    await settled();
    expect(timeline.steps()).toEqual([{ id: 1, changes: { x: 2 } }]);
    dispose();
  });

  test("S8 recorded async memo", async () => {
    let calls = 0;
    const fetchFn = (q: string) => {
      calls++;
      return delay(10).then(() => q.toUpperCase());
    };
    const [q, setQ] = createSignal("a");
    const { timeline, result, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const result = createRecordedMemo(() => fetchFn(q()), { name: "result", timeline });
      createEffect(result, () => {}); // observed, as a view would
      return { timeline, result, dispose };
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
    expect(calls).toBe(before); // traveling never calls fetchFn

    timeline.resume();
    await settled();
    expect(result()).toBe("C");
    await delay(15);
    await settled();
    expect(result()).toBe("C");
    console.log(`S8 fetchFn calls caused by goto + resume: ${calls - before}`);
    expect(timeline.steps()).toHaveLength(2);

    setQ("d"); // live again
    await waitFor(() => result() === "D");
    await settled();
    expect(timeline.steps().at(-1)).toEqual({ id: 3, changes: { result: "D" } });
    dispose();
  });

  test("S9 a result landing during travel", async () => {
    const { timeline, x, setX, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [x, setX] = createRecordedSignal(1, { name: "x", timeline });
      return { timeline, x, setX, dispose };
    });
    await settled();
    setX(2);
    await settled();
    setX(3);
    await settled();
    let resolve!: (v: number) => void;
    const response = new Promise<number>(r => (resolve = r));
    const save = action(function* () {
      const v: number = yield response;
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
    expect(x()).toBe(2); // the viewed past is unchanged
    console.log(`S9 steps while traveling, after the landing: ${timeline.steps().length} (recorded during travel)`);

    timeline.resume();
    await settled();
    expect(x()).toBe(42);
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { x: 2 } },
      { id: 2, changes: { x: 3 } },
      { id: 3, changes: { x: 42 } }
    ]);
    dispose();
  });

  test("S10 branch", async () => {
    const { timeline, x, setX, y, setY, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
      const [y, setY] = createRecordedSignal("a", { name: "y", timeline });
      return { timeline, x, setX, y, setY, dispose };
    });
    await settled();
    setX(1);
    await settled();
    setY("b");
    await settled();
    setX(2);
    await settled();

    timeline.goto(1);
    await settled();
    timeline.branch();
    await settled();
    expect(timeline.steps()).toEqual([{ id: 1, changes: { x: 1 } }]);
    expect(timeline.traveling()).toBe(false);
    expect(x()).toBe(1);
    expect(y()).toBe("a");

    setX(10);
    await settled();
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { x: 1 } },
      { id: 2, changes: { x: 10 } }
    ]);
    expect(x()).toBe(10);
    dispose();
  });

  test("S11 traveling flag and effect re-runs", async () => {
    const flags: boolean[] = [];
    let runs = 0;
    const { timeline, setA, setB, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [a, setA] = createRecordedSignal(0, { name: "a", timeline });
      const [b, setB] = createRecordedSignal(0, { name: "b", timeline });
      createEffect(timeline.traveling, t => {
        flags.push(t);
      });
      createEffect(
        () => [a(), b()],
        () => {
          runs++;
        }
      );
      return { timeline, setA, setB, dispose };
    });
    await settled();
    setA(1);
    await settled();
    setB(1);
    await settled();
    setA(2);
    await settled();

    const before = runs;
    timeline.goto(1);
    await settled();
    expect(timeline.traveling()).toBe(true);
    timeline.resume();
    await settled();
    expect(timeline.traveling()).toBe(false);
    expect(flags).toEqual([false, true, false]);
    console.log(`S11 plain effect over the recorded sources re-ran ${runs - before} time(s) across goto(1) + resume()`);
    dispose();
  });
});
