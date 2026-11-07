// Markup follows solid/examples/effect/src/checkout.tsx.

import { Array, Option } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html } from 'foldkit/html'

import type { CartItem, PlacedOrder } from '../api'
import {
  CheckoutComposition,
  type CheckoutViewBuilder,
  Message,
  type Phase,
  Saga,
} from './definition'
import { cartTotal } from './update'

const STEPS: ReadonlyArray<Readonly<{ phase: Phase; label: string }>> = [
  { phase: 'Reserving', label: 'Reserve inventory' },
  { phase: 'Charging', label: 'Charge card' },
  { phase: 'Finalizing', label: 'Create order' },
]

const PHASE_ORDER: ReadonlyArray<Phase> = [
  'Reserving',
  'Charging',
  'Finalizing',
]

const money = (amount: number) => `$${amount.toFixed(2)}`

const currentPhase = (saga: Saga): Option.Option<Phase> =>
  Saga.match(saga, {
    Idle: () => Option.none(),
    Running: ({ phase }) => Option.some(phase),
    Compensating: ({ phase }) => Option.some(phase),
  })

const stepClass = (step: Phase, saga: Saga): string =>
  Option.match(currentPhase(saga), {
    onNone: () => '',
    onSome: current => {
      const currentIndex = PHASE_ORDER.indexOf(current)
      const stepIndex = PHASE_ORDER.indexOf(step)
      if (stepIndex < currentIndex) {
        return 'done'
      }
      return stepIndex === currentIndex ? 'active' : ''
    },
  })

const cartRowView = (
  item: CartItem,
  inFlight: boolean,
  h: CheckoutViewBuilder,
): Html =>
  h.keyed('div')(
    item.id,
    [h.Class('cart-row')],
    [
      h.span([h.Class('cart-name')], [item.name]),
      h.span(
        [h.Class('qty')],
        [
          h.button(
            [
              h.Disabled(inFlight || item.quantity <= 1),
              h.OnClick(Message.ClickedDecrementQuantity({ itemId: item.id })),
            ],
            ['−'],
          ),
          String(item.quantity),
          h.button(
            [
              h.Disabled(inFlight),
              h.OnClick(Message.ClickedIncrementQuantity({ itemId: item.id })),
            ],
            ['+'],
          ),
        ],
      ),
      h.span([h.Class('cart-price')], [money(item.price * item.quantity)]),
    ],
  )

const ordersView = (
  orders: ReadonlyArray<PlacedOrder>,
  h: CheckoutViewBuilder,
): Html =>
  Array.isReadonlyArrayNonEmpty(orders)
    ? h.ul(
        [h.Class('orders')],
        Array.map(orders, order =>
          h.keyed('li')(
            order.id,
            [],
            [
              h.span([h.Class('pkg-name')], [order.id]),
              h.span(
                [h.Class('pkg-desc')],
                [
                  `${order.items.length} line${order.items.length === 1 ? '' : 's'} · placed ${order.placedAt}`,
                ],
              ),
              h.span([h.Class('cart-price')], [money(order.total)]),
            ],
          ),
        ),
      )
    : h.p([h.Class('empty')], ['No orders yet.'])

export const view = CheckoutComposition.makeView((model, h) => {
  const total = cartTotal(model.cart)
  const inFlight = model.saga._tag !== 'Idle'
  const isCompensating = model.saga._tag === 'Compensating'

  return h.section(
    [h.Class('panel')],
    [
      h.header(
        [],
        [
          h.h2([], ['Checkout saga']),
          h.p(
            [],
            [
              'Three Effect steps, each its own interruptible Command. Cancel mid-charge (it takes ~2.6s) or toggle the decline: the fiber is interrupted, update runs the compensations in reverse order, and the UI returns to idle.',
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('cart')],
        [
          ...Array.map(model.cart, item => cartRowView(item, inFlight, h)),
          h.div(
            [h.Class('cart-row total')],
            [
              h.span([h.Class('cart-name')], ['Total']),
              h.span([h.Class('cart-price')], [money(total)]),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('checkout-controls')],
        [
          h.label(
            [h.Class('decline-toggle')],
            [
              h.input([
                h.Type('checkbox'),
                h.Checked(model.declineCard),
                h.OnChange(() =>
                  Message.ToggledDeclineCard({
                    declineCard: !model.declineCard,
                  }),
                ),
              ]),
              'Simulate card decline (typed ',
              h.code([], ['CardDeclinedError']),
              ')',
            ],
          ),
          inFlight
            ? h.button(
                [
                  h.Class('danger'),
                  // Compensation is not cancellable (see README parity notes).
                  h.Disabled(isCompensating),
                  h.OnClick(Message.ClickedCancelCheckout()),
                ],
                ['Cancel checkout'],
              )
            : h.button(
                [h.Class('primary'), h.OnClick(Message.ClickedPlaceOrder())],
                [`Place order — ${money(total)}`],
              ),
        ],
      ),
      h.ol(
        [h.Class('steps')],
        Array.map(STEPS, step =>
          h.keyed('li')(
            step.phase,
            [h.Class(stepClass(step.phase, model.saga))],
            [step.label],
          ),
        ),
      ),
      Option.match(model.maybeNotice, {
        onNone: () => h.empty,
        onSome: notice =>
          h.p([h.Class(`notice ${notice.kind}`)], [notice.text]),
      }),
      h.h3([], ['Your orders']),
      AsyncData.matchData(model.orders, {
        onEmpty: () => h.p([h.Class('loading')], ['Loading orders…']),
        onFailure: () => h.empty,
        onData: orders => ordersView(orders, h),
      }),
    ],
  )
})
