// Client state: where the user is. One slice; the page on screen is derived.
import { slice } from "@solidkit/slices";
import type { Route } from "./routes";

const initial: { route: Route } = { route: { name: "stories", type: "top", page: 1 } };

export const navSlice = slice("nav", initial, {
  /** A link was followed, or the browser went back or forward. */
  navigated(state, route: Route) {
    state.route = route;
  }
});
