// The demo as one feature: slices for client state, derived server data, and
// the checkout saga as a named action.
import { createMemo, createOptimistic, createProjection, refresh } from "solid-js";
import type { Layer } from "effect";
import { feature } from "@solidkit/slices";
import { CardDeclinedError, type CartItem, type Order, type Package, type SearchConfig } from "./api";
import { call, makeBackend } from "./backend";
import { logSlice, logTo } from "./log";
import { ActionInterruptedError, createRuntime, effectAction, runEffect } from "./solid-effect";
import { checkoutSlice, searchSlice, shellSlice, totalOf } from "./state";

export type Phase = "idle" | "reserving" | "charging" | "finalizing";

export const Shop = feature((kit, config: Layer.Layer<SearchConfig>) => {
  const [shell, { tabSelected }] = kit.use(shellSlice);
  const [search, { queryChanged }] = kit.use(searchSlice);
  const [checkout, { incremented, decremented, declineToggled, noticeShown }] = kit.use(checkoutSlice);
  const [eventLog, { appended, cleared }] = kit.use(logSlice);
  logTo(appended);

  // Effect's R channel (SearchConfig) is provided to the backend by a runtime
  // scoped to this owner, as the original scoped it to its subtree.
  const { backend } = kit.services({ backend: makeBackend(createRuntime(config)) });

  // Read path. A new query re-runs the memo; Solid closes the superseded
  // flight's iterator, runEffect interrupts its fiber, the abort reaches the
  // backend fiber, and its onInterrupt finalizer logs it.
  const results = createMemo<Package[]>(() => {
    const q = search.query.trim();
    if (!q) return [];
    return runEffect(call(signal => backend.searchPackages(q, signal)));
  });
  const orders = createProjection<Order[]>(() => backend.fetchOrders(), [], { key: "id" });
  kit.refreshable(results, orders);

  // Action path. Progress is optimistic (reverts when the saga settles); the
  // outcome is a client fact in the checkout slice.
  const [phase, setPhase] = createOptimistic<Phase>("idle");
  const saga = effectAction(function* (items: CartItem[], decline: boolean) {
    let release: (() => ReturnType<typeof backend.releaseReservation>) | undefined;
    let refund: (() => ReturnType<typeof backend.refundCharge>) | undefined;
    try {
      setPhase("reserving");
      const reservation = yield* call(signal => backend.reserveInventory(items, signal));
      release = () => backend.releaseReservation(reservation);
      setPhase("charging");
      const charge = yield* call(signal => backend.chargeCard(totalOf(items), decline, signal));
      refund = () => backend.refundCharge(charge);
      setPhase("finalizing");
      const order = yield* call(signal => backend.createOrder(items, reservation, charge, signal));
      noticeShown({ kind: "success", text: `Order ${order.id} confirmed — $${order.total.toFixed(2)}` });
      refresh(orders);
      return order;
    } catch (e) {
      // Saga compensation, in reverse order of what committed.
      if (refund) yield* call(refund);
      if (release) yield* call(release);
      if (e instanceof CardDeclinedError)
        noticeShown({
          kind: "error",
          text: `Card declined for $${e.amount.toFixed(2)} — refunds/releases applied, cart untouched`
        });
      else if (e instanceof ActionInterruptedError)
        noticeShown({ kind: "info", text: "Checkout cancelled — compensations ran, cart untouched" });
      else noticeShown(null);
      throw e; // reject the action: the optimistic phase reverts to "idle"
    }
  });

  return {
    shell,
    tabSelected,
    search,
    queryChanged,
    results,
    checkout,
    incremented,
    decremented,
    declineToggled,
    orders,
    phase,
    placeOrder: kit.recorded("placeOrder", saga),
    cancelCheckout: () => kit.kernel.live("cancel checkout") && saga.interrupt(),
    eventLog,
    clearLog: cleared
  };
});

export type ShopApp = ReturnType<typeof Shop.create>;
