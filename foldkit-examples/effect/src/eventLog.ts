// Port of solid/examples/effect/src/log.ts: the in-page fiber event log.
//
// The original is a module-level Solid store that Effect programs write to
// with `Effect.sync(() => log(...))`. Here the programs write to an
// `EventLog` Service, which publishes to a PubSub. The LogPanel Block
// subscribes to that stream, so each entry still reaches the Model as a
// Message.

import {
  Clock,
  Context,
  Effect,
  Layer,
  PubSub,
  Ref,
  Schema,
  Stream,
} from 'effect'

export const LogKind = Schema.Literals([
  'start',
  'success',
  'retry',
  'interrupt',
  'compensate',
  'error',
])
export type LogKind = typeof LogKind.Type

export const LogEntry = Schema.Struct({
  id: Schema.Number,
  time: Schema.String,
  kind: LogKind,
  message: Schema.String,
})
export type LogEntry = typeof LogEntry.Type

export class EventLog extends Context.Service<
  EventLog,
  Readonly<{
    log: (kind: LogKind, message: string) => Effect.Effect<void>
    entries: Stream.Stream<LogEntry>
  }>
>()('EventLog') {}

/** `log(kind, message)` from the original, as an Effect that needs EventLog. */
export const log = (kind: LogKind, message: string) =>
  Effect.gen(function* () {
    const eventLog = yield* EventLog
    yield* eventLog.log(kind, message)
  })

export const EventLogLayer = Layer.effect(
  EventLog,
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const pubsub = yield* PubSub.unbounded<LogEntry>()
    const nextId = yield* Ref.make(0)
    const startedAt = yield* clock.currentTimeMillis

    return {
      log: (kind, message) =>
        Effect.gen(function* () {
          const id = yield* Ref.getAndUpdate(nextId, current => current + 1)
          const now = yield* clock.currentTimeMillis
          const time = `${((now - startedAt) / 1000).toFixed(2)}s`
          yield* PubSub.publish(pubsub, { id, time, kind, message })
        }),
      entries: Stream.fromPubSub(pubsub),
    }
  }),
)
