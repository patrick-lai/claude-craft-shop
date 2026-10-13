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

export function registerPane(on: On): void {
  // Every other drawn control: its press, or the pointer entering or leaving
  // it, runs what its drawing registered.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { press?: unknown; hover?: unknown } | null
    if (data?.press === true) pressHandlers.get(e.element)?.()
    else if (typeof data?.hover === 'boolean') hoverHandlers.get(e.element)?.(data.hover)
    return next(e)
  })

  // A Client that failed (its module never loaded, or never answered a
  // render) stays drawn as the desktop's placeholder unless the redraw the
  // engine makes leaves it out: every drawn control falls back to its Button
  // until a load (session.ts clears it at session.start) tries them again.
  on('ui.fault', async ($, e, next) => {
    $.ui.log(`Client ${e.element} (${e.module}) failed at ${e.phase}: ${e.reason}`, { to: 'debug' })
    await update($, isClientDown, () => true)
    return next(e)
  })

  on('command.run', { command: 'fishstack' }, async ($, e) => openPane($, e.args))
  on('command.run', { command: 'fs' }, async ($, e) => openPane($, e.args))
}
