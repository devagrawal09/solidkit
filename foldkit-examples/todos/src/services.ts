import { Layer } from 'effect'

import { BrowserKeyValueStore } from '@effect/platform-browser'

import { TodoApiLayer } from './api'

/** Ordinary application Services, supplied below every handler Layer. */
export const ApplicationLayer = TodoApiLayer.pipe(
  Layer.provide(BrowserKeyValueStore.layerLocalStorage),
)
