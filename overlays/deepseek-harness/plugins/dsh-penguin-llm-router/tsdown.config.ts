import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle(
  '@prismshadow/dsh-penguin-llm-router',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
