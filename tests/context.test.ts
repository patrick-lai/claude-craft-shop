import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { COMPOSE, mountPane, startSession, world } from './world'

type Drawing = Awaited<ReturnType<typeof mountPane>>

async function contextSection($: Engine) {
  return (await $.prompt.compose(COMPOSE)).sections.find(section => section.id === 'craft-shop:context')?.text
}

async function keyOf(ui: Drawing, pattern: RegExp): Promise<string> {
  const found = (await ui.findAll({ type: 'Button' })).find(one => one.key !== undefined && pattern.test(one.key))
  if (found?.key === undefined) throw new Error(`no Button keyed ${pattern}`)
  return found.key
}

test('a note added in the one field reaches the agent, Strict when pressed, and leaves when off', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'tab-context' })
    if (surface === 'terminal') expect(await ui.find({ text: /No sources yet/ })).toBeDefined()
    await ui.input({ key: 'add-input', text: `The API listens on port 4321 (${surface}).` })
    expect(await ui.find({ text: /The API listens on port 4321/ }), surface).toBeDefined()
    await ui.unmount()
  }
  expect(await contextSection($)).toContain('port 4321')

  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ text: /2 of 2/ })).toBeDefined()
  await ui.press({ key: await keyOf(ui, /^strict-/) })
  expect(await contextSection($)).toMatch(/STRICT: binding ground truth/)

  for (const one of (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('toggle-'))) {
    await ui.press({ key: one.key! })
  }
  expect(await contextSection($)).toBeUndefined()
  expect(await ui.find({ text: /0 of 2/ })).toBeDefined()
})

test('a chosen folder is one group: switched at once, named for the agent, removed whole', async ($, on) => {
  world(on, { isRepo: false })
  on('fs.list', () => ({
    value: [
      { name: 'refunds.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
      { name: 'currency.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', ($, e) => ({ value: `contents of ${e.path}` }))
  await startSession($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'tab-context' })
    expect(await ui.find({ type: 'Button', key: 'folder-new' }), surface).toBeUndefined()
    await ui.unmount()
  }

  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'tab-context' })
  await ui.press({ key: 'pick-folder' })
  expect(await ui.find({ text: /2 sources · 2 on/ })).toBeDefined()
  expect(await contextSection($)).toContain('### docs › refunds.md (docs/refunds.md)')

  await ui.press({ key: await keyOf(ui, /^folder-toggle-/) })
  expect(await contextSection($)).toBeUndefined()

  // One member back on leaves the folder partly on.
  await ui.press({ key: await keyOf(ui, /^toggle-/) })
  expect(await ui.find({ text: /Some on/ })).toBeDefined()

  // Removing the folder takes its sources with it.
  await ui.press({ key: await keyOf(ui, /^folder-delete-/) })
  await ui.press({ key: 'delete-folder' })
  expect(await contextSection($)).toBeUndefined()
  expect(await ui.find({ text: /No sources yet/ })).toBeDefined()
})

test('a view saved by an older version still draws, and a folder comes in from it', async ($, on) => {
  world(on, { isRepo: false })
  on('fs.list', () => ({ value: [{ name: 'adr.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', ($, e) => ({ value: `contents of ${e.path}` }))
  // What the folder-cards version left in $.state, which outlives a reload:
  // served until this version writes the view.
  const older = { folderId: null, openId: null, adding: null, isRenaming: false, isConfirmingDelete: false }
  let isRewritten = false
  on('state.set', ($, e, next) => {
    if (e.key === 'contextView') isRewritten = true
    return next(e)
  })
  on('state.get', async ($, e, next) => {
    const stored = await next(e)
    return e.key === 'contextView' && !isRewritten ? { ...stored, value: older as never } : stored
  })
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'tab-context' })
  expect(await ui.drawn()).toBeDefined()
  await ui.input({ key: 'add-input', text: 'docs/' })
  expect(await ui.drawn()).toBeDefined()
  expect(await ui.find({ text: /1 source · 1 on/ })).toBeDefined()
})

test('a source opens in place to rename and delete', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'tab-context' })
  await ui.input({ key: 'add-input', text: 'Use tabs.' })

  const open = await keyOf(ui, /^open-/)
  await ui.press({ key: open })
  const id = open.slice('open-'.length)
  expect(await ui.find({ type: 'Select', key: `move-${id}` })).toBeUndefined()
  await ui.input({ key: `rename-source-${id}`, text: 'Indentation' })
  expect(await contextSection($)).toContain('### Indentation')

  await ui.press({ key: `remove-${id}` })
  expect(await contextSection($)).toBeUndefined()
})

test('a link is fetched, and a repository directory imports as a folder of file sources', async ($, on) => {
  world(on, { isRepo: false })
  on('fs.list', () => ({
    value: [
      { name: 'api.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
      { name: 'logo.png', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
      { name: 'adr.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', ($, e) => ({ value: `contents of ${e.path}` }))
  await startSession($)
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'tab-context' })
  await ui.input({ key: 'add-input', text: 'https://example.com/style' })
  expect(await ui.find({ text: /example\.com\/style/ })).toBeDefined()
  await ui.input({ key: 'add-input', text: 'docs/' })
  expect(await ui.find({ text: /2 sources · 2 on/ })).toBeDefined()
  expect(await ui.find({ text: /adr\.md/ })).toBeDefined()
  expect(await ui.find({ text: /logo\.png/ })).toBeUndefined()
  expect(await contextSection($)).toContain('### docs › api.md (docs/api.md)')
})

test('while the file dialog is open the buttons say Choosing and more presses are dropped', async ($, on) => {
  const picker = world(on, { isRepo: false, isDialogSlow: true })
  on('fs.read', ($, e) => ({ value: `contents of ${e.path}` }))
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'tab-context' })

  // The first press opens the dialog and waits on it; the rest arrive meanwhile.
  const first = ui.press({ key: 'pick-files' })
  await ui.redraw()
  expect((await ui.find({ type: 'Button', key: 'pick-files' }))?.text).toBe('Choosing…')
  await ui.press({ key: 'pick-files' })
  await ui.press({ key: 'pick-folder' })
  expect(picker.dialogs).toBe(1)

  picker.closeDialog()
  await first
  await ui.redraw()
  expect((await ui.find({ type: 'Button', key: 'pick-files' }))?.text).toBe('Choose files…')
  expect((await contextSection($))?.match(/### /g)).toHaveLength(2)
})

test('Choose files and Choose folder add what the macOS dialog picks', async ($, on) => {
  world(on, { isRepo: false })
  on('fs.list', () => ({ value: [{ name: 'adr.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', ($, e) => ({ value: `contents of ${e.path}` }))
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'tab-context' })

  await ui.press({ key: 'pick-files' })
  expect(await ui.find({ text: /Added api\.md, style\.md/ })).toBeDefined()
  const section = await contextSection($)
  expect(section).toContain('### api.md (docs/api.md)')
  expect(section).toContain('### style.md (/Users/me/notes/style.md)')

  await ui.press({ key: 'pick-folder' })
  expect(await ui.find({ text: /1 source · 1 on/ })).toBeDefined()
  expect(await contextSection($)).toContain('### docs › adr.md (docs/adr.md)')
})
