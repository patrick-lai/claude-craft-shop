// The rail above the prompt while there is no worktree news: Craftshop's
// status at a glance (context window, prompt cache, cost, dials, sources,
// worktree), each item opening its tab. worktree.tsx gathers the figures.
import type { RenderElement } from 'claude-code'

import type { Tab } from '../types'
import { cacheGauge, drawnButton } from './kit'
import { railArt } from './rail-art'
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

// On the desktop each pill is its own picture with a Client over it for the
// press (kit.tsx's drawnButton). Hovers never reach the hooks: the surface
// swaps in the lit drawing and reveals the pill's caption in a row that is
// always there, so nothing moves under the pointer.
export function drawRail(ui: Ui, figures: RailFigures, open: (tab: Tab | null) => void) {
  const { Box, Text, Button, Svg } = ui
  if (Svg !== undefined && ui.Client !== undefined) {
    const pills = railArt(figures)
    return (
      <Box flexDirection="column">
        <Box key="rail-caption" height={1} overflow="hidden" position="relative">
          <Text> </Text>
          {pills.map(pill => (
            <Box key={`caption-${pill.id}`} position="absolute" top={0} left={0} right={0} display="none" hover={{ display: 'flex', scope: `craft-rail-${pill.id}` }}>
              <Text dimColor wrap="truncate-end">
                {pill.caption}
              </Text>
            </Box>
          ))}
        </Box>
        <Box gap={1} alignItems="center" flexWrap="wrap">
          {pills.map(pill => (
            <Box key={`rail-${pill.id}`} position="relative" flexShrink={0} hover={{ scope: `craft-rail-${pill.id}` }}>
              {drawnButton(ui, `rail-${pill.id}-press`, pill.source, pill.caption, pill.width, pill.height, () => open(pill.tab === 'pane' ? null : pill.tab))}
              <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex', scope: `craft-rail-${pill.id}` }}>
                <Svg source={pill.hotSource} alt={pill.caption} width={pill.width} height={pill.height} />
              </Box>
            </Box>
          ))}
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
  return (
    <Box gap={2} alignItems="center" flexWrap="wrap">
      {item(
        'open-craftshop',
        null,
        <Text bold color="claude">
          ▸ Craftshop
        </Text>,
      )}
      {left !== null && (
        <Box gap={1} alignItems="center">
          {Svg !== undefined ? (
            <Svg source={cacheGauge(left, figures.isWorking, figures.cachePercent)} alt={isWarm ? `Prompt cache warm, ${clock} left` : 'Prompt cache cold'} width={70} height={20} isInteractive />
          ) : (
            <Text color={isWarm ? 'warning' : undefined} dimColor={!isWarm}>
              {'▮'.repeat(figures.isWorking ? 5 : Math.ceil(left / 60))}
              {'▯'.repeat(figures.isWorking ? 0 : 5 - Math.ceil(left / 60))}
            </Text>
          )}
          {item(
            'rail-cache',
            'context',
            figures.isWorking ? (
              <Text dimColor>Working</Text>
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
      )}
      {figures.tokens !== null &&
        item(
          'rail-tokens',
          'context',
          <Text>
            <Text color="suggestion">↑</Text>
            <Text bold>{tokens(figures.tokens.input)}</Text>
            <Text dimColor> in </Text>
            <Text color="success">↓</Text>
            <Text bold>{tokens(figures.tokens.output)}</Text>
            <Text dimColor> out</Text>
            {figures.costUsd !== null && <Text dimColor> · ≈ ${figures.costUsd.toFixed(2)} API price</Text>}
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
