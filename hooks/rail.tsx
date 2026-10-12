// The rail above the prompt while there is no worktree news: Craftshop's
// status at a glance (context window, prompt cache, cost, dials, sources,
// worktree), each item opening its tab. worktree.tsx gathers the figures.
import type { RenderElement } from 'claude-code'

import type { Tab } from '../types'
import { svg, track } from './kit'
import { tokens } from './ui'
import type { Ui } from './ui'

export type RailFigures = {
  isPaneOpen: boolean
  percent: number
  used: number
  window: number
  // Share of the last request's input the prompt cache served, null before one.
  cachePercent: number | null
  costUsd: number | null
  preset: string
  sourcesOn: number
  sourcesTotal: number
  branch: string | null
}

const FILL: Record<string, string> = { success: '#3fb6a8', warning: '#d6a24a', error: '#e5534b' }

function windowColor(percent: number): string {
  return percent >= 85 ? 'error' : percent >= 65 ? 'warning' : 'success'
}

export function drawRail(ui: Ui, figures: RailFigures, open: (tab: Tab | null) => void) {
  const { Box, Text, Button } = ui
  const rich = ui.Svg !== undefined
  const color = windowColor(figures.percent)
  const cacheColor = figures.cachePercent === null ? undefined : figures.cachePercent >= 70 ? 'success' : figures.cachePercent >= 30 ? 'warning' : 'error'
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
      <Box gap={1} alignItems="center">
        {item(
          'rail-window',
          'context',
          <Text>
            <Text dimColor>Context </Text>
            <Text color={color} bold>
              {figures.percent}%
            </Text>
            <Text dimColor>
              {' '}
              {tokens(figures.used)}/{tokens(figures.window)}
            </Text>
          </Text>,
        )}
        {rich && svg(ui, track(figures.percent / 100, 56, FILL[color]), `${figures.percent}% of the context window`, 56, 6)}
      </Box>
      {figures.cachePercent !== null &&
        item(
          'rail-cache',
          'context',
          <Text>
            <Text dimColor>Cache </Text>
            <Text color={cacheColor} bold>
              {figures.cachePercent}%
            </Text>
          </Text>,
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
