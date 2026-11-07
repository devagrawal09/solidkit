// Live: the real Effect programs from api.ts, behind the real kernel (not
// scripted). They prove what the scripted tests can't: a superseded search's
// fiber is interrupted, and a cancel during the charge step interrupts the
// charge (its own finalizer voids it) before the saga releases the hold.
//
// Time is Effect's TestClock: the programs' sleeps end only when the test
// adjusts the clock, so the test decides where every step boundary falls.
// The test never waits for a fixed delay. It waits for what the app shows
// (log entries, the notice) or for the clock to hold a sleep.
import { afterEach, describe, expect, test } from "vitest";
import { createEffect, createRoot, latest } from "solid-js";
import { Chunk, Layer, ManagedRuntime, TestClock, TestContext } from "effect";
import { createKernel } from "@solidkit/kernel";
import { createProgram } from "@solidkit/messages";
import { SearchConfig } from "../src/api.ts";
import { effectDemo, Msg } from "../src/app.ts";
import { createServices } from "../src/services.ts";

// Polls (real time) until the app reaches a state. The app's progress doesn't
// depend on real time: only microtasks, tasks and the test clock.
const until = async (what: string, check: () => boolean | Promise<boolean>, ms = 4000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 5));
  }
};

let cleanup = async () => {};
afterEach(() => cleanup());

function startLive() {
  const kernel = createKernel();
  const runtime = ManagedRuntime.make(
    Layer.merge(TestContext.TestContext, Layer.succeed(SearchConfig, { flakiness: 0, baseLatencyMs: 40 }))
  );
  const clock = {
    adjust: (ms: number) => runtime.runPromise(TestClock.adjust(ms)),
    /** Resolves once some fiber is asleep until `instant` (test-clock ms). */
    sleepingUntil: (instant: number) =>
      until(`a sleep until ${instant} ms`, async () =>
        Chunk.toReadonlyArray(await runtime.runPromise(TestClock.sleeps())).includes(instant)
      )
  };
  const app = createRoot(dispose => {
    cleanup = async () => {
      dispose();
      await runtime.dispose();
    };
    const app = createProgram(effectDemo, { kernel, services: createServices(runtime), flags: undefined });
    // the view's read of the results, so the search memo runs
    createEffect(
      () => {
        try {
          return latest(app.data.results).length;
        } catch {
          return -1;
        }
      },
      () => {}
    );
    return app;
  });
  const log = () => app.model.log.map(e => e.message);
  return { app, clock, log };
}

describe("live fibers (TestClock)", () => {
  test("a superseded search's fiber is interrupted, not just ignored", async () => {
    const { app, clock, log } = startLive();
    app.send(Msg.ChangedQuery({ text: "s" }));
    await until('"s" to start', () => log().includes('search "s" — fiber started'));
    // The clock is stopped, so "s" is still in flight (asleep in its first attempt).
    app.send(Msg.ChangedQuery({ text: "so" }));
    await until(
      "the supersede",
      () =>
        log().includes('search "s" interrupted — fiber + pending retries torn down') &&
        log().includes('search "so" — fiber started')
    );
    await clock.adjust(600); // ≥ base latency (40 ms) + the largest random part (550 ms)
    await until('"so" to land', () => log().some(m => m.startsWith('search "so" →')));

    expect(log().filter(m => m.startsWith('search "s"'))).toEqual([
      'search "s" — fiber started',
      'search "s" interrupted — fiber + pending retries torn down'
    ]);
    const calls = app.kernel
      .entries()
      .flatMap(e => (e.kind === "service" && e.path === "search" ? [`${e.key} ${e.phase}`] : []));
    expect(calls).toEqual(['["s"] call', '["so"] call', '["s"] error', '["so"] result']);
  });

  test("cancel during the charge: the charge's finalizer voids it, then the hold is released", async () => {
    const { app, clock, log } = startLive();
    app.send(Msg.ClickedPlaceOrder());
    await until("the reservation to start", () => log().includes("reserveInventory — placing hold"));
    await clock.sleepingUntil(900); // reserveInventory sleeps 900 ms
    await clock.adjust(900);
    // The charge has started, and with the clock stopped it can't finish (it needs 2600 ms).
    await until("the charge to start", () => log().some(m => m.startsWith("chargeCard — authorizing")));
    app.send(Msg.ClickedCancel());
    await until("the charge's finalizer", () => log().includes("chargeCard interrupted — voiding card authorization"));
    await clock.sleepingUntil(900 + 400); // compensation: releaseReservation sleeps 400 ms
    await clock.adjust(400);
    // Wait for both: the notice lands with the action's transition, the release's log
    // entry a task later (fiber events are sent from a fresh task; see fiberLog).
    await until(
      "the notice and the release",
      () => app.model.notice !== null && log().some(m => m.startsWith("releaseReservation →"))
    );

    expect(app.model.notice?.text).toBe("Checkout cancelled — compensations ran, cart untouched");
    // In order: reserve, start the charge, the charge's own finalizer voids it,
    // then the saga compensates what had committed (the hold). Never charged, so
    // nothing to refund; no order.
    expect(log().map(m => m.replace(/rsv_\d+/, "rsv_#").replace(/\$[\d.]+/, "$#"))).toEqual([
      "reserveInventory — placing hold",
      "reserveInventory → rsv_# held",
      "chargeCard — authorizing $#",
      "chargeCard interrupted — voiding card authorization",
      "releaseReservation → rsv_# released (saga compensation)"
    ]);
    const actions = app.kernel.entries().flatMap(e => (e.kind === "action" ? [`${e.name} ${e.phase}`] : []));
    expect(actions).toEqual(["placeOrder start", "cancelCheckout start", "cancelCheckout settled", "placeOrder failed"]);
    const calls = app.kernel
      .entries()
      .flatMap(e => (e.kind === "service" && e.path.startsWith("checkout.") && e.phase === "call" ? [e.path] : []));
    expect(calls).toEqual(["checkout.reserveInventory", "checkout.chargeCard", "checkout.releaseReservation"]);
  });
});
