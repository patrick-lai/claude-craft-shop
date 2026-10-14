import { atom, update } from 'claude-code'
import type { CommandSpec, EngineInterface, On } from 'claude-code'

import { hoverHandlers, pressHandlers } from './kit'
import { isTab, PANE, PANE_TITLE, TABS } from './ui'

const tab = atom({ plugin: 'fishstack', key: 'tab' } as const, 'worktree')
const isClientDown = atom({ plugin: 'fishstack', key: 'isClientDown' } as const, false)

// /fishstack opens the pane, and /fs is its short form: bare /fish reads as
// the fish shell.
export const FISH_COMMANDS: CommandSpec[] = [
  { name: 'fishstack', description: 'Open the fishStack pane: perm worktree, dials and context', argumentHint: '[worktree|dials|context]' },
  { name: 'fs', description: 'Open the fishStack pane (short for /fishstack)', argumentHint: '[worktree|dials|context]' },
]

async function openPane($: EngineInterface, args: string): Promise<{ text: string }> {
  const wanted = args.trim().toLowerCase()
  if (wanted !== '' && !isTab(wanted)) {
    return { text: `No tab named "${wanted}". Try /fishstack worktree, dials or context.` }
  }
  if (isTab(wanted)) await update($, tab, () => wanted)
  await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true })
  const label = TABS.find(one => one.id === wanted)?.label
  return { text: label === undefined ? 'Opened fishStack.' : `Opened fishStack · ${label}.` }
}

// Faults heard since this load: a reload starts over, as session.ts does.
let faults = 0

const FAULT_RETRY_MS = 60_000
const FAULT_RETRIES = 2

// How long the Buttons stand in after a Client's fault before the drawn
// controls are tried again, or null to keep them down for the session: a
// module that never loaded will not load on a retry, and a third fault in
// one load is no passing hiccup.
export function faultRetryMs(phase: 'load' | 'render' | 'run', faultsSoFar: number): number | null {
  return phase === 'load' || faultsSoFar > FAULT_RETRIES ? null : FAULT_RETRY_MS
}

export function registerPane(on: On): void {
  // Every other drawn control: its press, or the pointer entering or leaving
  // it, runs what its drawing registered.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { press?: unknown; hover?: unknown } | null
    if (data?.press === true) pressHandlers.get(e.element)?.()
    else if (typeof data?.hover === 'boolean') hoverHandlers.get(e.element)?.(data.hover)
    return next(e)
  })

  // A Client that failed stays drawn as the desktop's placeholder unless the
  // redraw the engine makes leaves it out: every drawn control falls back to
  // its Button at once. A slow or failed render is often the desktop busy for
  // a moment, so the controls come back after a while and try again; a module
  // that never loaded, or one that keeps failing, stays down until a load
  // (session.ts clears it at session.start). Only giving up is said in the
  // transcript: a fallback that mends itself is the debug log's.
  on('ui.fault', async ($, e, next) => {
    faults += 1
    const retryMs = faultRetryMs(e.phase, faults)
    const what = `drawn control ${e.element} (${e.module}) failed at ${e.phase} on ${e.surface}: ${e.reason}`
    await update($, isClientDown, () => true)
    if (retryMs === null) {
      $.ui.log(`fishStack: ${what}. Buttons stand in until the next session.`)
    } else {
      $.ui.log(`${what}; Buttons stand in, trying again in ${retryMs / 1000}s`, { to: 'debug' })
      $.clock.after(retryMs, () => void update($, isClientDown, () => false))
    }
    return next(e)
  })

  on('command.run', { command: 'fishstack' }, async ($, e) => openPane($, e.args))
  on('command.run', { command: 'fs' }, async ($, e) => openPane($, e.args))
}
