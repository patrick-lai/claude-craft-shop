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

test('a folder groups sources, switches them at once and names them for the agent', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'tab-context' })
    await ui.press({ key: 'folder-new' })
    await ui.input({ key: 'folder-name', text: `Payments ${surface}` })
    // A new folder becomes where new sources go.
    expect(await ui.find({ text: new RegExp(`New sources go into Payments ${surface}`) }), surface).toBeDefined()
    await ui.input({ key: 'add-input', text: 'Refunds settle in 5 business days.' })
    await ui.input({ key: 'add-input', text: 'Amounts are integer cents.' })
    expect(await ui.find({ text: /2 sources · 2 on/ }), surface).toBeDefined()
    await ui.unmount()
  }
  expect(await contextSection($)).toContain('### Payments terminal › Refunds settle in 5 business days.')

  const ui = await mountPane($, 'terminal')
  const [first] = (await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('folder-toggle-'))
  await ui.press({ key: first!.key! })
  expect(await contextSection($)).not.toContain('Payments terminal')
  expect(await contextSection($)).toContain('Payments desktop')

  // One member back on leaves the folder partly on.
  const [member] = (await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('toggle-'))
  await ui.press({ key: member!.key! })
  expect(await ui.find({ text: /Some on/ })).toBeDefined()

  // Deleting a folder but keeping its sources leaves them loose.
  const [menu] = (await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('folder-menu-'))
  await ui.press({ key: menu!.key! })
  const [deleteKey] = (await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('folder-delete-'))
  await ui.press({ key: deleteKey!.key! })
  await ui.press({ key: 'delete-folder-keep' })
  expect(await contextSection($)).toContain('### Refunds settle in 5 business days.')
})

test('a source opens in place to rename, move into a folder and delete', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'tab-context' })
  await ui.press({ key: 'folder-new' })
  await ui.input({ key: 'folder-name', text: 'Docs' })
  await ui.select({ key: 'add-target', value: '' })
  await ui.input({ key: 'add-input', text: 'Use tabs.' })

  const open = await keyOf(ui, /^open-/)
  await ui.press({ key: open })
  const id = open.slice('open-'.length)
  await ui.input({ key: `rename-source-${id}`, text: 'Indentation' })
  expect(await contextSection($)).toContain('### Indentation')
  const move = (await ui.find({ type: 'Select', key: `move-${id}` }))!.props as { options: { value: string }[] }
  await ui.select({ key: `move-${id}`, value: move.options.find(one => one.value !== '')!.value })
  expect(await contextSection($)).toContain('### Docs › Indentation')

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
