import { Layer } from 'effect'

import { CheckoutStoreLayer, SearchConfigLive } from './api'
import { EventLogLayer } from './eventLog'

/** Ordinary Services, built once by the Runtime and shared by every handler:
 *  one EventLog (so the panel sees every program's events), the search
 *  configuration, and the checkout "database". */
export const ApplicationLayer = Layer.mergeAll(
  EventLogLayer,
  SearchConfigLive,
  CheckoutStoreLayer,
)
