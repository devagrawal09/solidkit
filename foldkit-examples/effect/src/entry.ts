import { Program, Runtime } from 'foldkit'

import { ApplicationBlock, crashView } from './application'
import { ApplicationLayer } from './services'

const program = Program.make({
  block: ApplicationBlock,
  container: document.getElementById('root'),
  crash: { view: crashView },
  devTools: { dispatch: true },
})

Runtime.run(program.provide(ApplicationLayer))
