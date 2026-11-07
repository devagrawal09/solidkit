import { Effect, Layer, Schema } from 'effect'

import {
  CartItem,
  Charge,
  type CheckoutStore,
  Reservation,
  chargeCard,
  createOrder,
  fetchOrders,
  refundCharge,
  releaseReservation,
  reserveInventory,
} from '../api'
import type { EventLog } from '../eventLog'
import { CheckoutDefinition, Message } from './definition'

// Each saga step is its own Command and its own fiber, like each `yield*` in
// the original's `effectAction`. The three forward steps are interruptible:
// Cancel returns `<Step>.Interrupt`, which interrupts the running fiber and
// runs the program's `onInterrupt` finalizer (the in-step compensation).
// The handlers capture the Services the programs need (the `R` channel)
// once, when the Runtime builds the application Layer.

const capture = Effect.context<CheckoutStore | EventLog>()

export const ReserveInventory = CheckoutDefinition.makeCommand(
  'ReserveInventory',
  {
    args: { items: Schema.Array(CartItem) },
    messages: [Message.SucceededReserveInventory],
    interrupt: true,
    handler: function* () {
      const services = yield* capture
      return ({ items }) =>
        reserveInventory(items).pipe(
          Effect.map(reservation =>
            Message.SucceededReserveInventory({ reservation }),
          ),
          Effect.provideContext(services),
        )
    },
  },
)

export const ChargeCard = CheckoutDefinition.makeCommand('ChargeCard', {
  args: { amount: Schema.Number, declineCard: Schema.Boolean },
  messages: [Message.SucceededChargeCard, Message.DeclinedChargeCard],
  interrupt: true,
  handler: function* () {
    const services = yield* capture
    return ({ amount, declineCard }) =>
      chargeCard(amount, declineCard).pipe(
        Effect.map(charge => Message.SucceededChargeCard({ charge })),
        Effect.catchTag('CardDeclined', error =>
          Effect.succeed(Message.DeclinedChargeCard({ amount: error.amount })),
        ),
        Effect.provideContext(services),
      )
  },
})

export const CreateOrder = CheckoutDefinition.makeCommand('CreateOrder', {
  args: {
    items: Schema.Array(CartItem),
    reservation: Reservation,
    charge: Charge,
  },
  messages: [Message.SucceededCreateOrder],
  interrupt: true,
  handler: function* () {
    const services = yield* capture
    return ({ items, reservation, charge }) =>
      createOrder(items, reservation, charge).pipe(
        Effect.map(order => Message.SucceededCreateOrder({ order })),
        Effect.provideContext(services),
      )
  },
})

export const RefundCharge = CheckoutDefinition.makeCommand('RefundCharge', {
  args: { charge: Charge },
  messages: [Message.CompletedRefundCharge],
  handler: function* () {
    const services = yield* capture
    return ({ charge }) =>
      refundCharge(charge).pipe(
        Effect.as(Message.CompletedRefundCharge()),
        Effect.provideContext(services),
      )
  },
})

export const ReleaseReservation = CheckoutDefinition.makeCommand(
  'ReleaseReservation',
  {
    args: { reservation: Reservation },
    messages: [Message.CompletedReleaseReservation],
    handler: function* () {
      const services = yield* capture
      return ({ reservation }) =>
        releaseReservation(reservation).pipe(
          Effect.as(Message.CompletedReleaseReservation()),
          Effect.provideContext(services),
        )
    },
  },
)

export const FetchOrders = CheckoutDefinition.makeCommand('FetchOrders', {
  messages: [Message.SucceededFetchOrders],
  handler: function* () {
    const services = yield* capture
    return () =>
      fetchOrders.pipe(
        Effect.map(orders => Message.SucceededFetchOrders({ orders })),
        Effect.provideContext(services),
      )
  },
})

export const EffectsLayer = Layer.mergeAll(
  ReserveInventory.layer,
  ChargeCard.layer,
  CreateOrder.layer,
  RefundCharge.layer,
  ReleaseReservation.layer,
  FetchOrders.layer,
)
