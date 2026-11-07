// The effect demo as one program: a typeahead (read path) and a checkout saga
// (action path), with the fiber event log as client state.
import { createMemo, createOptimistic, createOptimisticStore, refresh } from "solid-js";
import { Effect } from "effect";
import { variants, type Handlers, type ProgramSpec, type Subscription } from "@solidkit/messages";
import { CardDeclinedError, type CartItem, type Charge, type Order, type Package, type Reservation } from "./api.ts";
import { onLog, type LogEntry } from "./log.ts";
import { ActionInterruptedError, effectAction } from "./solid-effect.ts";
import type { Services } from "./services.ts";

export type Tab = "typeahead" | "checkout";
export type Phase = "idle" | "reserving" | "charging" | "finalizing";
export interface Notice {
  kind: "success" | "error" | "info";
  text: string;
}

export type Model = {
  tab: Tab;
  query: string;
  cart: CartItem[];
  declineCard: boolean;
  /** The last checkout's outcome. Survives the optimistic revert of the phase. */
  notice: Notice | null;
  /** Fiber lifecycle events, newest last, capped at 100. */
  log: LogEntry[];
};

export const INITIAL_CART: CartItem[] = [
  { id: "sku_signal", name: "Signal (fine-grained)", price: 19.99, quantity: 1 },
  { id: "sku_fiber", name: "Fiber (interruptible)", price: 24.5, quantity: 2 },
  { id: "sku_boundary", name: "Boundary (loading)", price: 9.75, quantity: 1 }
];

export const init = (): Model => ({
  tab: "typeahead",
  query: "",
  cart: INITIAL_CART.map(item => ({ ...item })),
  declineCard: false,
  notice: null,
  log: []
});

export const total = (items: readonly CartItem[]) => items.reduce((sum, item) => sum + item.price * item.quantity, 0);

// ── Messages and actions ──────────────────────────────────────────────────────

export type Msg =
  | { type: "ClickedTab"; tab: Tab }
  | { type: "ChangedQuery"; text: string }
  | { type: "ChangedQuantity"; id: string; by: 1 | -1 }
  | { type: "ToggledDecline"; decline: boolean }
  | { type: "ClickedPlaceOrder" }
  | { type: "ClickedCancel" }
  | { type: "PlacedOrder"; order: Order }
  | { type: "CardDeclined"; amount: number }
  | { type: "CheckoutCancelled" }
  | { type: "CheckoutFailed" }
  | { type: "Logged"; entry: LogEntry }
  | { type: "ClickedClearLog" };
export const Msg = variants<Msg>();

export type Act = { type: "placeOrder"; items: CartItem[]; decline: boolean } | { type: "cancelCheckout" };
export const Act = variants<Act>();

export function update(model: Model, msg: Msg): Act | void {
  switch (msg.type) {
    case "ClickedTab":
      model.tab = msg.tab;
      return;
    case "ChangedQuery":
      model.query = msg.text;
      return;
    case "ChangedQuantity": {
      const item = model.cart.find(i => i.id === msg.id);
      if (item) item.quantity = Math.max(1, item.quantity + msg.by);
      return;
    }
    case "ToggledDecline":
      model.declineCard = msg.decline;
      return;
    case "ClickedPlaceOrder":
      return Act.placeOrder({ items: model.cart.map(item => ({ ...item })), decline: model.declineCard });
    case "ClickedCancel":
      return Act.cancelCheckout();
    case "PlacedOrder":
      model.notice = { kind: "success", text: `Order ${msg.order.id} confirmed — $${msg.order.total.toFixed(2)}` };
      return;
    case "CardDeclined":
      model.notice = {
        kind: "error",
        text: `Card declined for $${msg.amount.toFixed(2)} — refunds/releases applied, cart untouched`
      };
      return;
    case "CheckoutCancelled":
      model.notice = { kind: "info", text: "Checkout cancelled — compensations ran, cart untouched" };
      return;
    case "CheckoutFailed":
      model.notice = null;
      return;
    case "Logged":
      model.log.push(msg.entry);
      if (model.log.length > 100) model.log.splice(0, model.log.length - 100);
      return;
    case "ClickedClearLog":
      model.log.length = 0;
      return;
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────

export function data(model: Model, services: Services) {
  // The whole read path: one memo keyed on the query. Superseded searches are
  // interrupted (the service ties the fiber to this computation's run).
  const results = createMemo<Package[]>(() => {
    const q = model.query.trim();
    if (!q) return [];
    return services.search(q);
  });
  const [orders] = createOptimisticStore<Order[]>(() => services.fetchOrders(), []);
  // Transition-scoped: the saga's writes revert when it settles (success, failure or cancel).
  const [phase, setPhase] = createOptimistic<Phase>("idle");
  return { results, orders, phase, setPhase };
}
export type Data = ReturnType<typeof data>;

// ── Actions: the checkout saga ────────────────────────────────────────────────

export const actions = ({ orders, setPhase }: Data, { checkout }: Services): Handlers<Act, Msg> => {
  // A service call as a saga step: an Effect whose interruption aborts the call.
  const step = <A>(call: (signal: AbortSignal) => Promise<A>) => Effect.tryPromise({ try: call, catch: error => error });

  // The original saga, steps as services. Each `yield*` is a transaction step
  // running as an interruptible fiber; the phase writes are optimistic.
  const placeOrder = effectAction(function* (items: CartItem[], decline: boolean) {
    let reservation: Reservation | undefined;
    let charge: Charge | undefined;
    try {
      setPhase("reserving");
      const held = yield* step(signal => checkout.reserveInventory(items, signal));
      reservation = held;
      setPhase("charging");
      const paid = yield* step(signal => checkout.chargeCard(total(items), decline, signal));
      charge = paid;
      setPhase("finalizing");
      const order = yield* step(signal => checkout.createOrder(items, held, paid, signal));
      refresh(orders);
      return order;
    } catch (e) {
      // Saga compensation, in reverse order of what committed. Mid-step cleanup
      // (voiding a half-done authorization) already ran in the step's own fiber.
      const paid = charge;
      const held = reservation;
      if (paid) yield* step(signal => checkout.refundCharge(paid, signal));
      if (held) yield* step(signal => checkout.releaseReservation(held, signal));
      throw e; // reject → the optimistic phase reverts to "idle"; onActionError reports it
    }
  });

  return {
    *placeOrder({ items, decline }) {
      const order: Order = yield placeOrder(items, decline);
      return Msg.PlacedOrder({ order });
    },
    *cancelCheckout() {
      placeOrder.interrupt();
    }
  };
};

export function onActionError(act: Act, error: unknown): Msg | void {
  if (act.type !== "placeOrder") return;
  if (error instanceof CardDeclinedError) return Msg.CardDeclined({ amount: error.amount });
  if (error instanceof ActionInterruptedError) return Msg.CheckoutCancelled();
  return Msg.CheckoutFailed();
}

/** Fiber events become messages, sent from a fresh task. Entries can be emitted
 * synchronously inside a computation (a search forking its fiber) or inside an
 * action's step (a saga step's first ops), where a write is refused or would
 * join the action's transition and stay hidden until it settles. A microtask is
 * not enough: queued during the step, it runs before the step's flush and its
 * write joins that flush. */
export const fiberLog: Subscription<Msg> = {
  key: "fiber-log",
  start: send => onLog(entry => void setTimeout(() => send(Msg.Logged({ entry }))))
};

export const effectDemo: ProgramSpec<Model, Msg, Act, Data, Services> = {
  name: "effect",
  init,
  update,
  data,
  sources: data => [data.results, data.orders],
  actions,
  onActionError,
  subscriptions: () => [fiberLog]
};
