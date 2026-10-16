import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { checkedOutBranches, isReadOnlyShell } from './readonly'
import { BALANCED } from './dials'
import { crewRefusal, EDIT_TOOLS, foresightRefusal, isCheckCommand, isShellWrite, noteAgent, noteChange, noteCheck, notePlan, noteSaid, stopReason, SUBAGENT_TOOLS } from './enforce'
import { defaultBranch, IDLE_WORKTREE, isReadOnlyPhase, READ_ONLY_DENY } from './worktree'

const dials = atom({ plugin: 'fishstack', key: 'dials' } as const, BALANCED)
const worktree = atom({ plugin: 'fishstack', key: 'worktree' } as const, IDLE_WORKTREE)
const isDialsOn = atom({ plugin: 'fishstack', key: 'isDialsOn' } as const, true)
const isEnforced = atom({ plugin: 'fishstack', key: 'isEnforced' } as const, true)
const refusals = atom({ plugin: 'fishstack', key: 'refusals' } as const, {})

// fishStack's refusals are its rules at work, not a failure: their rows in
// the transcript are drawn in teal, not as the engine's red error. Kept by
// call, the latest few.
const REFUSAL_COLOR = '#2ec4b6'
const REFUSALS_KEPT = 50

async function refuse($: EngineInterface, id: string | undefined, text: string): Promise<{ deny: string }> {
  if (id !== undefined) {
    await update($, refusals, now => Object.fromEntries([...Object.entries(now), [id, text]].slice(-REFUSALS_KEPT)))
  }
  return { deny: text }
}

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

// A worktree fishStack set up never takes the default branch: git checks a
// branch out in one worktree at a time, so a worktree on it locks the main
// checkout out of its own default branch. Null lets the command run; so does
// any failure here.
async function defaultBranchRefusal($: EngineInterface, command: unknown): Promise<string | null> {
  try {
    if (typeof command !== 'string') return null
    const { phase, main, path } = await read($, worktree)
    if (phase !== 'ready' || main === null || path === null) return null
    const here = checkedOutBranches(command).filter(one => one.dir === null || one.dir === path || one.dir.startsWith(`${path}/`))
    if (here.length === 0) return null
    const branch = await defaultBranch($, main)
    if (!here.some(one => one.branch === branch)) return null
    return `fishStack: this worktree does not check out \`${branch}\`. It stays free for the main checkout at \`${main}\`, since git lets only one worktree have a branch at a time. To work from the latest ${branch}, run \`git fetch origin ${branch}\`, then \`git switch -c <new-branch> origin/${branch}\` (or \`git switch --detach origin/${branch}\` to look around).`
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
      if (isWrite) return refuse($, e.tool_use_id, READ_ONLY_DENY)
    }
    if (e.tool === 'Bash') {
      const kept = await defaultBranchRefusal($, e.command)
      if (kept !== null) return refuse($, e.tool_use_id, kept)
    }
    const call = { ...(e as unknown as Call), tool }
    const refusal = await refusalOf($, call)
    if (refusal !== null) return refuse($, e.tool_use_id, refusal)
    const done = await next(e)
    record(call, 'deny' in done || (done as { isError?: boolean }).isError === true)
    return done
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'fishStack could not check this call, so it was refused.' },
  )

  // A call fishStack refused draws its reason in teal where the engine would
  // draw a red error.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const text = e.props.isErrored ? (await read($, refusals))[e.props.tool_use_id] : undefined
    if (text === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // The terminal hangs a result under its row with ⎿, as the engine does.
    return e.surface === 'terminal' ? (
      <Box>
        <Text dimColor>{'  ⎿  '}</Text>
        <Text color={REFUSAL_COLOR} wrap="wrap">
          {text}
        </Text>
      </Box>
    ) : (
      <Text color={REFUSAL_COLOR} wrap="wrap">
        {text}
      </Text>
    )
  })

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
