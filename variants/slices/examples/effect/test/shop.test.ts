// Scenario tests: the real feature (search memo, checkout saga, slices)
// against scripted services, plus one run against the live Effect backend.
import { createEffect, createRoot, latest } from "solid-js";
import { Layer } from "effect";
import { createKernel } from "@solidkit/kernel";
import { describe, expect, test } from "vitest";
import { expectReplayable, scripted, settled } from "@solidkit/slices/testing";
import { CardDeclinedError, SearchConfig, SearchConfigLive, type Order, type Package } from "../src/api";
import { Shop } from "../src/shop";
import { ActionInterruptedError } from "../src/solid-effect";
import { INITIAL_CART, totalOf } from "../src/state";

const solid: Package = { name: "solid-js", description: "Fine-grained reactive UI library", downloads: 1_450_000 };
const total = Number(totalOf(INITIAL_CART).toFixed(2));
const order: Order = { id: "ord_3", items: INITIAL_CART, total, placedAt: "12:00:00" };

function mount(kernel = createKernel({ script: true }), config = SearchConfigLive) {
  return createRoot(() => {
    const shop = Shop.create(kernel, config);
    // Stand-in for the view: keep the data observed.
    createEffect(
      () => [latest(shop.results).length, shop.orders.length, shop.phase()],
      () => {}
    );
    return shop;
  });
}

async function start() {
  const kernel = createKernel({ script: true });
  const script = scripted(kernel);
  const shop = mount(kernel);
  await script.expectCall("backend.fetchOrders");
  await script.resolve("backend.fetchOrders", []);
  return { kernel, script, shop };
}

// How an AbortSignal argument is recorded (`{}` in browsers; happy-dom adds a field).
const SIGNAL = JSON.parse(JSON.stringify(new AbortController().signal));

const signalOf = (kernel: ReturnType<typeof createKernel>, query: string) =>
  kernel.script.pending().find(c => c.path === "backend.searchPackages" && c.args[0] === query)?.args[1] as AbortSignal;

describe("typeahead", () => {
  test("a superseded search is interrupted: its call is aborted", async () => {
    const { kernel, script, shop } = await start();
    shop.queryChanged("so");
    await script.expectCall("backend.searchPackages", ["so", SIGNAL]);
    const first = signalOf(kernel, "so");
    expect(first.aborted).toBe(false);
    shop.queryChanged("sol");
    await script.expectCall("backend.searchPackages", ["sol", SIGNAL]);
    expect(first.aborted).toBe(true);
    await script.resolve("backend.searchPackages", [solid], ["sol", SIGNAL]);
    expect(shop.results()).toEqual([solid]);
    await script.resolve("backend.searchPackages", [], ["so", SIGNAL]); // a late answer for the stale flight changes nothing
    expect(shop.results()).toEqual([solid]);
  });
});

describe("checkout saga", () => {
  test("success: three steps, then the order and a notice", async () => {
    const { script, shop, kernel } = await start();
    const done = shop.placeOrder(INITIAL_CART, false);
    await script.expectCall("backend.reserveInventory");
    expect(shop.phase()).toBe("reserving");
    await script.resolve("backend.reserveInventory", { id: "rsv_1", items: INITIAL_CART });
    await script.expectCall("backend.chargeCard", [total, false, SIGNAL]);
    expect(shop.phase()).toBe("charging");
    await script.resolve("backend.chargeCard", { id: "ch_2", amount: total });
    await script.expectCall("backend.createOrder");
    await script.resolve("backend.createOrder", order);
    await script.expectCall("backend.fetchOrders");
    await script.resolve("backend.fetchOrders", [order]);
    expect(await done).toEqual(order);
    expect(shop.checkout.notice).toEqual({ kind: "success", text: `Order ord_3 confirmed — $${total.toFixed(2)}` });
    expect(shop.orders.map(o => o.id)).toEqual(["ord_3"]);
    expect(shop.phase()).toBe("idle");
    script.expectNoCalls();
    expectReplayable(kernel);
  });

  test("a declined card releases the hold and says so", async () => {
    const { script, shop } = await start();
    const done = shop.placeOrder(INITIAL_CART, true);
    const failed = expect(done).rejects.toBeInstanceOf(CardDeclinedError);
    await script.resolve("backend.reserveInventory", { id: "rsv_1", items: INITIAL_CART });
    await script.expectCall("backend.chargeCard", [total, true, SIGNAL]);
    await script.reject("backend.chargeCard", new CardDeclinedError({ amount: total }));
    await script.expectCall("backend.releaseReservation");
    await script.resolve("backend.releaseReservation");
    await failed;
    expect(shop.checkout.notice).toEqual({
      kind: "error",
      text: `Card declined for $${total.toFixed(2)} — refunds/releases applied, cart untouched`
    });
    expect(shop.phase()).toBe("idle");
    script.expectNoCalls();
  });

  test("cancel mid-charge aborts the charge, compensates and says so", async () => {
    const { kernel, script, shop } = await start();
    const done = shop.placeOrder(INITIAL_CART, false);
    const failed = expect(done).rejects.toBeInstanceOf(ActionInterruptedError);
    await script.resolve("backend.reserveInventory", { id: "rsv_1", items: INITIAL_CART });
    await script.expectCall("backend.chargeCard");
    const charge = kernel.script.pending().find(c => c.path === "backend.chargeCard")!;
    shop.cancelCheckout();
    await script.expectCall("backend.releaseReservation");
    expect((charge.args[2] as AbortSignal).aborted).toBe(true);
    await script.resolve("backend.releaseReservation");
    await failed;
    expect(shop.checkout.notice).toEqual({ kind: "info", text: "Checkout cancelled — compensations ran, cart untouched" });
    expect(kernel.entries().filter(e => e.kind === "action").map(e => (e.kind === "action" ? e.phase : ""))).toEqual([
      "start",
      "failed"
    ]);
  });
});

describe("time travel", () => {
  test("rewinding restores the query, the results and the notice, with no live calls", async () => {
    const { kernel, script, shop } = await start();
    shop.queryChanged("sol");
    await script.expectCall("backend.searchPackages", ["sol", SIGNAL]);
    await script.resolve("backend.searchPackages", [solid], ["sol", SIGNAL]);
    const searched = kernel.entries().at(-1)!;

    const done = shop.placeOrder(INITIAL_CART, false);
    await script.resolve("backend.reserveInventory", { id: "rsv_1", items: INITIAL_CART });
    await script.resolve("backend.chargeCard", { id: "ch_2", amount: total });
    await script.resolve("backend.createOrder", order);
    await script.expectCall("backend.fetchOrders");
    await script.resolve("backend.fetchOrders", [order]);
    await done;
    shop.queryChanged("effect");
    await script.expectCall("backend.searchPackages", ["effect", SIGNAL]);
    await script.resolve("backend.searchPackages", [], ["effect", SIGNAL]);
    expect(shop.checkout.notice?.kind).toBe("success");

    kernel.rewind(searched.seq);
    await settled();
    expect(shop.search.query).toBe("sol");
    expect(shop.results()).toEqual([solid]);
    expect(shop.checkout.notice).toBeNull();
    expect(shop.orders).toEqual([]);
    script.expectNoCalls();

    expect(await shop.placeOrder(INITIAL_CART, false)).toBeUndefined(); // ignored while rewound
    expect(shop.queryChanged("x")).toBe(false);
    script.expectNoCalls();

    kernel.resume();
    await settled();
    expect(shop.search.query).toBe("effect");
    expect(shop.checkout.notice?.kind).toBe("success");
    expectReplayable(kernel);
  });
});

describe("live backend", () => {
  test("a superseded search's fiber is interrupted and its finalizer logs it", async () => {
    const fast = Layer.succeed(SearchConfig, { flakiness: 0, baseLatencyMs: 5 });
    const kernel = createKernel();
    const shop = mount(kernel, fast);
    shop.queryChanged("so");
    await settled();
    shop.queryChanged("sol");
    for (let i = 0; i < 100 && !shop.eventLog.entries.some(e => e.message.startsWith('search "sol" →')); i++)
      await new Promise(r => setTimeout(r, 20));
    const messages = shop.eventLog.entries.map(e => `${e.kind}: ${e.message}`);
    expect(messages).toContain('interrupt: search "so" interrupted — fiber + pending retries torn down');
    expect(messages.some(m => m.startsWith('success: search "sol" →'))).toBe(true);
    expect(messages).not.toContain('success: search "so" → 2 results');
    expectReplayable(kernel);
  });
});