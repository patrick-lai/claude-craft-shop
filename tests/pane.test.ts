import { expect, test } from 'claude-code/testing'

import { mountPane, startSession, world } from './world'

test('the tabs switch on press and each draws its empty state', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'tab-worktree' })
    expect(await ui.find({ text: /No worktree for this session/ }), surface).toBeDefined()

    await ui.press({ key: 'tab-dials' })
    expect(await ui.find({ type: 'Button', key: 'preset-Balanced' }), surface).toBeDefined()
    expect(await ui.find({ text: /Plan steps/ }), surface).toBeDefined()

    await ui.press({ key: 'tab-context' })
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

test('with no worktree news the band is a status rail whose items open their tab', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const band = await $.ui.mount({
    plugin: 'craft-shop',
    surface: 'desktop',
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
