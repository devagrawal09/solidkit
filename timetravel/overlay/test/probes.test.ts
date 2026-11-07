// Probes beyond S1–S11: they answer the overlay-specific questions and pin
// down known limitations (those assert the observed behavior and say so).
import { describe, expect, test } from "vitest";
import { action, createEffect, createMemo, createRoot, createSignal, flush, isPending } from "solid-js";
import {
  createRecordedMemo,
  createRecordedSignal,
  createRecordedStore,
  createTimeline
} from "../src/index.ts";
import { delay, settled, waitFor } from "./helpers.ts";
import { renderList } from "./view.tsx";

describe("overlay probes", () => {
  test("goto writes nothing: a recorded memo's live computation never re-runs on goto/resume", async () => {
    let computes = 0;
    const { timeline, setX, m, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
      const m = createRecordedMemo(
        () => {
          computes++;
          return x() * 10;
        },
        { name: "m", timeline }
      );
      createEffect(m, () => {});
      return { timeline, setX, m, dispose };
    });
    await settled();
    setX(1);
    await settled();
    setX(2);
    await settled();
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { x: 1, m: 10 } },
      { id: 2, changes: { x: 2, m: 20 } }
    ]);
    const before = computes;
    timeline.goto(1);
    await settled();
    expect(m()).toBe(10);
    timeline.goto(0);
    await settled();
    expect(m()).toBe(0);
    timeline.resume();
    await settled();
    expect(m()).toBe(20);
    expect(computes).toBe(before); // live x was never written, so live m never recomputed
    expect(timeline.steps()).toHaveLength(2);
    dispose();
  });

  test("no leak into the past: live writes and refetches during travel don't reach the view", async () => {
    let calls = 0;
    const fetchFn = (q: string) => {
      calls++;
      return delay(5).then(() => q.toUpperCase());
    };
    const [q, setQ] = createSignal("a");
    const runs = { x: 0, row: 0, r: 0 };
    const h = createRoot(dispose => {
      const timeline = createTimeline();
      const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
      const [s, setS] = createRecordedStore({ rows: [{ id: 1, text: "a" }] }, { name: "s", timeline });
      const r = createRecordedMemo(() => fetchFn(q()), { name: "r", timeline });
      createEffect(x, () => void runs.x++);
      createEffect(() => s.rows[0].text, () => void runs.row++);
      createEffect(r, () => void runs.r++);
      return { timeline, x, setX, s, setS, r, dispose };
    });
    await waitFor(() => h.r() === "A");
    h.setX(1);
    h.setS(d => void (d.rows[0].text = "b"));
    setQ("b");
    await waitFor(() => h.r() === "B");
    await settled();
    expect(h.timeline.steps()).toHaveLength(2); // {x, s} then {r}

    h.timeline.goto(1);
    await settled();
    const seen = { ...runs };
    const callsBefore = calls;
    // The present keeps running underneath.
    h.setX(2);
    h.setS(d => void (d.rows[0].text = "LIVE"));
    setQ("z");
    await delay(20);
    await settled();
    expect(calls).toBe(callsBefore + 1); // the live memo refetched for "z"
    expect(runs).toEqual(seen); // no effect saw a live value
    expect(h.x()).toBe(1);
    expect(h.s.rows[0].text).toBe("b");
    expect(h.r()).toBe("A"); // step 1 had x and s, the result was still "A"
    expect(isPending(() => h.r())).toBe(false); // the live refetch never made the past pending
    expect(h.timeline.steps().length).toBeGreaterThan(2); // recorded while traveling

    // resume is instant: one synchronous flush, no timers, no refetch.
    h.timeline.resume();
    flush();
    expect(h.x()).toBe(2);
    expect(h.s.rows[0].text).toBe("LIVE");
    expect(h.r()).toBe("Z");
    expect(calls).toBe(callsBefore + 1);
    h.dispose();
  });

  test("goto while an action holds a write to a viewed source shows the past at once", async () => {
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
    const run = action(function* () {
      setX(5);
      yield delay(30);
    });
    const done = run();
    await settled();
    timeline.goto(1);
    await settled();
    expect(x()).toBe(1); // not held behind the action (the optimistic cursor layer)
    expect(timeline.traveling()).toBe(true);
    await done;
    await settled();
    expect(x()).toBe(1); // still viewing step 1 after the hold released
    expect(timeline.steps().at(-1)).toEqual({ id: 3, changes: { x: 5 } });
    timeline.resume();
    await settled();
    expect(x()).toBe(5);
    dispose();
  });

  test("a <For> list over the store view keeps its DOM rows across goto/resume", async () => {
    const el = document.createElement("div");
    const { timeline, state, setState, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [state, setState] = createRecordedStore(
        { rows: [{ id: 1, text: "a" }, { id: 2, text: "b" }, { id: 3, text: "c" }] },
        { name: "list", timeline }
      );
      return { timeline, state, setState, dispose };
    });
    const unmount = renderList(el, () => state.rows);
    await settled();
    setState(d => void (d.rows[1].text = "B")); // step 1
    await settled();
    setState(d => void d.rows.splice(2, 1)); // step 2: row 3 removed
    await settled();
    setState(d => void (d.rows[0].text = "A")); // step 3
    await settled();
    const li = () => [...el.querySelectorAll("li")];
    const [li1, li2] = li();
    expect(li().map(n => n.textContent)).toEqual(["A", "B"]);

    timeline.goto(1);
    await settled();
    expect(li().map(n => n.textContent)).toEqual(["a", "B", "c"]);
    expect(li()[0]).toBe(li1); // same DOM node, text patched in place
    expect(li()[1]).toBe(li2);

    timeline.resume();
    await settled();
    expect(li().map(n => n.textContent)).toEqual(["A", "B"]);
    expect(li()[0]).toBe(li1);
    expect(li()[1]).toBe(li2);
    unmount();
    dispose();
  });

  test("branch while an action holds a write: the view stays on the branch point until the restore lands", async () => {
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
    const done = action(function* () {
      setX(5);
      yield delay(30);
    })();
    await settled();
    timeline.goto(1);
    await settled();
    timeline.branch();
    await settled();
    expect(x()).toBe(1); // never shows the abandoned present (2)
    console.log(`branch during a hold: traveling() right after branch = ${timeline.traveling()}`);
    await done;
    await settled();
    expect(x()).toBe(1);
    expect(timeline.traveling()).toBe(false);
    // The restore was written after the action's write, so it wins: the
    // in-flight result (5) is dropped without a step.
    expect(timeline.steps()).toEqual([{ id: 1, changes: { x: 1 } }]);
    dispose();
  });

  test("a store write held by an action is recorded with the write when it commits", async () => {
    const { timeline, s, setS, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [s, setS] = createRecordedStore({ n: 0, tags: ["a"] }, { name: "s", timeline });
      return { timeline, s, setS, dispose };
    });
    await settled();
    const run = action(function* () {
      setS(d => {
        d.n = 1;
        d.tags.push("b");
      });
      yield delay(20);
      setS(d => void (d.n = 2));
    });
    const done = run();
    await settled();
    expect(timeline.steps()).toEqual([]);
    await done;
    await settled();
    expect(timeline.steps()).toEqual([{ id: 1, changes: { s: { n: 2, tags: ["a", "b"] } } }]);
    expect(s.n).toBe(2);
    dispose();
  });

  test("branch from a store step: live store equals the step, no echo step, rows keep identity", async () => {
    const { timeline, state, setState, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [state, setState] = createRecordedStore(
        { rows: [{ id: 1, text: "a" }, { id: 2, text: "b" }] },
        { name: "todos", timeline }
      );
      return { timeline, state, setState, dispose };
    });
    await settled();
    setState(d => void (d.rows[0].text = "A"));
    await settled();
    setState(d => void d.rows.push({ id: 3, text: "c" }));
    await settled();
    const row1 = state.rows[0];
    timeline.goto(1);
    await settled();
    timeline.branch();
    await settled();
    expect(timeline.traveling()).toBe(false);
    expect(timeline.steps().map(s => s.id)).toEqual([1]); // no echo of the restore
    expect(state.rows.map(r => r.text)).toEqual(["A", "b"]);
    expect(state.rows[0]).toBe(row1);
    setState(d => void (d.rows[1].text = "B"));
    await settled();
    expect(timeline.steps().map(s => s.id)).toEqual([1, 2]);
    expect(timeline.steps()[1].changes.todos).toEqual({ rows: [{ id: 1, text: "A" }, { id: 2, text: "B" }] });
    dispose();
  });

  test("live lane: a recorded async memo over a RECORDED query doesn't refetch on goto", async () => {
    let calls = 0;
    const fetchFn = (q: string) => {
      calls++;
      return delay(5).then(() => q.toUpperCase());
    };
    const h = createRoot(dispose => {
      const timeline = createTimeline();
      const [q, setQ] = createRecordedSignal("a", { name: "q", timeline });
      const r = createRecordedMemo(() => fetchFn(q()), { name: "r", timeline });
      createEffect(r, () => {});
      return { timeline, q, setQ, r, dispose };
    });
    await waitFor(() => h.r() === "A");
    h.setQ("b");
    await waitFor(() => h.r() === "B");
    await settled();
    expect(h.timeline.steps()).toEqual([
      { id: 1, changes: { q: "b" } },
      { id: 2, changes: { r: "B" } }
    ]);
    const before = calls;
    h.timeline.goto(1);
    await settled();
    expect(h.q()).toBe("b");
    expect(h.r()).toBe("A");
    h.timeline.goto(0);
    await settled();
    expect(h.q()).toBe("a");
    h.timeline.resume();
    await settled();
    expect(calls).toBe(before);
    expect(h.timeline.steps()).toHaveLength(2);
    h.dispose();
  });

  test("LIMITATION: a recorded memo reading a recorded STORE recomputes from the past and records it", async () => {
    const { timeline, setS, m, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [s, setS] = createRecordedStore({ n: 0 }, { name: "s", timeline });
      const m = createRecordedMemo(() => s.n * 10, { name: "m", timeline });
      createEffect(m, () => {});
      return { timeline, setS, m, dispose };
    });
    await settled();
    setS(d => void (d.n = 1));
    await settled();
    setS(d => void (d.n = 2));
    await settled();
    expect(timeline.steps()).toHaveLength(2);
    timeline.goto(1);
    await settled();
    expect(m()).toBe(10);
    timeline.resume();
    await settled();
    expect(m()).toBe(20);
    // Desired: still 2 steps. Observed: the live memo read the overlaid store,
    // recomputed to 10 while traveling (recorded) and back to 20 on resume.
    console.log("LIMITATION store-in-recorded-memo steps after goto+resume:", JSON.stringify(timeline.steps()));
    expect(timeline.steps().length).toBeGreaterThan(2);
    dispose();
  });

  test("LIMITATION: a plain memo between a recorded signal and a recorded memo carries the past into it", async () => {
    let computes = 0;
    const { timeline, setX, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
      const plus = createMemo(() => x() + 1); // a plain memo: one lane only (the view)
      const m = createRecordedMemo(
        () => {
          computes++;
          return plus() * 10;
        },
        { name: "m", timeline }
      );
      createEffect(m, () => {});
      return { timeline, setX, m, dispose };
    });
    await settled();
    setX(1);
    await settled();
    setX(2);
    await settled();
    const before = computes;
    timeline.goto(1);
    await settled();
    timeline.resume();
    await settled();
    console.log(`LIMITATION plain-memo bridge: live recomputes on goto+resume = ${computes - before}, steps = ${timeline.steps().length}`);
    expect(computes - before).toBe(2);
    dispose();
  });

  test("HAZARD: a handler that reads the getter while traveling writes a past-derived value", async () => {
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
    timeline.goto(1); // view: 2, present: 3
    await settled();
    setX(x() * 10); // reads the overlay: writes 20 into the present (from 3, you'd expect 30)
    await settled();
    setX(v => v + 1); // the updater gets the live value: 21
    await settled();
    timeline.resume();
    await settled();
    expect(x()).toBe(21);
    expect(timeline.steps().slice(2)).toEqual([
      { id: 3, changes: { x: 20 } },
      { id: 4, changes: { x: 21 } }
    ]);
    dispose();
  });

  test("LIMITATION: back-to-back synchronous flushes of different sources share a step", async () => {
    const { timeline, setA, setB, dispose } = createRoot(dispose => {
      const timeline = createTimeline();
      const [, setA] = createRecordedSignal(0, { name: "a", timeline });
      const [, setB] = createRecordedSignal(0, { name: "b", timeline });
      return { timeline, setA, setB, dispose };
    });
    await settled();
    setA(1);
    flush();
    setA(2);
    flush(); // same source again: a new step
    setB(1);
    flush(); // a different source in the same tick: merged into step 2
    await settled();
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { a: 1 } },
      { id: 2, changes: { a: 2, b: 1 } }
    ]);
    dispose();
  });
});
