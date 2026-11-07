// Pure tests: the slices' mutations. No Solid, no kernel, no Effect.
import { describe, expect, test } from "vitest";
import { given } from "@solidkit/slices/testing";
import { logSlice } from "../src/log";
import { checkoutSlice, INITIAL_CART, searchSlice, shellSlice, totalOf } from "../src/state";

describe("slices", () => {
  test("tabs and the query", () => {
    const [shell, { tabSelected }] = given(shellSlice);
    tabSelected("checkout");
    expect(shell.tab).toBe("checkout");
    const [search, { queryChanged }] = given(searchSlice);
    queryChanged("sol");
    expect(search.query).toBe("sol");
  });

  test("cart quantities never drop below one, and the total follows", () => {
    const [state, { incremented, decremented }] = given(checkoutSlice);
    decremented(0);
    expect(state.cart[0].quantity).toBe(1);
    incremented(0);
    decremented(1);
    expect(state.cart.map(i => i.quantity)).toEqual([2, 1, 1]);
    expect(totalOf(state.cart)).toBeCloseTo(19.99 * 2 + 24.5 + 9.75);
    expect(INITIAL_CART[0].quantity).toBe(1); // the definition is untouched
  });

  test("decline toggle and notices", () => {
    const [state, { declineToggled, noticeShown }] = given(checkoutSlice);
    declineToggled(true);
    noticeShown({ kind: "info", text: "Checkout cancelled" });
    expect(state).toMatchObject({ declineCard: true, notice: { kind: "info", text: "Checkout cancelled" } });
    noticeShown(null);
    expect(state.notice).toBeNull();
  });

  test("the log numbers its entries and keeps the last hundred", () => {
    const [state, { appended, cleared }] = given(logSlice);
    for (let i = 0; i < 105; i++) appended("start", `entry ${i}`, "0.00s");
    expect(state.entries).toHaveLength(100);
    expect(state.entries[0]).toEqual({ id: 5, time: "0.00s", kind: "start", message: "entry 5" });
    cleared();
    expect(state.entries).toEqual([]);
    appended("success", "again", "1.00s");
    expect(state.entries[0].id).toBe(105);
  });
});
