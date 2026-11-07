// The saga coordinator. In the original this is the generator's body and its
// catch block; here it is the update function reading `model.saga`.
//
//   ClickedPlaceOrder ─▶ ReserveInventory ─▶ ChargeCard ─▶ CreateOrder ─▶ done
//                              │                 │              │
//   ClickedCancelCheckout ─▶ <Step>.Interrupt ───┴──────────────┘
//                              │
//   declined or cancelled ─▶ compensate in reverse: RefundCharge, ReleaseReservation

import { Array, Number, Option } from 'effect'
import { AsyncData, type Command } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { CartItem, Reservation } from '../api'
import {
  ChargeCard,
  CreateOrder,
  FetchOrders,
  RefundCharge,
  ReleaseReservation,
  ReserveInventory,
} from './command'
import {
  CheckoutComposition,
  Compensation,
  Message,
  type Model,
  Notice,
  Orders,
  type Phase,
  Saga,
  Unwind,
  makeFieldsStep,
} from './definition'

export const INITIAL_CART: ReadonlyArray<CartItem> = [
  {
    id: 'sku_signal',
    name: 'Signal (fine-grained)',
    price: 19.99,
    quantity: 1,
  },
  { id: 'sku_fiber', name: 'Fiber (interruptible)', price: 24.5, quantity: 2 },
  { id: 'sku_boundary', name: 'Boundary (loading)', price: 9.75, quantity: 1 },
]

export const cartTotal = (items: ReadonlyArray<CartItem>): number =>
  Array.reduce(items, 0, (sum, item) => sum + item.price * item.quantity)

const money = (amount: number) => `$${amount.toFixed(2)}`

export const init = CheckoutComposition.makeInit(() => ({
  model: {
    cart: INITIAL_CART,
    declineCard: false,
    saga: Saga.Idle(),
    maybeNotice: Option.none(),
    orders: Orders.Loading(),
  },
  commands: [FetchOrders()],
}))

type Running = Extract<Saga, { _tag: 'Running' }>
type Compensating = Extract<Saga, { _tag: 'Compensating' }>

const interruptStep = (phase: Phase) => {
  const toMessage = (outcome: typeof Command.Interruptible.Outcome.Type) =>
    Message.CompletedCancelCheckoutStep({ outcome })
  if (phase === 'Reserving') {
    return ReserveInventory.Interrupt(toMessage)
  }
  if (phase === 'Charging') {
    return ChargeCard.Interrupt(toMessage)
  }
  return CreateOrder.Interrupt(toMessage)
}

const compensationCommand = (compensation: Compensation) =>
  Compensation.match(compensation, {
    RefundCharge: ({ charge }) => RefundCharge({ charge }),
    ReleaseReservation: ({ reservation }) =>
      ReleaseReservation({ reservation }),
  })

const unwindNotice = (unwind: Unwind): Notice =>
  Unwind.match(unwind, {
    Declined: ({ amount }) =>
      Notice.make({
        kind: 'error',
        text: `Card declined for ${money(amount)} — refunds/releases applied, cart untouched`,
      }),
    Cancelled: () =>
      Notice.make({
        kind: 'info',
        text: 'Checkout cancelled — compensations ran, cart untouched',
      }),
  })

const finishUnwind = (model: Model, unwind: Unwind) => ({
  model: modifyFields(model, {
    saga: () => Saga.Idle(),
    maybeNotice: () => Option.some(unwindNotice(unwind)),
  }),
})

/** Run the next compensation, or finish once none are left. */
const continueUnwind = (
  model: Model,
  phase: Phase,
  queue: ReadonlyArray<Compensation>,
  unwind: Unwind,
) =>
  Option.match(Array.head(queue), {
    onNone: () => finishUnwind(model, unwind),
    onSome: next => ({
      model: modifyFields(model, {
        saga: () => Saga.Compensating({ phase, queue, unwind }),
      }),
      commands: [compensationCommand(next)],
    }),
  })

/** The original's catch block: compensate in reverse order of what committed.
 *  A step interrupted mid-flight cleaned up after itself in its finalizer. */
const beginUnwind = (model: Model, running: Running, unwind: Unwind) =>
  continueUnwind(
    model,
    running.phase,
    Array.getSomes([
      Option.map(running.maybeCharge, charge =>
        Compensation.RefundCharge({ charge }),
      ),
      Option.map(running.maybeReservation, reservation =>
        Compensation.ReleaseReservation({ reservation }),
      ),
    ]),
    unwind,
  )

/** Results that arrive after the saga moved on change nothing. */
const whenRunning = <Result>(
  model: Model,
  onRunning: (running: Running) => Result,
): Result | { model: Model } =>
  model.saga._tag === 'Running' ? onRunning(model.saga) : { model }

const whenCompensating = <Result>(
  model: Model,
  onCompensating: (compensating: Compensating) => Result,
): Result | { model: Model } =>
  model.saga._tag === 'Compensating' ? onCompensating(model.saga) : { model }

const withSaga = (model: Model, saga: Saga) => ({
  model: modifyFields(model, { saga: () => saga }),
})

export const update = CheckoutComposition.makeUpdate({
  ClickedDecrementQuantity: makeFieldsStep.fromMessage(({ itemId }) => ({
    cart: Array.map(item =>
      item.id === itemId && item.quantity > 1
        ? modifyFields(item, { quantity: Number.decrement })
        : item,
    ),
  })),

  ClickedIncrementQuantity: makeFieldsStep.fromMessage(({ itemId }) => ({
    cart: Array.map(item =>
      item.id === itemId
        ? modifyFields(item, { quantity: Number.increment })
        : item,
    ),
  })),

  ToggledDeclineCard: makeFieldsStep.fromMessage(({ declineCard }) => ({
    declineCard: () => declineCard,
  })),

  ClickedPlaceOrder: model =>
    Saga.match(model.saga, {
      Idle: () => {
        const items = model.cart
        return {
          model: modifyFields(model, {
            maybeNotice: () => Option.none(),
            saga: () =>
              Saga.Running({
                phase: 'Reserving',
                items,
                total: cartTotal(items),
                declineCard: model.declineCard,
                maybeReservation: Option.none(),
                maybeCharge: Option.none(),
                isCancelling: false,
              }),
          }),
          commands: [ReserveInventory({ items })],
        }
      },
      Running: () => ({ model }),
      Compensating: () => ({ model }),
    }),

  ClickedCancelCheckout: model =>
    whenRunning(model, running =>
      running.isCancelling
        ? { model }
        : {
            ...withSaga(
              model,
              modifyFields(running, { isCancelling: () => true }),
            ),
            commands: [interruptStep(running.phase)],
          },
    ),

  SucceededReserveInventory: (model, { reservation }) =>
    whenRunning(model, running => {
      const reserved = modifyFields(running, {
        maybeReservation: () => Option.some(reservation),
      })
      if (running.isCancelling) {
        // Lost the race with Cancel: the hold exists, so it must be released.
        return withSaga(model, reserved)
      }
      return {
        ...withSaga(model, modifyFields(reserved, { phase: () => 'Charging' })),
        commands: [
          ChargeCard({
            amount: running.total,
            declineCard: running.declineCard,
          }),
        ],
      }
    }),

  SucceededChargeCard: (model, { charge }) =>
    whenRunning(model, running => {
      const charged = modifyFields(running, {
        maybeCharge: () => Option.some(charge),
      })
      return Option.match(running.maybeReservation, {
        onNone: () => withSaga(model, charged),
        onSome: (reservation: Reservation) =>
          running.isCancelling
            ? withSaga(model, charged)
            : {
                ...withSaga(
                  model,
                  modifyFields(charged, { phase: () => 'Finalizing' }),
                ),
                commands: [
                  CreateOrder({ items: running.items, reservation, charge }),
                ],
              },
      })
    }),

  DeclinedChargeCard: (model, { amount }) =>
    whenRunning(model, running =>
      beginUnwind(model, running, Unwind.Declined({ amount })),
    ),

  SucceededCreateOrder: (model, { order }) =>
    whenRunning(model, () => ({
      model: modifyFields(model, {
        saga: () => Saga.Idle(),
        maybeNotice: () =>
          Option.some(
            Notice.make({
              kind: 'success',
              text: `Order ${order.id} confirmed — ${money(order.total)}`,
            }),
          ),
        orders: orders =>
          Option.getOrElse(AsyncData.revalidate(orders), () => orders),
      }),
      commands: [FetchOrders()],
    })),

  // Interrupted or NotFound, the step's key is free: compensate whatever
  // committed. A result that won the race has already been recorded.
  CompletedCancelCheckoutStep: model =>
    whenRunning(model, running =>
      running.isCancelling
        ? beginUnwind(model, running, Unwind.Cancelled())
        : { model },
    ),

  CompletedRefundCharge: model =>
    whenCompensating(model, ({ phase, queue, unwind }) =>
      continueUnwind(model, phase, Array.drop(queue, 1), unwind),
    ),

  CompletedReleaseReservation: model =>
    whenCompensating(model, ({ phase, queue, unwind }) =>
      continueUnwind(model, phase, Array.drop(queue, 1), unwind),
    ),

  SucceededFetchOrders: makeFieldsStep.fromMessage(({ orders }) => ({
    orders: () => Orders.Success({ data: orders }),
  })),
})
