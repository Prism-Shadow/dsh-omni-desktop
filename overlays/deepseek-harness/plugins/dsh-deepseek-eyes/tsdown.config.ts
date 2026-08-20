import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle(
  '@prismshadow/dsh-deepseek-eyes',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
