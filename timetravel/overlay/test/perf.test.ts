// Perf protocol (SPEC.md): numbers are logged, nothing is asserted.
// "Settle" between writes is a synchronous flush(): the recorder effects run
// inside it; the steps signal publishes on the next microtask.
// Each scenario runs twice in a fresh root; the second (warm) run is reported.
import { test } from "vitest";
import { createEffect, createRoot, createSignal, createStore, flush, reconcile, snapshot } from "solid-js";
import { createRecordedSignal, createRecordedStore, createTimeline } from "../src/index.ts";

const now = () => performance.now();
const microtask = () => new Promise<void>(r => queueMicrotask(r));
const ms = (n: number) => n.toFixed(2) + " ms";
const results: string[] = [];
const log = (line: string) => {
  results.push(line);
  console.log(line);
};

async function twice<T>(run: () => Promise<T>): Promise<T> {
  await run();
  return run();
}

const WRITES = 10_000;
const SIGNALS = 1_000;
const ROWS = 1_000;
const STEPS = 200;

test("perf 1: 10,000 writes to one signal, settling after each", async () => {
  for (const reader of [false, true]) {
    const plain = await twice(async () => {
      const [get, set, dispose] = createRoot(dispose => {
        const [get, set] = createSignal(0);
        if (reader) createEffect(get, () => {});
        return [get, set, dispose] as const;
      });
      flush();
      const t0 = now();
      for (let i = 1; i <= WRITES; i++) {
        set(i);
        flush();
      }
      const t = now() - t0;
      dispose();
      return t;
    });
    const recorded = await twice(async () => {
      const [timeline, set, dispose] = createRoot(dispose => {
        const timeline = createTimeline();
        const [get, set] = createRecordedSignal(0, { name: "x", timeline });
        if (reader) createEffect(get, () => {});
        return [timeline, set, dispose] as const;
      });
      flush();
      await microtask();
      const t0 = now();
      for (let i = 1; i <= WRITES; i++) {
        set(i);
        flush();
      }
      await microtask(); // publish steps
      const t = now() - t0;
      const steps = timeline.steps().length;
      dispose();
      return { t, steps };
    });
    log(
      `perf1 ${reader ? "with a reader effect" : "no reader"}: plain ${ms(plain)} (${((plain / WRITES) * 1000).toFixed(2)} µs/write) | overlay ${ms(recorded.t)} (${((recorded.t / WRITES) * 1000).toFixed(2)} µs/write), steps=${recorded.steps}`
    );
  }
});

test("perf 2: 1,000 signals written in one tick", async () => {
  const plain = await twice(async () => {
    const [sets, dispose] = createRoot(dispose => {
      const sets = Array.from({ length: SIGNALS }, () => {
        const [get, set] = createSignal(0);
        createEffect(get, () => {});
        return set;
      });
      return [sets, dispose] as const;
    });
    flush();
    const t0 = now();
    for (const set of sets) set(1);
    flush();
    const t = now() - t0;
    dispose();
    return t;
  });
  const recorded = await twice(async () => {
    const [timeline, sets, dispose] = createRoot(dispose => {
      const timeline = createTimeline();
      const sets = Array.from({ length: SIGNALS }, (_, i) => {
        const [get, set] = createRecordedSignal(0, { name: "s" + i, timeline });
        createEffect(get, () => {});
        return set;
      });
      return [timeline, sets, dispose] as const;
    });
    flush();
    await microtask();
    const t0 = now();
    for (const set of sets) set(1);
    flush();
    await microtask();
    const t = now() - t0;
    const steps = timeline.steps();
    dispose();
    return { t, steps: steps.length, changes: Object.keys(steps[0]?.changes ?? {}).length };
  });
  log(`perf2 (one reader effect each): plain ${ms(plain)} | overlay ${ms(recorded.t)}, steps=${recorded.steps} with ${recorded.changes} changes`);
});

const rows = () => ({ rows: Array.from({ length: ROWS }, (_, i) => ({ id: i + 1, text: "r" + i })) });

test("perf 3: store with 1,000 rows, 200 one-row steps, goto(1), resume()", async () => {
  // Every row is read by its own effect, as a rendered list would.
  const plain = await twice(async () => {
    const [state, setState, dispose] = createRoot(dispose => {
      const [state, setState] = createStore(rows());
      for (let i = 0; i < ROWS; i++) createEffect(() => state.rows[i].text, () => {});
      return [state, setState, dispose] as const;
    });
    flush();
    let step1: any;
    const t0 = now();
    for (let s = 1; s <= STEPS; s++) {
      setState(d => void (d.rows[(s * 7) % ROWS].text = "s" + s));
      flush();
      if (s === 1) step1 = snapshot(state); // what a plain-Solid "goto" would write back (outside the timing below)
    }
    const record = now() - t0;
    const latest = snapshot(state);
    const t1 = now();
    setState(d => void reconcile(step1, "id")(d));
    flush();
    const back = now() - t1;
    const t2 = now();
    setState(d => void reconcile(latest, "id")(d));
    flush();
    const forward = now() - t2;
    dispose();
    return { record, back, forward };
  });
  const overlay = await twice(async () => {
    let reruns = 0;
    const [timeline, state, setState, dispose] = createRoot(dispose => {
      const timeline = createTimeline();
      const [state, setState] = createRecordedStore(rows(), { name: "rows", timeline });
      for (let i = 0; i < ROWS; i++) createEffect(() => state.rows[i].text, () => void reruns++);
      return [timeline, state, setState, dispose] as const;
    });
    flush();
    await microtask();
    const t0 = now();
    for (let s = 1; s <= STEPS; s++) {
      setState(d => void (d.rows[(s * 7) % ROWS].text = "s" + s));
      flush();
    }
    await microtask();
    const record = now() - t0;
    const steps = timeline.steps().length;
    reruns = 0;
    const t1 = now();
    timeline.goto(1);
    flush();
    const back = now() - t1;
    const gotoReruns = reruns;
    const ok1 = state.rows[7].text === "s1" && state.rows[14].text === "r14";
    reruns = 0;
    const t2 = now();
    timeline.resume();
    flush();
    const forward = now() - t2;
    const ok2 = state.rows[14].text === "s2";
    dispose();
    return { record, back, forward, steps, gotoReruns, resumeReruns: reruns, ok: ok1 && ok2 };
  });
  log(
    `perf3 plain store: 200 steps ${ms(plain.record)} | "goto(1)" as reconcile(snapshot) ${ms(plain.back)} | "resume" as reconcile(latest) ${ms(plain.forward)}`
  );
  log(
    `perf3 overlay store: record 200 steps ${ms(overlay.record)} (steps=${overlay.steps}) | goto(1) ${ms(overlay.back)} (${overlay.gotoReruns} row effects re-ran) | resume() ${ms(overlay.forward)} (${overlay.resumeReruns} re-ran) | values ok=${overlay.ok}`
  );
});

test("perf 4: cost of a read", async () => {
  const N = 1_000_000;
  const r = createRoot(dispose => {
    const timeline = createTimeline();
    const [plainGet] = createSignal(1);
    const [recGet] = createRecordedSignal(1, { name: "x", timeline });
    const [plainStore] = createStore(rows());
    const [recStore] = createRecordedStore(rows(), { name: "rows", timeline });
    return { plainGet, recGet, plainStore, recStore, dispose };
  });
  flush();
  const time = (fn: () => number) => {
    fn();
    const t0 = now();
    const v = fn();
    return { t: now() - t0, v };
  };
  const sig = (get: () => number) => () => {
    let s = 0;
    for (let i = 0; i < N; i++) s += get();
    return s;
  };
  const store = (st: any) => () => {
    let s = 0;
    for (let k = 0; k < 100; k++) for (let i = 0; i < ROWS; i++) s += st.rows[i].text.length;
    return s;
  };
  const a = time(sig(r.plainGet));
  const b = time(sig(r.recGet));
  const c = time(store(r.plainStore));
  const d = time(store(r.recStore));
  log(`perf4 1M untracked signal reads: plain ${ms(a.t)} (${((a.t / N) * 1e6).toFixed(1)} ns/read) | overlay getter ${ms(b.t)} (${((b.t / N) * 1e6).toFixed(1)} ns/read)`);
  log(`perf4 100k store leaf reads (state.rows[i].text): plain store ${ms(c.t)} | overlay view ${ms(d.t)}`);
  r.dispose();
});
