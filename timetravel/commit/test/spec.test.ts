import { afterEach, expect, test } from "vitest";
import { action, createEffect, createMemo } from "solid-js";
import { createRecordedSignal, createRecordedStore, createTimeline } from "../src/index.ts";
import { mountCounter } from "./components.tsx";
import {
  container,
  deferred,
  disposeAll,
  landed,
  onDispose,
  owned,
  recordedResults,
  searchSetup,
  settled,
  threeSteps
} from "./helpers.ts";

afterEach(disposeAll);

test("S1 one step per flush", async () => {
  const tl = createTimeline();
  const [, setA] = owned(() => createRecordedSignal(1, { name: "a", timeline: tl }));
  const [, setB] = owned(() => createRecordedSignal("x", { name: "b", timeline: tl }));
  await settled();
  expect(tl.steps()).toEqual([]);

  setA(2);
  setB("y");
  await settled();
  expect(tl.steps()).toEqual([{ id: 1, changes: { a: 2, b: "y" } }]);

  setA(3);
  await settled();
  expect(tl.steps()).toEqual([
    { id: 1, changes: { a: 2, b: "y" } },
    { id: 2, changes: { a: 3 } }
  ]);
});

test("S2 updater and equality", async () => {
  const tl = createTimeline();
  const [n, setN] = owned(() => createRecordedSignal(1, { name: "n", timeline: tl }));
  await settled();

  expect(setN(c => c + 1)).toBe(2);
  await settled();
  expect(tl.steps()).toEqual([{ id: 1, changes: { n: 2 } }]);

  setN(2);
  await settled();
  expect(n()).toBe(2);
  expect(tl.steps()).toEqual([{ id: 1, changes: { n: 2 } }]);
});

test("S3 goto and resume add no steps; memos and DOM follow", async () => {
  const tl = createTimeline();
  const el = container();
  const { count, setCount, doubled } = owned(() => {
    const [count, setCount] = createRecordedSignal(1, { name: "count", timeline: tl });
    const doubled = createMemo(() => count() * 2);
    return { count, setCount, doubled };
  });
  onDispose(mountCounter(el, count, doubled));
  await settled();
  for (const v of [2, 3, 4]) {
    setCount(v);
    await settled();
  }
  expect(tl.steps()).toHaveLength(3);
  expect(el.textContent).toBe("4/8");

  tl.goto(1);
  await settled();
  expect(count()).toBe(2);
  expect(doubled()).toBe(4);
  expect(el.textContent).toBe("2/4");
  expect(tl.steps()).toHaveLength(3);

  tl.resume();
  await settled();
  expect(count()).toBe(4);
  expect(doubled()).toBe(8);
  expect(el.textContent).toBe("4/8");
  expect(tl.steps()).toHaveLength(3);
});

test("S4 stores restore fine-grained", async () => {
  const tl = createTimeline();
  let row1Runs = 0;
  const [state, setState] = owned(() => {
    const store = createRecordedStore(
      { rows: [{ id: 1, text: "a" }, { id: 2, text: "b" }] },
      { name: "list", timeline: tl }
    );
    createEffect(
      () => store[0].rows[0].text,
      () => {
        row1Runs++;
      }
    );
    return store;
  });
  await settled();
  const row1 = state.rows[0];
  setState(d => {
    d.rows[0].text = "a1";
  });
  await settled();
  setState(d => {
    d.rows[1].text = "b1";
  });
  await settled();
  expect(tl.steps()).toEqual([
    { id: 1, changes: { list: { rows: [{ id: 1, text: "a1" }, { id: 2, text: "b" }] } } },
    { id: 2, changes: { list: { rows: [{ id: 1, text: "a1" }, { id: 2, text: "b1" }] } } }
  ]);
  const runs = row1Runs;
  expect(runs).toBe(2); // the effect is live: initial run + step 1

  tl.goto(1);
  await settled();
  expect(state.rows[1].text).toBe("b");
  expect(state.rows[0].text).toBe("a1");
  expect(row1Runs).toBe(runs);
  expect(state.rows[0]).toBe(row1);

  tl.resume();
  await settled();
  expect(state.rows[1].text).toBe("b1");
  expect(row1Runs).toBe(runs);
  expect(state.rows[0]).toBe(row1);
  expect(tl.steps()).toHaveLength(2);
});

test("S5 writes during travel don't touch the past", async () => {
  const tl = createTimeline();
  const [n, setN] = await threeSteps(tl);
  tl.goto(1);
  await settled();
  expect(n()).toBe(2);

  setTimeout(() => setN(10), 0); // as a timer would
  await settled();
  expect(n()).toBe(2);
  expect(tl.steps()).toHaveLength(3);

  tl.resume();
  await settled();
  expect(n()).toBe(10);
  expect(tl.steps().map(s => s.changes.n)).toEqual([2, 3, 4, 10]);
  expect(tl.steps()[3]).toEqual({ id: 4, changes: { n: 10 } });
});

test("S6 writes held by an action are recorded when they commit", async () => {
  const tl = createTimeline();
  const [n, setN] = owned(() => createRecordedSignal(1, { name: "n", timeline: tl }));
  await settled();
  const delay = deferred(); // stands in for delay(20); the test resolves it
  const save = action(function* () {
    setN(5);
    yield delay.promise;
  });

  save();
  await settled();
  expect(n()).toBe(1);
  expect(tl.steps()).toEqual([]);

  delay.resolve();
  await settled();
  expect(n()).toBe(5);
  expect(tl.steps()).toEqual([{ id: 1, changes: { n: 5 } }]);
});

test("S7 one step per action, final value only", async () => {
  const tl = createTimeline();
  const [n, setN] = owned(() => createRecordedSignal(1, { name: "n", timeline: tl }));
  await settled();
  const delay = deferred();
  const save = action(function* () {
    setN(5);
    yield delay.promise;
    setN(6);
  });

  save();
  await settled();
  expect(tl.steps()).toEqual([]);
  delay.resolve();
  await settled();
  expect(n()).toBe(6);
  expect(tl.steps()).toEqual([{ id: 1, changes: { n: 6 } }]);
});

// Expected to fail: with nothing rendering the memo, Solid commits the query write at once
// and the result one fetch later, so per-flush recording makes them two steps and step 1
// has no result. See README and the "S8 rendered" extra test.
test.fails("S8 recorded async memo", async () => {
  const tl = createTimeline();
  const { calls, q, setQ, result } = searchSetup(tl);
  await landed();
  setQ("b");
  await landed();
  setQ("c");
  await landed();
  console.log("S8 steps (no renderer):", JSON.stringify(tl.steps()));
  expect(recordedResults(tl)).toEqual(["R(b)", "R(c)"]);

  const fetches = calls.length;
  tl.goto(1);
  await settled();
  expect(q()).toBe("b");
  expect(result()).toBe("R(b)"); // step 1's result
  expect(calls.length).toBe(fetches);

  tl.resume();
  await landed();
  expect(result()).toBe("R(c)");
  console.log(`S8 refetches on resume: ${calls.length - fetches}`);
  setQ("d");
  await landed();
  expect(result()).toBe("R(d)");
  expect(recordedResults(tl)).toEqual(["R(b)", "R(c)", "R(d)"]);
});

test("S9 a result landing during travel", async () => {
  const tl = createTimeline();
  const [n, setN] = await threeSteps(tl);
  const server = deferred<number>();
  const save = action(function* () {
    const value = (yield server.promise) as number;
    setN(value);
  });
  save();
  await settled();

  tl.goto(1);
  await settled();
  expect(n()).toBe(2);

  server.resolve(99);
  await settled();
  expect(n()).toBe(2);
  expect(tl.steps()).toHaveLength(3);

  tl.resume();
  await settled();
  expect(n()).toBe(99);
  expect(tl.steps()).toHaveLength(4);
  expect(tl.steps()[3]).toEqual({ id: 4, changes: { n: 99 } });
});

test("S10 branch", async () => {
  const tl = createTimeline();
  const [n, setN] = await threeSteps(tl);
  tl.goto(1);
  await settled();
  tl.branch();
  await settled();
  expect(tl.steps()).toEqual([{ id: 1, changes: { n: 2 } }]);
  expect(n()).toBe(2);
  expect(tl.traveling()).toBe(false);

  setN(7);
  await settled();
  expect(tl.steps()).toEqual([
    { id: 1, changes: { n: 2 } },
    { id: 2, changes: { n: 7 } }
  ]);
});

test("S11 traveling flag and effect re-runs", async () => {
  const tl = createTimeline();
  let runs = 0;
  const seen: boolean[] = [];
  const { setA, setB } = owned(() => {
    const [a, setA] = createRecordedSignal(1, { name: "a", timeline: tl });
    const [b, setB] = createRecordedSignal(10, { name: "b", timeline: tl });
    createEffect(
      () => [a(), b()],
      () => {
        runs++;
      }
    );
    createEffect(
      () => tl.traveling(),
      t => {
        seen.push(t);
      }
    );
    return { setA, setB };
  });
  await settled();
  setA(2);
  setB(20);
  await settled();
  setA(3);
  await settled();
  expect(tl.traveling()).toBe(false);

  const before = runs;
  tl.goto(1);
  await settled();
  expect(tl.traveling()).toBe(true);
  const onGoto = runs - before;
  tl.resume();
  await settled();
  expect(tl.traveling()).toBe(false);
  const total = runs - before;
  console.log(`S11 plain user effect over the recorded sources re-ran ${total}x across goto + resume (goto ${onGoto}, resume ${total - onGoto})`);
  expect(seen).toEqual([false, true, false]);
  expect(tl.steps()).toHaveLength(2);
});
