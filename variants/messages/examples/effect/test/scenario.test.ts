import { afterEach, describe, expect, test } from "vitest";
import { ManagedRuntime } from "effect";
import { scenario, settled, type Scenario } from "@solidkit/messages/testing";
import { CardDeclinedError, SearchConfigLive, type CartItem, type Order, type Package } from "../src/api.ts";
import { effectDemo, Msg, type Data, type Model } from "../src/app.ts";
import { log } from "../src/log.ts";
import { createServices } from "../src/services.ts";
import { view } from "../src/view.tsx";

type App = Scenario<Model, Msg, Data>;
let app: App | undefined;
afterEach(() => app?.dispose());

// Scripted: the real services are never called, but the program is typed by them.
const services = createServices(ManagedRuntime.make(SearchConfigLive));
const start = async () => {
  app = scenario(effectDemo, { services, flags: undefined, view });
  await app.script.resolve("fetchOrders", []);
  return app;
};
const $ = (app: App, selector: string) => app.container!.querySelector<HTMLElement>(selector);
const all = (app: App, selector: string) => [...app.container!.querySelectorAll<HTMLElement>(selector)].map(e => e.textContent);
const click = (el: HTMLElement | null | undefined) => el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const button = (app: App, text: string) =>
  [...app.container!.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent!.includes(text));
const type = (app: App, text: string) => {
  const input = $(app, "input[type=search]") as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
};
const steps = (app: App) => [...app.container!.querySelectorAll(".steps li")].map(li => li.className || "-");

const solid: Package = { name: "solid-js", description: "Fine-grained reactive UI library", downloads: 1_450_000 };
const signals: Package = { name: "@solidjs/signals", description: "Standalone reactive primitives", downloads: 890_000 };
const reservation = (items: CartItem[]) => ({ id: "rsv_1", items });

describe("typeahead", () => {
  test("a newer query supersedes the older one; the stale answer is never shown", async () => {
    const app = await start();
    type(app, "so");
    await app.script.expectCall("search", ["so"]);
    // the memo already held [] (empty query), so latest() keeps the list branch: isPending says so
    expect($(app, ".results .empty")?.textContent).toBe("Searching…");
    type(app, "sol");
    await app.script.resolve("search", [solid], ["sol"]);
    expect(all(app, ".pkg-name")).toEqual(["solid-js"]);
    await app.script.resolve("search", [signals], ["so"]); // the superseded flight lands late
    expect(all(app, ".pkg-name")).toEqual(["solid-js"]);
  });

  test("stale-while-revalidate: old results stay, marked stale, while the next search runs", async () => {
    const app = await start();
    type(app, "sol");
    await app.script.resolve("search", [solid, signals], ["sol"]);
    type(app, "solid-");
    await app.script.expectCall("search", ["solid-"]);
    expect($(app, ".results")!.classList.contains("stale")).toBe(true);
    expect(all(app, ".pkg-name")).toEqual(["solid-js", "@solidjs/signals"]);
    await app.script.resolve("search", [solid], ["solid-"]);
    expect($(app, ".results")!.classList.contains("stale")).toBe(false);
    expect(all(app, ".pkg-name")).toEqual(["solid-js"]);
  });

  test("a search that gives up shows the error; Try again searches again", async () => {
    const app = await start();
    type(app, "sol");
    await app.script.reject("search", new Error("TimeoutException"), ["sol"]);
    expect($(app, ".error-box p")?.textContent).toBe("Search gave up after retries: Error: TimeoutException");
    click(button(app, "Try again"));
    await app.script.resolve("search", [solid], ["sol"]);
    expect(all(app, ".pkg-name")).toEqual(["solid-js"]);
  });
});

describe("checkout saga", () => {
  const openCheckout = async () => {
    const app = await start();
    click(button(app, "Checkout"));
    await settled();
    return app;
  };

  test("steps run in order with the phase shown, and the order lands with a notice", async () => {
    const app = await openCheckout();
    expect($(app, ".empty")?.textContent).toBe("No orders yet.");
    click(button(app, "Place order"));
    await app.script.expectCall("checkout.reserveInventory");
    expect(steps(app)).toEqual(["active", "-", "-"]);
    expect(button(app, "Cancel checkout")).toBeDefined();
    const items = app.script.pending()[0].args[0] as CartItem[];
    await app.script.resolve("checkout.reserveInventory", reservation(items));
    await app.script.expectCall("checkout.chargeCard");
    expect(steps(app)).toEqual(["done", "active", "-"]);
    expect(app.script.pending()[0].args.slice(0, 2)).toEqual([78.74, false]);
    await app.script.resolve("checkout.chargeCard", { id: "ch_2", amount: 78.74 });
    expect(steps(app)).toEqual(["done", "done", "active"]);
    const order: Order = { id: "ord_3", items, total: 78.74, placedAt: "10:00:00" };
    await app.script.resolve("checkout.createOrder", order);
    await app.script.resolve("fetchOrders", [order]);
    expect($(app, ".notice")?.textContent).toBe("Order ord_3 confirmed — $78.74");
    expect($(app, ".notice")!.classList.contains("success")).toBe(true);
    expect(all(app, ".orders .pkg-name")).toEqual(["ord_3"]);
    expect(steps(app)).toEqual(["-", "-", "-"]); // the optimistic phase reverted
    expect(button(app, "Place order")).toBeDefined();
  });

  test("a declined card releases the reservation (nothing to refund) and reports the decline", async () => {
    const app = await openCheckout();
    click(button(app, "Simulate card decline")?.parentElement ?? $(app, ".decline-toggle input"));
    const toggle = $(app, ".decline-toggle input") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settled();
    click(button(app, "Place order"));
    await app.script.resolve("checkout.reserveInventory", reservation([]));
    await app.script.expectCall("checkout.chargeCard");
    expect(app.script.pending()[0].args[1]).toBe(true);
    await app.script.reject("checkout.chargeCard", new CardDeclinedError({ amount: 78.74 }));
    await app.script.resolve("checkout.releaseReservation");
    app.script.expectNoCalls(); // no refund: the charge never settled
    expect($(app, ".notice")?.textContent).toBe("Card declined for $78.74 — refunds/releases applied, cart untouched");
    expect(button(app, "Place order")).toBeDefined();
  });

  test("cancel mid-charge interrupts the step, runs the compensation and reports the cancel", async () => {
    const app = await openCheckout();
    click(button(app, "Place order"));
    await app.script.resolve("checkout.reserveInventory", reservation([]));
    await app.script.expectCall("checkout.chargeCard");
    click(button(app, "Cancel checkout"));
    await app.script.expectCall("checkout.releaseReservation");
    await app.script.resolve("checkout.releaseReservation");
    expect($(app, ".notice")?.textContent).toBe("Checkout cancelled — compensations ran, cart untouched");
    const acts = app.kernel.entries().flatMap(e => (e.kind === "action" ? [`${e.name} ${e.phase}`] : []));
    expect(acts).toEqual(["placeOrder start", "cancelCheckout start", "cancelCheckout settled", "placeOrder failed"]);
  });

  test("time travel: before the order the cart, notice and orders are as they were, with no live calls", async () => {
    const app = await openCheckout();
    click(button(app, "+"));
    await settled();
    const beforeOrder = app.kernel.entries().at(-1)!.seq;
    click(button(app, "Place order"));
    const items = (await app.script.expectCall("checkout.reserveInventory"), app.script.pending()[0].args[0] as CartItem[]);
    await app.script.resolve("checkout.reserveInventory", reservation(items));
    await app.script.resolve("checkout.chargeCard", { id: "ch_2", amount: 98.73 });
    const order: Order = { id: "ord_3", items, total: 98.73, placedAt: "10:00:00" };
    await app.script.resolve("checkout.createOrder", order);
    await app.script.resolve("fetchOrders", [order]);
    expect(all(app, ".orders .pkg-name")).toEqual(["ord_3"]);

    app.kernel.rewind(beforeOrder);
    await settled();
    app.script.expectNoCalls();
    expect(app.model.notice).toBeNull();
    expect($(app, ".notice")).toBeNull();
    expect($(app, ".empty")?.textContent).toBe("No orders yet."); // fetchOrders replayed from then
    expect(app.model.cart.map(i => i.quantity)).toEqual([2, 2, 1]);

    const start = app.kernel.entries().find(e => e.kind === "transition" && e.name === "ClickedTab")!;
    app.kernel.rewind(start.seq - 1);
    await settled();
    expect($(app, "input[type=search]")).not.toBeNull(); // back on the typeahead tab
    app.script.expectNoCalls();

    app.kernel.resume();
    await app.script.resolve("fetchOrders", [order]);
    expect(app.model.notice?.kind).toBe("success");
    expect(all(app, ".orders .pkg-name")).toEqual(["ord_3"]);
  });
});

describe("fiber log", () => {
  test("entries arrive as messages, so the panel rewinds with the model", async () => {
    const app = await start();
    const before = app.kernel.entries().at(-1)!.seq;
    log("start", "search \"x\" — fiber started");
    await settled();
    expect(all(app, ".log-msg")).toEqual(['search "x" — fiber started']);
    expect(app.kernel.entries().at(-1)).toMatchObject({ kind: "transition", name: "Logged" });
    app.kernel.rewind(before);
    await settled();
    expect(all(app, ".log-msg")).toEqual([]);
    app.kernel.resume();
    await settled();
    expect(all(app, ".log-msg")).toEqual(['search "x" — fiber started']);
    click(button(app, "Clear"));
    await settled();
    expect(all(app, ".log-msg")).toEqual([]);
  });
});
