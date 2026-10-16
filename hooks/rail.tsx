// The rail above the prompt, unless the worktree failed: fishStack's
// status at a glance (context window, prompt cache, cost, dials, sources,
// worktree), each item opening its tab. worktree.tsx gathers the figures.
import type { RenderElement } from 'claude-code'

import type { Tab } from '../types'
import { cacheGauge, drawnButton } from './kit'
import { COMPACTABLE, railArt } from './rail-art'
import type { Compactable, RailAutopilot, RailPill } from './rail-art'
import { tokens } from './ui'
import type { Ui } from './ui'
import type { Head } from './state'

export type RailFigures = {
  isWorking: boolean
  // Seconds the prompt cache stays warm, null before the first reply.
  cacheSecondsLeft: number | null
  // Share of the last request's input the prompt cache served, null before one.
  cachePercent: number | null
  tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null
  costUsd: number | null
  preset: string
  presetLevels: number[]
  sourcesOn: number
  sourcesTotal: number
  branch: string | null
  // While the worktree is made, the step it is on; null once ready or off.
  preparingStep: string | null
  autopilot: RailAutopilot | null
  isDialsOn: boolean
  isContextOn: boolean
  // What each card's head says, which the terminal's line repeats.
  heads?: Record<Tab, Head>
}

// A desktop cell's width in pixels, guessed low: the band is measured in the
// code font's advance (about 7.8px at 13px), and a low guess compacts a pill
// early where a high one would clip it.
const CELL_PX = 7

// The pills as wide as the band allows: the least needed give up their words,
// one at a time, until the row fits with a few cells to spare. It reads only
// the width and the figures, never the layout, so it cannot flap.
export function fitPills(figures: RailFigures, columns: number): RailPill[] {
  const budget = (columns - 3) * CELL_PX
  const compact = new Set<Compactable>()
  // The status line says where the agent works and how; the cache and the
  // spend are Claude Code's own to show.
  const shown = () => railArt(figures, compact).filter(pill => pill.id !== 'cache' && pill.id !== 'tokens')
  let pills = shown()
  const width = () => pills.reduce((sum, pill) => sum + pill.width, 0) + (pills.length - 1) * CELL_PX
  for (const id of COMPACTABLE) {
    if (width() <= budget) break
    compact.add(id)
    pills = shown()
  }
  return pills
}

// On the desktop the rail is one row: each pill its own picture with a Client
// over it for the press and the hover (kit.tsx's drawnButton), then the
// hovered pill's caption in the room left. The lit pill is the same size and
// the caption's box is sized by the row, not its text, so nothing moves. A
// narrow row clips the last pills; it never wraps.
export function drawRail(ui: Ui, figures: RailFigures, open: (tab: Tab | null) => void, hover: string | null, onHover: (id: string, isOn: boolean) => void, columns: number) {
  const { Box, Text, Button, Svg } = ui
  if (Svg !== undefined && ui.Client !== undefined) {
    const pills = fitPills(figures, columns)
    const caption = pills.find(pill => pill.id === hover)?.caption ?? ''
    return (
      <Box key="rail-row" gap={1} alignItems="center" flexWrap="nowrap" overflow="hidden">
        {pills.map(pill =>
          drawnButton(ui, `rail-${pill.id}-press`, pill.source, pill.caption, pill.width, pill.height, () => {
              if (pill.tab !== null) open(pill.tab === 'pane' ? null : pill.tab)
            }, {
            hotSource: pill.hotSource,
            isHot: pill.id === hover,
            onHover: isOn => onHover(pill.id, isOn),
          }),
        )}
        <Box key="rail-caption" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Text dimColor wrap="truncate-end">
            {caption === '' ? ' ' : caption}
          </Text>
        </Box>
      </Box>
    )
  }
  // The terminal's status line: the three cards' heads, each opening its
  // card, in the words the pane uses.
  const heads = figures.heads
  const item = (key: string, tab: Tab | null, children: RenderElement) => (
    <Button key={key} plain onPress={() => open(tab)}>
      {children}
    </Button>
  )
  const part = (key: string, tab: Tab, icon: string) => {
    const head = heads?.[tab]
    return item(
      key,
      tab,
      <Text>
        <Text color={head?.tone ?? 'suggestion'}>{icon} </Text>
        <Text color={head?.tone} bold={head?.tone !== undefined}>
          {head?.value ?? ''}
        </Text>
      </Text>,
    )
  }
  const isDesktop = Svg !== undefined
  return (
    <Box gap={2} alignItems="center" flexWrap="nowrap" overflow="hidden">
      {item(
        'open-fishstack',
        null,
        <Text bold color="suggestion">
          ≋ fishStack
        </Text>,
      )}
      {part('rail-worktree', 'worktree', '⎇')}
      {part('rail-dials', 'dials', '◇')}
      {part('rail-sources', 'context', '▤')}
      {!isDesktop && <Text dimColor>/fs</Text>}
    </Box>
  )
}
