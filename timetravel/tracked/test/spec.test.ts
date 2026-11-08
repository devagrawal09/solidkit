import { afterEach, describe, expect, test } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createRoot,
  createSignal,
  createStore,
  flush,
  OBSERVE
} from "solid-js";
import { createTimeline, createTracked, type Step, type Timeline } from "../src/index.ts";
import { delay, settled, waitFor } from "./helpers.ts";
import { renderCounter } from "./view.tsx";

/** Steps without their attribution: what S1–S11 compare. */
const brief = (timeline: Timeline) => timeline.steps().map(({ id, changes }) => ({ id, changes }));

let current: { timeline: Timeline; dispose: () => void } | null = null;
afterEach(() => {
  current?.timeline.dispose();
  current?.dispose();
  current = null;
  flush();
});

function setup<T>(fn: (timeline: Timeline) => T): T & { timeline: Timeline } {
  return createRoot(dispose => {
    const timeline = createTimeline();
    current = { timeline, dispose };
    return { ...fn(timeline), timeline };
  });
}

describe("tracked: the spec scenarios", () => {
  test("S1 one step per flush", async () => {
    const { timeline, setA, setB } = setup(() => {
      const [, setA] = createTracked(createSignal, 0, { name: "a" });
      const [, setB] = createTracked(createSignal, "x", { name: "b" });
      return { setA, setB };
    });
    await settled();
    expect(brief(timeline)).toEqual([]);

    setA(1);
    setB("y");
    await settled();
    expect(brief(timeline)).toEqual([{ id: 1, changes: { a: 1, b: "y" } }]);

    setA(2);
    await settled();
    expect(brief(timeline)).toEqual([
      { id: 1, changes: { a: 1, b: "y" } },
      { id: 2, changes: { a: 2 } }
    ]);
  });

  test("S1b two synchronous flushes are two steps", async () => {
    const { timeline, setA } = setup(() => {
      const [, setA] = createTracked(createSignal, 0, { name: "a" });
      return { setA };
    });
    await settled();
    setA(1);
    flush();
    setA(2);
    flush();
    await settled();
    expect(brief(timeline)).toEqual([
      { id: 1, changes: { a: 1 } },
      { id: 2, changes: { a: 2 } }
    ]);
  });

  test("S2 updater and equality", async () => {
    const { timeline, c, setC } = setup(() => {
      const [c, setC] = createTracked(createSignal, 0, { name: "c" });
      return { c, setC };
    });
    await settled();
    expect(setC(v => v + 1)).toBe(1);
    await settled();
    expect(c()).toBe(1);
    expect(brief(timeline)).toEqual([{ id: 1, changes: { c: 1 } }]);
    setC(1);
    await settled();
    setC(v => v);
    await settled();
    expect(brief(timeline)).toEqual([{ id: 1, changes: { c: 1 } }]);
  });

  test("S3 goto and resume add no steps; memos and DOM follow", async () => {
    const { timeline, count, setCount, doubled } = setup(() => {
      const [count, setCount] = createTracked(createSignal, 0, { name: "count" });
      const doubled = createMemo(() => count() * 2);
      return { count, setCount, doubled };
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
    expect(el.textContent).toBe("count=3 doubled=6");
    expect(timeline.steps()).toHaveLength(3);
    unmount();
  });

  test("S4 stores restore fine-grained", async () => {
    let row1Runs = 0;
    const { timeline, state, setState } = setup(() => {
      const [state, setState] = createTracked(
        createStore,
        { rows: [{ id: 1, text: "a" }, { id: 2, text: "b" }] },
        { name: "todos" }
      );
      createEffect(
        () => state.rows[0].text,
        () => {
          row1Runs++;
        }
      );
      return { state, setState };
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
    expect(timeline.steps()[1].changes.todos).toEqual({
      rows: [{ id: 1, text: "A" }, { id: 2, text: "B" }]
    });

    const row1 = state.rows[0];
    const runsBefore = row1Runs;
    timeline.goto(1);
    await settled();
    expect(state.rows[1].text).toBe("b");
    expect(state.rows[0].text).toBe("A");
    expect(row1Runs).toBe(runsBefore);
    expect(state.rows[0]).toBe(row1);

    timeline.resume();
    await settled();
    expect(state.rows[1].text).toBe("B");
    expect(state.rows[0]).toBe(row1);
    expect(row1Runs).toBe(runsBefore);
    expect(timeline.steps()).toHaveLength(2);
  });

  test("S5 writes during travel don't touch the past", async () => {
    const { timeline, x, setX } = setup(() => {
      const [x, setX] = createTracked(createSignal, 0, { name: "x" });
      return { x, setX };
    });
    await settled();
    setX(1);
    await settled();
    setX(2);
    await settled();
    timeline.goto(1);
    await settled();
    expect(x()).toBe(1);
    setTimeout(() => setX(99), 0);
    await settled();
    expect(x()).toBe(1);
    timeline.resume();
    await settled();
    expect(x()).toBe(99);
    expect(brief(timeline)).toEqual([
      { id: 1, changes: { x: 1 } },
      { id: 2, changes: { x: 2 } },
      { id: 3, changes: { x: 99 } }
    ]);
  });

  test("S6 writes held by an action are recorded when they commit", async () => {
    const { timeline, x, setX } = setup(() => {
      const [x, setX] = createTracked(createSignal, 0, { name: "x" });
      return { x, setX };
    });
    await settled();
    const run = action(function* () {
      setX(5);
      yield delay(20);
    });
    const done = run();
    await settled();
    expect(brief(timeline)).toEqual([]);
    await done;
    await settled();
    expect(x()).toBe(5);
    expect(brief(timeline)).toEqual([{ id: 1, changes: { x: 5 } }]);
  });

  test("S7 one step per action, final value only", async () => {
    const { timeline, setX } = setup(() => {
      const [, setX] = createTracked(createSignal, 0, { name: "x" });
      return { setX };
    });
    await settled();
    const run = action(function* () {
      setX(1);
      yield delay(10);
      setX(2);
    });
    await run();
    await settled();
    expect(brief(timeline)).toEqual([{ id: 1, changes: { x: 2 } }]);
  });

  test("S8 tracked async memo", async () => {
    let calls = 0;
    const fetchFn = (q: string) => {
      calls++;
      return delay(10).then(() => q.toUpperCase());
    };
    const [q, setQ] = createSignal("a");
    const { timeline, result } = setup(() => {
      const result = createTracked(createMemo, () => fetchFn(q()), {
        name: "result"
      });
      createEffect(result, () => {});
      return { result };
    });
    await waitFor(() => result() === "A");
    setQ("b");
    await waitFor(() => result() === "B");
    setQ("c");
    await waitFor(() => result() === "C");
    await settled();
    expect(brief(timeline)).toEqual([
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
    await delay(15);
    await settled();
    expect(result()).toBe("C");
    expect(calls).toBe(before); // no refetch on resume
    expect(timeline.steps()).toHaveLength(2);
  });

  test("S9 a result landing during travel", async () => {
    const { timeline, x, setX } = setup(() => {
      const [x, setX] = createTracked(createSignal, 1, { name: "x" });
      return { x, setX };
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
    expect(x()).toBe(2);
    timeline.resume();
    await settled();
    expect(x()).toBe(42);
    expect(brief(timeline)).toEqual([
      { id: 1, changes: { x: 2 } },
      { id: 2, changes: { x: 3 } },
      { id: 3, changes: { x: 42 } }
    ]);
  });

  test("S10 branch", async () => {
    const { timeline, x, setX, y, setY } = setup(() => {
      const [x, setX] = createTracked(createSignal, 0, { name: "x" });
      const [y, setY] = createTracked(createSignal, "a", { name: "y" });
      return { x, setX, y, setY };
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
    expect(brief(timeline)).toEqual([{ id: 1, changes: { x: 1 } }]);
    expect(timeline.traveling()).toBe(false);
    expect(x()).toBe(1);
    expect(y()).toBe("a");
    setX(10);
    await settled();
    expect(brief(timeline)).toEqual([
      { id: 1, changes: { x: 1 } },
      { id: 2, changes: { x: 10 } }
    ]);
  });

  test("S11 traveling flag and effect re-runs", async () => {
    const flags: boolean[] = [];
    let runs = 0;
    const { timeline, setA, setB } = setup(timeline => {
      const [a, setA] = createTracked(createSignal, 0, { name: "a" });
      const [b, setB] = createTracked(createSignal, 0, { name: "b" });
      createEffect(timeline.traveling, t => {
        flags.push(t);
      });
      createEffect(
        () => [a(), b()],
        () => {
          runs++;
        }
      );
      return { setA, setB };
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
    console.log(`S11 a plain effect over the tracked sources re-ran ${runs - before} time(s) across goto(1) + resume()`);
  });
});

describe("tracked: attribution", () => {
  test("a step names the action that wrote it, including its landing", async () => {
    const gate = { resolve: () => {} };
    const { timeline, setSaved } = setup(() => {
      const [, setSaved] = createTracked(createSignal, "draft", { name: "saved" });
      return { setSaved };
    });
    await settled();
    const submit = action(function* save() {
      setSaved("final");
      yield new Promise<void>(r => (gate.resolve = r));
    });
    const done = submit();
    await settled();
    expect(timeline.steps()).toEqual([]);
    gate.resolve();
    await done;
    await settled();
    expect(timeline.steps()).toEqual([
      expect.objectContaining({ id: 1, changes: { saved: "final" }, actions: ["save"] })
    ]);
  });

  test("an optimistic value is a step when it appears and when it lifts", async () => {
    const gate = { resolve: () => {} };
    const { timeline, status, setStatus } = setup(() => {
      const [status, setStatus] = createTracked(createOptimistic, "idle", { name: "status" });
      createEffect(status, () => {});
      return { status, setStatus };
    });
    await settled();
    const submit = action(function* save() {
      setStatus("saving");
      yield new Promise<void>(r => (gate.resolve = r));
    });
    const done = submit();
    await settled();
    expect(status()).toBe("saving");
    gate.resolve();
    await done;
    await settled();
    expect(status()).toBe("idle");
    const steps: Step[] = timeline.steps() as Step[];
    expect(steps.map(s => [s.changes, s.actions])).toEqual([
      [{ status: "saving" }, ["save"]],
      [{ status: "idle" }, []]
    ]);
    // Rewind to the optimistic moment.
    timeline.goto(1);
    await settled();
    expect(status()).toBe("saving");
    timeline.resume();
    await settled();
    expect(status()).toBe("idle");
  });

  test("a step names the interaction that caused it", async () => {
    const { timeline, setCount } = setup(() => {
      const [, setCount] = createTracked(createSignal, 0, { name: "count" });
      return { setCount };
    });
    await settled();
    OBSERVE!.attribution.withInteraction({ type: "click", target: "button#inc" }, () => setCount(1));
    await settled();
    expect(timeline.steps()).toEqual([expect.objectContaining({ cause: "click on button#inc" })]);
  });

  test("untracked writes are not steps", async () => {
    const { timeline } = setup(() => ({}));
    const [plain, setPlain] = createSignal(0);
    createRoot(() => createEffect(plain, () => {}));
    await settled();
    setPlain(1);
    await settled();
    expect(timeline.steps()).toEqual([]);
  });
});
