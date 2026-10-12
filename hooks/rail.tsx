// The rail above the prompt while there is no worktree news: Craftshop's
// status at a glance (context window, prompt cache, cost, dials, sources,
// worktree), each item opening its tab. worktree.tsx gathers the figures.
import type { ClientProps, ElementConstructor, RenderElement } from 'claude-code'

import type { Tab } from '../types'
import { cacheGauge } from './kit'
import { railArt } from './rail-art'
import type { Ui } from './ui'

export type RailFigures = {
  isPaneOpen: boolean
  isWorking: boolean
  // Seconds the prompt cache stays warm, null before the first reply.
  cacheSecondsLeft: number | null
  // Share of the last request's input the prompt cache served, null before one.
  cachePercent: number | null
  costUsd: number | null
  preset: string
  presetLevels: number[]
  sourcesOn: number
  sourcesTotal: number
  branch: string | null
}

// On the desktop the rail is one picture with a Client over it for presses
// and hovers. A hover lights its pill and changes nothing else: a row that
// came and went with it moved the rail under the pointer, which flickered.
export function drawRail(
  ui: Ui,
  figures: RailFigures,
  open: (tab: Tab | null) => void,
  hover: number | null,
  Client: ElementConstructor<ClientProps> | undefined,
) {
  const { Box, Text, Button, Svg } = ui
  if (Svg !== undefined && Client !== undefined) {
    const art = railArt(figures, hover, !figures.isPaneOpen)
    return (
      <Box flexDirection="column">
        <Box key="rail-art" position="relative">
          <Svg source={art.source} alt={art.segments.map(one => one.caption).join(' ')} width={art.width} height={art.height} />
          <Box position="absolute" top={0} left={0} right={0} bottom={0}>
            <Client
              key="rail-click"
              module="./rail-click.tsx"
              props={{ width: art.width, segments: art.segments.map(one => ({ x0: one.x0, x1: one.x1, tab: one.tab })) }}
              width="100%"
              height="100%"
            />
          </Box>
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
      {!figures.isPaneOpen &&
        item(
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
      {figures.costUsd !== null &&
        item(
          'rail-cost',
          'context',
          <Text>
            <Text dimColor>Cost </Text>
            <Text bold>${figures.costUsd.toFixed(2)}</Text>
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
