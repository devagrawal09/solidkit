import { flush } from "solid-js";

/** A few rounds of timers + flush, as the spec's `settled()`. */
export async function settled(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
}

export const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Reads that may throw while async values are pending count as "not yet". */
export async function waitFor(pred: () => boolean, rounds = 200): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    try {
      if (pred()) return;
    } catch {}
    await settled(1);
  }
  throw new Error("waitFor: condition never held");
}
