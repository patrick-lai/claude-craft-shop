// The rail above the prompt while there is no worktree news: fishStack's
// status at a glance (context window, prompt cache, cost, dials, sources,
// worktree), each item opening its tab. worktree.tsx gathers the figures.
import type { RenderElement } from 'claude-code'

import type { Tab } from '../types'
import { cacheGauge, drawnButton } from './kit'
import { COMPACTABLE, railArt } from './rail-art'
import type { Compactable, RailPill } from './rail-art'
import { tokens } from './ui'
import type { Ui } from './ui'

export type RailFigures = {
  isWorking: boolean
  // Seconds the prompt cache stays warm, null before the first reply.
  cacheSecondsLeft: number | null
  // Share of the last request's input the prompt cache served, null before one.
  cachePercent: number | null
  tokens: { input: number; output: number } | null
  costUsd: number | null
  preset: string
  presetLevels: number[]
  sourcesOn: number
  sourcesTotal: number
  branch: string | null
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
  let pills = railArt(figures, compact)
  const width = () => pills.reduce((sum, pill) => sum + pill.width, 0) + (pills.length - 1) * CELL_PX
  for (const id of COMPACTABLE) {
    if (width() <= budget) break
    compact.add(id)
    pills = railArt(figures, compact)
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
  const left = figures.cacheSecondsLeft
  const isWarm = figures.isWorking || (left !== null && left > 0)
  const clock = left === null ? '' : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
  const item = (key: string, tab: Tab | null, children: RenderElement) => (
    <Button key={key} plain onPress={() => open(tab)}>
      {children}
    </Button>
  )
  // An item with no pane of its own: shown, not pressed.
  const still = (key: string, children: RenderElement) => <Box key={key}>{children}</Box>
  return (
    <Box gap={2} alignItems="center" flexWrap="wrap">
      {item(
        'open-fishstack',
        null,
        <Text bold color="suggestion">
          ≋
        </Text>,
      )}
      <Box gap={1} alignItems="center">
        {Svg !== undefined ? (
          <Svg source={cacheGauge(left ?? 0, figures.isWorking, figures.cachePercent)} alt={isWarm ? `Prompt cache warm, ${clock} left` : 'Prompt cache cold'} width={70} height={20} isInteractive />
        ) : (
          <Text color={isWarm ? 'warning' : undefined} dimColor={!isWarm}>
            {'▮'.repeat(figures.isWorking ? 5 : Math.ceil((left ?? 0) / 60))}
            {'▯'.repeat(figures.isWorking ? 0 : 5 - Math.ceil((left ?? 0) / 60))}
          </Text>
        )}
        {still(
          'rail-cache',
          figures.isWorking ? (
            <Text dimColor>Working</Text>
          ) : left === null ? (
            <Text dimColor>Cache starts next reply</Text>
          ) : isWarm ? (
              <Text>
                <Text dimColor>Cache warm </Text>
                <Text bold>{clock}</Text>
              </Text>
            ) : (
            <Text dimColor>Cache cold</Text>
          ),
        )}
      </Box>
      {(figures.tokens !== null || figures.costUsd !== null) &&
        still(
          'rail-tokens',
          <Text>
            {figures.tokens !== null && (
              <Text>
                <Text color="suggestion">↑</Text>
                <Text bold>{tokens(figures.tokens.input)}</Text>
                <Text dimColor> in </Text>
                <Text color="success">↓</Text>
                <Text bold>{tokens(figures.tokens.output)}</Text>
                <Text dimColor> out</Text>
              </Text>
            )}
            {figures.costUsd !== null && <Text dimColor>{figures.tokens !== null ? ' · ' : ''}≈ ${figures.costUsd.toFixed(2)} API price</Text>}
          </Text>,
        )}
      {item(
        'rail-dials',
        'dials',
        <Text>
          <Text dimColor>Dials </Text>
          <Text bold>{figures.preset}</Text>
        </Text>,
      )}
      {item(
        'rail-sources',
        'context',
        <Text>
          <Text bold>{figures.sourcesOn}</Text>
          <Text dimColor>
            {figures.sourcesTotal === figures.sourcesOn ? '' : `/${figures.sourcesTotal}`} {figures.sourcesOn === 1 && figures.sourcesTotal <= 1 ? 'source on' : 'sources on'}
          </Text>
        </Text>,
      )}
      {item(
        'rail-worktree',
        'worktree',
        figures.branch === null ? (
          <Text dimColor>Worktree off</Text>
        ) : (
          <Text>
            <Text color="success">⎇ </Text>
            <Text bold>{figures.branch}</Text>
          </Text>
        ),
      )}
    </Box>
  )
}
