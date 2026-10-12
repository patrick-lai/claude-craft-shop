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
  const caption = byKey(await band.drawn(), 'caption-tokens')
  expect(caption).toMatchObject({ props: { display: 'none' }, hover: { display: 'flex', scope: 'craft-rail-tokens' } })
  expect(JSON.stringify(caption)).toContain('at API list prices, not your plan')
  expect(byKey(await band.drawn(), 'rail-tokens')).toMatchObject({ hover: { scope: 'craft-rail-tokens' } })

  await activate(band, 'rail-dials-press')
  const pane = await mountPane($, 'desktop')
  expect(await pane.find({ type: 'Button', key: 'dial-foresight' })).toBeDefined()
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
