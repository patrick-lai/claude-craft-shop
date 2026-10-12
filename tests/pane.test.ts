import { expect, test } from 'claude-code/testing'

import { activate, mountPane, startSession, world } from './world'

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
  expect(await band.find({ type: 'Button', key: 'open-craftshop' })).toBeUndefined()
})

test('on the desktop the rail is one picture: hovering lights a pill without moving it, pressing opens its tab', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'craft-shop',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await band.find({ type: 'Svg' })).toBeDefined()
  const overlay = (await band.find({ type: 'Client', key: 'rail-click' }))!.props as {
    props: { width: number; segments: { x0: number; x1: number; tab: string }[] }
  }
  const { width, segments } = overlay.props
  expect(segments.map(one => one.tab)).toEqual(['pane', 'context', 'dials', 'context', 'worktree'])

  // Lay the overlay out at 60 cells and point at the middle of the Dials pill.
  await band.resize({ columns: 60, rows: 2, in: 'rail-click' })
  const dials = segments[2]!
  const x = Math.floor(((dials.x0 + dials.x1) / 2 / width) * 60)
  await band.pointer({ type: 'move', x, y: 0, in: 'rail-click' })
  await band.redraw()
  const lit = (await band.find({ type: 'Svg' }))!.props as { source: string }
  expect(lit.source.match(/class="pill hot"/g)).toHaveLength(1)
  expect(await band.find({ text: /Dials: Balanced/ })).toBeUndefined()
  await band.pointer({ type: 'down', x, y: 0, button: 'left', in: 'rail-click' })
  const pane = await mountPane($, 'desktop')
  expect(await pane.find({ type: 'Button', key: 'dial-foresight' })).toBeDefined()
})
