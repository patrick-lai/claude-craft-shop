import { expect, test } from 'claude-code/testing'

import { mountPane, startSession, world } from './world'

test('api_send sends through http.fetch, records the exchange and the Log shows it', async ($, on) => {
  const { fetched } = world(on, { isRepo: false })
  await startSession($)
  const sent = await $.tool.call({
    tool: 'mcp__craft-shop__api_send',
    method: 'GET',
    path: '/items',
    headers: { Authorization: 'Bearer secret-token' },
    expect_status: 200,
  })
  expect(fetched).toContain('http://localhost:3000/items')
  expect(String(sent.result)).toContain('(pass)')
  expect(String(sent.result)).not.toContain('secret-token')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'tab-api' })
    await ui.press({ key: 'lens-log' })
    const row = (await ui.findAll({ type: 'Button' })).find(button => button.key?.startsWith('ex-'))
    expect(row?.text).toContain('/items')
    expect(row?.text).toContain('agent')
    await ui.unmount()
  }
})
