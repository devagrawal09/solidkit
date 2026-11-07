import { Block } from 'foldkit'

import { EffectsLayer } from './command'
import { CheckoutComposition, type Model } from './definition'
import { init, update } from './update'
import { view } from './view'

const prepare = () =>
  CheckoutComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer,
  })
export const CheckoutBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare)
