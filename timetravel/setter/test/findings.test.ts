// Observations behind the README's S6/S7 analysis. These assert what the setter variant
// actually does (not the desired behavior), so a change in Solid or in the variant shows up.
import { describe, expect, test } from "vitest";
import { action, createEffect, createRoot, createSignal, flush } from "solid-js";
import { createRecordedMemo, createRecordedSignal, createTimeline } from "../src/index.ts";
import { delay, settled, waitFor } from "./helpers.ts";

describe("findings", () => {
  test("F1 a write held by an action is recorded at call time, with the value that later commits", async () => {
    const timeline = createTimeline();
    const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
    const done = action(function* () {
      setX(5);
      yield delay(20);
    })();
    await settled();
    expect(x()).toBe(0); // held by the action
    expect(timeline.steps()).toEqual([{ id: 1, changes: { x: 5 } }]); // already recorded
    await done;
    await settled();
    expect(x()).toBe(5);
    expect(timeline.steps()).toEqual([{ id: 1, changes: { x: 5 } }]); // unchanged: right step, early
  });

  test("F2 goto() into a step made inside an action shows a value that never committed", async () => {
    const timeline = createTimeline();
    const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
    const seen: number[] = [];
    const dispose = createRoot(dispose => {
      createEffect(x, v => {
        seen.push(v);
      });
      return dispose;
    });
    flush();
    await action(function* () {
      setX(1);
      yield delay(10);
      setX(2);
    })();
    await settled();
    expect(seen).toEqual([0, 2]);
    timeline.goto(1);
    await settled();
    expect(x()).toBe(1); // a state the app never showed
    expect(seen).toEqual([0, 2, 1]);
    timeline.resume();
    await settled();
    dispose();
  });

  test("F3 goto() during an action that holds a recorded write waits for the action", async () => {
    const timeline = createTimeline();
    const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
    const [y, setY] = createRecordedSignal("a", { name: "y", timeline });
    setY("b");
    await settled();
    const done = action(function* () {
      setX(5);
      yield delay(20);
    })();
    await settled();
    timeline.goto(0); // view the initial state while the action still holds x = 5
    await settled();
    const during = [x(), y(), timeline.traveling()];
    await done;
    await settled();
    const after = [x(), y(), timeline.traveling()];
    console.log(`F3 viewing step 0: during the action ${JSON.stringify(during)}, after it settles ${JSON.stringify(after)}`);
    // goto's raw write to x joins the action's transition, and the rest of goto (y, the flag)
    // was written in the same frame, so the whole goto waits for the action
    expect(during).toEqual([0, "b", false]);
    expect(after).toEqual([0, "a", true]);
    timeline.resume();
    await settled();
    expect([x(), y()]).toEqual([5, "b"]);
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { y: "b" } },
      { id: 2, changes: { x: 5 } }
    ]);
  });

  test("F4 the published steps are held when a computation reads them with held state", async () => {
    const timeline = createTimeline();
    const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
    const panel: unknown[] = [];
    const dispose = createRoot(dispose => {
      // e.g. a devtools panel showing the app state next to the timeline
      createEffect(
        () => [x(), timeline.steps().length],
        v => {
          panel.push(v);
        }
      );
      return dispose;
    });
    flush();
    const done = action(function* () {
      setX(5);
      yield delay(20);
    })();
    await settled();
    const inFlight = timeline.steps().length;
    await done;
    await settled();
    console.log(`F4 steps().length in flight: ${inFlight}; panel saw ${JSON.stringify(panel)}`);
    // reading steps() next to x entangles the timeline's own signal with the action
    expect(inFlight).toBe(0);
    expect(panel).toEqual([
      [0, 0],
      [5, 1]
    ]);
    dispose();
  });

  test("F6 an unrelated write during an action gets its own step, as does the action's (early)", async () => {
    const timeline = createTimeline();
    const [x, setX] = createRecordedSignal(0, { name: "x", timeline });
    const [y, setY] = createRecordedSignal(0, { name: "y", timeline });
    const done = action(function* () {
      setX(5);
      yield delay(20);
    })();
    await settled();
    setY(1); // a timer or handler, not part of the action
    await settled();
    expect([x(), y()]).toEqual([0, 1]);
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { x: 5 } },
      { id: 2, changes: { y: 1 } }
    ]);
    await done;
    await settled();
    expect(x()).toBe(5);
    expect(timeline.steps()).toHaveLength(2); // the order says x landed before y; it landed after
  });

  test("F7 a recorded sync memo lands in the same step as the write that changed it", async () => {
    const timeline = createTimeline();
    const [n, setN] = createRecordedSignal(1, { name: "n", timeline });
    let double!: () => number;
    const dispose = createRoot(dispose => {
      double = createRecordedMemo(() => n() * 2, { name: "double", timeline });
      createEffect(double, () => {});
      return dispose;
    });
    flush();
    setN(2);
    await settled();
    expect(timeline.steps()).toEqual([{ id: 1, changes: { n: 2, double: 4 } }]);
    timeline.goto(0);
    await settled();
    expect([n(), double()]).toEqual([1, 2]);
    timeline.resume();
    await settled();
    expect([n(), double()]).toEqual([2, 4]);
    expect(timeline.steps()).toHaveLength(1);
    dispose();
  });

  test("F5 a recorded query and its async result land in separate steps", async () => {
    const timeline = createTimeline();
    const [q, setQ] = createRecordedSignal("a", { name: "q", timeline });
    let result!: () => string;
    const dispose = createRoot(dispose => {
      result = createRecordedMemo(
        () => {
          const query = q();
          return delay(10).then(() => query.toUpperCase());
        },
        { name: "result", timeline }
      );
      createEffect(result, () => {});
      return dispose;
    });
    await waitFor(() => result() === "A");
    setQ("b");
    await settled();
    const whileLoading = [q(), result()]; // Solid commits q at once and keeps the old result
    await waitFor(() => result() === "B");
    await settled();
    expect(whileLoading).toEqual(["b", "A"]);
    expect(timeline.steps()).toEqual([
      { id: 1, changes: { q: "b" } },
      { id: 2, changes: { result: "B" } }
    ]);
    timeline.goto(1);
    await settled();
    expect([q(), result()]).toEqual(["b", "A"]); // the loading state, as it was committed
    timeline.resume();
    await settled();
    dispose();
  });
});
