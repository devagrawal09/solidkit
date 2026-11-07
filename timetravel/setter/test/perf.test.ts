// Perf protocol from SPEC.md. Logs numbers only (no assertions on time).
// "Settling" a write here means flush() plus one awaited microtask, which is when the setter
// variant closes its step. Timer-based settling (the spec's settled()) is measured separately
// for a smaller run, because it mostly measures setTimeout.
import { test } from "vitest";
import { createEffect, createRoot, createSignal, createStore, flush, reconcile, snapshot } from "solid-js";
import { createRecordedSignal, createRecordedStore, createTimeline } from "../src/index.ts";
import { settled } from "./helpers.ts";

const now = () => performance.now();
const tick = async () => {
  flush();
  await Promise.resolve();
  flush();
};
const rows = (n: number) => ({ rows: Array.from({ length: n }, (_, i) => ({ id: i, text: `row ${i}` })) });
const results: string[] = [];
const report = (line: string) => {
  results.push(line);
  console.log(`PERF ${line}`);
};
const ms = (t: number) => `${t.toFixed(2)} ms`;

async function writes(n: number, recorded: boolean, settle: () => Promise<void>) {
  const timeline = createTimeline();
  const [, set] = recorded
    ? createRecordedSignal(0, { name: "n", timeline })
    : createSignal(0);
  const t0 = now();
  for (let i = 1; i <= n; i++) {
    set(i);
    await settle();
  }
  await settled();
  return { total: now() - t0, steps: timeline.steps().length };
}

async function wide(n: number, recorded: boolean) {
  const timeline = createTimeline();
  const t0 = now();
  const setters = Array.from({ length: n }, (_, i) =>
    recorded ? createRecordedSignal(0, { name: `s${i}`, timeline })[1] : createSignal(0)[1]
  );
  const created = now() - t0;
  const t1 = now();
  for (const set of setters) set(1);
  await tick();
  const total = now() - t1;
  await settled();
  return { created, total, changes: Object.keys(timeline.steps()[0]?.changes ?? {}).length };
}

async function store(n: number, steps: number, recorded: boolean) {
  const timeline = createTimeline();
  const [state, setState] = recorded
    ? createRecordedStore(rows(n), { name: "rows", timeline })
    : createStore(rows(n));
  let reruns = 0;
  const dispose = createRoot(dispose => {
    for (let i = 0; i < n; i++)
      createEffect(
        () => state.rows[i].text,
        () => {
          reruns++;
        }
      );
    return dispose;
  });
  flush();
  let afterStep1: unknown;
  const t0 = now();
  for (let s = 1; s <= steps; s++) {
    setState(d => {
      d.rows[(s * 7) % n].text = `step ${s}`;
    });
    await tick();
    if (s === 1 && !recorded) afterStep1 = snapshot(state);
  }
  const record = now() - t0;
  const latest = recorded ? undefined : snapshot(state);
  await settled();
  const restore = (v: unknown) =>
    setState(d => {
      reconcile(v as ReturnType<typeof rows>, null)(d);
    });
  reruns = 0;
  const t1 = now();
  if (recorded) timeline.goto(1);
  else restore(afterStep1);
  flush();
  const goto = now() - t1;
  const gotoReruns = reruns;
  await settled();
  const t2 = now();
  if (recorded) timeline.resume();
  else restore(latest);
  flush();
  const resume = now() - t2;
  await settled();
  const ok = state.rows[7].text === "step 1" && timeline.steps().length === (recorded ? steps : 0);
  dispose();
  return { record, goto, resume, gotoReruns, ok };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test("perf", { timeout: 180_000 }, async () => {
  // warm up both paths
  for (const recorded of [false, true]) {
    await writes(1_000, recorded, tick);
    await wide(100, recorded);
    await store(100, 20, recorded);
  }
  type Row = { w: number; t: number; wide: number; created: number; rec: number; goto: number; resume: number; reruns: number; ok: boolean; steps: number; changes: number };
  const runs: Record<"plain" | "setter", Row[]> = { plain: [], setter: [] };
  for (let round = 0; round < 5; round++) {
    for (const recorded of [false, true]) {
      const a = await writes(10_000, recorded, tick);
      const t = round < 3 ? await writes(1_000, recorded, () => settled(1)) : { total: NaN, steps: 0 };
      const w = await wide(1_000, recorded);
      const s = await store(1_000, 200, recorded);
      runs[recorded ? "setter" : "plain"].push({
        w: a.total, t: t.total, wide: w.total, created: w.created, rec: s.record, goto: s.goto,
        resume: s.resume, reruns: s.gotoReruns, ok: s.ok, steps: a.steps, changes: w.changes
      });
    }
  }
  for (const label of ["plain", "setter"] as const) {
    const rs = runs[label];
    const m = (k: keyof Row) => median(rs.map(r => r[k] as number).filter(v => !Number.isNaN(v)));
    report(`${label} 1. 10,000 writes, microtask settle: ${ms(m("w"))} (${((m("w") / 10_000) * 1000).toFixed(2)} µs/write; steps ${rs[0].steps})`);
    report(`${label} 1b. 1,000 writes, settled(1) timer settle: ${ms(m("t"))} (${m("t").toFixed(0)} µs/write)`);
    report(`${label} 2. 1,000 signals written in one tick: ${ms(m("wide"))} to settle and record (creating them ${ms(m("created"))}; changes in the step ${rs[0].changes})`);
    report(`${label} 3. store of 1,000 rows, 200 one-row steps: record ${ms(m("rec"))} (${((m("rec") / 200) * 1000).toFixed(0)} µs/step); goto(1) ${ms(m("goto"))} (${rs[0].reruns} row effects re-ran); resume() ${ms(m("resume"))}; ok=${rs.every(r => r.ok)}`);
  }
  console.log(`\nmedians of 5 runs (3 for 1b)\n${results.join("\n")}`);
});
