// The desktop drawings the README shows, printed between PREVIEW markers
// like desktop.test.ts's: e2e/reel/desktop.mjs turns a run of them into the
// README's desktop GIFs. Each tree is the desktop's own, so it must validate.
import { expect, test } from 'claude-code/testing'

import { activate, mountBand, mountPane, openCard, startSession, world } from './world'

declare const console: { log: (...args: unknown[]) => void }

const AUTOPILOT = { foresight: 4, crew: 3, tenacity: 5, autonomy: 5, proof: 4, voice: 2 }
const MINUTE = 60_000
const TURN = { turnId: 't1', answer: 'done', durationMs: 1_000, reason: 'answer', isAborted: false, usage: { input_tokens: 2_400, output_tokens: 5_100, cache_read_input_tokens: 61_000, cache_creation_input_tokens: 3_300, model: 'claude-opus-5-5' } }

async function show(ui: { drawn: () => Promise<unknown> }, name: string) {
  const tree = await ui.drawn()
  expect(tree).toBeDefined()
  console.log(`PREVIEW ${name} ${JSON.stringify(tree)}`)
}

test('media: the dials, preset by preset', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await openCard(ui, 'dials')
  for (const preset of ['Balanced', 'Quick', 'Deep work', 'Autopilot']) {
    await activate(ui, `preset-${preset}`)
    await show(ui, `media-dials-${preset.toLowerCase().replace(' ', '-')}`)
  }
})

// Three notes on, as a person's library might hold them.
const LIBRARY = {
  sources: ['Every JSON response uses snake_case keys.', 'Money is integer cents, never floats.', 'Errors are { error: string }.'].map((text, index) => ({
    id: `n${index}`,
    kind: 'note',
    title: text,
    text,
    url: null,
    path: null,
    mode: index === 0 ? 'strict' : 'guidance',
    folderId: null,
  })),
  folders: [],
}

test('media: the rail, from a reply to an answer Autopilot gave', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock } = world(on, { store: { dials: AUTOPILOT, 'context:/repo': LIBRARY } })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await startSession($)
  // The session in its slot, its first reply in: the band gives way to the rail.
  await clock.advance(1)
  await $.turn.complete(TURN as never)
  const band = await mountBand($, 'desktop')
  const point = async (id: string | null, last: string | null) => {
    if (last !== null) await band.pointer({ type: 'leave', x: 2, y: 0, in: `rail-${last}-press` })
    if (id !== null) {
      await band.resize({ columns: 20, rows: 1, in: `rail-${id}-press` })
      await band.pointer({ type: 'enter', x: 2, y: 0, in: `rail-${id}-press` })
    }
    await band.redraw()
  }
  await show(band, 'media-rail-1')
  await clock.advance(30_000)
  await point('sources', null)
  await show(band, 'media-rail-2')
  await point('worktree', 'sources')
  await show(band, 'media-rail-3')
  await point(null, 'worktree')
  const pending = $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which port?', header: 'Port', multiSelect: false, options: [{ label: '4517 (Recommended)', description: '' }, { label: '8080', description: '' }] }] } as never)
  await clock.advance(MINUTE)
  await point('dials', null)
  await show(band, 'media-rail-4')
  for (const [step, name] of [[5, 'media-rail-5'], [5, 'media-rail-6'], [3, 'media-rail-7']] as const) {
    await clock.advance(step * MINUTE)
    await band.redraw()
    await show(band, name)
  }
  await clock.advance(MINUTE)
  await pending
  await band.redraw()
  await show(band, 'media-rail-8')
  await point(null, 'dials')
  await show(band, 'media-rail-9')
})
