import { describe, expect, test } from "vitest";
import { expectActions, expectModel, send, story } from "@solidkit/messages/testing";
import { Act, INITIAL_CART, init, Msg, update, type Model } from "../src/app.ts";
import type { LogEntry } from "../src/log.ts";

const given = (model: Partial<Model> = {}) => ({ model: { ...init(), ...model } });
const order = { id: "ord_3", items: INITIAL_CART, total: 78.74, placedAt: "10:00:00" };
const entry = (id: number): LogEntry => ({ id, time: "0.00s", kind: "start", message: "m" + id });

describe("effect update", () => {
  test("tabs and the query are client state", () => {
    story(
      { update },
      given(),
      send(Msg.ClickedTab({ tab: "checkout" }), Msg.ChangedQuery({ text: "sol" })),
      expectModel<Model>(m => expect([m.tab, m.query]).toEqual(["checkout", "sol"])),
      expectActions()
    );
  });

  test("quantities step by one and never drop below one", () => {
    story(
      { update },
      given(),
      send(Msg.ChangedQuantity({ id: "sku_signal", by: -1 }), Msg.ChangedQuantity({ id: "sku_fiber", by: 1 })),
      expectModel<Model>(m => expect(m.cart.map(i => i.quantity)).toEqual([1, 3, 1]))
    );
  });

  test("placing an order requests the saga with a copy of the cart; cancel requests the cancel", () => {
    story(
      { update },
      given(),
      send(Msg.ToggledDecline({ decline: true }), Msg.ClickedPlaceOrder()),
      expectActions(Act.placeOrder({ items: INITIAL_CART, decline: true })),
      send(Msg.ClickedCancel()),
      expectActions(Act.cancelCheckout())
    );
  });

  test("outcomes become the notice; an unknown failure clears it", () => {
    const s = story({ update }, given(), send(Msg.PlacedOrder({ order })));
    expect(s.model.notice).toEqual({ kind: "success", text: "Order ord_3 confirmed — $78.74" });
    s.send(Msg.CardDeclined({ amount: 78.74 }));
    expect(s.model.notice).toEqual({
      kind: "error",
      text: "Card declined for $78.74 — refunds/releases applied, cart untouched"
    });
    s.send(Msg.CheckoutCancelled());
    expect(s.model.notice?.kind).toBe("info");
    s.send(Msg.CheckoutFailed());
    expect(s.model.notice).toBeNull();
  });

  test("the fiber log keeps the newest 100 entries and clears", () => {
    const s = story({ update }, given());
    for (let i = 0; i < 105; i++) s.send(Msg.Logged({ entry: entry(i) }));
    expect(s.model.log.length).toBe(100);
    expect(s.model.log[0].id).toBe(5);
    s.send(Msg.ClickedClearLog());
    expect(s.model.log).toEqual([]);
  });
});
