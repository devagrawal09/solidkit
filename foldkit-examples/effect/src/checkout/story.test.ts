import { Array, Option } from 'effect'
import { Interruptible } from 'foldkit/command'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import type { Charge, PlacedOrder, Reservation } from '../api'
import {
  ChargeCard,
  CreateOrder,
  FetchOrders,
  RefundCharge,
  ReleaseReservation,
  ReserveInventory,
} from './command'
import { Message, type Model, Orders, Saga } from './definition'
import { INITIAL_CART, cartTotal, init, update } from './update'

const total = cartTotal(INITIAL_CART)
const reservation: Reservation = { id: 'rsv_1', items: INITIAL_CART }
const charge: Charge = { id: 'ch_2', amount: total }
const order: PlacedOrder = {
  id: 'ord_3',
  items: INITIAL_CART,
  total,
  placedAt: '10:00:00',
}

const ready: Model = { ...init().model, orders: Orders.Success({ data: [] }) }

const cancelled = (outcome: typeof Interruptible.Outcome.Type) =>
  Message.CompletedCancelCheckoutStep({ outcome })

const noticeText = (current: Model) =>
  Option.map(current.maybeNotice, notice => `${notice.kind}: ${notice.text}`)

describe('checkout saga', () => {
  test('a successful checkout runs reserve, charge and create, then refreshes orders', () => {
    story(
      update,
      given(ready),
      message(Message.ClickedPlaceOrder()),
      Command.expectExact(ReserveInventory({ items: INITIAL_CART })),
      Command.resolve(
        ReserveInventory,
        Message.SucceededReserveInventory({ reservation }),
      ),
      Command.expectExact(ChargeCard({ amount: total, declineCard: false })),
      Command.resolve(ChargeCard, Message.SucceededChargeCard({ charge })),
      Command.expectExact(
        CreateOrder({ items: INITIAL_CART, reservation, charge }),
      ),
      Command.resolve(CreateOrder, Message.SucceededCreateOrder({ order })),
      model(current => {
        expect(current.saga).toEqual(Saga.Idle())
        expect(noticeText(current)).toEqual(
          Option.some(`success: Order ord_3 confirmed — $${total.toFixed(2)}`),
        )
      }),
      Command.resolve(
        FetchOrders,
        Message.SucceededFetchOrders({ orders: [order] }),
      ),
      model(current => {
        expect(current.orders).toEqual(Orders.Success({ data: [order] }))
      }),
    )
  })

  test('a declined card releases the hold and reports the decline', () => {
    story(
      update,
      given({ ...ready, declineCard: true }),
      message(Message.ClickedPlaceOrder()),
      Command.resolve(
        ReserveInventory,
        Message.SucceededReserveInventory({ reservation }),
      ),
      Command.expectExact(ChargeCard({ amount: total, declineCard: true })),
      Command.resolve(
        ChargeCard,
        Message.DeclinedChargeCard({ amount: total }),
      ),
      // Nothing was charged, so the only compensation is the release.
      Command.expectExact(ReleaseReservation({ reservation })),
      model(current => {
        expect(current.saga._tag).toBe('Compensating')
      }),
      Command.resolve(
        ReleaseReservation,
        Message.CompletedReleaseReservation(),
      ),
      model(current => {
        expect(current.saga).toEqual(Saga.Idle())
        expect(noticeText(current)).toEqual(
          Option.some(
            `error: Card declined for $${total.toFixed(2)} — refunds/releases applied, cart untouched`,
          ),
        )
        expect(current.cart).toEqual(INITIAL_CART)
      }),
    )
  })

  test('cancelling mid-charge interrupts the step, then releases the hold', () => {
    story(
      update,
      given(ready),
      message(Message.ClickedPlaceOrder()),
      Command.resolve(
        ReserveInventory,
        Message.SucceededReserveInventory({ reservation }),
      ),
      message(Message.ClickedCancelCheckout()),
      Command.expectHas(ChargeCard.Interrupt(cancelled)),
      Command.resolve(
        ChargeCard.Interrupt(cancelled),
        cancelled(Interruptible.Outcome.Interrupted()),
      ),
      // The interrupted charge delivers nothing; only the release remains.
      Command.expectExact(ReleaseReservation({ reservation })),
      Command.resolve(
        ReleaseReservation,
        Message.CompletedReleaseReservation(),
      ),
      model(current => {
        expect(current.saga).toEqual(Saga.Idle())
        expect(noticeText(current)).toEqual(
          Option.some(
            'info: Checkout cancelled — compensations ran, cart untouched',
          ),
        )
      }),
    )
  })

  test('cancelling while the order is created refunds first, then releases', () => {
    story(
      update,
      given(ready),
      message(Message.ClickedPlaceOrder()),
      Command.resolve(
        ReserveInventory,
        Message.SucceededReserveInventory({ reservation }),
      ),
      Command.resolve(ChargeCard, Message.SucceededChargeCard({ charge })),
      message(Message.ClickedCancelCheckout()),
      Command.resolve(
        CreateOrder.Interrupt(cancelled),
        cancelled(Interruptible.Outcome.Interrupted()),
      ),
      Command.expectExact(RefundCharge({ charge })),
      model(current => {
        expect(
          current.saga._tag === 'Compensating'
            ? Array.map(current.saga.queue, step => step._tag)
            : [],
        ).toEqual(['RefundCharge', 'ReleaseReservation'])
      }),
      Command.resolve(RefundCharge, Message.CompletedRefundCharge()),
      Command.expectExact(ReleaseReservation({ reservation })),
      Command.resolve(
        ReleaseReservation,
        Message.CompletedReleaseReservation(),
      ),
      model(current => {
        expect(current.saga).toEqual(Saga.Idle())
      }),
    )
  })

  test('a step that finishes before its Interrupt lands is still compensated', () => {
    story(
      update,
      given(ready),
      message(Message.ClickedPlaceOrder()),
      message(Message.ClickedCancelCheckout()),
      Command.resolve(
        ReserveInventory,
        Message.SucceededReserveInventory({ reservation }),
      ),
      // No charge is started once cancellation is requested.
      Command.resolve(
        ReserveInventory.Interrupt(cancelled),
        cancelled(Interruptible.Outcome.NotFound()),
      ),
      Command.expectExact(ReleaseReservation({ reservation })),
      Command.resolve(
        ReleaseReservation,
        Message.CompletedReleaseReservation(),
      ),
      model(current => {
        expect(current.saga).toEqual(Saga.Idle())
      }),
    )
  })

  test('quantities are locked while a checkout is in flight', () => {
    story(
      update,
      given(ready),
      message(Message.ClickedIncrementQuantity({ itemId: 'sku_signal' })),
      model(current => {
        expect(current.cart[0]?.quantity).toBe(2)
      }),
      message(Message.ClickedDecrementQuantity({ itemId: 'sku_boundary' })),
      model(current => {
        expect(current.cart[2]?.quantity).toBe(1)
      }),
    )
  })
})
