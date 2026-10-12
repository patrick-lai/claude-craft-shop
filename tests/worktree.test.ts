import { expect, test } from 'claude-code/testing'

import { startSession, world } from './world'

const EDIT = { tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as const

test('the head start is read-only until the worktree is ready, then the session moves in', async ($, on) => {
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

test('read-only shell commands pass and anything that writes is refused', async ($, on) => {
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
