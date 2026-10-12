import { expect, test } from 'claude-code/testing'

import { activate, keysOf, mountPane, startSession, world } from './world'

test('the tabs switch on press and each draws its empty state', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    await activate(ui, 'tab-worktree')
    expect(await ui.find({ text: /No worktree for this session/ }), surface).toBeDefined()

    await activate(ui, 'tab-dials')
    expect(await ui.find({ key: 'preset-Balanced' }), surface).toBeDefined()
    expect(await ui.find({ text: /Plan steps/ }), surface).toBeDefined()

    await activate(ui, 'tab-context')
    expect(await ui.find({ text: /No sources yet/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'add-input' }), surface).toBeDefined()

    await ui.unmount()
  }
})

test('/craft opens the pane on the tab it names', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const opened = await $.command.run({
    command: 'craft',
    args: 'dials',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })
  expect(opened.text).toBe('Opened Craftshop · Dials.')
  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Button', key: 'pip-crew-1' })).toBeDefined()
})

test("the rail's cache gauge runs down for 5 minutes after a reply, then goes cold", async ($, on) => {
  const { clock } = world(on, { isRepo: false })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'craft-shop',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  const cache = async () => (await band.find({ type: 'Button', key: 'rail-cache' }))?.text
  expect(await cache()).toBeUndefined()

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false })
  await band.redraw()
  expect(await cache()).toBe('Cache warm 5:00')
  await clock.advance(3 * 60_000 + 10_000)
  await band.redraw()
  expect(await cache()).toBe('Cache warm 1:50')
  await clock.advance(2 * 60_000)
  await band.redraw()
  expect(await cache()).toBe('Cache cold')
})

test('with no worktree news the band is a status rail whose items open their tab', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'craft-shop',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await band.find({ type: 'Button', key: 'open-craftshop' })).toBeDefined()
  expect((await band.find({ type: 'Button', key: 'rail-dials' }))?.text).toContain('Dials Balanced')
  expect((await band.find({ type: 'Button', key: 'rail-sources' }))?.text).toContain('0 sources on')
  expect((await band.find({ type: 'Button', key: 'rail-worktree' }))?.text).toContain('Worktree off')
  await band.press({ key: 'rail-dials' })
  const pane = await mountPane($, 'desktop')
  expect(await pane.find({ type: 'Button', key: 'dial-foresight' })).toBeDefined()
  await band.redraw()
  expect(await band.find({ type: 'Button', key: 'open-craftshop' })).toBeDefined()
})

test('on the desktop each rail pill is a picture whose hover the surface lights and captions, and whose press opens its tab', async ($, on) => {
  world(on, { isRepo: false })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  // Two turns' tokens, one of them a subagent's: the rail sums them all.
  const usage = { input_tokens: 1_200, output_tokens: 800, cache_read_input_tokens: 52_000, cache_creation_input_tokens: 3_000, model: 'claude-opus-5-5' }
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false, usage } as never)
  await $.turn.complete({ turnId: 't2', agentId: 'a1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false, usage } as never)
  const band = await $.ui.mount({
    plugin: 'craft-shop',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  // Each pill its own picture and press; its lit drawing and its caption wait
  // hidden, for the surface to reveal on hover: no hook, nothing moves.
  expect(await keysOf(band, /^rail-.*-press$/)).toEqual(['rail-brand-press', 'rail-cache-press', 'rail-tokens-press', 'rail-dials-press', 'rail-sources-press', 'rail-worktree-press'])
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('>112k<')
  expect(drawn).toContain('>1.6k<')
  expect(drawn).toContain('≈ $0.42')
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
  expect(await lit()).toEqual({ hot: ['tokens'], caption: '≈ $0.42 at API list prices, not your bill' })
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
  const pane = await mountPane($, 'desktop')
  expect(await pane.find({ type: 'Button', key: 'dial-foresight' })).toBeDefined()
})

test('on the desktop the rail fits its one row: the least needed pills give up their words first', async ($, on) => {
  world(on, { isRepo: false })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  const usage = { input_tokens: 14_000_000, output_tokens: 67_000, cache_read_input_tokens: 700_000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false, usage } as never)
  const at = async (bodyColumns: number) => {
    const band = await $.ui.mount({
      plugin: 'craft-shop',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    const tree = await band.drawn()
    const ids = ['brand', 'cache', 'tokens', 'dials', 'sources', 'worktree']
    const svgs = ids.map(id => (byKey(tree, `drawn-rail-${id}-press`) as { children: { props: { source: string; width: number; alt: string } }[] }).children[0]!.props)
    const width = svgs.reduce((sum, svg) => sum + svg.width, 0) + (svgs.length - 1) * 7
    const worded = Object.fromEntries(ids.map((id, index) => [id, /<text/.test(svgs[index]!.source) && !(id === 'sources' && !svgs[index]!.source.includes(' sources'))]))
    return { width, worded, svgs }
  }
  // Wide: every pill keeps its words.
  const wide = await at(200)
  expect(wide.worded).toEqual({ brand: true, cache: false, tokens: true, dials: true, sources: true, worktree: true })
  // About 700px: the wordmark goes first, and the row fits.
  const mid = await at(100)
  expect(mid.width).toBeLessThanOrEqual((100 - 3) * 7)
  expect(mid.worded.brand).toBe(false)
  expect(mid.worded.tokens).toBe(true)
  // Narrow: every pill that can is an icon, and the tokens keep what was
  // sent and the cost; what came back moves to the caption. It still fits.
  const narrow = await at(70)
  expect(narrow.width).toBeLessThanOrEqual((70 - 3) * 7)
  expect(narrow.worded).toEqual({ brand: false, cache: false, tokens: true, dials: false, sources: false, worktree: false })
  expect(narrow.svgs[2]!.source).toContain('≈ $0.42')
  expect(narrow.svgs[2]!.source).toContain('>14.7M<')
  expect(narrow.svgs[2]!.source).not.toContain('>67.0k<')
  expect(narrow.svgs[2]!.alt).toBe('↓ 67.0k received · ≈ $0.42 at API list prices, not your bill')
  // An icon still says what it stands for when hovered.
  expect(narrow.svgs[3]!.alt).toBe('Dials: Balanced · tune how the agent works')
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
