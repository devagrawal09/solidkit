import { Schema } from 'effect'
import { AsyncData, Block, Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'

import { CartItem, Charge, PlacedOrder, Reservation } from '../api'

// MODEL
//
// The Solid original keeps the saga's progress in local variables of an
// action generator (`reservation`, `charge`) plus an optimistic `phase`
// signal that reverts when the action settles. Here that state is explicit:
// `saga` records which step is in flight and what has committed, so update
// can decide what to compensate when a step fails or is cancelled.

export const Phase = Schema.Literals(['Reserving', 'Charging', 'Finalizing'])
export type Phase = typeof Phase.Type

/** Why a saga is being unwound. */
export const Unwind = defineTaggedUnion({
  Declined: { amount: Schema.Number },
  Cancelled: {},
})
export type Unwind = typeof Unwind.Type

/** One compensating action. */
export const Compensation = defineTaggedUnion({
  RefundCharge: { charge: Charge },
  ReleaseReservation: { reservation: Reservation },
})
export type Compensation = typeof Compensation.Type

export const Saga = defineTaggedUnion({
  Idle: {},
  Running: {
    phase: Phase,
    items: Schema.Array(CartItem),
    total: Schema.Number,
    declineCard: Schema.Boolean,
    maybeReservation: Schema.Option(Reservation),
    maybeCharge: Schema.Option(Charge),
    isCancelling: Schema.Boolean,
  },
  /** Compensations run one at a time, in reverse order of what committed.
   *  The head of `queue` is in flight. */
  Compensating: {
    phase: Phase,
    queue: Schema.Array(Compensation),
    unwind: Unwind,
  },
})
export type Saga = typeof Saga.Type

export const NoticeKind = Schema.Literals(['success', 'error', 'info'])

export const Notice = Schema.Struct({ kind: NoticeKind, text: Schema.String })
export type Notice = typeof Notice.Type

export const Orders = AsyncData.Schema(Schema.Array(PlacedOrder), Schema.Never)

export const Model = Schema.Struct({
  cart: Schema.Array(CartItem),
  declineCard: Schema.Boolean,
  saga: Saga,
  maybeNotice: Schema.Option(Notice),
  orders: Orders.schema,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedDecrementQuantity: { itemId: Schema.String },
  ClickedIncrementQuantity: { itemId: Schema.String },
  ToggledDeclineCard: { declineCard: Schema.Boolean },
  ClickedPlaceOrder: {},
  ClickedCancelCheckout: {},
  SucceededReserveInventory: { reservation: Reservation },
  SucceededChargeCard: { charge: Charge },
  DeclinedChargeCard: { amount: Schema.Number },
  SucceededCreateOrder: { order: PlacedOrder },
  CompletedCancelCheckoutStep: { outcome: Command.Interruptible.Outcome },
  CompletedRefundCharge: {},
  CompletedReleaseReservation: {},
  SucceededFetchOrders: { orders: Schema.Array(PlacedOrder) },
})

export const CheckoutDefinition = Block.makeDefinition('Checkout', {
  Model,
  Message,
})

export const { makeFieldsStep, makeNoopStep } = CheckoutDefinition

export const CheckoutComposition = CheckoutDefinition.makeComposition()
export type CheckoutViewBuilder = Block.ViewBuilderFor<
  typeof CheckoutComposition
>
