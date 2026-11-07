// Client state for the demo: one slice per feature. Server data (search
// results, orders) is derived in shop.ts; in-flight progress is optimistic.
import { slice } from "@solidkit/slices";
import type { CartItem } from "./api";

export type Tab = "typeahead" | "checkout";
const shell: { tab: Tab } = { tab: "typeahead" };

export const shellSlice = slice("shell", shell, {
  tabSelected(state, tab: Tab) {
    state.tab = tab;
  }
});

const search: { query: string } = { query: "" };

export const searchSlice = slice("search", search, {
  queryChanged(state, query: string) {
    state.query = query;
  }
});

export interface Notice {
  kind: "success" | "error" | "info";
  text: string;
}

export const INITIAL_CART: CartItem[] = [
  { id: "sku_signal", name: "Signal (fine-grained)", price: 19.99, quantity: 1 },
  { id: "sku_fiber", name: "Fiber (interruptible)", price: 24.5, quantity: 2 },
  { id: "sku_boundary", name: "Boundary (loading)", price: 9.75, quantity: 1 }
];

type CheckoutState = { cart: CartItem[]; declineCard: boolean; notice: Notice | null };
const checkout: CheckoutState = { cart: INITIAL_CART, declineCard: false, notice: null };

export const checkoutSlice = slice("checkout", checkout, {
  incremented(state, index: number) {
    state.cart[index].quantity++;
  },
  decremented(state, index: number) {
    if (state.cart[index].quantity > 1) state.cart[index].quantity--;
  },
  declineToggled(state, decline: boolean) {
    state.declineCard = decline;
  },
  /** The outcome of the last checkout (or none). */
  noticeShown(state, notice: Notice | null) {
    state.notice = notice;
  }
});

export const totalOf = (items: readonly CartItem[]) => items.reduce((sum, item) => sum + item.price * item.quantity, 0);
