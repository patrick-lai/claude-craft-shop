import type { Elements, RenderElement } from 'claude-code'

import type { Tab } from '../types'

export const PANE = 'craft-shop'
export const PANE_TITLE = 'Craft Shop'

// The elements the pane draws with, so it draws on every surface: mobile has
// no Input or Select, and the tabs leave those out where they are missing.
export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Markdown'> &
  Partial<Pick<Elements['terminal'], 'Input' | 'Select'>>

export const TABS: { id: Tab; label: string }[] = [
  { id: 'worktree', label: 'Worktree' },
  { id: 'dials', label: 'Dials' },
  { id: 'context', label: 'Context' },
  { id: 'api', label: 'API' },
]

export function isTab(value: string): value is Tab {
  return TABS.some(one => one.id === value)
}

// Each tab's file draws the whole pane while its tab is active (a $ never
// crosses an import, so a tab cannot be drawn from another file); this is
// the frame they share.
export function frame(ui: Ui, current: Tab, columns: number, onSelect: (id: Tab) => void, body: RenderElement) {
  const { Box, Button } = ui
  return (
    <Box flexDirection="column" width={columns} gap={1}>
      <Box gap={1}>
        {TABS.map((one, index) => (
          <Button
            key={`tab-${one.id}`}
            label={one.label}
            hotkey={String(index + 1)}
            variant={one.id === current ? 'primary' : undefined}
            onPress={() => onSelect(one.id)}
          />
        ))}
      </Box>
      {body}
    </Box>
  )
}

export function bar(fraction: number, width: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`
  return String(count)
}
