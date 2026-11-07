// Test helpers: pure slices, replay checks, and the kernel's scripted services.
import type { Kernel } from "@solidkit/kernel";
import { replay, type Bound, type Mutations, type Slice } from "./index.ts";

export { scripted, settled } from "@solidkit/kernel/testing";
export { replay };

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** A slice on a plain object: the same call shape as `kit.use`, without Solid or a kernel. */
export function given<S extends object, M extends Mutations<S>>(def: Slice<S, M>, initial: S = def.initial) {
  const state = json(initial);
  const bound: Record<string, (...args: unknown[]) => boolean> = {};
  for (const [key, mutation] of Object.entries(def.mutations))
    bound[key] = (...args) => {
      mutation(state, ...json(args));
      return true;
    };
  return [state, bound as Bound<M>] as const; // cast: built key by key from def.mutations
}

/**
 * Checks the timeline is exact: at every committed transition, the snapshot
 * the kernel recorded equals the state rebuilt by replaying the mutation calls.
 * Returns the number of transitions checked; throws on the first mismatch.
 */
export function expectReplayable(kernel: Kernel): number {
  const transitions = kernel.entries().filter(e => e.kind === "transition");
  for (const entry of transitions) {
    const recorded = JSON.stringify(kernel.stateAt(entry.seq));
    const replayed = JSON.stringify(replay(kernel, entry.seq));
    if (recorded !== replayed)
      throw new Error(`replay diverges at #${entry.seq} (${(entry as { source: string }).source}): recorded ${recorded}, replayed ${replayed}`);
  }
  return transitions.length;
}
