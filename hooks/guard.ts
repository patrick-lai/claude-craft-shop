import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { isReadOnlyShell } from './readonly'
import { BALANCED } from './dials'
import { IDLE_WORKTREE, isReadOnlyPhase, READ_ONLY_DENY } from './worktree'

const dials = atom({ plugin: 'fishstack', key: 'dials' } as const, BALANCED)
const worktree = atom({ plugin: 'fishstack', key: 'worktree' } as const, IDLE_WORKTREE)

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'ExitPlanMode'])
const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])

const SOLO_DENY = 'Crew is set to Solo in fishStack: do the work yourself without subagents.'

export function registerGuard(on: On): void {
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (isReadOnlyPhase((await read($, worktree)).phase)) {
      const isWrite = WRITE_TOOLS.has(tool) || (e.tool === 'Bash' && !isReadOnlyShell(e.command))
      if (isWrite) return { deny: READ_ONLY_DENY }
    }
    if (SUBAGENT_TOOLS.has(tool) && (await read($, dials)).crew === 1) return { deny: SOLO_DENY }
    return next(e)
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'fishStack could not check this call, so it was refused.' },
  )
}
