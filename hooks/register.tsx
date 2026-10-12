import type { Register } from 'claude-code'

import { registerApi } from './api'
import { registerContext } from './context'
import { registerDials } from './dials'
import { registerGuard } from './guard'
import { registerPane } from './pane'
import { registerSession } from './session'
import { registerWorktree } from './worktree'

export const register: Register = (on, options) => {
  registerGuard(on)
  registerSession(on)
  registerWorktree(on, options)
  registerDials(on)
  registerContext(on)
  registerApi(on, options)
  registerPane(on)
}
