import type { Elements, RenderElement } from 'claude-code'

import type { Tab } from '../types'
import { wordmarkArt } from './art'
import { card } from './kit'
import type { Head } from './state'

export const PANE = 'fishstack'
export const PANE_TITLE = 'fishStack'
// How wide the pane asks to dock: a sidebar, as the desktop's own panel is.
export const PANE_COLUMNS = 46

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

export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'worktree', label: 'Worktree', icon: '⎇' },
  { id: 'dials', label: 'Dials', icon: '◇' },
  { id: 'context', label: 'Context', icon: '▤' },
]

export function isTab(value: string): value is Tab {
  return TABS.some(one => one.id === value)
}

// The pane is one column of cards, as the desktop's own side panel is: each
// card's head names it on the left and says its state on the right, and a
// press opens it in place, one at a time. Each tab's file draws the whole
// pane while its card is open (a $ never crosses an import, so a card cannot
// be drawn from another file); pane.tsx draws it with every card closed.
export function frame(ui: Ui, current: Tab | null, columns: number, onSelect: (id: Tab | null) => void, body: RenderElement | null, heads: Record<Tab, Head>) {
  const { Box, Button, Text, Svg } = ui
  const rich = Svg !== undefined
  const cardOf = (one: (typeof TABS)[number], index: number) => {
    const isOpen = one.id === current
    const head = heads[one.id]
    const toggle = () => onSelect(isOpen ? null : one.id)
    return card(
      ui,
      `card-${one.id}`,
      [
        <Box key={`head-${one.id}`} justifyContent="space-between" alignItems="center" gap={1}>
          <Button key={`tab-${one.id}`} plain hotkey={String(index + 1)} onPress={toggle}>
            <Text color="suggestion">{one.icon} </Text>
            <Text bold>{one.label}</Text>
          </Button>
          <Button key={`tab-${one.id}-state`} plain onPress={toggle}>
            <Text color={head.tone} dimColor={head.tone === undefined}>
              {head.value}
            </Text>
            <Text dimColor> {isOpen ? '⌄' : '›'}</Text>
          </Button>
        </Box>,
        isOpen && body !== null && (
          <Box key={`body-${one.id}`} flexDirection="column" gap={1} marginTop={1}>
            {body}
          </Box>
        ),
      ],
      { tone: isOpen ? 'selected' : 'plain' },
    )
  }
  return (
    <Box flexDirection="column" width={columns} gap={rich ? 1 : 0}>
      {rich && (
        <Box key="pane-head">
          <Svg source={wordmarkArt().source} alt="fishStack" width={wordmarkArt().width} height={wordmarkArt().height} />
        </Box>
      )}
      {TABS.map(cardOf)}
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
