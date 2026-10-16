import { expect, test } from 'claude-code/testing'

import { faultRetryMs } from '../hooks/pane'
import { drawRail } from '../hooks/rail'
import { resolveUi } from '../hooks/ui'
import type { Ui } from '../hooks/ui'
import { activate, keysOf, mountPane, openCard, startSession, world } from './world'

test('the cards open one at a time on press, close on a second, and each draws its empty state', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    // Every card starts closed, its head saying how it stands.
    for (const id of ['worktree', 'dials', 'context']) expect(await ui.find({ key: `body-${id}` }), surface).toBeUndefined()
    expect((await ui.find({ key: 'tab-worktree-state' }))?.text, surface).toBe('Main checkout ›')
    expect((await ui.find({ key: 'tab-dials-state' }))?.text, surface).toBe('Balanced ›')
    expect((await ui.find({ key: 'tab-context-state' }))?.text, surface).toBe('None yet ›')

    await openCard(ui, 'worktree')
    expect(await ui.find({ text: 'Sessions work in the main checkout.' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'worktree-create' }), surface).toBeDefined()

    await openCard(ui, 'dials')
    expect(await ui.find({ key: 'body-worktree' }), surface).toBeUndefined()
    expect(await ui.find({ key: 'preset-Balanced' }), surface).toBeDefined()
    expect(await ui.find({ text: /Plan steps/ }), surface).toBeDefined()

    await openCard(ui, 'context')
    expect(await ui.find({ text: /No sources yet/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'add-input' }), surface).toBeDefined()

    // A press on the open card's head closes it.
    await activate(ui, 'tab-context')
    expect(await ui.find({ key: 'body-context' }), surface).toBeUndefined()
    expect(await ui.find({ type: 'Input', key: 'add-input' }), surface).toBeUndefined()

    await ui.unmount()
  }
})

test('/fishstack, or /fs for short, opens the pane on the tab it names', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const run = (command: string, args: string) =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect((await run('fs', 'nope')).text).toBe('No tab named "nope". Try /fishstack worktree, dials or context.')
  expect((await run('fs', '')).text).toBe('Opened fishStack.')
  const opened = await run('fishstack', 'dials')
  expect(opened.text).toBe('Opened fishStack · Dials.')
  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Button', key: 'pip-crew-1' })).toBeDefined()
})

test('with no worktree news the band is a status rail of the cards\' heads, each opening its card', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await band.find({ type: 'Button', key: 'open-fishstack' })).toBeDefined()
  expect((await band.find({ type: 'Button', key: 'rail-worktree' }))?.text).toBe('⎇ Main checkout')
  expect((await band.find({ type: 'Button', key: 'rail-dials' }))?.text).toBe('◇ Balanced')
  expect((await band.find({ type: 'Button', key: 'rail-sources' }))?.text).toBe('▤ None yet')
  expect(await band.find({ text: '/fs' })).toBeDefined()
  // The cache and the spend are Claude Code's own to show.
  expect(await band.find({ key: 'rail-cache' })).toBeUndefined()
  expect(await band.find({ key: 'rail-tokens' })).toBeUndefined()
  await band.press({ key: 'rail-dials' })
  const pane = await mountPane($, 'desktop')
  expect(await pane.find({ type: 'Button', key: 'dial-foresight' })).toBeDefined()
  await band.redraw()
  expect(await band.find({ type: 'Button', key: 'open-fishstack' })).toBeDefined()
})

test('on the desktop each rail pill is a picture whose hover the surface lights and captions, and whose press opens its card', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  // Each pill its own picture and press; its lit drawing and its caption wait
  // hidden, for the surface to reveal on hover: no hook, nothing moves.
  // No cache or cost pill: those are Claude Code's own to show.
  expect(await keysOf(band, /^rail-.*-press$/)).toEqual(['rail-brand-press', 'rail-dials-press', 'rail-sources-press', 'rail-worktree-press'])
  // The pointer reaches the plugin through each pill's Client: entering lights
  // that pill and fills the caption row, which is always there.
  const lit = async () => {
    const tree = await band.drawn()
    const hot = ['brand', 'dials', 'sources', 'worktree'].filter(
      id => (byKey(tree, `hot-rail-${id}-press`) as { props: { display: string } }).props.display === 'flex',
    )
    const caption = ((await band.find({ key: 'rail-caption' }))?.text ?? '').trim()
    return { hot, caption }
  }
  // The layout, hover aside: every Box's key and size.
  const layout = async () =>
    JSON.stringify(await band.drawn(), function (this: { type?: string }, key, value) {
      return key === 'display' || (key === 'children' && this.type === 'Text') ? undefined : value
    })
  const resting = await layout()
  expect(await lit()).toEqual({ hot: [], caption: '' })
  const point = async (id: string, type: 'enter' | 'leave') => {
    await band.resize({ columns: 6, rows: 1, in: `rail-${id}-press` })
    await band.pointer({ type, x: 2, y: 0, in: `rail-${id}-press` })
    await band.redraw()
  }
  await point('sources', 'enter')
  expect(await lit()).toEqual({ hot: ['sources'], caption: 'Add files, links or notes' })
  // One row: the caption sits beside the pills, and nothing wraps.
  const row = byKey(await band.drawn(), 'rail-row') as { props: Record<string, unknown>; children: { props: { key?: string } }[] }
  expect(row.props).toMatchObject({ flexWrap: 'nowrap', overflow: 'hidden' })
  expect(row.children.map(child => child.props.key).slice(-1)).toEqual(['rail-caption'])
  expect((byKey(await band.drawn(), 'hot-rail-sources-press') as { children: { props: { source: string } }[] }).children[0]!.props.source).toContain('class="pill hot"')
  expect(await layout()).toBe(resting)
  // Straight onto the next pill, its leave landing after: only the new one lit.
  await point('dials', 'enter')
  await point('sources', 'leave')
  expect(await lit()).toEqual({ hot: ['dials'], caption: 'Dials: Balanced · tune how the agent works' })
  // A post that is not a hover changes nothing.
  await band.post({ hover: 'x' }, { in: 'rail-dials-press' })
  await band.redraw()
  expect((await lit()).hot).toEqual(['dials'])
  await point('dials', 'leave')
  expect(await lit()).toEqual({ hot: [], caption: '' })
  expect(await layout()).toBe(resting)

  await activate(band, 'rail-dials-press')
  const pane = await mountPane($, 'desktop')
  expect(await pane.find({ type: 'Button', key: 'dial-foresight' })).toBeDefined()
})

// Docked and shown, the pane says all the rail would: the band gives way.
test('where the pane docks and shows, the rail draws nothing; closed, it is back', async ($, on) => {
  const { clock, panes } = world(on, { isRepo: false })
  // Beneath the plugins, the engine's own band: what a plugin that draws
  // nothing leaves.
  on('ui.render', ($, e) => ({ type: 'engine', component: e.component }) as never)
  await startSession($)
  const band = () =>
    $.ui.render({
      surface: 'desktop',
      component: 'AbovePrompt',
      viewport: { columns: 120, rows: 40, isFullscreen: true },
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    } as never)
  // A docking surface opens the pane at once.
  expect(JSON.stringify(await band())).toContain('rail-dials-press')
  await clock.advance(1)
  expect(panes).toEqual(['fishstack'])
  const docked = await band()
  expect(docked).toMatchObject({ type: 'engine' })
  expect(JSON.stringify(docked)).not.toContain('rail-')
  panes.length = 0
  expect(JSON.stringify(await band())).toContain('rail-dials-press')
})

test('on the desktop the rail fits its one row: the least needed pills give up their words first', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const at = async (bodyColumns: number) => {
    const band = await $.ui.mount({
      plugin: 'fishstack',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    const tree = await band.drawn()
    const ids = ['brand', 'dials', 'sources', 'worktree']
    const svgs = ids.map(id => (byKey(tree, `drawn-rail-${id}-press`) as { children: { props: { source: string; width: number; height: number; alt: string } }[] }).children[0]!.props)
    const width = svgs.reduce((sum, svg) => sum + svg.width, 0) + (svgs.length - 1) * 7
    // Words beyond a count: the sources pill only ever has its number.
    const worded = Object.fromEntries(ids.map((id, index) => [id, /<text/.test(svgs[index]!.source) && !(id === 'sources')]))
    expect(svgs[2]!.source).not.toContain('source')
    return { width, worded, svgs }
  }
  // Wide: every pill keeps its words.
  const wide = await at(200)
  expect(wide.worded).toEqual({ brand: false, dials: true, sources: false, worktree: true })
  expect(wide.svgs[2]!.alt).toBe('Add files, links or notes')
  // Slim: every pill under 25px tall, and all four whole fit 45 columns.
  expect(Math.max(...wide.svgs.map(svg => svg.height))).toBeLessThanOrEqual(25)
  const mid = await at(45)
  expect(mid.width).toBeLessThanOrEqual((45 - 3) * 7)
  expect(mid.worded).toEqual(wide.worded)
  // Narrower, the worktree gives up its words first, then the dials.
  const narrow = await at(40)
  expect(narrow.width).toBeLessThanOrEqual((40 - 3) * 7)
  expect(narrow.worded).toEqual({ brand: false, dials: true, sources: false, worktree: false })
  const narrowest = await at(30)
  expect(narrowest.width).toBeLessThanOrEqual((30 - 3) * 7)
  expect(narrowest.worded).toEqual({ brand: false, dials: false, sources: false, worktree: false })
  // An icon still says what it stands for when hovered.
  expect(narrowest.svgs[1]!.alt).toBe('Dials: Balanced · tune how the agent works')
})

test('each rail pill opens its own card, and the mark opens the pane as it was left', async ($, on) => {
  const { panes } = world(on, { isRepo: false })
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(panes).toEqual([])

  const tabShown = async () => {
    const pane = await mountPane($, 'desktop')
    const shown =
      (await pane.find({ type: 'Button', key: 'dial-foresight' })) !== undefined
        ? 'dials'
        : (await pane.find({ key: 'pick-files' })) !== undefined
          ? 'context'
          : (await pane.find({ key: 'auto-worktree' })) !== undefined
            ? 'worktree'
            : 'none'
    await pane.unmount()
    return shown
  }
  await activate(band, 'rail-dials-press')
  expect(panes).toEqual(['fishstack'])
  expect(await tabShown()).toBe('dials')
  await activate(band, 'rail-sources-press')
  expect(await tabShown()).toBe('context')
  await activate(band, 'rail-worktree-press')
  expect(await tabShown()).toBe('worktree')
  // The mark opens the pane as it was left.
  await activate(band, 'rail-dials-press')
  await activate(band, 'rail-brand-press')
  expect(await tabShown()).toBe('dials')
})

// The element drawn under a key, hover and all (find leaves hover out).
function byKey(node: unknown, key: string): unknown {
  if (node === null || typeof node !== 'object') return undefined
  const element = node as { props?: { key?: unknown }; children?: unknown[] }
  if (element.props?.key === key) return element
  for (const child of element.children ?? []) {
    const found = byKey(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

// A Client whose module never answered is a dead placeholder on the desktop:
// once one is heard failing (ui.fault), the table leaves Clients out, so every
// drawn control falls back to its Button. The kit cannot raise a fault, so
// the table is checked directly.
test('with a Client down the desktop table leaves Clients out', async () => {
  const table = { Client: () => null, Svg: () => null } as unknown as Ui
  expect(resolveUi(table, 'desktop', false).Client).toBeDefined()
  expect(resolveUi(table, 'desktop', true).Client).toBeUndefined()
  expect(resolveUi(table, 'desktop', true).Svg).toBeDefined()
})

// A render that did not answer in time is often the desktop busy for a
// moment: the Buttons stand in, then the drawn controls are tried again,
// twice at most. A module that never loaded stays down for the session.
test('a Client fault is retried a minute later, twice at most; one that never loaded is not', () => {
  expect(faultRetryMs('render', 1)).toBe(60_000)
  expect(faultRetryMs('run', 2)).toBe(60_000)
  expect(faultRetryMs('render', 3)).toBeNull()
  expect(faultRetryMs('load', 1)).toBeNull()
})

// With its Client down the desktop rail is Buttons, and still one row: a
// rail that wraps pushes the prompt down and reads as two. The terminal's
// line is one row too.
test('the rail keeps one row on every surface, the desktop too while its Buttons stand in', () => {
  const figures = { isWorking: true, cacheSecondsLeft: 200, cachePercent: 90, tokens: { input: 12_700_000, output: 56_000 }, costUsd: 7.36, preset: 'Autopilot', presetLevels: [4, 3, 5, 5, 4, 2], sourcesOn: 0, sourcesTotal: 0, branch: 'kind-hermann-f2092f', preparingStep: null, autopilot: null, isDialsOn: true, isContextOn: true }
  const element = (name: string) => (props: unknown) => ({ name, props })
  const table = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Markdown: element('Markdown'), Code: element('Code'), Svg: element('Svg'), Client: element('Client') } as unknown as Ui
  const row = (surface: string) => drawRail(resolveUi(table, surface, true), figures, () => undefined, null, () => undefined, 120) as unknown as { props: Record<string, unknown> }
  expect(row('desktop').props).toMatchObject({ flexWrap: 'nowrap', overflow: 'hidden' })
  expect(row('terminal').props).toMatchObject({ flexWrap: 'nowrap', overflow: 'hidden' })
})
