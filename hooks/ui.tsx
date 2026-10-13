import type { Elements, RenderElement } from 'claude-code'

import type { Tab } from '../types'
import { wordmarkArt } from './art'

export const PANE = 'fishstack'
export const PANE_TITLE = 'fishStack'

// The elements the pane draws with, so it draws on every surface: mobile has
// no Input or Select, the terminal no Svg, and the tabs leave those out where
// they are missing.
export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Markdown' | 'Code'> &
  Partial<Pick<Elements['terminal'], 'Input' | 'Select'>> &
  Partial<Pick<Elements['desktop'], 'Svg' | 'Client'>>

// $.ui.resolve completes every table with stand-ins that draw nothing; this
// leaves out what the surface lacks, so the tabs can test for it: the
// terminal draws no Svg, mobile no Input or Select. A Client that failed
// (ui.fault) leaves them all out until a reload, the Buttons standing in.
export function resolveUi(table: Ui, surface: string, isClientDown: boolean): Ui {
  return {
    ...table,
    Svg: surface === 'terminal' ? undefined : table.Svg,
    // Drawn controls take presses through a Client, which only the desktop
    // lays over a picture; the terminal keeps its Buttons.
    Client: surface === 'desktop' && !isClientDown ? table.Client : undefined,
    Input: surface === 'mobile' ? undefined : table.Input,
    Select: surface === 'mobile' ? undefined : table.Select,
  }
}

export const TABS: { id: Tab; label: string }[] = [
  { id: 'worktree', label: 'Worktrees' },
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
  const { Box, Button, Text, Svg } = ui
  // The tabs are the surface's own buttons, so a press answers at once (a
  // drawn tab bar went through a Client and a redrawn picture, and lagged);
  // the current one filled, keys 1 to 3. No tray behind them: the desktop
  // draws a box's background square, and it read as a stray box. On the
  // desktop the mark and the name lead, a still picture.
  const tabs = (
    <Box gap={1}>
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
  )
  if (Svg !== undefined) {
    const mark = wordmarkArt()
    return (
      <Box flexDirection="column" width={columns} gap={1}>
        <Box key="pane-head" gap={2} alignItems="center">
          <Svg source={mark.source} alt="fishStack" width={mark.width} height={mark.height} />
          {tabs}
        </Box>
        {body}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width={columns} gap={1}>
      <Box justifyContent="space-between" alignItems="center">
        {tabs}
        <Text dimColor>fishStack</Text>
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
