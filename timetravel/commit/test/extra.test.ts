// Findings beyond S1-S11. A test marked \`test.fails\` asserts the desired behavior and is a
// known failure of this design; each logs what actually happened.
import { afterEach, expect, test } from "vitest";
import { action, createEffect, createStore, deep, flush, snapshot } from "solid-js";
import { createRecordedMemo, createRecordedSignal, createRecordedStore, createTimeline } from "../src/index.ts";
import { mountResult } from "./components.tsx";
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

test("E1 S8 with a rendered reader: a query change and its result share a step", async () => {
  const tl = createTimeline();
  const { calls, q, setQ, result } = searchSetup(tl);
  const el = container();
  onDispose(mountResult(el, result));
  await landed();
  expect(el.textContent).toBe("R(a)");
  setQ("b");
  await landed();
  setQ("c");
  await landed();
  expect(tl.steps()).toEqual([
    { id: 1, changes: { q: "b", result: "R(b)" } },
    { id: 2, changes: { q: "c", result: "R(c)" } }
  ]);

  const fetches = calls.length;
  tl.goto(1);
  await settled();
  expect([q(), result(), el.textContent]).toEqual(["b", "R(b)", "R(b)"]);
  tl.goto(0);
  await settled();
  expect([q(), result(), el.textContent]).toEqual(["a", "R(a)", "R(a)"]);
  expect(calls.length).toBe(fetches);

  tl.resume();
  await settled();
  expect(tl.traveling()).toBe(false); // the refetch below does not hold the resume
  expect([q(), result(), el.textContent]).toEqual(["c", "R(c)", "R(c)"]);
  await landed();
  console.log(`E1 (rendered) fetches during travel: 0, refetches on resume: ${calls.length - fetches}`);
  expect(tl.steps()).toHaveLength(2);

  setQ("d");
  await landed();
  expect(el.textContent).toBe("R(d)");
  expect(tl.steps()[2]).toEqual({ id: 3, changes: { q: "d", result: "R(d)" } });
});

test("E2 S8 without a renderer: travel never fetches, resume refetches once and goes live", async () => {
  const tl = createTimeline();
  const { calls, q, setQ, result } = searchSetup(tl);
  await landed();
  setQ("b");
  await landed();
  setQ("c");
  await landed();
  expect(tl.steps()).toEqual([
    { id: 1, changes: { q: "b" } },
    { id: 2, changes: { result: "R(b)" } },
    { id: 3, changes: { q: "c" } },
    { id: 4, changes: { result: "R(c)" } }
  ]);
  const fetches = calls.length;
  const views: unknown[] = [];
  for (const id of [1, 2, 3, 0]) {
    tl.goto(id);
    await settled();
    views.push([id, q(), result()]);
  }
  expect(views).toEqual([
    [1, "b", "R(a)"], // a state the app really showed: new query, stale result
    [2, "b", "R(b)"],
    [3, "c", "R(b)"],
    [0, "a", "R(a)"]
  ]);
  expect(calls.length).toBe(fetches);

  tl.resume();
  await settled();
  expect(tl.traveling()).toBe(false);
  expect([q(), result()]).toEqual(["c", "R(c)"]); // latest record served while refetching
  await landed();
  console.log(`E2 (no renderer) refetches on resume: ${calls.length - fetches}`);
  expect(tl.steps()).toHaveLength(4);
  setQ("d");
  await landed();
  expect(result()).toBe("R(d)");
  expect(recordedResults(tl)).toEqual(["R(b)", "R(c)", "R(d)"]);
});

// Steps are closed by a microtask, so flushes that run in one synchronous tick merge.
test.fails("E3 two synchronous flushes in one tick make two steps", async () => {
  const tl = createTimeline();
  const [, setA] = owned(() => createRecordedSignal(1, { name: "a", timeline: tl }));
  await settled();
  setA(2);
  flush();
  setA(3);
  flush();
  await settled();
  console.log("E3 steps:", JSON.stringify(tl.steps()));
  expect(tl.steps()).toEqual([
    { id: 1, changes: { a: 2 } },
    { id: 2, changes: { a: 3 } }
  ]);
});

test("E4 a write made by an effect in response joins the same step", async () => {
  const tl = createTimeline();
  const { setA } = owned(() => {
    const [a, setA] = createRecordedSignal(1, { name: "a", timeline: tl });
    const [, setB] = createRecordedSignal(0, { name: "b", timeline: tl });
    createEffect(a, v => {
      setB(v * 100);
    });
    return { setA };
  });
  await settled();
  expect(tl.steps()).toEqual([{ id: 1, changes: { b: 100 } }]); // the effect's first run is a write too
  setA(2);
  await settled();
  expect(tl.steps()[1]).toEqual({ id: 2, changes: { a: 2, b: 200 } });
});

// An action holding a write to a recorded signal also holds goto's write to it.
test.fails("E5 goto while an action holds a recorded write", async () => {
  const tl = createTimeline();
  const [n, setN] = await threeSteps(tl);
  const delay = deferred();
  const save = action(function* () {
    setN(5);
    yield delay.promise;
  });
  save();
  await settled();
  const seen: unknown[] = [["in flight", n()]];
  tl.goto(1);
  await settled();
  seen.push(["after goto(1)", n()]);
  delay.resolve();
  await settled();
  seen.push(["action landed during travel", n()]);
  tl.resume();
  await settled();
  seen.push(["after resume", n()], ["steps", tl.steps().map(s => s.changes.n)]);
  console.log("E5", JSON.stringify(seen));
  expect(seen).toEqual([
    ["in flight", 4],
    ["after goto(1)", 2],
    ["action landed during travel", 2],
    ["after resume", 5],
    ["steps", [2, 3, 4, 5]]
  ]);
});

test("E6 a write in the same tick before goto survives resume", async () => {
  const tl = createTimeline();
  const [n, setN] = await threeSteps(tl);
  const [state, setState] = owned(() => createRecordedStore({ x: 1 }, { name: "s", timeline: tl }));
  await settled();
  setN(9);
  setState(d => {
    d.x = 9;
  });
  tl.goto(1);
  await settled();
  expect([n(), state.x]).toEqual([2, 1]);
  tl.resume();
  await settled();
  expect([n(), state.x]).toEqual([9, 9]);
  expect(tl.steps()[3]).toEqual({ id: 4, changes: { n: 9, s: { x: 9 } } });
});

test("E7 updaters queued during travel apply to the latest value", async () => {
  const tl = createTimeline();
  const [n, setN] = await threeSteps(tl);
  const [state, setState] = owned(() => createRecordedStore({ count: 1 }, { name: "s", timeline: tl }));
  await settled();
  setState(d => {
    d.count = 7;
  });
  await settled(); // step 4: s.count = 7
  tl.goto(1);
  await settled();
  expect(setN(c => c + 1)).toBe(5); // the value it will have after resume
  setState(d => {
    d.count++;
  });
  await settled();
  expect([n(), state.count]).toEqual([2, 1]);
  tl.resume();
  await settled();
  expect([n(), state.count]).toEqual([5, 8]);
  expect(tl.steps()[4]).toEqual({ id: 5, changes: { n: 5, s: { count: 8 } } });
});

test("E8 stores: restore removes later keys and rows; equal writes record nothing", async () => {
  const tl = createTimeline();
  type S = { rows: { id: number; text: string }[]; extra?: string };
  const [state, setState] = owned(() => createRecordedStore<S>({ rows: [{ id: 1, text: "a" }] }, { name: "s", timeline: tl }));
  await settled();
  setState(d => {
    d.rows.push({ id: 2, text: "b" });
    d.extra = "x";
  });
  await settled();
  setState(d => {
    d.rows[0].text = "a";
  });
  await settled();
  expect(tl.steps()).toHaveLength(1);

  tl.goto(0);
  await settled();
  expect(snapshot(state)).toEqual({ rows: [{ id: 1, text: "a" }] });
  expect("extra" in state).toBe(false);
  tl.resume();
  await settled();
  const head = { rows: [{ id: 1, text: "a" }, { id: 2, text: "b" }], extra: "x" };
  expect(snapshot(state)).toEqual(head);
  setState(d => {
    d.rows[1].text = "b2";
  });
  await settled();
  expect(tl.steps()[0].changes.s).toEqual(head); // restores never mutate the history
  expect(tl.steps()).toHaveLength(2);
});

test("E9 branch applies writes queued during travel on top of the viewed state", async () => {
  const tl = createTimeline();
  const [n, setN] = await threeSteps(tl);
  tl.goto(1);
  setN(c => c * 10);
  tl.branch();
  await settled();
  expect(n()).toBe(20);
  expect(tl.steps()).toEqual([
    { id: 1, changes: { n: 2 } },
    { id: 2, changes: { n: 20 } }
  ]);
});

test("E10 a recorded sync memo: goto serves the record, resume re-runs fn once", async () => {
  const tl = createTimeline();
  let runs = 0;
  const { setN, doubled } = owned(() => {
    const [n, setN] = createRecordedSignal(1, { name: "n", timeline: tl });
    const doubled = createRecordedMemo(
      () => {
        runs++;
        return n() * 2;
      },
      { name: "doubled", timeline: tl }
    );
    return { setN, doubled };
  });
  await settled();
  setN(2);
  await settled();
  setN(3);
  await settled();
  expect(tl.steps()).toEqual([
    { id: 1, changes: { n: 2, doubled: 4 } },
    { id: 2, changes: { n: 3, doubled: 6 } }
  ]);
  const before = runs;
  tl.goto(1);
  await settled();
  expect(doubled()).toBe(4);
  tl.goto(0);
  await settled();
  expect(doubled()).toBe(2);
  expect(runs).toBe(before);
  tl.resume();
  await settled();
  expect(doubled()).toBe(6);
  console.log(`E10 sync recorded memo: fn runs during travel 0, on resume ${runs - before}`);
  expect(tl.steps()).toHaveLength(2);
});

test("E11 a store write held by an action is recorded once, when it commits", async () => {
  const tl = createTimeline();
  const [state, setState] = owned(() => createRecordedStore({ items: ["a"] }, { name: "list", timeline: tl }));
  await settled();
  const delay = deferred();
  const add = action(function* () {
    setState(d => {
      d.items.push("b");
    });
    yield delay.promise;
    setState(d => {
      d.items.push("c");
    });
  });
  add();
  await settled();
  expect(tl.steps()).toEqual([]);
  expect(state.items.length).toBe(1);
  delay.resolve();
  await settled();
  expect(tl.steps()).toEqual([{ id: 1, changes: { list: { items: ["a", "b", "c"] } } }]);
});

// Solid finding behind E11's fix: deep() in an effect's compute misses an action's writes
// made before a yield when the action lands; snapshot() in the apply phase sees them.
test.fails("E12 (Solid) deep() in an effect compute sees an action's writes when it lands", async () => {
  const [state, setState] = owned(() => createStore({ rows: [{ t: "x" }, { t: "y" }] }));
  const seen: unknown[] = [];
  owned(() =>
    createEffect(
      () => deep(state),
      value => {
        seen.push({ compute: value, apply: snapshot(state) });
      }
    )
  );
  await settled();
  const delay = deferred();
  const edit = action(function* () {
    setState(d => {
      d.rows[0].t = "x1";
    });
    yield delay.promise;
    setState(d => {
      d.rows[1].t = "y1";
    });
  });
  edit();
  await settled();
  delay.resolve();
  await settled();
  console.log("E12", JSON.stringify(seen.at(-1)));
  const landedRows = { rows: [{ t: "x1" }, { t: "y1" }] };
  expect(seen.at(-1)).toEqual({ compute: landedRows, apply: landedRows });
});
