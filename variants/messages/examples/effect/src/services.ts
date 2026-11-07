// The services the program is given: every call goes through kernel.services
// (recorded live, replayed while rewound, scripted in tests). Each wraps one of
// the original Effect programs in api.ts, run on the app's runtime (which
// provides SearchConfig, the R channel).
import { Cause, Effect, Exit, type ManagedRuntime } from "effect";
import {
  chargeCard,
  createOrder,
  fetchOrders,
  refundCharge,
  releaseReservation,
  reserveInventory,
  searchPackages,
  type CartItem,
  type Charge,
  type Reservation,
  type SearchConfig
} from "./api.ts";
import { runEffectInterruptible } from "./solid-effect.ts";

export function createServices(runtime: ManagedRuntime.ManagedRuntime<SearchConfig, never>) {
  // A saga step's fiber passes its AbortSignal down: aborting interrupts this
  // fiber, so the program's own onInterrupt finalizers run (void the charge...).
  // Typed failures (CardDeclinedError) reject as themselves.
  const run = <A, E>(effect: Effect.Effect<A, E, SearchConfig>, signal?: AbortSignal): Promise<A> =>
    runtime.runPromiseExit(effect, { signal }).then(exit => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw Cause.squash(exit.cause);
    });
  return {
    /** Read path: superseded searches are interrupted (see runEffectInterruptible). */
    search: (query: string) => runEffectInterruptible(searchPackages(query), effect => runtime.runFork(effect)),
    fetchOrders: () => fetchOrders(),
    checkout: {
      reserveInventory: (items: CartItem[], signal?: AbortSignal) => run(reserveInventory(items), signal),
      chargeCard: (amount: number, decline: boolean, signal?: AbortSignal) => run(chargeCard(amount, decline), signal),
      createOrder: (items: CartItem[], reservation: Reservation, charge: Charge, signal?: AbortSignal) =>
        run(createOrder(items, reservation, charge), signal),
      refundCharge: (charge: Charge, signal?: AbortSignal) => run(refundCharge(charge), signal),
      releaseReservation: (reservation: Reservation, signal?: AbortSignal) => run(releaseReservation(reservation), signal)
    }
  };
}

export type Services = ReturnType<typeof createServices>;
