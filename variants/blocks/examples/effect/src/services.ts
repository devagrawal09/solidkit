// The app's I/O as plain functions, for kernel.services: recorded live,
// replayed while time traveling, scripted in tests. Each Effect program runs
// through runEffect, so it is an AsyncIterable whose close interrupts its fiber.
import { Effect } from "effect";
import { getOwner, runWithOwner } from "solid-js";
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
  type Reservation
} from "./api.ts";
import { runEffect } from "./solid-effect.ts";

/**
 * Create under <RuntimeContext>: runEffect resolves its runtime (which
 * provides SearchConfig) from Solid context, at the owner captured here.
 */
export function createServices() {
  const owner = getOwner();
  const fiber = <A, E, R>(program: Effect.Effect<A, E, R>) => runWithOwner(owner, () => runEffect(program));
  return {
    registry: {
      search: (query: string) => fiber(searchPackages(query))
    },
    shop: {
      fetchOrders: () => fetchOrders(),
      reserve: (items: CartItem[]) => fiber(reserveInventory(items)),
      charge: (amount: number, decline: boolean) => fiber(chargeCard(amount, decline)),
      createOrder: (items: CartItem[], reservation: Reservation, charge: Charge) => fiber(createOrder(items, reservation, charge)),
      refund: (charge: Charge) => fiber(refundCharge(charge)),
      release: (reservation: Reservation) => fiber(releaseReservation(reservation))
    }
  };
}

export type Services = ReturnType<typeof createServices>;
export type Registry = Services["registry"];
export type Shop = Services["shop"];

const isAsyncIterable = <A>(v: AsyncIterable<A> | PromiseLike<A>): v is AsyncIterable<A> => Symbol.asyncIterator in v;

/**
 * A recorded service call as one saga step. Interrupting the step closes the
 * source, which interrupts the fiber below the kernel, so its finalizers run.
 * (Scripted and replayed calls are plain promises.)
 */
export function step<A>(source: AsyncIterable<A> | PromiseLike<A>): Effect.Effect<A, unknown> {
  if (!isAsyncIterable(source)) return Effect.tryPromise({ try: () => Promise.resolve(source), catch: error => error });
  return Effect.async<A, unknown>(resume => {
    const it = source[Symbol.asyncIterator]();
    it.next().then(
      r => resume(r.done ? Effect.interrupt : Effect.succeed(r.value)),
      error => resume(Effect.fail(error))
    );
    return Effect.sync(() => void it.return?.());
  });
}
