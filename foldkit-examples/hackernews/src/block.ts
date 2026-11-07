import { Layer } from 'effect'
import { Block } from 'foldkit'

import { EffectsLayer } from './command'
import { ApplicationComposition } from './composition'
import type { Model } from './definition'
import { subscriptions } from './subscription'
import { init, update } from './update'
import { view } from './view'

const prepare = () =>
  ApplicationComposition.prepareBlock({
    init,
    update,
    view,
    subscriptions,
    EffectsLayer: Layer.mergeAll(EffectsLayer, subscriptions.layer),
  })
export const ApplicationBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare)
