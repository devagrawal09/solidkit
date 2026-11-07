// Pure tests of the state logic.
import { describe, expect, test } from "vitest";
import { testUpdate } from "@solidkit/blocks/testing";
import { App } from "../src/app.tsx";
import { Act, Checkout, initModel, Msg as CheckoutMsg, total } from "../src/checkout.tsx";
import { EventLog, Msg as LogMsg, type Model as LogModel } from "../src/event-log.tsx";
import { Msg as TypeaheadMsg, Typeahead } from "../src/typeahead.tsx";

describe("Typeahead", () => {
  test("the query is the only client state; reset clears it", () => {
    const r = testUpdate(Typeahead, { query: "" }, TypeaheadMsg.ChangedQuery({ query: "sol" }));
    expect(r.model.query).toBe("sol");
    expect(testUpdate(Typeahead, r.model, TypeaheadMsg.RequestedReset()).model.query).toBe("");
  });
});

describe("Checkout", () => {
  test("quantities never drop below one", () => {
    const start = initModel();
    const r = testUpdate(Checkout, start, CheckoutMsg.ClickedDecrement({ id: "sku_signal" }));
    expect(r.model.cart[0].quantity).toBe(1);
    expect(testUpdate(Checkout, start, CheckoutMsg.ClickedIncrement({ id: "sku_signal" })).model.cart[0].quantity).toBe(2);
  });

  test("placing an order requests the saga with a copy of the cart and the decline flag", () => {
    const model = { ...initModel(), decline: true };
    const r = testUpdate(Checkout, model, CheckoutMsg.ClickedPlaceOrder());
    expect(r.acts).toEqual([Act.placeOrder({ items: initModel().cart, decline: true })]);
    expect(total(initModel().cart)).toBeCloseTo(78.74);
  });

  test("outcomes become the notice; cancel requests the interrupt; reset restores the cart", () => {
    const m = initModel();
    expect(testUpdate(Checkout, m, CheckoutMsg.CardDeclined({ amount: 78.74 })).model.notice).toEqual({
      kind: "error",
      text: "Card declined for $78.74 — refunds/releases applied, cart untouched"
    });
    expect(testUpdate(Checkout, m, CheckoutMsg.CheckoutCancelled()).model.notice?.kind).toBe("info");
    expect(testUpdate(Checkout, m, CheckoutMsg.ClickedCancel()).acts).toEqual([Act.cancelCheckout()]);
    const changed = { ...m, decline: true, notice: { kind: "info" as const, text: "x" } };
    expect(testUpdate(Checkout, changed, CheckoutMsg.RequestedReset()).model).toEqual(initModel());
  });
});

describe("EventLog", () => {
  test("keeps the last 100 entries; clear empties it", () => {
    let model: LogModel = { entries: [] };
    for (let id = 0; id < 101; id++) model = testUpdate(EventLog, model, LogMsg.Logged({ entry: { id, time: "0s", kind: "start", message: "" } })).model;
    expect(model.entries).toHaveLength(100);
    expect(model.entries[0].id).toBe(1);
    expect(testUpdate(EventLog, model, LogMsg.ClickedClear()).model.entries).toEqual([]);
  });
});

describe("the root", () => {
  const model = () => ({ tab: "typeahead" as const, typeahead: { query: "so" }, checkout: initModel(), log: { entries: [] } });

  test("leaving a tab resets it through its operation, as unmounting did", () => {
    const r = testUpdate(App, model(), { type: "ClickedTab", tab: "checkout" });
    expect(r.model.tab).toBe("checkout");
    expect(r.ops).toEqual([{ block: "typeahead", op: "reset", args: [] }]);
    expect(testUpdate(App, model(), { type: "ClickedTab", tab: "typeahead" }).ops).toEqual([]);
  });
});
