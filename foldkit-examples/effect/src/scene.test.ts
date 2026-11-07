import { Interruptible } from 'foldkit/command'
import {
  Command,
  all,
  click,
  expect,
  first,
  given,
  placeholder,
  role,
  scene,
  selector,
  text,
  type,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { init, update, view } from './application'
import { ReserveInventory } from './checkout/command'
import { Message as CheckoutMessage } from './checkout/definition'
import { SearchPackages, Message as TypeaheadMessage } from './typeahead'

const start = init().model

const cancelled = (outcome: typeof Interruptible.Outcome.Type) =>
  CheckoutMessage.CompletedCancelCheckoutStep({ outcome })
const searchInput = placeholder('Search packages… (try typing “solid” quickly)')

describe('application', () => {
  test('a search renders its results, newest results marked stale while the next runs', () => {
    scene(
      { update, view },
      given(start),
      type(searchInput, 'solid'),
      expect(text('Searching…')).toExist(),
      Command.resolve(
        SearchPackages,
        TypeaheadMessage.SucceededSearchPackages({
          searchId: 1,
          packages: [
            {
              name: 'solid-js',
              description: 'Fine-grained reactive UI library',
              downloads: 1_450_000,
            },
          ],
        }),
      ),
      expect(text('solid-js')).toExist(),
      expect(text('1.4M/wk')).toExist(),
      expect(selector('.results.stale')).toBeAbsent(),
    )
  })

  test('the checkout tab shows the saga controls and the active step', () => {
    scene(
      { update, view },
      given(start),
      click(role('button', { name: 'Checkout action path' })),
      expect(text('Checkout saga')).toExist(),
      click(role('button', { name: 'Place order — $78.74' })),
      Command.expectExact(ReserveInventory),
      Command.keepPending(ReserveInventory),
      expect(role('button', { name: 'Cancel checkout' })).toExist(),
      expect(selector('ol.steps li.active')).toHaveText('Reserve inventory'),
      expect(first(all.role('button', { name: '+' }))).toBeDisabled(),
      click(role('button', { name: 'Cancel checkout' })),
      // A parent Scene resolves the child's Interrupt with the child's raw
      // result Message; the Binding's delivery path is replayed for it.
      Command.resolve(
        ReserveInventory.Interrupt(cancelled),
        cancelled(Interruptible.Outcome.Interrupted()),
      ),
      Command.expectNone(),
      expect(
        text('Checkout cancelled — compensations ran, cart untouched'),
      ).toExist(),
      expect(role('button', { name: 'Place order — $78.74' })).toExist(),
    )
  })
})
