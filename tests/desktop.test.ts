// Every tab drawn on the desktop with real content: each tree must validate
// against the desktop's table (drawn() rejects otherwise). Each drawing is
// also printed between PREVIEW markers, which e2e/preview.mjs turns into an
// HTML page for a look at the layout.
import { expect, test } from 'claude-code/testing'

import { activate, keysOf, mountPane, startSession, world } from './world'

declare const console: { log: (...args: unknown[]) => void }

type Drawing = Awaited<ReturnType<typeof mountPane>>

async function show(ui: Pick<Drawing, "drawn">, name: string) {
  const tree = await ui.drawn()
  expect(tree).toBeDefined()
  console.log(`PREVIEW ${name} ${JSON.stringify(tree)}`)
}

async function buttons(ui: Drawing, key: RegExp) {
  return (await ui.findAll({ type: 'Button' })).filter(one => one.key !== undefined && key.test(one.key))
}

test('every tab draws on the desktop with content in it', async ($, on) => {
  world(on, { isRepo: false })
  on('fs.list', () => ({
    value: [
      { name: 'refunds.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
      { name: 'currency.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('refunds.md') ? 'Refunds settle in 5 business days. Partial refunds keep the original currency.' : 'Amounts are integer cents. Never use floats for money.' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  const ui = await mountPane($, 'desktop')

  await activate(ui, 'tab-context')
  await show(ui, 'context-empty')

  await ui.press({ key: 'pick-folder' })
  const [strict] = await keysOf(ui, /^strict-/)
  await activate(ui, strict!)
  await ui.input({ key: 'add-input', text: 'Every endpoint returns JSON with snake_case keys. Paginate with cursor, never offset.' })
  await ui.input({ key: 'add-input', text: 'https://example.com/style' })
  const [off] = (await keysOf(ui, /^toggle-/)).slice(-1)
  await activate(ui, off!)
  await show(ui, 'context-library')

  const [open] = await keysOf(ui, /^open-/)
  await activate(ui, open!)
  await show(ui, 'context-source')

  await activate(ui, 'tab-dials')
  await activate(ui, 'preset-Autopilot')
  await ui.press({ key: 'dial-tenacity' })
  await show(ui, 'dials')

  await activate(ui, 'tab-worktree')
  await show(ui, 'worktree-off')

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false, usage: { input_tokens: 1_200, output_tokens: 3_400, cache_read_input_tokens: 48_000, cache_creation_input_tokens: 2_100, model: 'claude-opus-5-5' } } as never)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  await show(band, 'rail')
  // The pointer on the tokens pill, as its Client reports it.
  await band.resize({ columns: 20, rows: 1, in: 'rail-tokens-press' })
  await band.pointer({ type: 'enter', x: 5, y: 0, in: 'rail-tokens-press' })
  await band.redraw()
  await show(band, 'rail-hover')
  // About 490px, as a narrow window leaves the composer.
  const narrow = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 70, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  await show(narrow, 'rail-narrow')
})

test('the worktree tab draws its steps and slots on the desktop', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock } = world(on)
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await activate(ui, 'tab-worktree')
  await show(ui, 'worktree-preparing')
  await clock.advance(1)
  await show(ui, 'worktree-ready')
})

test('the rail on Autopilot: a question waiting, then answered for the person', async ($, on) => {
  const { clock } = world(on, { isRepo: false, store: { dials: { foresight: 4, crew: 3, tenacity: 5, autonomy: 5, proof: 4, voice: 2 } } })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false, usage: { input_tokens: 1_200, output_tokens: 3_400, cache_read_input_tokens: 48_000, cache_creation_input_tokens: 2_100, model: 'claude-opus-5-5' } } as never)
  const band = await $.ui.mount({
    plugin: 'fishstack',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  const pending = $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red (Recommended)', description: '' }, { label: 'Blue', description: '' }] }] } as never)
  await clock.advance(4 * 60_000)
  await band.redraw()
  await show(band, 'rail-autopilot-wait')
  // The pointer on the dials pill: its caption says what will be picked.
  await band.resize({ columns: 20, rows: 1, in: 'rail-dials-press' })
  await band.pointer({ type: 'enter', x: 5, y: 0, in: 'rail-dials-press' })
  await band.redraw()
  await show(band, 'rail-autopilot-wait-hover')
  await clock.advance(11 * 60_000)
  await pending
  await band.redraw()
  await show(band, 'rail-autopilot-done-hover')
  await band.pointer({ type: 'leave', x: 5, y: 0, in: 'rail-dials-press' })
  await band.redraw()
  await show(band, 'rail-autopilot-done')
})
