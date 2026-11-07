import { Array } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import type { LogEntry } from './eventLog'
import { Message, init, update } from './logPanel'

const entry = (id: number): LogEntry => ({
  id,
  time: `${id}.00s`,
  kind: 'start',
  message: `event ${id}`,
})

describe('log panel', () => {
  test('keeps the latest 100 events and clears on demand', () => {
    story(
      update,
      given({
        ...init().model,
        entries: Array.makeBy(100, entry),
      }),
      message(Message.LoggedFiberEvent({ entry: entry(100) })),
      model(current => {
        expect(current.entries).toHaveLength(100)
        expect(current.entries[0]?.id).toBe(1)
        expect(current.entries[99]?.id).toBe(100)
      }),
      message(Message.ClickedClear()),
      model(current => {
        expect(current.entries).toEqual([])
      }),
    )
  })
})
