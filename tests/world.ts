// The world beneath the plugin in every test: a main checkout at /repo with
// an origin, git answered from a script, and the engine's own nouns.
import type { On, PromptComposeInput, RenderPropsOf } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const REPO = '/repo'

export type World = { clock: MockClock; toolCalls: string[]; fetched: string[]; dialogs: number; closeDialog: () => void }

function ran(stdout = '', exitCode = 0) {
  return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

export function world(on: On, { isRepo = true, isDialogSlow = false } = {}): World {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  const toolCalls: string[] = []
  const fetched: string[] = []
  const state: World = { clock, toolCalls, fetched, dialogs: 0, closeDialog: () => undefined }

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
  // A session a few turns in: the fields Craftshop reads, the rest left out.
  const breakdown = {
    totalTokens: 68_000,
    rawMaxTokens: 200_000,
    percentage: 34,
    categories: [{ name: 'Messages', tokens: 41_000, kind: 'used' }],
    apiUsage: { input_tokens: 1_200, output_tokens: 800, cache_read_input_tokens: 52_000, cache_creation_input_tokens: 3_000 },
  }
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 68_000, percent: 34, breakdown: breakdown as never }, rateLimits: [], cost: { usd: 0.42 } as never },
  }))
  const panes: string[] = []
  on('ui.open', ($, e) => {
    if (!panes.includes(e.id)) panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', ($, e) => ({ value: { kind: /\.\w+$/.test(e.path) ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('http.fetch', ($, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: { 'content-type': 'application/json' }, text: '[{"id":1}]' } }
  })
  on('process.run', ($, e) => {
    const command = e.argv.join(' ')
    // The macOS file dialog: what picked files come back as.
    if (e.argv[0] === 'osascript') {
      const picked = ran(command.includes('choose folder') ? `${REPO}/docs/\n` : `${REPO}/docs/api.md\n/Users/me/notes/style.md\n`)
      state.dialogs += 1
      // A slow dialog stays open until the test closes it.
      return isDialogSlow ? new Promise<typeof picked>(resolve => (state.closeDialog = () => resolve(picked))) : picked
    }
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
  return state
}

export async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
}

export const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'Craftshop',
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

type Drawing = Awaited<ReturnType<typeof mountPane>>

// Presses a control by key as a person would on its surface: its Button, or
// on the desktop the Client laid over its picture (the tab bar's by segment).
// What activate needs of a drawing, on whichever surface it was mounted.
type Pressable = Pick<Drawing, 'find' | 'press' | 'resize' | 'pointer'>

export async function activate(ui: Pressable, key: string): Promise<void> {
  if ((await ui.find({ type: 'Button', key })) !== undefined) {
    await ui.press({ key })
    return
  }
  if (key.startsWith('tab-')) {
    const bar = (await ui.find({ type: 'Client', key: 'tabs-click' }))!.props as {
      props: { width: number; segments: { x0: number; x1: number; tab: string }[] }
    }
    const segment = bar.props.segments.find(one => one.tab === key.slice('tab-'.length))!
    await ui.resize({ columns: 60, rows: 2, in: 'tabs-click' })
    const x = Math.floor(((segment.x0 + segment.x1) / 2 / bar.props.width) * 60)
    await ui.pointer({ type: 'down', x, y: 0, button: 'left', in: 'tabs-click' })
    return
  }
  await ui.resize({ columns: 4, rows: 1, in: key })
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: key })
}

// The keys of the controls, Buttons or drawn, whose key matches.
export async function keysOf(ui: Pick<Drawing, 'findAll'>, pattern: RegExp): Promise<string[]> {
  const found = [...(await ui.findAll({ type: 'Button' })), ...(await ui.findAll({ type: 'Client' }))]
  return found.map(one => one.key).filter((key): key is string => key !== undefined && pattern.test(key))
}
