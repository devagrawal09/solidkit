// Scenario tests: the real blocks, data and actions, against scripted services.
import { describe, expect, test } from "vitest";
import { liveCalls, settled, start, transitions } from "@solidkit/blocks/testing";
import { CardDeclinedError, type Order, type Package } from "../src/api.ts";
import { App } from "../src/app.tsx";
import { log } from "../src/log.ts";
import { createServices } from "../src/services.ts";

const solid: Package = { name: "solid-js", description: "Fine-grained reactive UI library", downloads: 1_450_000 };
const web: Package = { name: "@solidjs/web", description: "Solid web platform runtime", downloads: 1_310_000 };

async function boot() {
  const t = start(App, { services: createServices(), render: true });
  await t.script.resolve("shop.fetchOrders", []);
  return t;
}
type T = Awaited<ReturnType<typeof boot>>;

const $ = (t: T, selector: string) => t.container.querySelector<HTMLElement>(selector);
const names = (t: T) => [...t.container.querySelectorAll(".results .pkg-name")].map(el => el.textContent);
const steps = (t: T) => [...t.container.querySelectorAll(".steps li")].map(li => `${li.textContent}:${li.className}`);
async function search(t: T, query: string) {
  const input = $(t, "input[type=search]") as HTMLInputElement;
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settled();
}
async function click(el: HTMLElement | null) {
  el!.click();
  await settled();
}
const button = (t: T, text: string) => [...t.container.querySelectorAll("button")].find(b => b.textContent?.includes(text)) ?? null;

describe("typeahead", () => {
  test("searches, keeps stale results while revalidating, and ignores superseded answers", async () => {
    const t = await boot();
    await search(t, "s");
    await search(t, "so");
    await t.script.expectCall("registry.search", ["so"]);
    expect(t.container.textContent).toContain("Searching…");
    await t.script.resolve("registry.search", [solid, web], ["so"]);
    expect(names(t)).toEqual(["solid-js", "@solidjs/web"]);
    await t.script.resolve("registry.search", [web], ["s"]); // superseded: no effect
    expect(names(t)).toEqual(["solid-js", "@solidjs/web"]);

    await search(t, "sol");
    expect($(t, ".results.stale")).toBeTruthy();
    expect(names(t)).toEqual(["solid-js", "@solidjs/web"]);
    await t.script.resolve("registry.search", [solid], ["sol"]);
    expect($(t, ".results.stale")).toBeNull();
    expect(names(t)).toEqual(["solid-js"]);
    expect(transitions(t.kernel).filter(s => s.startsWith("effect/typeahead"))).toEqual([
      "effect/typeahead · ChangedQuery",
      "effect/typeahead · ChangedQuery",
      "effect/typeahead · ChangedQuery"
    ]);
    t.dispose();
  });

  test("a search that gives up shows the error boundary; Try again searches again", async () => {
    const t = await boot();
    await search(t, "zz");
    await t.script.reject("registry.search", new Error("TimeoutException"), ["zz"]);
    expect(t.container.textContent).toContain("Search gave up after retries");
    await click(button(t, "Try again"));
    await t.script.resolve("registry.search", [], ["zz"]);
    expect(t.container.textContent).toContain("No packages match “zz”.");
    t.dispose();
  });

  test("leaving the tab resets the search", async () => {
    const t = await boot();
    await search(t, "so");
    await click(button(t, "Checkout"));
    await click(button(t, "Typeahead"));
    expect(($(t, "input[type=search]") as HTMLInputElement).value).toBe("");
    expect(transitions(t.kernel).slice(-4)).toEqual([
      "effect · ClickedTab",
      "effect/typeahead · RequestedReset",
      "effect · ClickedTab",
      "effect/checkout · RequestedReset"
    ]);
    t.dispose();
  });
});

describe("checkout saga", () => {
  const order: Order = { id: "ord_3", items: [], total: 78.74, placedAt: "12:00:00" };

  test("success: each step shows as it runs, then the order and its notice", async () => {
    const t = await boot();
    await click(button(t, "Checkout"));
    await click(button(t, "Place order"));
    expect(steps(t)).toEqual(["Reserve inventory:active", "Charge card:", "Create order:"]);
    expect(button(t, "Cancel checkout")).toBeTruthy();
    await t.script.resolve("shop.reserve", { id: "rsv_1", items: [] });
    expect(steps(t)).toEqual(["Reserve inventory:done", "Charge card:active", "Create order:"]);
    expect(t.script.pending()).toEqual([{ path: "shop.charge", args: [78.74, false] }]);
    await t.script.resolve("shop.charge", { id: "ch_2", amount: 78.74 });
    await t.script.resolve("shop.createOrder", order);
    await t.script.resolve("shop.fetchOrders", [order]);
    expect($(t, ".notice.success")?.textContent).toBe("Order ord_3 confirmed — $78.74");
    expect($(t, ".orders")?.textContent).toContain("ord_3");
    expect(steps(t)).toEqual(["Reserve inventory:", "Charge card:", "Create order:"]); // the optimistic phase reverted
    t.dispose();
  });

  test("a typed decline compensates what committed and says so", async () => {
    const t = await boot();
    await click(button(t, "Checkout"));
    const decline = $(t, ".decline-toggle input") as HTMLInputElement;
    decline.checked = true;
    decline.dispatchEvent(new Event("input", { bubbles: true }));
    await settled();
    await click(button(t, "Place order"));
    await t.script.resolve("shop.reserve", { id: "rsv_1", items: [] });
    await t.script.reject("shop.charge", new CardDeclinedError({ amount: 78.74 }), [78.74, true]);
    await t.script.resolve("shop.release");
    expect($(t, ".notice.error")?.textContent).toBe("Card declined for $78.74 — refunds/releases applied, cart untouched");
    t.script.expectNoCalls();
    t.dispose();
  });

  test("cancel interrupts the step in flight, compensates, and the outcome is a fact", async () => {
    const t = await boot();
    await click(button(t, "Checkout"));
    await click(button(t, "Place order"));
    await t.script.resolve("shop.reserve", { id: "rsv_1", items: [] });
    await t.script.expectCall("shop.charge");
    await click(button(t, "Cancel checkout"));
    await t.script.resolve("shop.release");
    expect($(t, ".notice.info")?.textContent).toBe("Checkout cancelled — compensations ran, cart untouched");
    expect(transitions(t.kernel).slice(-1)).toEqual(["effect/checkout · CheckoutCancelled"]);
    const actions = t.kernel.entries().flatMap(e => (e.kind === "action" ? [`${e.name} ${e.phase}`] : []));
    expect(actions).toEqual([
      "effect/checkout:placeOrder start",
      "effect/checkout:cancelCheckout start",
      "effect/checkout:cancelCheckout settled",
      "effect/checkout:placeOrder failed"
    ]);
    t.dispose();
  });
});

describe("event log", () => {
  test("fiber events become entries; Clear empties the panel", async () => {
    const t = await boot();
    log("start", 'search "s" — fiber started');
    log("interrupt", 'search "s" interrupted');
    await settled();
    expect([...t.container.querySelectorAll(".log-panel li")].map(li => li.className)).toEqual(["log-interrupt", "log-start"]);
    await click(button(t, "Clear"));
    expect(t.container.textContent).toContain("Interact to see fiber lifecycle events.");
    t.dispose();
  });
});

describe("time travel", () => {
  test("rewinding before an order shows the app as it was, with no network", async () => {
    const t = await boot();
    await click(button(t, "Checkout"));
    await click(button(t, "Place order"));
    const placed = t.kernel.entries().find(e => e.kind === "transition" && e.name === "ClickedPlaceOrder")!;
    await t.script.resolve("shop.reserve", { id: "rsv_1", items: [] });
    await t.script.resolve("shop.charge", { id: "ch_2", amount: 78.74 });
    await t.script.resolve("shop.createOrder", { id: "ord_3", items: [], total: 78.74, placedAt: "12:00:00" });
    log("success", "createOrder → ord_3 confirmed");
    await t.script.resolve("shop.fetchOrders", [{ id: "ord_3", items: [], total: 78.74, placedAt: "12:00:00" }]);
    expect($(t, ".notice.success")).toBeTruthy();
    const calls = liveCalls(t.kernel).length;

    t.kernel.rewind(placed.seq);
    await settled();
    expect($(t, ".notice")).toBeNull();
    expect(t.container.textContent).toContain("No orders yet.");
    expect(t.container.textContent).not.toContain("ord_3 confirmed");
    t.script.expectNoCalls();
    expect(liveCalls(t.kernel)).toHaveLength(calls);

    t.kernel.resume();
    await t.script.expectCall("shop.fetchOrders");
    await t.script.resolve("shop.fetchOrders", [{ id: "ord_3", items: [], total: 78.74, placedAt: "12:00:00" }]);
    expect($(t, ".notice.success")).toBeTruthy();
    expect(t.container.textContent).toContain("createOrder → ord_3 confirmed");
    t.dispose();
  });
});
