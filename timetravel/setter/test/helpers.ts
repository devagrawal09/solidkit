import { flush } from "solid-js";

/** A few rounds of "let timers run, then flush" (the shared spec's helper). */
export async function settled(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
}

export const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Settles until `check()` is true (reads that throw NotReadyError count as false). */
export async function waitFor(check: () => boolean, timeoutMs = 500) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    await settled(1);
    try {
      if (check()) return;
    } catch {
      // not ready yet
    }
    if (Date.now() > end) throw new Error("waitFor timed out");
  }
}
