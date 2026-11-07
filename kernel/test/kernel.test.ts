import { createEffect, createMemo, createRoot, createStore, flush } from "solid-js";
import { describe, expect, test } from "vitest";
import { createKernel } from "../src/index.ts";
import { scripted, settled } from "../src/testing.ts";

describe("kernel", () => {
  test("solid runs its client build here (effects fire)", () => {
    const seen: number[] = [];
    const [s, set] = createStore({ n: 0 });
    createRoot(() => createEffect(() => s.n, n => void seen.push(n)));
    flush();
    set(d => {
      d.n = 1;
    });
    flush();
    expect(seen).toEqual([0, 1]);
  });

  test("commits snapshot tracked state; stateAt finds the state after any entry", () => {
    const k = createKernel();
    const [s, set] = createStore({ count: 0, other: { x: 1 } });
    k.track("counter", s, set);
    set(d => {
      d.count = 1;
    });
    const one = k.commit("counter", "incremented");
    set(d => {
      d.count = 2;
    });
    const two = k.commit("counter", "incremented");
    expect(k.stateAt(one.seq)).toEqual({ counter: { count: 1, other: { x: 1 } } });
    expect(k.stateAt(two.seq)).toEqual({ counter: { count: 2, other: { x: 1 } } });
    // unchanged branches are shared between snapshots
    expect((k.stateAt(one.seq).counter as any).other).toBe((k.stateAt(two.seq).counter as any).other);
  });

  test("rewinding restores state and replays services without calling them", async () => {
    const k = createKernel();
    const calls: string[] = [];
    const api = k.services({
      user: async (id: string) => {
        calls.push(id);
        return { id, name: "user " + id };
      }
    });
    const [s, set] = createStore({ id: "a" });
    k.track("route", s, set);
    const shown: string[] = [];
    createRoot(() => {
      const user = createMemo(() => api.user(s.id));
      k.refreshable(user);
      createEffect(() => user().name, name => void shown.push(name));
    });
    await settled();
    set(d => {
      d.id = "b";
    });
    const toB = k.commit("route", "navigated", { id: "b" });
    await settled();
    expect(calls).toEqual(["a", "b"]);
    expect(shown).toEqual(["user a", "user b"]);

    k.rewind(toB.seq - 1); // before navigating
    await settled();
    expect(s.id).toBe("a");
    expect(shown.at(-1)).toBe("user a");
    expect(calls).toEqual(["a", "b"]); // replayed, not called

    k.resume();
    await settled();
    expect(s.id).toBe("b");
    expect(shown.at(-1)).toBe("user b");
    expect(k.live("anything")).toBe(true);
  });

  test("input is refused while time traveling", () => {
    const k = createKernel();
    const [s, set] = createStore({ n: 0 });
    k.track("n", s, set);
    k.rewind(0);
    expect(k.live("a click")).toBe(false);
    expect(k.entries().at(-1)).toMatchObject({ kind: "note", text: "ignored a click while time traveling" });
  });

  test("scripted services wait for the test", async () => {
    const k = createKernel();
    const script = scripted(k);
    const api = k.services({ save: async (_n: number) => "real" });
    let result: unknown;
    void api.save(1).then(v => (result = v));
    await script.expectCall("save", [1]);
    await script.resolve("save", "scripted");
    expect(result).toBe("scripted");
    script.expectNoCalls();
    expect(k.entries().filter(e => e.kind === "service").map(e => (e as any).phase)).toEqual(["call", "result"]);
  });
});
