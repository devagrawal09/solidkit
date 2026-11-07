import { Layer } from 'effect'
import { Http } from 'foldkit'

import { HnApiLayer } from './hnApi'

/** The HN API Service over Foldkit's Fetch-backed HttpClient. */
export const ApplicationLayer = HnApiLayer.pipe(Layer.provide(Http.layer))
