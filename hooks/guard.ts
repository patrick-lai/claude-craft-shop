import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { isReadOnlyShell } from './readonly'
import { BALANCED } from './dials'
import { crewRefusal, EDIT_TOOLS, foresightRefusal, isCheckCommand, isShellWrite, noteAgent, noteChange, noteCheck, notePlan, noteSaid, stopReason, SUBAGENT_TOOLS } from './enforce'
import { IDLE_WORKTREE, isReadOnlyPhase, READ_ONLY_DENY } from './worktree'

const dials = atom({ plugin: 'fishstack', key: 'dials' } as const, BALANCED)
const worktree = atom({ plugin: 'fishstack', key: 'worktree' } as const, IDLE_WORKTREE)
const isDialsOn = atom({ plugin: 'fishstack', key: 'isDialsOn' } as const, true)
const isEnforced = atom({ plugin: 'fishstack', key: 'isEnforced' } as const, true)

const WRITE_TOOLS = new Set([...EDIT_TOOLS, 'ExitPlanMode'])

type Call = { tool: string; agentId?: string; command?: unknown; file_path?: unknown; notebook_path?: unknown; plan?: unknown }

// Whether the dials are enforced now: on, and their Enforce switch on.
async function isEnforcing($: EngineInterface): Promise<boolean> {
  return (await read($, isDialsOn)) && (await read($, isEnforced))
}

// The dials' refusal of a call before it runs, or null. Any failure here
// lets the call through: enforcement must never be what stops a session.
async function refusalOf($: EngineInterface, call: Call): Promise<string | null> {
  try {
    // Subagents work as they are told; the dials hold the main agent.
    if (call.agentId !== undefined || !(await isEnforcing($))) return null
    const values = await read($, dials)
    if (SUBAGENT_TOOLS.has(call.tool)) return crewRefusal(values.crew)
    if (EDIT_TOOLS.has(call.tool)) return foresightRefusal(values.foresight)
    return null
  } catch {
    return null
  }
}

// What a call that ran tells the turn's facts. Never throws.
function record(call: Call, isError: boolean): void {
  try {
    if (call.tool === 'Bash' && typeof call.command === 'string') {
      // A check counts whether it passed or not: what it found is the
      // agent's to report.
      if (isCheckCommand(call.command)) noteCheck()
      else if (!isError && isShellWrite(call.command)) noteChange(null)
      return
    }
    if (isError) return
    if (EDIT_TOOLS.has(call.tool)) {
      const path = typeof call.file_path === 'string' ? call.file_path : typeof call.notebook_path === 'string' ? call.notebook_path : null
      noteChange(path)
    } else if (call.agentId === undefined && SUBAGENT_TOOLS.has(call.tool)) noteAgent()
    else if (call.agentId === undefined && (call.tool === 'TodoWrite' || call.tool === 'ExitPlanMode')) notePlan()
  } catch {
    // The facts are a hint; a call is never failed over them.
  }
}

export function registerGuard(on: On): void {
  // What the main agent writes, noted as it streams and passed on untouched:
  // Foresight's spec, read before the edit that follows it in one response.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let block: number | null = null
    for await (const chunk of stream) {
      if (e.agentId === undefined && chunk.kind === 'text') {
        // Blocks and steps apart, so a heading starts its own line.
        if (chunk.index !== block) noteSaid('\n')
        block = chunk.index
        noteSaid(chunk.text)
      }
      yield chunk
    }
    // Returning nothing lets the result beneath stand.
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (isReadOnlyPhase((await read($, worktree)).phase)) {
      const isWrite = WRITE_TOOLS.has(tool) || (e.tool === 'Bash' && !isReadOnlyShell(e.command))
      if (isWrite) return { deny: READ_ONLY_DENY }
    }
    const call = { ...(e as unknown as Call), tool }
    const refusal = await refusalOf($, call)
    if (refusal !== null) return { deny: refusal }
    const done = await next(e)
    record(call, 'deny' in done || (done as { isError?: boolean }).isError === true)
    return done
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'fishStack could not check this call, so it was refused.' },
  )

  // The end of a turn that changed code, held back once if the dials ask for
  // something it has not done: never twice (stop_hook_active), never on a
  // failure here.
  on('classic.Stop', async ($, e, next) => {
    const done = await next(e)
    try {
      if (done.block !== undefined || !(await isEnforcing($))) return done
      const reason = stopReason(await read($, dials), e.last_assistant_message ?? '', e.stop_hook_active === true)
      return reason === null ? done : { ...done, block: reason }
    } catch {
      return done
    }
  })
}
