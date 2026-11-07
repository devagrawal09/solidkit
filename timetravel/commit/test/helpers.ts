// Shared test helpers.
import { createRoot, flush } from "solid-js";
import { createRecordedMemo, createRecordedSignal, type Timeline } from "../src/index.ts";

/** The spec's helper: a few rounds of a macrotask plus a flush. */
export async function settled(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
  }
}

export const later = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

const cleanups: (() => void)[] = [];
/** Call from afterEach: disposes every root and render made by the test. */
export function disposeAll() {
  for (const dispose of cleanups.splice(0)) dispose();
  document.body.innerHTML = "";
}
export function onDispose(fn: () => void) {
  cleanups.push(fn);
}
/** Runs fn under an owned root that is disposed after the test. */
export function owned<T>(fn: () => T): T {
  return createRoot(dispose => {
    cleanups.push(dispose);
    return fn();
  });
}
export function container(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

/** Records n = 2, 3, 4 as steps 1-3 on a fresh signal named "n" (initial 1). */
export async function threeSteps(tl: Timeline) {
  const [n, setN] = owned(() => createRecordedSignal(1, { name: "n", timeline: tl }));
  await settled();
  for (const v of [2, 3, 4]) {
    setN(v);
    await settled();
  }
  return [n, setN] as const;
}

/** S8 setup: a recorded query and a recorded async memo over it; fetchFn counts calls. */
export function searchSetup(tl: Timeline) {
  const calls: string[] = [];
  const fetchFn = (q: string) => {
    calls.push(q);
    return later(10).then(() => `R(${q})`);
  };
  const { q, setQ, result } = owned(() => {
    const [q, setQ] = createRecordedSignal("a", { name: "q", timeline: tl });
    const result = createRecordedMemo(() => fetchFn(q()), { name: "result", timeline: tl });
    return { q, setQ, result };
  });
  return { calls, q, setQ, result };
}
/** Waits past one fetch (10ms) and settles. */
export async function landed() {
  await later(30);
  await settled();
}
export const recordedResults = (tl: Timeline) =>
  tl.steps().flatMap(s => ("result" in s.changes ? [s.changes.result] : []));
