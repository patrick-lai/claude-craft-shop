import type { Elements, RenderElement } from 'claude-code'

import type { Tab } from '../types'
import { tabsArt } from './art'

export const PANE = 'craft-shop'
export const PANE_TITLE = 'Craftshop'

// The elements the pane draws with, so it draws on every surface: mobile has
// no Input or Select, the terminal no Svg, and the tabs leave those out where
// they are missing.
export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Markdown' | 'Code'> &
  Partial<Pick<Elements['terminal'], 'Input' | 'Select'>> &
  Partial<Pick<Elements['desktop'], 'Svg' | 'Client'>>

// $.ui.resolve completes every table with stand-ins that draw nothing; this
// leaves out what the surface lacks, so the tabs can test for it: the
// terminal draws no Svg, mobile no Input or Select.
export function resolveUi(table: Ui, surface: string): Ui {
  return {
    ...table,
    Svg: surface === 'terminal' ? undefined : table.Svg,
    // Drawn controls take presses through a Client, which only the desktop
    // lays over a picture; the terminal keeps its Buttons.
    Client: surface === 'desktop' ? table.Client : undefined,
    Input: surface === 'mobile' ? undefined : table.Input,
    Select: surface === 'mobile' ? undefined : table.Select,
  }
}

export const TABS: { id: Tab; label: string }[] = [
  { id: 'worktree', label: 'Perm worktree' },
  { id: 'dials', label: 'Dials' },
  { id: 'context', label: 'Context' },
]

export function isTab(value: string): value is Tab {
  return TABS.some(one => one.id === value)
}

// Each tab's file draws the whole pane while its tab is active (a $ never
// crosses an import, so a tab cannot be drawn from another file); this is
// the frame they share.
export function frame(ui: Ui, current: Tab, columns: number, onSelect: (id: Tab) => void, body: RenderElement) {
  const { Box, Button, Text, Svg, Client } = ui
  const rich = ui.Svg !== undefined
  if (Svg !== undefined && Client !== undefined) {
    // The desktop draws the wordmark and the tabs as one picture; a Client
    // over it takes the press (pane.tsx's tabs-click hook switches the tab).
    const art = tabsArt(TABS, current)
    return (
      <Box flexDirection="column" width={columns} gap={1}>
        <Box key="tabs-art" position="relative">
          <Svg source={art.source} alt={`Craftshop tabs: ${TABS.map(one => one.label).join(', ')}; ${current} shown`} width={art.width} height={art.height} />
          <Box position="absolute" top={0} left={0} right={0} bottom={0}>
            <Client key="tabs-click" module="./rail-click.tsx" props={{ width: art.width, segments: art.segments }} width="100%" height="100%" />
          </Box>
        </Box>
        {body}
      </Box>
    )
  }
  // The tabs sit in one rounded tray, the current one filled: a segmented
  // control, as CommissionAI's Stage tabs read.
  return (
    <Box flexDirection="column" width={columns} gap={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Box gap={1} backgroundColor={rich ? 'rgba(140,140,150,0.10)' : undefined} paddingX={rich ? 1 : 0}>
          {TABS.map((one, index) => (
            <Button
              key={`tab-${one.id}`}
              label={one.label}
              hotkey={String(index + 1)}
              variant={one.id === current ? 'primary' : undefined}
              dimColor={one.id !== current}
              onPress={() => onSelect(one.id)}
            />
          ))}
        </Box>
        <Text dimColor>Craftshop</Text>
      </Box>
      {body}
    </Box>
  )
}

// How wide each card of a grid is, so the cards fill the row: as many as fit
// at `least` columns each, with one column between them.
export function gridWidth(columns: number, least: number): number {
  const perRow = Math.max(1, Math.floor((columns + 1) / (least + 1)))
  return Math.floor((columns - (perRow - 1)) / perRow)
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
