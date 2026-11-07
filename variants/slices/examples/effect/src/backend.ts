// The I/O boundary. api.ts's Effect programs are the fake backend; here they
// become Promise services that the kernel records, replays and scripts. Each
// takes an AbortSignal: aborting it interrupts the backend fiber, so its own
// finalizers run, exactly as when the original interrupted it directly.
//
// Why not hand the kernel runEffect's AsyncIterable? The kernel wraps
// iterables in an async generator, and a return() on that waits behind the
// pending next(), so a superseded search would run to completion instead of
// being interrupted. An abort signal reaches the fiber at once.
import { Cause, Effect, Exit, type ManagedRuntime } from "effect";
import * as api from "./api";

export function makeBackend(runtime: ManagedRuntime.ManagedRuntime<api.SearchConfig, never>) {
  const run = <A, E>(effect: Effect.Effect<A, E, api.SearchConfig>, signal?: AbortSignal): Promise<A> =>
    runtime
      .runPromiseExit(effect, { signal })
      .then(exit => (Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause))));
  return {
    searchPackages: (query: string, signal?: AbortSignal) => run(api.searchPackages(query), signal),
    fetchOrders: () => api.fetchOrders(),
    reserveInventory: (items: api.CartItem[], signal?: AbortSignal) => run(api.reserveInventory(items), signal),
    chargeCard: (amount: number, decline: boolean, signal?: AbortSignal) => run(api.chargeCard(amount, decline), signal),
    createOrder: (items: api.CartItem[], reservation: api.Reservation, charge: api.Charge, signal?: AbortSignal) =>
      run(api.createOrder(items, reservation, charge), signal),
    refundCharge: (charge: api.Charge, signal?: AbortSignal) => run(api.refundCharge(charge), signal),
    releaseReservation: (reservation: api.Reservation, signal?: AbortSignal) =>
      run(api.releaseReservation(reservation), signal)
  };
}

export type Backend = ReturnType<typeof makeBackend>;

/** A service call as an Effect: interrupting the fiber aborts the call. */
export const call = <A>(request: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: request, catch: error => error });
