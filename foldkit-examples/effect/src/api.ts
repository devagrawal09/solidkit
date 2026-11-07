// Port of solid/examples/effect/src/api.ts: fake backends written as Effect
// programs. Typed errors (Data.TaggedError), declarative retry/timeout
// policies and interruption finalizers (onInterrupt) are declared here, on
// the programs. The Blocks only see Commands and their result Messages.
//
// Changes from the Effect 3 original: `Context.Tag` is `Context.Service`,
// `Effect.sync(() => log(...))` is `log(...)` against the EventLog Service,
// randomness comes from `Random`, and the module-level ORDERS array and `seq`
// counter live in Refs owned by the `CheckoutStore` Layer.

import {
  Array,
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Order,
  Random,
  Ref,
  Schedule,
  Schema,
} from 'effect'

import { log } from './eventLog'

// ---------------------------------------------------------------------------
// Search (read path)
// ---------------------------------------------------------------------------

export const Package = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  downloads: Schema.Number,
})
export type Package = typeof Package.Type

export class TransientNetworkError extends Data.TaggedError(
  'TransientNetwork',
)<{
  readonly query: string
}> {}

const REGISTRY: ReadonlyArray<Package> = [
  {
    name: 'solid-js',
    description: 'Fine-grained reactive UI library',
    downloads: 1_450_000,
  },
  {
    name: '@solidjs/web',
    description: 'Solid web platform runtime',
    downloads: 1_310_000,
  },
  {
    name: '@solidjs/signals',
    description: 'Standalone reactive primitives',
    downloads: 890_000,
  },
  {
    name: '@solidjs/router',
    description: 'Universal router for Solid',
    downloads: 640_000,
  },
  {
    name: '@solidjs/start',
    description: 'Fullstack Solid meta-framework',
    downloads: 410_000,
  },
  {
    name: '@solidjs/meta',
    description: 'Document head management',
    downloads: 350_000,
  },
  {
    name: 'solid-devtools',
    description: 'Reactivity graph devtools',
    downloads: 120_000,
  },
  {
    name: 'solid-transition-group',
    description: 'Enter/exit animations',
    downloads: 95_000,
  },
  {
    name: 'effect',
    description: 'Typed functional effect system',
    downloads: 980_000,
  },
  {
    name: '@effect/platform',
    description: 'Cross-platform runtime services',
    downloads: 420_000,
  },
  {
    name: '@effect/schema',
    description: 'Schema validation and transformation',
    downloads: 510_000,
  },
  {
    name: '@effect/cli',
    description: 'Declarative command-line apps',
    downloads: 88_000,
  },
  {
    name: '@effect-atom/atom-solid',
    description: 'Effect Atom bindings for Solid 1.x',
    downloads: 12_000,
  },
  {
    name: 'vite',
    description: 'Next generation frontend tooling',
    downloads: 12_400_000,
  },
  {
    name: 'vitest',
    description: 'Vite-native test runner',
    downloads: 6_200_000,
  },
  {
    name: 'vinxi',
    description: 'Full-stack JS SDK on Nitro + Vite',
    downloads: 380_000,
  },
  {
    name: 'seroval',
    description: 'Universal value serialization',
    downloads: 1_100_000,
  },
  {
    name: 'typescript',
    description: 'Typed superset of JavaScript',
    downloads: 48_000_000,
  },
  {
    name: 'esbuild',
    description: 'Extremely fast bundler',
    downloads: 32_000_000,
  },
  {
    name: 'rollup',
    description: 'Module bundler for libraries',
    downloads: 21_000_000,
  },
  {
    name: 'terser',
    description: 'JavaScript mangler and compressor',
    downloads: 19_000_000,
  },
  {
    name: 'prettier',
    description: 'Opinionated code formatter',
    downloads: 27_000_000,
  },
  {
    name: 'zod',
    description: 'TypeScript-first schema validation',
    downloads: 14_000_000,
  },
  {
    name: 'hono',
    description: 'Small, fast web framework',
    downloads: 2_100_000,
  },
  {
    name: 'nitro',
    description: 'Universal server toolkit',
    downloads: 950_000,
  },
  {
    name: 'oxc-parser',
    description: 'Rust-based JS/TS parser',
    downloads: 260_000,
  },
  {
    name: 'turbo',
    description: 'Incremental monorepo build system',
    downloads: 3_400_000,
  },
  {
    name: 'pnpm',
    description: 'Fast, disk-efficient package manager',
    downloads: 8_900_000,
  },
]

/** A Service the search program requires (the `R` channel): latency and
 *  failure characteristics come from the environment, not the call site. The
 *  original provides it through a ManagedRuntime on Solid context; here the
 *  Program's `ApplicationLayer` provides it below the handler Layers. */
export class SearchConfig extends Context.Service<
  SearchConfig,
  Readonly<{ flakiness: number; baseLatencyMs: number }>
>()('SearchConfig') {}

export const SearchConfigLive = Layer.succeed(SearchConfig, {
  flakiness: 0.35,
  baseLatencyMs: 250,
})

const byDownloadsDescending = Order.flip(
  Order.mapInput(Order.Number, (pkg: Package) => pkg.downloads),
)

/**
 * Search the fake registry. The program:
 *  - requires `SearchConfig` (and `EventLog`) from the environment,
 *  - carries realistic latency,
 *  - fails transiently (per config), retried up to 3 times with exponential
 *    backoff (typed `while`: only TransientNetwork retries),
 *  - times out at 4s,
 *  - logs interruption via a finalizer, which is what fires when the next
 *    keystroke returns `SearchPackages.Interrupt` and Foldkit interrupts
 *    the fiber.
 */
export const searchPackages = (query: string) => {
  const attempt = Effect.gen(function* () {
    const { flakiness, baseLatencyMs } = yield* SearchConfig
    const jitter = yield* Random.next
    yield* Effect.sleep(Duration.millis(baseLatencyMs + jitter * 550))
    const roll = yield* Random.next
    if (roll < flakiness) {
      yield* log(
        'retry',
        `search "${query}" hit a transient error — retrying with backoff`,
      )
      return yield* new TransientNetworkError({ query })
    }
    const q = query.toLowerCase()
    return Array.sort(
      Array.filter(
        REGISTRY,
        pkg =>
          pkg.name.toLowerCase().includes(q) ||
          pkg.description.toLowerCase().includes(q),
      ),
      byDownloadsDescending,
    )
  })

  return Effect.gen(function* () {
    yield* log('start', `search "${query}" — fiber started`)
    return yield* attempt.pipe(
      Effect.retry({
        schedule: Schedule.exponential(Duration.millis(150)),
        times: 3,
        while: error => error._tag === 'TransientNetwork',
      }),
    )
  }).pipe(
    Effect.timeout(Duration.seconds(4)),
    Effect.tap(results =>
      log('success', `search "${query}" → ${results.length} results`),
    ),
    Effect.tapError(error =>
      log('error', `search "${query}" failed for good: ${error._tag}`),
    ),
    Effect.onInterrupt(() =>
      log(
        'interrupt',
        `search "${query}" interrupted — fiber + pending retries torn down`,
      ),
    ),
  )
}

// ---------------------------------------------------------------------------
// Checkout (action path)
// ---------------------------------------------------------------------------

export const CartItem = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  price: Schema.Number,
  quantity: Schema.Number,
})
export type CartItem = typeof CartItem.Type

export const Reservation = Schema.Struct({
  id: Schema.String,
  items: Schema.Array(CartItem),
})
export type Reservation = typeof Reservation.Type

export const Charge = Schema.Struct({
  id: Schema.String,
  amount: Schema.Number,
})
export type Charge = typeof Charge.Type

export const PlacedOrder = Schema.Struct({
  id: Schema.String,
  items: Schema.Array(CartItem),
  total: Schema.Number,
  placedAt: Schema.String,
})
export type PlacedOrder = typeof PlacedOrder.Type

export class CardDeclinedError extends Data.TaggedError('CardDeclined')<{
  readonly amount: number
}> {}

/** The original's module-level "database" (ORDERS and `seq`), as Refs whose
 *  lifetime is the application's. */
export class CheckoutStore extends Context.Service<
  CheckoutStore,
  Readonly<{
    orders: Ref.Ref<ReadonlyArray<PlacedOrder>>
    seq: Ref.Ref<number>
  }>
>()('CheckoutStore') {}

export const CheckoutStoreLayer = Layer.effect(
  CheckoutStore,
  Effect.gen(function* () {
    const orders = yield* Ref.make<ReadonlyArray<PlacedOrder>>([])
    const seq = yield* Ref.make(0)
    return { orders, seq }
  }),
)

const nextSeq = Effect.gen(function* () {
  const store = yield* CheckoutStore
  return yield* Ref.updateAndGet(store.seq, current => current + 1)
})

const money = (amount: number) => `$${amount.toFixed(2)}`

export const fetchOrders = Effect.gen(function* () {
  yield* Effect.sleep(Duration.millis(300))
  const store = yield* CheckoutStore
  return yield* Ref.get(store.orders)
})

/** Step 1: hold inventory. ~900ms. */
export const reserveInventory = (items: ReadonlyArray<CartItem>) =>
  Effect.gen(function* () {
    yield* log('start', 'reserveInventory — placing hold')
    yield* Effect.sleep(Duration.millis(900))
    const reservation: Reservation = { id: `rsv_${yield* nextSeq}`, items }
    yield* log('success', `reserveInventory → ${reservation.id} held`)
    return reservation
  }).pipe(
    Effect.onInterrupt(() =>
      log('interrupt', 'reserveInventory interrupted — no hold placed'),
    ),
  )

/** Compensation for step 1: release a hold that was successfully placed. */
export const releaseReservation = (reservation: Reservation) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(400))
    yield* log(
      'compensate',
      `releaseReservation → ${reservation.id} released (saga compensation)`,
    )
  })

/** Compensation for step 2: refund a charge that fully settled (the
 *  mid-flight case is covered by chargeCard's own onInterrupt finalizer). */
export const refundCharge = (charge: Charge) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(400))
    yield* log(
      'compensate',
      `refundCharge → ${charge.id} refunded ${money(charge.amount)} (saga compensation)`,
    )
  })

/**
 * Step 2: charge the card. Slow (~2.6s) so cancellation is clickable.
 * Declines with a typed CardDeclinedError when `declineCard` is set.
 * In-step compensation: interruption mid-charge voids the authorization via
 * a finalizer on the program itself.
 */
export const chargeCard = (amount: number, declineCard: boolean) => {
  const attempt = Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(2600))
    if (declineCard) {
      return yield* new CardDeclinedError({ amount })
    }
    const charge: Charge = { id: `ch_${yield* nextSeq}`, amount }
    yield* log('success', `chargeCard → ${charge.id} for ${money(amount)}`)
    return charge
  })

  return Effect.gen(function* () {
    yield* log('start', `chargeCard — authorizing ${money(amount)}`)
    return yield* attempt
  }).pipe(
    Effect.tapError(error =>
      log('error', `chargeCard failed: ${error._tag} (${money(error.amount)})`),
    ),
    Effect.onInterrupt(() =>
      log('compensate', 'chargeCard interrupted — voiding card authorization'),
    ),
  )
}

/** Step 3: finalize the order. ~700ms. */
export const createOrder = (
  items: ReadonlyArray<CartItem>,
  reservation: Reservation,
  charge: Charge,
) =>
  Effect.gen(function* () {
    yield* log(
      'start',
      `createOrder — committing ${reservation.id} + ${charge.id}`,
    )
    yield* Effect.sleep(Duration.millis(700))
    const clock = yield* Clock.Clock
    const now = yield* clock.currentTimeMillis
    const order: PlacedOrder = {
      id: `ord_${yield* nextSeq}`,
      items,
      total: charge.amount,
      placedAt: new Date(now).toLocaleTimeString(),
    }
    const store = yield* CheckoutStore
    yield* Ref.update(store.orders, orders => Array.prepend(orders, order))
    yield* log('success', `createOrder → ${order.id} confirmed`)
    return order
  }).pipe(
    Effect.onInterrupt(() =>
      log('interrupt', 'createOrder interrupted before commit'),
    ),
  )
