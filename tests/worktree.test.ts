import { expect, test } from 'claude-code/testing'

import { PANE_PROPS, startSession, world } from './world'

const EDIT = { tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as const

test('the head start is read-only until the worktree is ready, then the session moves in', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls } = world(on)
  await startSession($)

  expect((await $.tool.call(EDIT)).deny).toContain('Read-only until the worktree is ready')
  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf src' })).deny).toBeDefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'rg TODO src | head -5' })).deny).toBeUndefined()

  const submitted = await $.prompt.submit({ text: 'create hello.txt', wait: false, origin: { kind: 'composer' } })
  expect(submitted.context?.join('\n')).toContain('Read-only head start')

  await clock.advance(1)
  expect(toolCalls).toContain('EnterWorktree')
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
})

test('read-only shell commands pass and anything that writes is refused', { options: { autoWorktree: true } }, async ($, on) => {
  world(on)
  await startSession($)
  const allowed = ['ls -la', 'git -C /repo log --oneline -5', 'find . -name "*.ts"', "sed -n '1,20p' a.ts", 'cat a.ts 2>/dev/null']
  const refused = [
    'ls && rm a.ts',
    'cat a.ts | tee b.ts',
    'echo hi > b.ts',
    'git -c core.pager=less log',
    'git diff --output=patch.diff',
    'find . -exec rm {} \;',
    'sed -i s/a/b/ a.ts',
    'echo $(whoami)',
    'npm install',
  ]
  for (const command of allowed) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny, command).toBeUndefined()
  }
  for (const command of refused) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny, command).toBeDefined()
  }
})

test('a session outside the main checkout gets no worktree', async ($, on) => {
  world(on, { isRepo: false })
  await startSession($)
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
})

test('a desktop session, headless at start, claims its worktree when the app attaches', { options: { autoWorktree: true } }, async ($, on) => {
  const { clock, toolCalls } = world(on)
  on('session.surfaces', () => ({ value: [] }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()

  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default', viewport: { columns: 120, rows: 40, isFullscreen: true } })
  expect((await $.tool.call(EDIT)).deny).toContain('Read-only until the worktree is ready')
  await clock.advance(1)
  expect(toolCalls).toContain('EnterWorktree')
})

test('Perm worktree is off by default: no slot and no read-only guard', async ($, on) => {
  const { toolCalls } = world(on)
  await startSession($)
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  expect(toolCalls).not.toContain('EnterWorktree')

  const ui = await $.ui.mount({ plugin: 'craft-shop', surface: 'desktop', component: 'Pane', requestId: 'craft-shop', props: PANE_PROPS })
  await ui.press({ key: 'tab-worktree' })
  expect(await ui.find({ text: /Off: Craft Shop leaves worktrees to Claude Code/ })).toBeDefined()
  await ui.press({ key: 'auto-worktree-on' })
  expect(await ui.find({ text: /On: new sessions in a main checkout/ })).toBeDefined()
})

test("Claude Code's own worktree creation gets a slot, read-only until it is seeded", { options: { autoWorktree: true, setupCommand: '' } }, async ($, on) => {
  const { clock } = world(on, { isRepo: false })
  on('classic.WorktreeCreate', () => ({}))
  await startSession($)
  const created = await $.classic.WorktreeCreate({ name: 'fix-login' })
  expect(created.worktreePath).toMatch(/\/1$/)
  expect((await $.tool.call(EDIT)).deny).toContain('Read-only until the worktree is ready')
  await clock.advance(1)
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
})
