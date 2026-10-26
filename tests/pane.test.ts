import { expect, test } from 'claude-code/testing'

import { faultRetryMs } from '../hooks/pane'
import { drawRail } from '../hooks/rail'
import { resolveUi } from '../hooks/ui'
import type { Ui } from '../hooks/ui'
import { activate, keysOf, mountBand, mountPane, openCard, startSession, world } from './world'

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
    expect(await ui.find({ text: 'No slots kept. Create worktree now still works.' }), surface).toBeDefined()
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

test('/fishstack, or /fs for short, opens the card it names: above the prompt where nothing docks, on the right where it does', async ($, on) => {
  const { panes } = world(on, { isRepo: false })
  await startSession($)
  const run = (command: string, args: string, isFullscreen = false) =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen, columns: 200 } })
  expect((await run('fs', 'nope')).text).toBe('No card named "nope". Try /fs worktree, dials, context or panel.')
  // Alone, it opens the Worktree card when none was open before.
  expect((await run('fs', '')).text).toBe('Opened fishStack · Worktree, above the prompt.')
  const opened = await run('fishstack', 'dials')
  expect(opened.text).toBe('Opened fishStack · Dials, above the prompt.')
  const band = await mountBand($, 'terminal')
  expect(await band.find({ key: 'body-dials' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'pip-crew-1' })).toBeDefined()
  // Alone again, the last card it opened.
  expect((await run('fs', '')).text).toBe('Opened fishStack · Dials, above the prompt.')
  expect(panes).toEqual([])
  expect((await run('fs', 'panel')).text).toBe('Opened the fishStack panel.')
  expect(panes).toEqual(['fishstack'])
  // Where the pane docks, the card shows there.
  expect((await run('fs', 'context', true)).text).toBe('Opened fishStack · Context.')
  const pane = await mountPane($, 'desktop')
  expect(await pane.find({ key: 'body-context' })).toBeDefined()
})

test("the rail's cache gauge runs down for 5 minutes after a reply, then goes cold", async ($, on) => {
  const { clock } = world(on, { isRepo: false })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  // Shown, not a button: the cache has no pane of its own.
  expect(await band.find({ type: 'Button', key: 'rail-cache' })).toBeUndefined()
  const cache = async () => (await band.find({ key: 'rail-cache' }))?.text
  // The gauge is there from the start, empty until a reply.
  expect(await cache()).toBe('Cache starts next reply')

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false })
  await band.redraw()
  expect(await cache()).toBe('Cache warm 5:00 · 93% hit')
  await clock.advance(3 * 60_000 + 10_000)
  await band.redraw()
  expect(await cache()).toBe('Cache warm 1:50 · 93% hit')
  await clock.advance(2 * 60_000)
  await band.redraw()
  expect(await cache()).toBe('Cache cold')
})

test('with no worktree news the band is a status rail whose items open their card under it', async ($, on) => {
  const { panes } = world(on, { isRepo: false })
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await band.find({ type: 'Button', key: 'open-fishstack' })).toBeDefined()
  expect((await band.find({ key: 'rail-cache' }))?.text).toBe('Cache starts next reply')
  // The items say what each card's head says.
  expect((await band.find({ type: 'Button', key: 'rail-worktree' }))?.text).toBe('⎇ Main checkout')
  expect((await band.find({ type: 'Button', key: 'rail-dials' }))?.text).toBe('◇ Balanced')
  expect((await band.find({ type: 'Button', key: 'rail-sources' }))?.text).toBe('▤ None yet')
  await band.press({ key: 'rail-dials' })
  await band.redraw()
  expect(await band.find({ key: 'body-dials' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'dial-foresight' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'open-fishstack' })).toBeDefined()
  expect(panes).toEqual([])
  // Pressed again, the card closes and the rail is all that is left.
  await band.press({ key: 'rail-dials' })
  await band.redraw()
  expect(await band.find({ key: 'body-dials' })).toBeUndefined()
  expect(await band.find({ type: 'Button', key: 'open-fishstack' })).toBeDefined()
})

test('on the desktop each rail pill is a picture whose hover the surface lights and captions, and whose press opens its card', async ($, on) => {
  world(on, { isRepo: false })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  // Two turns' tokens, one of them a subagent's: the rail sums them all.
  const usage = { input_tokens: 1_200, output_tokens: 800, cache_read_input_tokens: 52_000, cache_creation_input_tokens: 3_000, model: 'claude-opus-5-5' }
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false, usage } as never)
  await $.turn.complete({ turnId: 't2', agentId: 'a1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false, usage } as never)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  // Each pill its own picture and press; its lit drawing and its caption wait
  // hidden, for the surface to reveal on hover: no hook, nothing moves.
  expect(await keysOf(band, /^rail-.*-press$/)).toEqual(['rail-brand-press', 'rail-cache-press', 'rail-tokens-press', 'rail-dials-press', 'rail-sources-press', 'rail-worktree-press'])
  const drawn = JSON.stringify(await band.drawn())
  // The tokens pill shows the cost alone; the tokens wait in its caption.
  expect(drawn).toContain('>≈ $0.42<')
  expect(drawn).not.toContain('>112k<')
  // The pointer reaches the plugin through each pill's Client: entering lights
  // that pill and fills the caption row, which is always there.
  const lit = async () => {
    const tree = await band.drawn()
    const hot = ['brand', 'cache', 'tokens', 'dials', 'sources', 'worktree'].filter(
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
  await point('tokens', 'enter')
  expect(await lit()).toEqual({ hot: ['tokens'], caption: '↑ 112k sent · ↓ 1.6k received · API list price, cache reads and writes included; not your bill' })
  // One row: the caption sits beside the pills, and nothing wraps.
  const row = byKey(await band.drawn(), 'rail-row') as { props: Record<string, unknown>; children: { props: { key?: string } }[] }
  expect(row.props).toMatchObject({ flexWrap: 'nowrap', overflow: 'hidden' })
  expect(row.children.map(child => child.props.key).slice(-1)).toEqual(['rail-caption'])
  expect((byKey(await band.drawn(), 'hot-rail-tokens-press') as { children: { props: { source: string } }[] }).children[0]!.props.source).toContain('class="pill hot"')
  expect(await layout()).toBe(resting)
  // Straight onto the next pill, its leave landing after: only the new one lit.
  await point('dials', 'enter')
  await point('tokens', 'leave')
  expect(await lit()).toEqual({ hot: ['dials'], caption: 'Dials: Balanced · tune how the agent works' })
  // A post that is not a hover changes nothing.
  await band.post({ hover: 'x' }, { in: 'rail-dials-press' })
  await band.redraw()
  expect((await lit()).hot).toEqual(['dials'])
  await point('dials', 'leave')
  expect(await lit()).toEqual({ hot: [], caption: '' })
  expect(await layout()).toBe(resting)

  await activate(band, 'rail-dials-press')
  await band.redraw()
  expect(await band.find({ key: 'body-dials' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'dial-foresight' })).toBeDefined()
})

test('on the desktop the rail fits its one row: the least needed pills give up their words first', async ($, on) => {
  world(on, { isRepo: false })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  const usage = { input_tokens: 14_000_000, output_tokens: 67_000, cache_read_input_tokens: 700_000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false, usage } as never)
  const at = async (bodyColumns: number) => {
    const band = await $.ui.mount({
      plugin: 'fishstack',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    const tree = await band.drawn()
    const ids = ['brand', 'cache', 'tokens', 'dials', 'sources', 'worktree']
    const svgs = ids.map(id => (byKey(tree, `drawn-rail-${id}-press`) as { children: { props: { source: string; width: number; height: number; alt: string } }[] }).children[0]!.props)
    const width = svgs.reduce((sum, svg) => sum + svg.width, 0) + (svgs.length - 1) * 7
    // Words beyond a count: the sources pill only ever has its number.
    const worded = Object.fromEntries(ids.map((id, index) => [id, /<text/.test(svgs[index]!.source) && !(id === 'sources')]))
    expect(svgs[4]!.source).not.toContain('source')
    return { width, worded, svgs }
  }
  // Wide: every pill keeps its words.
  const wide = await at(200)
  expect(wide.svgs[4]!.alt).toBe('Add files, links or notes')
  // Slim: every pill under 25px tall, and all six whole fit 120 columns.
  expect(Math.max(...wide.svgs.map(svg => svg.height))).toBeLessThanOrEqual(25)
  expect((await at(120)).worded).toEqual({ brand: false, cache: false, tokens: true, dials: true, sources: false, worktree: true })
  expect((await at(120)).width).toBeLessThanOrEqual((120 - 3) * 7)
  expect(wide.worded).toEqual({ brand: false, cache: false, tokens: true, dials: true, sources: false, worktree: true })
  // About 560px: the row fits whole.
  const mid = await at(80)
  expect(mid.width).toBeLessThanOrEqual((80 - 3) * 7)
  expect(mid.worded).toEqual({ brand: false, cache: false, tokens: true, dials: true, sources: false, worktree: true })
  const narrow = await at(55)
  expect(narrow.width).toBeLessThanOrEqual((55 - 3) * 7)
  expect(narrow.worded).toEqual({ brand: false, cache: false, tokens: true, dials: false, sources: false, worktree: false })
  expect(narrow.svgs[2]!.source).toContain('>≈ $0.42<')
  expect(narrow.svgs[2]!.alt).toBe('↑ 14.7M sent · ↓ 67.0k received · API list price, cache reads and writes included; not your bill')
  // An icon still says what it stands for when hovered.
  expect(narrow.svgs[3]!.alt).toBe('Dials: Balanced · tune how the agent works')
})

test('the cache gauge and the cost stay on the rail when the state starts over, from what the store kept', async ($, on) => {
  // As after a reload or a rename: no state, but this session's last reply
  // a minute ago and its tokens kept in the store.
  world(on, { isRepo: false, store: { rail: { sessionId: 'abcdef123456', repliedAt: 1_000_000 - 60_000, tokens: { input: 20_100_000, output: 86_700 } } } })
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  const tree = await band.drawn()
  const alt = (id: string) => (byKey(tree, `drawn-rail-${id}-press`) as { children: { props: { alt: string; source: string } }[] }).children[0]!.props
  expect(alt('cache').alt).toBe('Cache warm, 4:00 left: replies now are cheaper · last reply 93% from cache')
  expect(alt('tokens').source).toContain('>≈ $0.42<')
  expect(alt('tokens').alt).toBe('↑ 20.1M sent · ↓ 86.7k received · API list price, cache reads and writes included; not your bill')
})

test("the cache's hit rate, the last reply's and the session's, is what Claude reported", async ($, on) => {
  world(on, { isRepo: false })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  // Two turns: 48k of 51.3k read from the cache, then 90k of 100k.
  for (const usage of [
    { input_tokens: 1_200, output_tokens: 3_400, cache_read_input_tokens: 48_000, cache_creation_input_tokens: 2_100 },
    { input_tokens: 4_000, output_tokens: 1_000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 6_000 },
  ]) {
    await $.turn.complete({ turnId: 't', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false, usage: { ...usage, model: 'claude-opus-5-5' } } as never)
  }
  const band = await mountBand($, 'desktop')
  const tree = await band.drawn()
  const caption = (byKey(tree, 'drawn-rail-cache-press') as { children: { props: { alt: string } }[] }).children[0]!.props.alt
  // The last reply's share is the session's live window (the world reports
  // 93%); the session's is summed over both turns: 138k of 151.3k.
  expect(caption).toBe('Cache warm, 5:00 left: replies now are cheaper · last reply 93% from cache · session 91% (138k of 151k input tokens)')
})

test("another session's kept figures are not this one's: the gauge waits, the cost still shows", async ($, on) => {
  world(on, { isRepo: false, store: { rail: { sessionId: 'someone-else', repliedAt: 1_000_000 - 60_000, tokens: { input: 5, output: 5 } } } })
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  const tree = await band.drawn()
  const alt = (id: string) => (byKey(tree, `drawn-rail-${id}-press`) as { children: { props: { alt: string; source: string } }[] }).children[0]!.props
  expect(alt('cache').alt).toBe('Prompt cache: the gauge starts with the next reply · last reply 93% from cache')
  expect(alt('tokens').alt).toBe('≈ $0.42 API list price, cache reads and writes included; not your bill')
})

test('each rail pill opens its own card under the rail, and the cache and cost open nothing', async ($, on) => {
  const { panes } = world(on, { isRepo: false })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false } as never)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 40, bodyColumns: 200, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const cardShown = async () => {
    await band.redraw()
    for (const id of ['worktree', 'dials', 'context']) if ((await band.find({ key: `body-${id}` })) !== undefined) return id
    return 'none'
  }
  // The cache and the cost explain themselves on hover; a press opens nothing.
  await activate(band, 'rail-cache-press')
  await activate(band, 'rail-tokens-press')
  expect(await cardShown()).toBe('none')

  await activate(band, 'rail-dials-press')
  expect(await cardShown()).toBe('dials')
  await activate(band, 'rail-sources-press')
  expect(await cardShown()).toBe('context')
  await activate(band, 'rail-worktree-press')
  expect(await cardShown()).toBe('worktree')
  // A pill pressed again closes its card.
  await activate(band, 'rail-worktree-press')
  expect(await cardShown()).toBe('none')
  // The mark opens the Worktree card when none is open, and closes any that is.
  await activate(band, 'rail-brand-press')
  expect(await cardShown()).toBe('worktree')
  await activate(band, 'rail-dials-press')
  await activate(band, 'rail-brand-press')
  expect(await cardShown()).toBe('none')
  // None of it opens the pane.
  expect(panes).toEqual([])
})

// The rail stays where the pane docks: nothing opens the pane but /fs panel,
// and with it open and shown the rail still draws.
test('where the surface docks, the pane opens on the right by itself, the rail stays, and a rail item opens its card there', async ($, on) => {
  const { clock, panes } = world(on, { isRepo: false })
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'desktop',
    component: 'AbovePrompt',
    viewport: { columns: 120, rows: 40, isFullscreen: true },
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  await clock.advance(1)
  expect(panes).toEqual(['fishstack'])
  await band.redraw()
  const keys = await keysOf(band, /^rail-.*-press$/)
  for (const key of ['rail-brand-press', 'rail-cache-press', 'rail-dials-press', 'rail-sources-press', 'rail-worktree-press']) expect(keys).toContain(key)
  // The Dials item opens its card in the pane, not under the rail.
  await activate(band, 'rail-dials-press')
  await band.redraw()
  expect(await band.find({ key: 'body-dials' })).toBeUndefined()
  const pane = await mountPane($, 'desktop')
  expect(await pane.find({ key: 'body-dials' })).toBeDefined()
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
// rail that wraps pushes the prompt down and reads as two.
test('the desktop rail keeps one row while its Buttons stand in; the terminal may wrap', () => {
  const figures = { isWorking: true, cacheSecondsLeft: 200, cachePercent: 90, tokens: { input: 12_700_000, output: 56_000 }, costUsd: 7.36, preset: 'Autopilot', presetLevels: [4, 3, 5, 5, 4, 2], sourcesOn: 0, sourcesTotal: 0, branch: 'kind-hermann-f2092f', preparingStep: null, autopilot: null, isDialsOn: true, isContextOn: true }
  const element = (name: string) => (props: unknown) => ({ name, props })
  const table = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Markdown: element('Markdown'), Code: element('Code'), Svg: element('Svg'), Client: element('Client') } as unknown as Ui
  const row = (surface: string) => drawRail(resolveUi(table, surface, true), figures, () => undefined, null, () => undefined, 120) as unknown as { props: Record<string, unknown> }
  expect(row('desktop').props).toMatchObject({ flexWrap: 'nowrap', overflow: 'hidden' })
  expect(row('terminal').props).toMatchObject({ flexWrap: 'wrap' })
})
