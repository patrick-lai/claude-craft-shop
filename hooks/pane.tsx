import { atom, update } from 'claude-code'
import type { CommandSpec, On } from 'claude-code'

import { isTab, PANE, PANE_TITLE, TABS } from './ui'

const tab = atom({ plugin: 'craft-shop', key: 'tab' } as const, 'worktree')

export const CRAFT_COMMAND: CommandSpec = {
  name: 'craft',
  description: 'Open the Craftshop pane: perm worktree, dials and context',
  argumentHint: '[worktree|dials|context]',
}

export function registerPane(on: On): void {
  on('command.run', { command: 'craft' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    if (wanted !== '' && !isTab(wanted)) {
      return { text: `No tab named "${wanted}". Try /craft worktree, dials or context.` }
    }
    if (isTab(wanted)) await update($, tab, () => wanted)
    await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true })
    const label = TABS.find(one => one.id === wanted)?.label
    return { text: label === undefined ? 'Opened Craftshop.' : `Opened Craftshop · ${label}.` }
  })
}
