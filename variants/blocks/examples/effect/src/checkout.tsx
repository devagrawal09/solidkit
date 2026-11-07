// Checkout: a cancellable saga. The cart, the decline toggle and the outcome
// notice are model state; the step indicator is an optimistic signal (it shows
// during the transition and reverts when the saga settles); orders are server
// data. The saga is an effectAction: each yield* is one transaction step run
// as an interruptible fiber, and its catch compensates what committed.
import { createOptimistic, createOptimisticStore, For, Loading, refresh, Show } from "solid-js";
import { block, driven, variants, type DataCtx, type Handlers, type Send, type ViewProps } from "@solidkit/blocks";
import { CardDeclinedError, type CartItem, type Charge, type Order, type Reservation } from "./api.ts";
import { step, type Shop } from "./services.ts";
import { ActionInterruptedError, effectAction } from "./solid-effect.ts";

type Phase = "idle" | "reserving" | "charging" | "finalizing";

export interface Notice {
  kind: "success" | "error" | "info";
  text: string;
}

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "reserving", label: "Reserve inventory" },
  { phase: "charging", label: "Charge card" },
  { phase: "finalizing", label: "Create order" }
];

const INITIAL_CART: CartItem[] = [
  { id: "sku_signal", name: "Signal (fine-grained)", price: 19.99, quantity: 1 },
  { id: "sku_fiber", name: "Fiber (interruptible)", price: 24.5, quantity: 2 },
  { id: "sku_boundary", name: "Boundary (loading)", price: 9.75, quantity: 1 }
];

export type Model = { cart: CartItem[]; decline: boolean; notice: Notice | null };

export type Msg =
  | { type: "ClickedIncrement"; id: string }
  | { type: "ClickedDecrement"; id: string }
  | { type: "ToggledDecline"; decline: boolean }
  | { type: "ClickedPlaceOrder" }
  | { type: "ClickedCancel" }
  | { type: "OrderPlaced"; order: Order }
  | { type: "CardDeclined"; amount: number }
  | { type: "CheckoutCancelled" }
  | { type: "RequestedReset" };
export const Msg = variants<Msg>();

type PlaceOrder = { type: "placeOrder"; items: CartItem[]; decline: boolean };
export type Act = PlaceOrder | { type: "cancelCheckout" };
export const Act = variants<Act>();

type Services = { shop: Shop };
type Types = { model: Model; msg: Msg; act: Act; services: Services };

export const total = (items: readonly CartItem[]) => items.reduce((sum, item) => sum + item.price * item.quantity, 0);
export const initModel = (): Model => ({ cart: INITIAL_CART.map(item => ({ ...item })), decline: false, notice: null });

export function update(model: Model, msg: Msg): Act | void {
  switch (msg.type) {
    case "ClickedIncrement": {
      const item = model.cart.find(i => i.id === msg.id);
      if (item) item.quantity++;
      return;
    }
    case "ClickedDecrement": {
      const item = model.cart.find(i => i.id === msg.id);
      if (item && item.quantity > 1) item.quantity--;
      return;
    }
    case "ToggledDecline":
      model.decline = msg.decline;
      return;
    case "ClickedPlaceOrder":
      return Act.placeOrder({ items: model.cart.map(item => ({ ...item })), decline: model.decline });
    case "ClickedCancel":
      return Act.cancelCheckout();
    case "OrderPlaced":
      model.notice = { kind: "success", text: `Order ${msg.order.id} confirmed — $${msg.order.total.toFixed(2)}` };
      return;
    case "CardDeclined":
      model.notice = { kind: "error", text: `Card declined for $${msg.amount.toFixed(2)} — refunds/releases applied, cart untouched` };
      return;
    case "CheckoutCancelled":
      model.notice = { kind: "info", text: "Checkout cancelled — compensations ran, cart untouched" };
      return;
    case "RequestedReset":
      Object.assign(model, initModel());
      return;
  }
}

export function data(_model: Model, { shop }: Services, ctx: DataCtx) {
  const [orders] = createOptimisticStore<Order[]>(() => shop.fetchOrders(), []);
  ctx.refreshable(orders);
  // Transition-scoped: writes inside the saga revert when it settles.
  const [phase, setPhase] = createOptimistic<Phase>("idle");
  return { orders, phase, setPhase };
}
export type Data = ReturnType<typeof data>;

export const actions = (
  { orders, setPhase }: Data,
  { shop }: Services,
  ctx: { send: Send<Msg>; interrupt(type: Act["type"]): void }
): Handlers<Act> => ({
  placeOrder: driven(effectAction, function* ({ items, decline }: PlaceOrder) {
    let reservation: Reservation | undefined;
    let charge: Charge | undefined;
    try {
      setPhase("reserving");
      reservation = yield* step(shop.reserve(items));
      setPhase("charging");
      charge = yield* step(shop.charge(total(items), decline));
      setPhase("finalizing");
      const order = yield* step(shop.createOrder(items, reservation, charge));
      ctx.send(Msg.OrderPlaced({ order }));
      refresh(orders);
      return order;
    } catch (e) {
      // Compensation, in reverse order of what committed. Mid-step cleanup
      // (voiding a half-done authorization) ran in the step's own finalizer.
      if (charge) yield* step(shop.refund(charge));
      if (reservation) yield* step(shop.release(reservation));
      throw e; // onActionError turns it into the notice; the optimistic phase reverts
    }
  }),
  *cancelCheckout() {
    ctx.interrupt("placeOrder");
  }
});

function view(props: ViewProps<Types, {}, Data>) {
  const inFlight = () => props.data.phase() !== "idle";
  const stepState = (step: Phase) => {
    const order: Phase[] = ["reserving", "charging", "finalizing"];
    const current = order.indexOf(props.data.phase());
    const target = order.indexOf(step);
    if (current === -1) return "";
    return target < current ? "done" : target === current ? "active" : "";
  };
  return (
    <section class="panel">
      <header>
        <h2>Checkout saga</h2>
        <p>
          Three Effect steps inside one Solid action transaction. Cancel mid-charge (it takes ~2.6s) or toggle the decline:
          the fiber is interrupted, compensations run server-side, and the optimistic UI reverts — automatically on both
          sides.
        </p>
      </header>

      <div class="cart">
        <For each={props.model.cart}>
          {item => (
            <div class="cart-row">
              <span class="cart-name">{item.name}</span>
              <span class="qty">
                <button disabled={inFlight() || item.quantity <= 1} onClick={() => props.send(Msg.ClickedDecrement({ id: item.id }))}>
                  −
                </button>
                {item.quantity}
                <button disabled={inFlight()} onClick={() => props.send(Msg.ClickedIncrement({ id: item.id }))}>
                  +
                </button>
              </span>
              <span class="cart-price">${(item.price * item.quantity).toFixed(2)}</span>
            </div>
          )}
        </For>
        <div class="cart-row total">
          <span class="cart-name">Total</span>
          <span class="cart-price">${total(props.model.cart).toFixed(2)}</span>
        </div>
      </div>

      <div class="checkout-controls">
        <label class="decline-toggle">
          <input
            type="checkbox"
            checked={props.model.decline}
            onInput={e => props.send(Msg.ToggledDecline({ decline: e.currentTarget.checked }))}
          />
          Simulate card decline (typed <code>CardDeclinedError</code>)
        </label>
        <Show
          when={inFlight()}
          fallback={
            <button class="primary" onClick={() => props.send(Msg.ClickedPlaceOrder())}>
              Place order — ${total(props.model.cart).toFixed(2)}
            </button>
          }
        >
          <button class="danger" onClick={() => props.send(Msg.ClickedCancel())}>
            Cancel checkout
          </button>
        </Show>
      </div>

      <ol class="steps">
        <For each={STEPS}>
          {step => <li class={{ done: stepState(step.phase) === "done", active: stepState(step.phase) === "active" }}>{step.label}</li>}
        </For>
      </ol>

      <Show when={props.model.notice}>{n => <p class={["notice", n().kind]}>{n().text}</p>}</Show>

      <h3>Your orders</h3>
      <Loading fallback={<p class="loading">Loading orders…</p>}>
        <Show when={props.data.orders.length > 0} fallback={<p class="empty">No orders yet.</p>}>
          <ul class="orders">
            <For each={props.data.orders}>
              {order => (
                <li>
                  <span class="pkg-name">{order.id}</span>
                  <span class="pkg-desc">
                    {order.items.length} line{order.items.length === 1 ? "" : "s"} · placed {order.placedAt}
                  </span>
                  <span class="cart-price">${order.total.toFixed(2)}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Loading>
    </section>
  );
}

export const Checkout = block<Types>()({
  name: "Checkout",
  requires: { shop: true },
  init: initModel,
  data,
  update,
  actions,
  onActionError: (_act, error) =>
    error instanceof CardDeclinedError
      ? Msg.CardDeclined({ amount: error.amount })
      : error instanceof ActionInterruptedError
        ? Msg.CheckoutCancelled()
        : undefined,
  operations: { reset: () => Msg.RequestedReset() },
  view
});
