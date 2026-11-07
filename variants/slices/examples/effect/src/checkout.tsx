// Action path: the saga lives in shop.ts; this is the original view, reading
// the checkout slice and calling its mutations and the named action.
import { For, Loading, Show } from "solid-js";
import { Shop, type Phase } from "./shop";
import { totalOf } from "./state";

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "reserving", label: "Reserve inventory" },
  { phase: "charging", label: "Charge card" },
  { phase: "finalizing", label: "Create order" }
];

export function Checkout() {
  const { checkout, incremented, decremented, declineToggled, orders, phase, placeOrder, cancelCheckout } = Shop.use();
  const total = () => totalOf(checkout.cart);
  const inFlight = () => phase() !== "idle";
  const stepState = (step: Phase) => {
    const order: Phase[] = ["reserving", "charging", "finalizing"];
    const current = order.indexOf(phase());
    const target = order.indexOf(step);
    if (current === -1) return "";
    return target < current ? "done" : target === current ? "active" : "";
  };

  return (
    <section class="panel">
      <header>
        <h2>Checkout saga</h2>
        <p>
          Three Effect steps inside one Solid action transaction. Cancel mid-charge (it takes ~2.6s)
          or toggle the decline: the fiber is interrupted, compensations run server-side, and the
          optimistic UI reverts — automatically on both sides.
        </p>
      </header>

      <div class="cart">
        <For each={checkout.cart}>
          {(item, i) => (
            <div class="cart-row">
              <span class="cart-name">{item.name}</span>
              <span class="qty">
                <button disabled={inFlight() || item.quantity <= 1} onClick={() => decremented(i())}>
                  −
                </button>
                {item.quantity}
                <button disabled={inFlight()} onClick={() => incremented(i())}>
                  +
                </button>
              </span>
              <span class="cart-price">${(item.price * item.quantity).toFixed(2)}</span>
            </div>
          )}
        </For>
        <div class="cart-row total">
          <span class="cart-name">Total</span>
          <span class="cart-price">${total().toFixed(2)}</span>
        </div>
      </div>

      <div class="checkout-controls">
        <label class="decline-toggle">
          <input
            type="checkbox"
            checked={checkout.declineCard}
            onInput={e => declineToggled(e.currentTarget.checked)}
          />
          Simulate card decline (typed <code>CardDeclinedError</code>)
        </label>
        <Show
          when={inFlight()}
          fallback={
            <button
              class="primary"
              onClick={() =>
                placeOrder(
                  checkout.cart.map(item => ({ ...item })),
                  checkout.declineCard
                ).catch(() => {})
              }
            >
              Place order — ${total().toFixed(2)}
            </button>
          }
        >
          <button class="danger" onClick={() => cancelCheckout()}>
            Cancel checkout
          </button>
        </Show>
      </div>

      <ol class="steps">
        <For each={STEPS}>
          {step => (
            <li
              class={{
                done: stepState(step.phase) === "done",
                active: stepState(step.phase) === "active"
              }}
            >
              {step.label}
            </li>
          )}
        </For>
      </ol>

      <Show when={checkout.notice}>{n => <p class={`notice ${n().kind}`}>{n().text}</p>}</Show>

      <h3>Your orders</h3>
      <Loading fallback={<p class="loading">Loading orders…</p>}>
        <Show when={orders.length > 0} fallback={<p class="empty">No orders yet.</p>}>
          <ul class="orders">
            <For each={orders}>
              {order => (
                <li>
                  <span class="pkg-name">{order.id}</span>
                  <span class="pkg-desc">
                    {order.items.length} line{order.items.length === 1 ? "" : "s"} · placed{" "}
                    {order.placedAt}
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
