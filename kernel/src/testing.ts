// Test helpers shared by every variant.
import { flush } from "solid-js";
import type { Kernel } from "./index.ts";

/** Lets promises, timers and Solid's batching settle. */
export async function settled(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Scripts the kernel's services: every call waits until the test resolves or
 * rejects it, while Solid runs for real (optimistic writes, reverts, refresh).
 */
export function scripted(kernel: Kernel) {
  kernel.script.enable();
  const describe = () => kernel.script.pending().map(c => c.path + JSON.stringify(c.args)).join(", ") || "none";
  return {
    /** Waits for a pending call to `path` (with these arguments, if given). */
    async expectCall(path: string, args?: readonly unknown[]): Promise<void> {
      for (let i = 0; i < 50; i++) {
        if (kernel.script.pending().some(c => c.path === path && (!args || same(c.args, args)))) return;
        await settled(1);
      }
      throw new Error(`expected a call to ${path}${args ? JSON.stringify(args) : ""}; pending: ${describe()}`);
    },
    /** Asserts nothing is waiting on the test. */
    expectNoCalls(): void {
      if (kernel.script.pending().length) throw new Error(`expected no pending calls; pending: ${describe()}`);
    },
    async resolve(path: string, value?: unknown, args?: readonly unknown[]): Promise<void> {
      const call = kernel.script.take(path, args);
      if (!call) throw new Error(`nothing pending on ${path}; pending: ${describe()}`);
      call.resolve(value);
      await settled();
    },
    async reject(path: string, error: unknown = new Error("rejected"), args?: readonly unknown[]): Promise<void> {
      const call = kernel.script.take(path, args);
      if (!call) throw new Error(`nothing pending on ${path}; pending: ${describe()}`);
      call.reject(error);
      await settled();
    },
    pending: () => kernel.script.pending().map(c => ({ path: c.path, args: c.args }))
  };
}
