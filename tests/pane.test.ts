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
  const cache = async () => (await band.find({ type: 'Button', key: 'rail-cache' }))?.text
  // The gauge is there from the start, empty until a reply.
  expect(await cache()).toBe('Cache starts next reply')

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
    plugin: 'fishstack',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await band.find({ type: 'Button', key: 'open-fishstack' })).toBeDefined()
  expect((await band.find({ type: 'Button', key: 'rail-dials' }))?.text).toContain('Dials Balanced')
  expect((await band.find({ type: 'Button', key: 'rail-sources' }))?.text).toContain('0 sources on')
  expect((await band.find({ type: 'Button', key: 'rail-worktree' }))?.text).toContain('Worktree off')
  await band.press({ key: 'rail-dials' })
  const pane = await mountPane($, 'desktop')
  expect(await pane.find({ type: 'Button', key: 'dial-foresight' })).toBeDefined()
  await band.redraw()
  expect(await band.find({ type: 'Button', key: 'open-fishstack' })).toBeDefined()
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
  expect(await lit()).toEqual({ hot: ['tokens'], caption: '↑ 112k sent · ↓ 1.6k received · API list price, not your bill' })
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
      plugin: 'fishstack',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    const tree = await band.drawn()
    const ids = ['brand', 'cache', 'tokens', 'dials', 'sources', 'worktree']
    const svgs = ids.map(id => (byKey(tree, `drawn-rail-${id}-press`) as { children: { props: { source: string; width: number; height: number; alt: string } }[] }).children[0]!.props)
    const width = svgs.reduce((sum, svg) => sum + svg.width, 0) + (svgs.length - 1) * 7
    const worded = Object.fromEntries(ids.map((id, index) => [id, /<text/.test(svgs[index]!.source) && !(id === 'sources' && !svgs[index]!.source.includes(' sources'))]))
    return { width, worded, svgs }
  }
  // Wide: every pill keeps its words.
  const wide = await at(200)
  // Slim: every pill under 25px tall, and all six whole fit 120 columns.
  expect(Math.max(...wide.svgs.map(svg => svg.height))).toBeLessThanOrEqual(25)
  expect((await at(120)).worded).toEqual({ brand: true, cache: false, tokens: true, dials: true, sources: true, worktree: true })
  expect((await at(120)).width).toBeLessThanOrEqual((120 - 3) * 7)
  expect(wide.worded).toEqual({ brand: true, cache: false, tokens: true, dials: true, sources: true, worktree: true })
  // About 560px: the wordmark goes first, and the row fits.
  const mid = await at(80)
  expect(mid.width).toBeLessThanOrEqual((80 - 3) * 7)
  expect(mid.worded).toEqual({ brand: false, cache: false, tokens: true, dials: true, sources: true, worktree: true })
  const narrow = await at(60)
  expect(narrow.width).toBeLessThanOrEqual((60 - 3) * 7)
  expect(narrow.worded).toEqual({ brand: false, cache: false, tokens: true, dials: false, sources: false, worktree: false })
  expect(narrow.svgs[2]!.source).toContain('>≈ $0.42<')
  expect(narrow.svgs[2]!.alt).toBe('↑ 14.7M sent · ↓ 67.0k received · API list price, not your bill')
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
  expect(alt('cache').alt).toBe('Cache warm, 4:00 left: replies now are cheaper')
  expect(alt('tokens').source).toContain('>≈ $0.42<')
  expect(alt('tokens').alt).toBe('↑ 20.1M sent · ↓ 86.7k received · API list price, not your bill')
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
  expect(alt('cache').alt).toBe('Prompt cache: the gauge starts with the next reply')
  expect(alt('tokens').alt).toBe('≈ $0.42 at API list price, not your bill')
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
