// Handler tests: run the real Command handlers through their Services, on a
// TestClock, and check what the fibers did. Story tests supply results
// without running handlers; these cover the Effect programs themselves.

import { Array, Effect, Fiber, Layer, Ref, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, test } from 'vitest'

import { CheckoutStoreLayer, SearchConfig } from './api'
import { ChargeCard, CreateOrder, FetchOrders } from './checkout/command'
import { Message as CheckoutMessage } from './checkout/definition'
import { EventLog, type LogKind } from './eventLog'
import { SearchPackages, Message as TypeaheadMessage } from './typeahead'

type Logged = Readonly<{ kind: LogKind; message: string }>

/** An EventLog that records into a Ref instead of publishing. */
const recordingEventLog = Effect.gen(function* () {
  const entries = yield* Ref.make<ReadonlyArray<Logged>>([])
  const layer = Layer.succeed(EventLog, {
    log: (kind, message) =>
      Ref.update(entries, current => Array.append(current, { kind, message })),
    entries: Stream.empty,
  })
  return { entries, layer }
})

const searchConfig = (flakiness: number, baseLatencyMs: number) =>
  Layer.succeed(SearchConfig, { flakiness, baseLatencyMs })

const kinds = (entries: ReadonlyArray<Logged>) =>
  Array.map(entries, entry => entry.kind)

describe('SearchPackages handler', () => {
  test('interrupting a running search runs its finalizer', async () => {
    const program = Effect.gen(function* () {
      const { entries, layer } = yield* recordingEventLog
      const handler = Layer.provide(
        SearchPackages.layer,
        Layer.mergeAll(layer, searchConfig(0, 250)),
      )
      const fiber = yield* SearchPackages({
        searchId: 1,
        query: 'solid',
      }).effect.pipe(Effect.provide(handler), Effect.forkChild)
      yield* TestClock.adjust('100 millis')
      yield* Fiber.interrupt(fiber)
      return yield* Ref.get(entries)
    }).pipe(Effect.provide(TestClock.layer()))

    const entries = await Effect.runPromise(program)
    expect(kinds(entries)).toEqual(['start', 'interrupt'])
    expect(entries[1]?.message).toContain('fiber + pending retries torn down')
  })

  test('transient failures retry three times, then fail as a Message', async () => {
    const program = Effect.gen(function* () {
      const { entries, layer } = yield* recordingEventLog
      const handler = Layer.provide(
        SearchPackages.layer,
        Layer.mergeAll(layer, searchConfig(1, 0)),
      )
      const fiber = yield* SearchPackages({
        searchId: 7,
        query: 'vite',
      }).effect.pipe(Effect.provide(handler), Effect.forkChild)
      yield* TestClock.adjust('10 seconds')
      const result = yield* Fiber.join(fiber)
      return { result, entries: yield* Ref.get(entries) }
    }).pipe(Effect.provide(TestClock.layer()))

    const { result, entries } = await Effect.runPromise(program)
    expect(result).toEqual(
      TypeaheadMessage.FailedSearchPackages({
        searchId: 7,
        reason: 'TransientNetwork (still failing after 3 retries)',
      }),
    )
    expect(kinds(entries)).toEqual([
      'start',
      'retry',
      'retry',
      'retry',
      'retry',
      'error',
    ])
  })

  test('a search slower than 4s times out', async () => {
    const program = Effect.gen(function* () {
      const { entries, layer } = yield* recordingEventLog
      const handler = Layer.provide(
        SearchPackages.layer,
        Layer.mergeAll(layer, searchConfig(0, 5000)),
      )
      const fiber = yield* SearchPackages({
        searchId: 2,
        query: 'zod',
      }).effect.pipe(Effect.provide(handler), Effect.forkChild)
      yield* TestClock.adjust('5 seconds')
      const result = yield* Fiber.join(fiber)
      return { result, entries: yield* Ref.get(entries) }
    }).pipe(Effect.provide(TestClock.layer()))

    const { result, entries } = await Effect.runPromise(program)
    expect(result).toEqual(
      TypeaheadMessage.FailedSearchPackages({
        searchId: 2,
        reason: 'TimeoutError (no answer within 4s)',
      }),
    )
    expect(kinds(entries)).toEqual(['start', 'error'])
  })
})

describe('checkout step handlers', () => {
  const handlers = (eventLog: Layer.Layer<EventLog>) =>
    Layer.provide(
      Layer.mergeAll(ChargeCard.layer, CreateOrder.layer, FetchOrders.layer),
      Layer.mergeAll(eventLog, CheckoutStoreLayer),
    )

  test('interrupting a charge voids the authorization in its finalizer', async () => {
    const program = Effect.gen(function* () {
      const { entries, layer } = yield* recordingEventLog
      const fiber = yield* ChargeCard({
        amount: 10,
        declineCard: false,
      }).effect.pipe(Effect.provide(handlers(layer)), Effect.forkChild)
      yield* TestClock.adjust('1 second')
      yield* Fiber.interrupt(fiber)
      return yield* Ref.get(entries)
    }).pipe(Effect.provide(TestClock.layer()))

    const entries = await Effect.runPromise(program)
    expect(entries).toEqual([
      { kind: 'start', message: 'chargeCard — authorizing $10.00' },
      {
        kind: 'compensate',
        message: 'chargeCard interrupted — voiding card authorization',
      },
    ])
  })

  test('a declined card is a typed failure, delivered as DeclinedChargeCard', async () => {
    const program = Effect.gen(function* () {
      const { entries, layer } = yield* recordingEventLog
      const fiber = yield* ChargeCard({
        amount: 12.5,
        declineCard: true,
      }).effect.pipe(Effect.provide(handlers(layer)), Effect.forkChild)
      yield* TestClock.adjust('3 seconds')
      const result = yield* Fiber.join(fiber)
      return { result, entries: yield* Ref.get(entries) }
    }).pipe(Effect.provide(TestClock.layer()))

    const { result, entries } = await Effect.runPromise(program)
    expect(result).toEqual(CheckoutMessage.DeclinedChargeCard({ amount: 12.5 }))
    expect(entries[1]).toEqual({
      kind: 'error',
      message: 'chargeCard failed: CardDeclined ($12.50)',
    })
  })
})
