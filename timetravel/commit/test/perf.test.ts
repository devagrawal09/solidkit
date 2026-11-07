// Perf protocol from SPEC.md. Logs numbers; no assertions on timing.
// "Settle" per write is flush() + one microtask turn (the step publisher) + flush(); the
// spec's timer-based settled() is also run for 1,000 writes as a cross-check.
import { afterEach, expect, test } from "vitest";
import { createEffect, createSignal, createStore, deep, flush, reconcile, snapshot } from "solid-js";
import { createRecordedSignal, createRecordedStore, createTimeline } from "../src/index.ts";
import { disposeAll, owned, settled } from "./helpers.ts";

afterEach(disposeAll);

async function settle() {
  flush();
  await Promise.resolve();
  flush();
}
const ms = (t0: number) => performance.now() - t0;
const f = (n: number) => n.toFixed(1);
const report: Record<string, string> = {};
function log(key: string, value: string) {
  report[key] = value;
  console.log(`${key}: ${value}`);
}

/** n writes to one signal, settling after each; returns total ms. */
async function writes(set: (v: number) => unknown, n: number, wait: () => Promise<void> = settle) {
  const t0 = performance.now();
  for (let i = 1; i <= n; i++) {
    set(i);
    await wait();
  }
  return ms(t0);
}

test("perf 1: 10,000 writes to one recorded signal, settling after each", { timeout: 120_000 }, async () => {
  const N = 10_000;
  const recordedSignal = () => {
    const tl = createTimeline();
    return { tl, set: owned(() => createRecordedSignal(0, { name: "n", timeline: tl }))[1] };
  };
  const plainWithEffect = () =>
    owned(() => {
      const [get, set] = createSignal(0);
      createEffect(get, () => {});
      return set;
    });
  // warm-up
  await writes(recordedSignal().set, 1000);
  await writes(plainWithEffect(), 1000);
  await writes(createSignal(0)[1], 1000);
  await settled();

  const rec = recordedSignal();
  await settled();
  const recorded = await writes(rec.set, N);
  await settled();
  expect(rec.tl.steps()).toHaveLength(N);
  const effect = await writes(plainWithEffect(), N);
  const bare = await writes(createSignal(0)[1], N);
  log("perf1 recorded signal", `${f(recorded)} ms total, ${f((recorded / N) * 1000)} µs/write`);
  log("perf1 plain signal + 1 effect", `${f(effect)} ms total, ${f((effect / N) * 1000)} µs/write`);
  log("perf1 plain signal, no reader", `${f(bare)} ms total, ${f((bare / N) * 1000)} µs/write`);

  // cross-check with the spec's timer-based settle (1 round per write), 1,000 writes
  const one = () => settled(1);
  const recT = await writes(recordedSignal().set, 1000, one);
  const effT = await writes(plainWithEffect(), 1000, one);
  log("perf1 timer-settle x1000 recorded vs plain+effect", `${f(recT)} ms vs ${f(effT)} ms`);
});

test("perf 2: 1,000 recorded signals written in one tick", { timeout: 60_000 }, async () => {
  const N = 1000;
  async function recorded(n: number) {
    const tl = createTimeline();
    let t0 = performance.now();
    const setters = owned(() => Array.from({ length: n }, (_, i) => createRecordedSignal(0, { name: `s${i}`, timeline: tl })[1]));
    await settle();
    const setup = ms(t0);
    await settled();
    t0 = performance.now();
    for (const set of setters) set(1);
    await settle();
    const write = ms(t0);
    await settled();
    return { tl, setup, write };
  }
  async function plain(n: number, withEffects: boolean) {
    let t0 = performance.now();
    const setters = owned(() =>
      Array.from({ length: n }, () => {
        const [get, set] = createSignal(0);
        if (withEffects) createEffect(get, () => {});
        return set;
      })
    );
    await settle();
    const setup = ms(t0);
    await settled();
    t0 = performance.now();
    for (const set of setters) set(1);
    await settle();
    return { setup, write: ms(t0) };
  }
  await recorded(200); // warm-up
  await plain(200, true);
  await plain(200, false);

  const rec = await recorded(N);
  expect(rec.tl.steps()).toHaveLength(1);
  expect(Object.keys(rec.tl.steps()[0].changes)).toHaveLength(N);
  const eff = await plain(N, true);
  const bare = await plain(N, false);
  log("perf2 recorded: write+settle+record", `${f(rec.write)} ms (setup ${f(rec.setup)} ms)`);
  log("perf2 plain + 1 effect each", `${f(eff.write)} ms (setup ${f(eff.setup)} ms)`);
  log("perf2 plain, no readers", `${f(bare.write)} ms (setup ${f(bare.setup)} ms)`);
});

test("perf 3: recorded store, 1,000 rows, 200 one-row steps; goto(1); resume()", { timeout: 60_000 }, async () => {
  const ROWS = 1000;
  const STEPS = 200;
  const data = () => ({ rows: Array.from({ length: ROWS }, (_, i) => ({ id: i, text: `row ${i}`, done: false })) });
  type Data = ReturnType<typeof data>;
  const edit = (i: number) => (d: Data) => {
    d.rows[(i * 5) % ROWS].text = `edit ${i}`;
  };

  async function recorded(steps: number) {
    const tl = createTimeline();
    const [state, setState] = owned(() => createRecordedStore(data(), { name: "rows", timeline: tl }));
    await settled();
    let t0 = performance.now();
    for (let i = 0; i < steps; i++) {
      setState(edit(i));
      await settle();
    }
    const record = ms(t0);
    await settled();
    t0 = performance.now();
    tl.goto(1);
    flush();
    const goto = ms(t0);
    const atStep1 = [state.rows[0].text, state.rows[5].text];
    await settled();
    t0 = performance.now();
    tl.resume();
    flush();
    const resume = ms(t0);
    await settled();
    return { tl, state, record, goto, resume, atStep1 };
  }
  async function plain(steps: number, deepEffect: boolean) {
    const [state, setState] = owned(() => {
      const pair = createStore(data());
      if (deepEffect) createEffect(() => deep(pair[0]), () => {});
      return pair;
    });
    await settled();
    let t0 = performance.now();
    let first: unknown;
    for (let i = 0; i < steps; i++) {
      setState(edit(i));
      await settle();
      if (i === 0) first = snapshot(state);
    }
    const record = ms(t0);
    const last = snapshot(state);
    await settled();
    t0 = performance.now();
    setState(d => {
      reconcile(first as Data, null)(d);
    });
    flush();
    const goto = ms(t0);
    await settled();
    t0 = performance.now();
    setState(d => {
      reconcile(last as Data, null)(d);
    });
    flush();
    const resume = ms(t0);
    return { record, goto, resume };
  }
  await recorded(50); // warm-up
  await plain(50, true);
  await plain(50, false);

  const rec = await recorded(STEPS);
  expect(rec.tl.steps()).toHaveLength(STEPS);
  expect(rec.atStep1).toEqual(["edit 0", "row 5"]);
  expect(rec.state.rows[995].text).toBe("edit 199");
  const withDeep = await plain(STEPS, true);
  const bare = await plain(STEPS, false);
  log("perf3 recorded store", `record ${f(rec.record)} ms, goto(1) ${f(rec.goto)} ms, resume ${f(rec.resume)} ms`);
  log("perf3 plain store + deep() effect", `writes ${f(withDeep.record)} ms, reconcile-to-step-1 ${f(withDeep.goto)} ms, reconcile-to-latest ${f(withDeep.resume)} ms`);
  log("perf3 plain store, no readers", `writes ${f(bare.record)} ms, reconcile-to-step-1 ${f(bare.goto)} ms, reconcile-to-latest ${f(bare.resume)} ms`);
  console.log("PERF SUMMARY", JSON.stringify(report));
});
