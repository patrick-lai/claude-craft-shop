// The world beneath the plugin in every test: a main checkout at /repo with
// an origin, git answered from a script, and the engine's own nouns.
import type { On, PromptComposeInput, RenderPropsOf } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const REPO = '/repo'

export type World = { clock: MockClock; toolCalls: string[]; fetched: string[] }

function ran(stdout = '', exitCode = 0) {
  return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

export function world(on: On, { isRepo = true } = {}): World {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  const toolCalls: string[] = []
  const fetched: string[] = []

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__craft-shop__${e.name}` } }))
  on('session.repo', () => ({
    value: isRepo ? { root: REPO, remote: 'git@example.com:me/repo.git', internal: false, name: null } : null,
  }))
  on('session.root', () => ({ value: REPO }))
  on('session.cwd', () => ({ value: REPO }))
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', ($, e) => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('http.fetch', ($, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: { 'content-type': 'application/json' }, text: '[{"id":1}]' } }
  })
  on('process.run', ($, e) => {
    const command = e.argv.join(' ')
    if (command === 'git rev-parse --show-toplevel') return ran(`${REPO}\n`)
    if (command === 'git symbolic-ref --short refs/remotes/origin/HEAD') return ran('origin/main\n')
    if (command === 'git fetch -q origin main') return ran()
    if (command === 'git rev-parse origin/main') return ran('0123456789abcdef\n')
    if (command === 'git worktree list --porcelain') return ran(`worktree ${REPO}\nbranch refs/heads/main\n`)
    if (command.startsWith('git worktree add -q -B craft/')) return ran()
    return ran('', 1)
  })
  on('tool.call', ($, e) => {
    toolCalls.push(String(e.tool))
    return { result: 'ok' }
  })
  return { clock, toolCalls, fetched }
}

export async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
}

export const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'Craft Shop',
  isFocused: true,
  bodyColumns: 90,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}


export async function mountPane($: Engine, surface: 'terminal' | 'desktop') {
  return $.ui.mount({ plugin: 'craft-shop', surface, component: 'Pane', requestId: 'craft-shop', props: PANE_PROPS })
}

export const COMPOSE: PromptComposeInput = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
}
