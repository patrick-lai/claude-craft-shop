// Auto-claims a worktree slot for a session started in a main checkout, a
// simplified port of CommissionAI's head start (service/src/threads.rs) and
// slots (worktrees.rs). Until the slot is ready the session runs read-only
// in the main checkout (see guard.ts). This file also draws the band above
// the prompt and the pane's Worktree tab.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions, Timer } from 'claude-code'

import type { Slot, Tab, Worktree, WorktreePhase } from '../types'
import { frame, PANE, PANE_TITLE, resolveUi } from './ui'
import type { Ui } from './ui'
import { BALANCED, presetName } from './dials'
import { branchArt, card, label, segmented, svg, useSwitch } from './kit'
import { beginTurn } from './enforce'
import { drawRail } from './rail'

export const IDLE_WORKTREE: Worktree = {
  phase: 'off',
  step: '',
  steps: [],
  main: null,
  path: null,
  branch: null,
  base: null,
  baseSha: null,
  error: null,
}

const isBandHidden = atom({ plugin: 'fishstack', key: 'isBandHidden' } as const, false)
const isHeadStartPrompted = atom({ plugin: 'fishstack', key: 'isHeadStartPrompted' } as const, false)
const isWhereAsked = atom({ plugin: 'fishstack', key: 'isWhereAsked' } as const, false)
const isTurnRunning = atom({ plugin: 'fishstack', key: 'isTurnRunning' } as const, false)
const owedMoveNote = atom({ plugin: 'fishstack', key: 'owedMoveNote' } as const, null)
const slots = atom({ plugin: 'fishstack', key: 'slots' } as const, [])
const tab = atom({ plugin: 'fishstack', key: 'tab' } as const, 'worktree')
const isClientDown = atom({ plugin: 'fishstack', key: 'isClientDown' } as const, false)
const worktree = atom({ plugin: 'fishstack', key: 'worktree' } as const, IDLE_WORKTREE)
const isStepsShown = atom({ plugin: 'fishstack', key: 'isStepsShown' } as const, false)
const dials = atom({ plugin: 'fishstack', key: 'dials' } as const, BALANCED)
const sources = atom({ plugin: 'fishstack', key: 'sources' } as const, [])
const lastReplyAt = atom({ plugin: 'fishstack', key: 'lastReplyAt' } as const, null)
// The rail pill under the pointer, kept to this process: a hover is one
// window's, not the session's.
let railHover: string | null = null
// Bumped by a rail hover and the cache gauge's tick; only the band reads it,
// so neither redraws the pane.
const railTick = atom({ plugin: 'fishstack', key: 'railTick' } as const, 0)
// The rail's figures for one session, kept in the store under one key.
const RAIL_STORE_KEY = 'rail'
type RailKept = { sessionId: string; repliedAt: number | null; tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null }
// The worktree this session works in when it is not ours to manage (another
// tool's, or one made by hand); null in the main checkout or a slot of ours.
const elsewhere = atom({ plugin: 'fishstack', key: 'elsewhere' } as const, null)
// What the pool's background warming is doing, for the Worktrees tab.
const poolNote = atom({ plugin: 'fishstack', key: 'poolNote' } as const, '')
const slotAsk = atom({ plugin: 'fishstack', key: 'slotAsk' } as const, null)
const tokenTotals = atom({ plugin: 'fishstack', key: 'tokenTotals' } as const, null)
// Autopilot answering for a person who is away (session.ts sets it).
const autopilot = atom({ plugin: 'fishstack', key: 'autopilot' } as const, null)
const isDialsOn = atom({ plugin: 'fishstack', key: 'isDialsOn' } as const, true)
const isContextOn = atom({ plugin: 'fishstack', key: 'isContextOn' } as const, true)

type $ = EngineInterface

const LEASE_PREFIX = 'lease:'
const HEARTBEAT_MS = 60_000
const LEASE_TTL_MS = 3 * HEARTBEAT_MS
const SETUP_TIMEOUT_MS = 10 * 60_000
const LOCK_STALE_MS = 30_000
const READY_BAND_MS = 4_000
// As CommissionAI's: three slots ready, and no warming below 20 GB free
// (the minFreeGb option).
export const POOL_SIZE = 3
const DEFAULT_MIN_FREE_GB = 20
const SETUP_PREFIX = 'setup:'
type SetupRun = { command: string; lockHash: string }
// A slot the pool is making, by path: who reserved it and what it is doing,
// so every session lists it as setting up and none claims it half made.
// Queued is reserved, not yet started. A run that died leaves its mark,
// which lapses after the longest a step may take.
const WARMING_PREFIX = 'warming:'
const QUEUED = 'Queued'
const WARMING_TTL_MS = SETUP_TIMEOUT_MS + LEASE_TTL_MS
type Warming = { sessionId: string; step: string; at: number }
// How many slots the pool keeps, by slot root: + Add slot raises it and
// Remove lowers it; POOL_SIZE until either is pressed.
const POOL_SIZE_PREFIX = 'poolSize:'
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']
const IN_REPO_ROOT = '.claude/worktrees/fishstack'

export const READ_ONLY_DENY =
  'Read-only until the worktree is ready. fishStack is preparing a worktree for this session; read, search and plan for now, and you will be moved there with full access.'

// What a note told between tool calls says first: it rides beside a tool's
// result, where a model rightly distrusts instructions.
export const MID_TURN_FROM = 'fishStack update, from the hook of fishStack, a plugin the user installed, not from the tool you just ran: '

export function headStartNote(main: string, isMidTurn = false): string {
  return `${isMidTurn ? MID_TURN_FROM : ''}Read-only head start: your worktree is still being prepared, so for now you run read-only in the main checkout at \`${main}\`. It may sit on another branch or be behind origin, so treat it as a reference. Investigate, read code and plan; do not edit files, commit or run commands that change anything. When your plan is ready, write it in your reply and end your turn. When the worktree is ready, fishStack moves you there with full access and tells you to continue.`
}

function continueNote(path: string, branch: string): string {
  return `Your worktree is ready at \`${path}\` on branch \`${branch}\`, and the read-only head start is over. You now work there with full access. Carry on with the request from where you left off, starting with the plan you made. If you ended your last turn waiting for an answer, end this turn and keep waiting instead.`
}

// A move the agent was not warned of, as a head start told before it would;
// whoever delivers it says first where it comes from.
function movedNote(path: string, branch: string): string {
  return `this session has moved into its own worktree at \`${path}\` on branch \`${branch}\`, and works there from now on, with full access. Relative paths and commands now run there, not in the main checkout; anything you said about where you work before this is out of date.`
}

type Lease = { sessionId: string; beatAt: number }

class StepError extends Error {}

export function isReadOnlyPhase(phase: Worktree['phase']): boolean {
  return phase === 'preparing' || phase === 'failed'
}

type GitRun = { timeoutMs?: number; env?: Record<string, string> }

async function git($: $, args: string[], cwd: string, { timeoutMs = 120_000, env }: GitRun = {}) {
  return $.process.run(['git', ...args], env === undefined ? { cwd, timeoutMs } : { cwd, timeoutMs, env })
}

async function gitOut($: $, args: string[], cwd: string, failure: string, run?: GitRun): Promise<string> {
  // A git still running at its timeout rejects: that failed too.
  const ran = await git($, args, cwd, run).catch((error: unknown) => {
    $.ui.log(`git ${args.join(' ')} did not finish: ${String(error)}`, { to: 'debug' })
    throw new StepError(`${failure} Git did not finish in time.`)
  })
  if (ran.exitCode !== 0) {
    $.ui.log(`git ${args.join(' ')} failed: ${ran.stderr.trim()}`, { to: 'debug' })
    // Git's last line says why, which the step alone cannot.
    const why = ran.stderr.trim().split('\n').pop()?.trim() ?? ''
    throw new StepError(why === '' ? failure : `${failure} ${why.slice(0, 160)}`)
  }
  return ran.stdout.trim()
}

async function hash6(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 6)
}

async function realPath($: $, path: string): Promise<string> {
  return (await $.fs.stat(path, { resolve: true })).realPath ?? path
}

async function expandHome($: $, path: string): Promise<string> {
  if (!path.startsWith('~/')) return path
  const home = await $.env.get('HOME')
  if (home === undefined) throw new StepError('HOME is not set, so the worktree root cannot be found.')
  return `${home}${path.slice(1)}`
}

// Where a repository's slots live: by default inside its main checkout, under
// .claude/worktrees/ where Claude Code keeps its own, so EnterWorktree moves in
// without asking; with a worktreeRoot set, under <root>/<repo>-<hash>.
async function slotsRoot($: $, options: PluginOptions, main: string): Promise<string> {
  if (!options.worktreeRoot) return `${main}/${IN_REPO_ROOT}`
  const root = await expandHome($, String(options.worktreeRoot))
  const name = main.split('/').pop() ?? 'repo'
  return `${root}/${name}-${await hash6(main)}`
}

// Whether a session's worktree is one of the pool's slots, leased and
// released, or the desktop app's own, set up where it is (see startWorktree).
async function isSlot($: $, options: PluginOptions, main: string, path: string): Promise<boolean> {
  return path.startsWith(`${await slotsRoot($, options, main)}/`)
}

// A slot root inside the main checkout stays out of its git status: unless the
// repository ignores it already, it goes in the checkout's own info/exclude.
async function excludeFromMain($: $, main: string, path: string): Promise<void> {
  if (!path.startsWith(`${main}/`)) return
  await keepOutOfGit($, main, `${path.slice(main.length + 1, path.lastIndexOf('/'))}/`)
}

// A path in the main checkout, relative, added to its own info/exclude
// unless something ignores it already.
async function keepOutOfGit($: $, main: string, relative: string): Promise<void> {
  if ((await git($, ['check-ignore', '-q', relative], main)).exitCode !== 1) return
  const found = await git($, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], main)
  const exclude = found.stdout.trim()
  if (found.exitCode !== 0 || exclude === '') return
  await $.process.run(['/bin/bash', '-c', 'mkdir -p "$(dirname "$1")" && printf \'%s\\n\' "$2" >> "$1"', 'bash', exclude, `/${relative}`])
}

async function readLease($: $, path: string): Promise<Lease | null> {
  const lease = await $.store.get(LEASE_PREFIX + path)
  return lease !== null && typeof lease === 'object' ? (lease as Lease) : null
}

async function isLeaseLive($: $, lease: Lease | null): Promise<boolean> {
  return lease !== null && (await $.clock.now()) - lease.beatAt < LEASE_TTL_MS
}

async function writeLease($: $, path: string): Promise<void> {
  const lease: Lease = { sessionId: await $.session.id(), beatAt: await $.clock.now() }
  await $.store.set(LEASE_PREFIX + path, lease)
}

// The desktop app's hold on a slot, from desktop-worktree.sh: a file beside
// the slot, kept from the session's start until the desktop removes its
// worktree, so it outlasts the session's process, which a lease does not.
// A slot is offered to that hook by its .ready file.
const HELD = '.held'
const READY = '.ready'

async function isHeld($: $, path: string): Promise<boolean> {
  return $.fs.exists(path + HELD)
}

// Held by the desktop, or leased by a live session.
async function isTaken($: $, path: string): Promise<boolean> {
  return (await isHeld($, path)) || (await isLeaseLive($, await readLease($, path)))
}

async function readWarming($: $, path: string): Promise<Warming | null> {
  const mark = await $.store.get(WARMING_PREFIX + path)
  return mark !== null && typeof mark === 'object' ? (mark as Warming) : null
}

async function isWarmingLive($: $, mark: Warming | null): Promise<boolean> {
  return mark !== null && (await $.clock.now()) - mark.at < WARMING_TTL_MS
}

// Marks a slot setting up at this step, in the store and the pool's signal
// for every session, and in this one's list at once.
async function markWarming($: $, path: string, step: string): Promise<void> {
  await $.store.set(WARMING_PREFIX + path, { sessionId: await $.session.id(), step, at: await $.clock.now() })
  await signalPool($, path)
  await update($, slots, list => list.map(one => (one.path === path ? { ...one, setup: step } : one)))
}

async function poolSize($: $, repoDir: string): Promise<number> {
  const kept = await $.store.get(POOL_SIZE_PREFIX + repoDir)
  return typeof kept === 'number' ? kept : POOL_SIZE
}

async function setStep($: $, label: string, isWarning = false): Promise<void> {
  const at = await $.clock.now()
  await update($, worktree, current => ({
    ...current,
    step: label,
    steps: [...current.steps, { label, at, isWarning }],
  }))
}

async function worktreePaths($: $, main: string): Promise<Map<string, string | null>> {
  const listed = await gitOut($, ['worktree', 'list', '--porcelain'], main, 'Could not list worktrees.')
  const paths = new Map<string, string | null>()
  let path: string | null = null
  for (const line of listed.split('\n')) {
    if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length)
      paths.set(path, null)
    } else if (line.startsWith('branch ') && path !== null) {
      paths.set(path, line.slice('branch refs/heads/'.length))
    }
  }
  return paths
}

// The numbered slot folders under a repository's slot root, in order.
async function slotDirs($: $, repoDir: string): Promise<string[]> {
  const found = await $.process.run(['find', repoDir, '-mindepth', '1', '-maxdepth', '1', '-type', 'd'])
  if (found.exitCode !== 0) return []
  return found.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => /\/\d+$/.test(line))
    .sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop()))
}

async function refreshSlots($: $, options: PluginOptions): Promise<void> {
  const main = (await read($, worktree)).main ?? (await repoMain($))
  if (main !== null) await refreshSlotsFor($, options, main)
}

// The main checkout of the session's repository, or null outside one: the
// folder holding the repository's .git, so a session working in a linked
// worktree finds the same pool as one in the main checkout.
async function repoMain($: $): Promise<string | null> {
  const repo = await $.session.repo()
  if (repo === null) return null
  const common = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'], repo.root)
  const dir = common.stdout.trim()
  return realPath($, common.exitCode === 0 && dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : repo.root)
}

// The soonest a lease of another session lapses unrenewed, when the Slots
// list is next checked: one timer, not a poll, so a session that died
// shows its slot free on time.
let lapseTimer: Timer | null = null

async function refreshSlotsFor($: $, options: PluginOptions, main: string): Promise<void> {
  const { path: mine } = await read($, worktree)
  const repoDir = await slotsRoot($, options, main)
  const listed = await worktreePaths($, main)
  const now = await $.clock.now()
  const found: Slot[] = []
  let lapsesAt = Infinity
  for (const path of await slotDirs($, repoDir)) {
    const real = await realPath($, path)
    const mark = await readWarming($, path)
    const isWarming = await isWarmingLive($, mark)
    // A slot being made is listed before git knows it, so it shows at once.
    if (!listed.has(real) && !isWarming) continue
    const lease = await readLease($, path)
    const isLive = await isLeaseLive($, lease)
    const isLeased = isLive || (await isHeld($, path))
    if (isLive && path !== mine) lapsesAt = Math.min(lapsesAt, lease!.beatAt + LEASE_TTL_MS)
    found.push({ path, branch: listed.get(real) ?? null, isLeased, isMine: path === mine, setup: isWarming ? mark!.step : null, isRemoving: removing.has(path) })
  }
  lapseTimer?.cancel()
  lapseTimer = Number.isFinite(lapsesAt) ? $.clock.after(Math.max(1_000, lapsesAt - now), () => void refreshSlotsFor($, options, main)) : null
  // Unchanged, the pane is not drawn again.
  if (JSON.stringify(await read($, slots)) !== JSON.stringify(found)) await update($, slots, () => found)
}

// The pool's change signal, a file beside the slots: every claim, release
// and new slot rewrites it, and each session has Claude Code's own file
// watcher on it (armed at session start), so the Slots list follows other
// sessions as they go, with no polling.
const POOL_SIGNAL = '.changed'

async function signalPool($: $, slot: string): Promise<void> {
  await $.fs.write(`${slot.slice(0, slot.lastIndexOf('/'))}/${POOL_SIGNAL}`, String(await $.clock.now())).catch(() => undefined)
}

// What a session watches for the Slots list: the pool's signal, and each
// slot's HEAD, so a branch checked out in a slot shows too. None while the
// repository has no pool.
async function poolWatchPaths($: $, options: PluginOptions): Promise<string[]> {
  const main = await repoMain($)
  if (main === null) return []
  const repoDir = await slotsRoot($, options, main)
  const dirs = await slotDirs($, repoDir)
  if (dirs.length === 0) return []
  const signal = `${repoDir}/${POOL_SIGNAL}`
  if (!(await $.fs.exists(signal))) await $.fs.write(signal, String(await $.clock.now()))
  const heads: string[] = []
  for (const slot of dirs) {
    const gitdir = await $.fs.read(`${slot}/.git`).catch(() => '')
    const admin = /^gitdir: (.+)$/m.exec(String(gitdir))?.[1]?.trim()
    if (admin !== undefined) heads.push(`${admin}/HEAD`)
  }
  return [signal, ...heads]
}

// Changes come in bursts (a claim writes its lease, then its branch): one
// refresh for each burst.
let isRefreshQueued = false

function queueRefresh($: $, options: PluginOptions): void {
  if (isRefreshQueued) return
  isRefreshQueued = true
  $.clock.after(250, () => {
    isRefreshQueued = false
    void refreshSlots($, options)
  })
}

// Slots this process is removing, so a redraw meanwhile still says so.
const removing = new Set<string>()

// A slot left on the default branch (checked out by hand, past the guard)
// lets go of it as its session ends: the main checkout may want it, and git
// gives a branch to one worktree at a time. Uncommitted work stays in place.
async function freeDefaultBranch($: $, main: string, path: string): Promise<void> {
  try {
    const on = await git($, ['symbolic-ref', '--short', '-q', 'HEAD'], path)
    if (on.exitCode !== 0 || on.stdout.trim() !== (await defaultBranch($, main))) return
    await git($, ['-c', 'core.hooksPath=/dev/null', 'checkout', '-q', '--detach'], path)
  } catch (error) {
    $.ui.log(`default branch not freed in ${path}: ${String(error)}`, { to: 'debug' })
  }
}

async function releaseSlot($: $, path: string): Promise<void> {
  await $.store.delete(LEASE_PREFIX + path)
  await signalPool($, path)
}

// A git write: never runs the repository's hooks, as CommissionAI's do not.
// Writes check out, reset and remove whole trees, which in a big repository
// take minutes, so they get the setup command's time, not a read's. And in
// a blobless clone a checkout needs blobs it lacks: Claude Code runs git
// with GIT_NO_LAZY_FETCH=1, under which such a checkout grinds until it is
// killed, so writes let git fetch them from origin, as the fetch before
// them does.
const GIT_WRITE: GitRun = { timeoutMs: SETUP_TIMEOUT_MS, env: { GIT_NO_LAZY_FETCH: '0' } }

async function gitWrite($: $, args: string[], cwd: string, failure: string): Promise<string> {
  return gitOut($, ['-c', 'core.hooksPath=/dev/null', ...args], cwd, failure, GIT_WRITE)
}

// One claim at a time per repository, across sessions: an atomic mkdir, and a
// lock older than LOCK_STALE_MS (a session that died holding it) is broken.
async function lock($: $, repoDir: string): Promise<void> {
  await $.process.run(['mkdir', '-p', repoDir])
  const lockDir = `${repoDir}/.lock`
  for (let tries = 0; tries < 300; tries++) {
    if ((await $.process.run(['mkdir', lockDir])).exitCode === 0) return
    const held = await $.fs.stat(lockDir).catch(() => null)
    if (held === null || (await $.clock.now()) - held.mtimeMs > LOCK_STALE_MS) {
      await $.process.run(['rm', '-rf', lockDir])
      continue
    }
    await $.clock.sleep(100)
  }
  throw new StepError('Another session held the worktree lock for too long.')
}

async function unlock($: $, repoDir: string): Promise<void> {
  await $.process.run(['rm', '-rf', `${repoDir}/.lock`])
}

// A fresh slot as CommissionAI makes one: detached and unchecked-out at the
// base, then checked out with stat checks kept minimal, then the index warmed
// so the session's first git status is quick.
async function createSlot($: $, main: string, path: string, sha: string): Promise<void> {
  await excludeFromMain($, main, path)
  await git($, ['worktree', 'prune'], main)
  await gitWrite($, ['worktree', 'add', '-q', '--detach', '--no-checkout', path, sha], main, 'Could not create the worktree.')
  try {
    await gitWrite($, ['-c', 'core.checkStat=minimal', 'reset', '--hard', '-q'], path, 'Could not check out the new worktree.')
  } catch (error) {
    // A checkout cut short is no slot to scrub and reuse: remove it.
    await git($, ['worktree', 'remove', '--force', '--force', path], main, GIT_WRITE)
    throw error
  }
  await git($, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], path)
}

// Anything left uncommitted in a slot, kept under refs/fish/backup/.
async function backUpLeftovers($: $, path: string): Promise<void> {
  const status = await git($, ['status', '--porcelain'], path)
  if (status.exitCode === 0 && status.stdout.trim() !== '') {
    await gitWrite($, ['add', '-A'], path, 'Could not save the slot\'s leftover work.')
    const stash = await git($, ['stash', 'create'], path)
    const sha = stash.stdout.trim()
    if (stash.exitCode === 0 && sha !== '') {
      await gitWrite($, ['update-ref', `refs/fish/backup/${path.split('/').pop()}-${await $.clock.now()}`, sha], path, 'Could not back up the slot\'s leftover work.')
    }
  }
}

// Readies a used slot for its next session: its leftovers backed up, then
// the slot is reset, cleaned (ignored files such as node_modules stay) and
// detached, which frees its old branch.
async function scrubSlot($: $, path: string): Promise<void> {
  await backUpLeftovers($, path)
  await gitWrite($, ['reset', '--hard', '-q'], path, 'Could not reset the slot.')
  await gitWrite($, ['clean', '-fdq'], path, 'Could not clean the slot.')
  await gitWrite($, ['checkout', '-q', '--detach', 'HEAD'], path, 'Could not detach the slot.')
}

// Picks a slot under the lock: the one this session already leases (a retry
// comes back to it), else an idle one (listed, not held, no live lease), one
// offered to the desktop's hook last, else the next number, reserved by its
// empty folder. Leased before the lock lifts.
async function pickSlot($: $, options: PluginOptions, main: string): Promise<{ path: string; isNew: boolean; isMine: boolean }> {
  const repoDir = await slotsRoot($, options, main)
  await lock($, repoDir)
  try {
    const listed = await worktreePaths($, main)
    const sessionId = await $.session.id()
    const dirs = await slotDirs($, repoDir)
    const free: { path: string; isMine: boolean }[] = []
    const offered: { path: string; isMine: boolean }[] = []
    for (const path of dirs) {
      if (!listed.has(await realPath($, path))) continue
      if (await isWarmingLive($, await readWarming($, path))) continue
      if (await isHeld($, path)) continue
      const lease = await readLease($, path)
      const isMine = lease?.sessionId === sessionId
      if (!isMine && (await isLeaseLive($, lease))) continue
      ;((await $.fs.exists(path + READY)) ? offered : free).push({ path, isMine })
    }
    const picked = [...free, ...offered].find(one => one.isMine) ?? free[0] ?? offered[0]
    if (picked !== undefined) {
      await $.process.run(['rm', '-f', picked.path + READY])
      await writeLease($, picked.path)
      await signalPool($, picked.path)
      return { ...picked, isNew: false }
    }
    const next = dirs.reduce((most, path) => Math.max(most, Number(path.split('/').pop())), 0) + 1
    const path = `${repoDir}/${next}`
    await $.process.run(['mkdir', '-p', path])
    await writeLease($, path)
    await signalPool($, path)
    return { path, isNew: true, isMine: false }
  } finally {
    await unlock($, repoDir)
  }
}

// The slot's branch, this session's alone: the name asked for while no branch
// has it, or while this session's own slot is on it (a retry); else that name
// with the session's id. Claude Code reuses a worktree folder for a new
// session, so a name taken from the folder does not say whose a branch is,
// and checkout -B over another session's branch would reset its commits away.
async function freeBranch($: $, main: string, path: string, isMine: boolean, wanted: string): Promise<string> {
  const own = isMine ? ((await worktreePaths($, main)).get(await realPath($, path)) ?? null) : null
  const id = (await $.session.id()).slice(0, 6)
  for (const name of [wanted, `${wanted}-${id}`]) {
    if (name === own) return name
    if ((await git($, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], main)).exitCode !== 0) return name
  }
  return `${wanted}-${id}-${(await $.clock.now()).toString(36)}`
}

async function claimSlot($: $, options: PluginOptions, main: string, base: string, baseSha: string, wanted: string) {
  const { path, isNew, isMine } = await pickSlot($, options, main)
  const branch = await freeBranch($, main, path, isMine, wanted)
  if (isNew) {
    await setStep($, 'Creating a new worktree')
    await createSlot($, main, path, baseSha)
  } else {
    await setStep($, `Reusing slot ${path.split('/').pop()}`)
    await scrubSlot($, path)
  }
  await gitWrite($, ['checkout', '-q', '-B', branch, base], path, 'Could not check out the base branch in the slot.')
  await signalPool($, path)
  return { path, branch }
}

// What the dependencies are pinned to: the git hashes of the lockfiles there.
async function lockHash($: $, dir: string): Promise<string> {
  const parts: string[] = []
  for (const lockfile of LOCKFILES) {
    if (!(await $.fs.exists(`${dir}/${lockfile}`))) continue
    const hashed = await git($, ['hash-object', lockfile], dir)
    parts.push(`${lockfile}:${hashed.stdout.trim()}`)
  }
  return parts.join(',')
}

// Every node_modules under a folder, six deep at most, skipping dot folders
// and build output; relative paths.
async function nodeModulesIn($: $, dir: string): Promise<string[]> {
  const found = await $.process.run(
    ['find', dir, '-maxdepth', '6', '(', '-name', '.*', '-o', '-name', 'target', ')', '-prune', '-o', '-type', 'd', '-name', 'node_modules', '-print', '-prune'],
    { timeoutMs: 60_000 },
  )
  if (found.exitCode !== 0) return []
  return found.stdout
    .split('\n')
    .filter(line => line.startsWith(`${dir}/`))
    .map(line => line.slice(dir.length + 1))
}

// Seeds a slot's node_modules as CommissionAI does: cloned copy-on-write (APFS
// clonefile through cp -c, so it costs no disk until a file changes) from an
// idle sibling slot pinned to the same lockfiles, or else the main checkout,
// into a staging folder renamed into place. Then the setup command, skipped
// when it and the lockfiles are what it last ran with in this slot.
// What seeding says as it goes: a session's claim logs each step for its
// band and stepper; the pool's warming shows it on the slot's row instead,
// as no session waits on it.
type Report = (label: string, isWarning?: boolean) => Promise<void>

async function seedDependencies($: $, options: PluginOptions, main: string, path: string, report: Report) {
  const hash = await lockHash($, path)
  if (hash !== '') {
    let donor: string | null = null
    const repoDir = await slotsRoot($, options, main)
    for (const sibling of await slotDirs($, repoDir)) {
      if (sibling === path || (await isTaken($, sibling)) || (await isWarmingLive($, await readWarming($, sibling)))) continue
      if ((await $.fs.exists(`${sibling}/node_modules`)) && (await lockHash($, sibling)) === hash) {
        donor = sibling
        break
      }
    }
    if (donor === null && (await $.fs.exists(`${main}/node_modules`)) && (await lockHash($, main)) === hash) donor = main
    if (donor !== null) {
      const missing: string[] = []
      for (const relative of await nodeModulesIn($, donor)) {
        if (!(await $.fs.exists(`${path}/${relative}`))) missing.push(relative)
      }
      if (missing.length > 0) {
        await report(`Cloning ${missing.length === 1 ? 'node_modules' : `${missing.length} node_modules folders`} from ${donor === main ? 'the main checkout' : `slot ${donor.split('/').pop()}`}`)
        for (const [index, relative] of missing.entries()) {
          const target = `${path}/${relative}`
          const staging = `${path}/.fish-seed-${index}`
          await $.process.run(['mkdir', '-p', target.slice(0, target.lastIndexOf('/'))])
          const copied = await $.process.run(['cp', '-c', '-p', '-R', `${donor}/${relative}`, staging], { timeoutMs: SETUP_TIMEOUT_MS })
          if (copied.exitCode !== 0) {
            $.ui.log(`cp -c failed: ${copied.stderr.trim()}`, { to: 'debug' })
            await $.process.run(['rm', '-rf', staging])
            await report('Could not clone node_modules; the setup command has to install them', true)
            break
          }
          await $.process.run(['mv', staging, target])
        }
      }
    }
  }

  const setup = String(options.setupCommand ?? '').trim()
  if (setup === '') return
  const last = await $.store.get(SETUP_PREFIX + path)
  if (last !== null && typeof last === 'object' && (last as SetupRun).command === setup && (last as SetupRun).lockHash === hash) {
    await report('Setup already done for these lockfiles')
    return
  }
  await report(`Running ${setup}`)
  const ran = await $.process.run(['/bin/bash', '-lc', setup], { cwd: path, timeoutMs: SETUP_TIMEOUT_MS })
  if (ran.exitCode !== 0) {
    $.ui.log(`setup command failed: ${ran.stderr.trim()}`, { to: 'debug' })
    throw new StepError(`The setup command exited with ${ran.exitCode}.`)
  }
  await $.store.set(SETUP_PREFIX + path, { command: setup, lockHash: hash })
}

// Free disk where the slots live, in kilobytes; Infinity when df cannot say.
async function freeKb($: $, dir: string): Promise<number> {
  const df = await $.process.run(['df', '-Pk', dir])
  const columns = df.stdout.trim().split('\n').pop()?.split(/\s+/) ?? []
  const available = Number(columns[3])
  return df.exitCode === 0 && Number.isFinite(available) ? available : Infinity
}

// What the pool holds now: its slots, made or being made by a live run, how
// many of those no session holds, and the slots this session reserved that
// wait to be made.
async function poolNow($: $, main: string, repoDir: string): Promise<{ total: number; idle: number; queued: string[] }> {
  const listed = await worktreePaths($, main)
  const sessionId = await $.session.id()
  let total = 0
  let idle = 0
  const queued: string[] = []
  for (const path of await slotDirs($, repoDir)) {
    const mark = await readWarming($, path)
    const isListed = listed.has(await realPath($, path))
    if (!isListed && mark?.sessionId === sessionId && mark.step === QUEUED) queued.push(path)
    if (!isListed && !(await isWarmingLive($, mark))) continue
    total++
    if (!(await isTaken($, path))) idle++
  }
  return { total, idle, queued }
}

// The next slot number, reserved under the lock by its empty folder and
// marked Queued, so every session lists it before anything is made there.
async function reserveSlot($: $, repoDir: string): Promise<string> {
  await lock($, repoDir)
  try {
    const dirs = await slotDirs($, repoDir)
    const path = `${repoDir}/${dirs.reduce((most, one) => Math.max(most, Number(one.split('/').pop())), 0) + 1}`
    await $.process.run(['mkdir', '-p', path])
    await markWarming($, path, QUEUED)
    return path
  } finally {
    await unlock($, repoDir)
  }
}

// Where desktop-worktree.sh finds the pool, the switch it reads (there while
// Use worktrees is on) and the script itself, beside the repository's git
// data: a path that stays put as the plugin updates, which the settings name.
// Then the settings are wired to it.
async function installDesktopHook($: $, main: string, repoDir: string): Promise<void> {
  try {
    const common = await gitOut($, ['rev-parse', '--path-format=absolute', '--git-common-dir'], main, 'Could not find the git data.')
    const keep = async (name: string, text: string) => {
      const path = `${common}/fishstack/${name}`
      if ((await $.fs.read(path).catch(() => null)) !== text) await $.fs.write(path, text)
    }
    await keep('slots-root', `${repoDir}\n`)
    await keep('on', 'Use worktrees is on\n')
    await keep('desktop-worktree.sh', String(await $.fs.read(`${$.plugin.root}/hooks/desktop-worktree.sh`)))
    await wireDesktopHook($, main, true)
  } catch (error) {
    $.ui.log(`desktop hook not installed: ${String(error)}`, { to: 'debug' })
  }
}

// Use worktrees off: the hook hands out no more slots, and the settings go
// back to Claude Code's own worktrees.
async function unwireDesktopHook($: $, main: string): Promise<void> {
  try {
    const common = await gitOut($, ['rev-parse', '--path-format=absolute', '--git-common-dir'], main, 'Could not find the git data.')
    await $.process.run(['rm', '-f', `${common}/fishstack/on`])
    await wireDesktopHook($, main, false)
  } catch (error) {
    $.ui.log(`desktop hook not removed: ${String(error)}`, { to: 'debug' })
  }
}

// The settings that send worktree creation to desktop-worktree.sh: the
// repository's .claude/settings.local.json, the person's own, kept out of
// git. fishStack's two entries go in while Use worktrees is on and come out
// when it goes off; the rest stays. A file that does not parse, or a
// WorktreeCreate hook of the person's own, is left alone. Every client
// there reads these settings; the script hands out slots only to the
// desktop app with fishStack on, and makes any other client the worktree
// Claude Code would.
const HOOK_SCRIPT = 'fishstack/desktop-worktree.sh'
const LOCAL_SETTINGS = '.claude/settings.local.json'

function hookCommand(mode: 'create' | 'remove'): string {
  return `bash "$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --path-format=absolute --git-common-dir)/${HOOK_SCRIPT}" ${mode}`
}

async function wireDesktopHook($: $, main: string, isOn: boolean): Promise<void> {
  const path = `${main}/${LOCAL_SETTINGS}`
  const isThere = await $.fs.exists(path)
  if (!isThere && !isOn) return
  let settings: Record<string, unknown> = {}
  if (isThere) {
    try {
      const parsed: unknown = JSON.parse(String(await $.fs.read(path)))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return
      settings = parsed as Record<string, unknown>
    } catch {
      return
    }
  }
  const was = settings.hooks
  const hooks: Record<string, unknown> = was !== null && typeof was === 'object' && !Array.isArray(was) ? { ...(was as Record<string, unknown>) } : {}
  const isOurs = (group: unknown) => JSON.stringify(group).includes(HOOK_SCRIPT)
  const groupsOf = (event: string) => (Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [])
  if (isOn && groupsOf('WorktreeCreate').some(group => !isOurs(group))) return
  for (const [event, mode] of [['WorktreeCreate', 'create'], ['WorktreeRemove', 'remove']] as const) {
    const groups = [...groupsOf(event).filter(group => !isOurs(group)), ...(isOn ? [{ hooks: [{ type: 'command', command: hookCommand(mode) }] }] : [])]
    if (groups.length > 0) hooks[event] = groups
    else delete hooks[event]
  }
  const { hooks: _hooks, ...rest } = settings
  const next = Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest
  if (JSON.stringify(next) === JSON.stringify(settings)) return
  if (isOn) await keepOutOfGit($, main, LOCAL_SETTINGS)
  await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`)
  if (isOn) await $.ui.toast(`fishStack: desktop sessions in ${main.split('/').pop()} now start in a pool slot (${LOCAL_SETTINGS}, kept out of git).`)
}

// Keeps one slot offered to the desktop's WorktreeCreate hook, marked by its
// .ready file, so a desktop session starts in it with no checkout. Only a
// slot no one uses is offered: detached and clean, as a new slot or one a
// claim scrubbed is. One a session left its branch in stays its own.
async function offerSlot($: $, main: string, repoDir: string): Promise<void> {
  await lock($, repoDir)
  try {
    const listed = await worktreePaths($, main)
    let free: string | null = null
    for (const path of await slotDirs($, repoDir)) {
      if (await $.fs.exists(path + READY)) return
      const real = await realPath($, path)
      if (free !== null || !listed.has(real) || listed.get(real) !== null) continue
      if ((await isWarmingLive($, await readWarming($, path))) || (await isTaken($, path))) continue
      const status = await git($, ['status', '--porcelain'], path)
      if (status.exitCode === 0 && status.stdout.trim() === '') free = path
    }
    if (free === null) return
    await $.fs.write(free + READY, String(await $.clock.now()))
    await signalPool($, free)
  } finally {
    await unlock($, repoDir)
  }
}

// Keeps the pool warm, as CommissionAI does: at least its size in slots
// (POOL_SIZE, or what + Add slot and Remove made it), at least one of them
// idle, each made, seeded and set up ahead of any session, one at a time in
// the background. Each slot is listed as setting up from the moment it is
// reserved. Pauses below minFreeGb of free disk, and says so in the tab.
let isWarming = false
// A top-up asked for while one runs: run once more when it ends, as a claim
// made meanwhile may have taken the spare it was counting on.
let isWarmAgain = false
async function prewarm($: $, options: PluginOptions, main: string): Promise<void> {
  if (isWarming) {
    isWarmAgain = true
    return
  }
  isWarming = true
  let path: string | null = null
  try {
    const repoDir = await slotsRoot($, options, main)
    const sessionId = await $.session.id()
    // Marks this session left mid-step belong to a run that is gone (none
    // runs here now); Queued ones still wait to be made.
    for (const one of await slotDirs($, repoDir)) {
      const mark = await readWarming($, one)
      if (mark?.sessionId === sessionId && mark.step !== QUEUED) await $.store.delete(WARMING_PREFIX + one)
    }
    await update($, poolNote, () => '')
    const branchName = await defaultBranch($, main)
    const minFreeGb = Number(options.minFreeGb ?? DEFAULT_MIN_FREE_GB)
    let sha: string | null = null
    let note = ''
    for (let made = 0; made < Math.max(await poolSize($, repoDir), 1); made++) {
      const pool = await poolNow($, main, repoDir)
      path = pool.queued[0] ?? null
      if (path === null && pool.total >= (await poolSize($, repoDir)) && pool.idle >= 1) break
      await $.process.run(['mkdir', '-p', repoDir])
      const free = await freeKb($, repoDir)
      if (free < minFreeGb * 1024 * 1024) {
        note = `Paused: ${(free / 1024 / 1024).toFixed(1)} GB of disk free, under the ${minFreeGb} GB it keeps.`
        path = null
        break
      }
      if (path !== null) await markWarming($, path, `Fetching origin/${branchName}`)
      if (sha === null) {
        const isFetched = await fetchBase($, main, branchName)
        sha = await gitOut($, ['rev-parse', isFetched ? `origin/${branchName}` : branchName], main, 'Could not resolve the base.')
      }
      if (path === null) {
        path = await reserveSlot($, repoDir)
        await refreshSlotsFor($, options, main)
      }
      const at = path
      await markWarming($, at, 'Checking out')
      await createSlot($, main, at, sha)
      await seedDependencies($, options, main, at, label => markWarming($, at, label))
      await $.store.delete(WARMING_PREFIX + at)
      await signalPool($, at)
      path = null
      await refreshSlotsFor($, options, main)
    }
    await installDesktopHook($, main, repoDir)
    await offerSlot($, main, repoDir)
    await update($, poolNote, () => note)
  } catch (error) {
    $.ui.log(`prewarm stopped: ${String(error)}`, { to: 'debug' })
    // The slot it was making is no longer listed as setting up.
    if (path !== null) {
      await $.store.delete(WARMING_PREFIX + path)
      await signalPool($, path)
    }
    await refreshSlotsFor($, options, main).catch(() => undefined)
    await update($, poolNote, () => (error instanceof StepError ? `Warming stopped: ${error.message}` : 'Warming stopped.'))
  } finally {
    isWarming = false
    if (isWarmAgain) {
      isWarmAgain = false
      $.clock.after(0, () => void prewarm($, options, main))
    }
  }
}

export async function defaultBranch($: $, main: string): Promise<string> {
  const head = await git($, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], main)
  if (head.exitCode === 0) return head.stdout.trim().replace(/^origin\//, '')
  return gitOut($, ['rev-parse', '--abbrev-ref', 'HEAD'], main, 'Could not read the current branch.')
}

// Fetches origin's branch, true when it came: one fetch at a time per
// repository in this process, shared by whoever asks meanwhile. A session's
// claim and the pool's warming start together, and of two fetches into one
// repository one loses the ref lock and starts from a stale base. A fetch
// still running at its timeout (a checkout far behind) did not come either.
const fetching = new Map<string, Promise<boolean>>()

async function fetchBase($: $, main: string, branchName: string): Promise<boolean> {
  const key = `${main}\n${branchName}`
  let run = fetching.get(key)
  if (run === undefined) {
    run = git($, ['fetch', '-q', 'origin', branchName], main)
      .then(ran => ran.exitCode === 0, () => false)
      .finally(() => fetching.delete(key))
    fetching.set(key, run)
  }
  return run
}

// Held by the module, not $.state: a reload runs session.start again, which
// restarts prepare() and its heartbeat.
let heartbeat: Timer | null = null

function startHeartbeat($: $, path: string): void {
  heartbeat?.cancel()
  heartbeat = $.clock.every(HEARTBEAT_MS, () => void writeLease($, path))
}

async function fail($: $, error: unknown): Promise<void> {
  const message = error instanceof StepError ? error.message : 'Something went wrong while preparing the worktree.'
  if (!(error instanceof StepError)) $.ui.log(`prepare failed: ${String(error)}`, { to: 'debug' })
  await update($, worktree, (current): Worktree => ({ ...current, phase: 'failed', step: message, error: message }))
}

// The ready band is news, not a fixture: it gives way to the rail on its own.
// A retry may have started over by then, so only a band still ready hides.
async function markReady($: $): Promise<void> {
  await setStep($, 'Worktree ready')
  await update($, worktree, (current): Worktree => ({ ...current, phase: 'ready', error: null }))
  $.clock.after(READY_BAND_MS, () => void hideIfReady($))
}

async function hideIfReady($: $): Promise<void> {
  if ((await read($, worktree)).phase === 'ready') await update($, isBandHidden, () => true)
}

async function enter($: $, options: PluginOptions): Promise<void> {
  const { path, branch } = await read($, worktree)
  if (path === null || branch === null) return
  // Claude Code may ask the person to confirm the move: the stepper says
  // where things stand meanwhile.
  await setStep($, 'Moving the session in')
  const entered = await $.tool.call({ tool: 'EnterWorktree', path })
  if (entered.deny !== undefined || entered.isError === true) {
    $.ui.log(`EnterWorktree refused: ${entered.deny ?? entered.text ?? ''}`, { to: 'debug' })
    await fail($, new StepError('Claude Code would not move the session into the worktree.'))
    return
  }
  await settle($, options, path, branch)
}

// Ready: the lock lifts, and a prompt that came in during the head start is
// told to carry on.
async function settle($: $, options: PluginOptions, path: string, branch: string | null): Promise<void> {
  await markReady($)
  await refreshSlots($, options)
  if (await read($, isHeadStartPrompted)) {
    await update($, isHeadStartPrompted, () => false)
    await $.prompt.submit({ text: continueNote(path, branch ?? 'HEAD') })
  } else if (await read($, isTurnRunning)) {
    // Moved under a turn that never heard of the head start (it began before
    // the claim did): told at its next batch or prompt. Before any turn, the
    // session simply starts where it works.
    await update($, owedMoveNote, () => movedNote(path, branch ?? 'HEAD'))
  }
}

async function prepare($: $, options: PluginOptions): Promise<void> {
  const { main, path: given } = await read($, worktree)
  if (main === null) return
  try {
    // The desktop's own worktree: seeded and set up where it is, no move.
    if (given !== null && !(await isSlot($, options, main, given))) {
      await setStep($, 'Setting up this worktree in place')
      await seedDependencies($, options, main, given, (label, isWarning) => setStep($, label, isWarning))
      await settle($, options, given, (await read($, worktree)).branch)
      return
    }
    const branchName = await defaultBranch($, main)
    await setStep($, `Fetching the latest origin/${branchName}`)
    let base = `origin/${branchName}`
    if (!(await fetchBase($, main, branchName))) {
      base = branchName
      await setStep($, `Could not fetch origin; starting from the local ${branchName}`, true)
    }
    const baseSha = await gitOut($, ['rev-parse', base], main, `Could not resolve ${base}.`)
    const wanted = `fish/${adoptedName ?? (await $.session.id()).slice(0, 6)}`
    await update($, worktree, current => ({ ...current, base, baseSha }))

    await setStep($, 'Claiming a slot')
    const { path, branch } = await claimSlot($, options, main, base, baseSha, wanted)
    await update($, worktree, current => ({ ...current, path, branch }))
    startHeartbeat($, path)
    await seedDependencies($, options, main, path, (label, isWarning) => setStep($, label, isWarning))
    await refreshSlots($, options)
    $.clock.after(0, () => void prewarm($, options, main))

    await enter($, options)
  } catch (error) {
    await fail($, error)
  }
}

async function beginWorktree($: $, options: PluginOptions): Promise<void> {
  await update($, worktree, (current): Worktree => ({ ...current, phase: 'preparing', step: 'Starting', steps: [], error: null }))
  await update($, isBandHidden, () => false)
  $.clock.after(0, () => void prepare($, options))
}

const PHASE: Record<WorktreePhase, { label: string; color: string }> = {
  off: { label: 'Off', color: 'inactive' },
  preparing: { label: 'Preparing (read-only)', color: 'warning' },
  ready: { label: 'Ready', color: 'success' },
  failed: { label: 'Failed (read-only)', color: 'error' },
}

// A pane opened unasked is a sidebar only where the surface docks one, which
// a render's viewport says and session.start does not.
let hasAutoOpened = false

// Claims a slot once per load, for the first person at the session: a REPL
// at session.start, or the desktop app or an editor attaching (they run the
// session headless, so its session.start says no one is at the prompt).
let hasStarted = false
// Where the session worked as a /clear ended it, for the session after.
let carried: { worktree: Worktree; elsewhere: string | null; isBandHidden: boolean } | null = null

// After a /clear: the session that follows works where the last one did,
// in the same slot, its lease kept alive from here.
async function carryOverClear($: $, options: PluginOptions): Promise<void> {
  if (carried === null) return
  const { worktree: was, elsewhere: where, isBandHidden: wasHidden } = carried
  carried = null
  await update($, worktree, () => was)
  await update($, elsewhere, () => where)
  await update($, isBandHidden, () => wasHidden)
  if (was.phase === 'ready' && was.path !== null && was.main !== null && (await isSlot($, options, was.main, was.path))) startHeartbeat($, was.path)
}

export const AUTO_WORKTREE_KEY = 'autoWorktree'

// + Add slot: the next slot reserved and listed at once, setting up, then
// made in the background like the rest, behind the same disk guard. The
// pool keeps one more from then on.
async function addSlot($: $, options: PluginOptions): Promise<void> {
  const main = (await read($, worktree)).main ?? (await repoMain($))
  if (main === null) return
  try {
    const repoDir = await slotsRoot($, options, main)
    await reserveSlot($, repoDir)
    const { total } = await poolNow($, main, repoDir)
    await $.store.set(POOL_SIZE_PREFIX + repoDir, Math.max(await poolSize($, repoDir), total))
    await refreshSlotsFor($, options, main)
  } catch (error) {
    $.ui.log(`add slot failed: ${String(error)}`, { to: 'debug' })
    await update($, poolNote, () => (error instanceof StepError ? `Could not add a slot: ${error.message}` : 'Could not add a slot.'))
    return
  }
  await prewarm($, options, main)
}

// Remove: a free slot leaves the pool, and the pool keeps one fewer from
// then on. It is leased under the lock so no session claims it meanwhile,
// its leftovers are backed up, then it is moved out of the numbered slots
// at once and deleted. Its branch stays.
async function removeSlot($: $, options: PluginOptions, path: string): Promise<void> {
  await update($, slotAsk, () => null)
  const main = (await read($, worktree)).main ?? (await repoMain($))
  if (main === null) return
  const number = path.split('/').pop()
  removing.add(path)
  await update($, slots, list => list.map(one => (one.path === path ? { ...one, isRemoving: true } : one)))
  try {
    const repoDir = await slotsRoot($, options, main)
    await lock($, repoDir)
    let isFree = false
    try {
      isFree =
        path !== (await read($, worktree)).path &&
        !(await isTaken($, path)) &&
        !(await isWarmingLive($, await readWarming($, path)))
      if (isFree) await writeLease($, path)
    } finally {
      await unlock($, repoDir)
    }
    if (!isFree) {
      await $.ui.toast(`Slot ${number} is in use now, so it stays.`)
      return
    }
    if ((await worktreePaths($, main)).has(await realPath($, path))) await backUpLeftovers($, path)
    const gone = `${repoDir}/.removing-${number}-${await $.clock.now()}`
    const moved = await $.process.run(['mv', path, gone])
    if (moved.exitCode !== 0) throw new StepError(`Could not move slot ${number} out of the pool.`)
    for (const prefix of [LEASE_PREFIX, SETUP_PREFIX, WARMING_PREFIX]) await $.store.delete(prefix + path)
    await $.process.run(['rm', '-f', path + READY])
    await $.process.run(['rm', '-rf', gone], { timeoutMs: SETUP_TIMEOUT_MS })
    await git($, ['worktree', 'prune'], main)
    await signalPool($, path)
    const { total } = await poolNow($, main, repoDir)
    await $.store.set(POOL_SIZE_PREFIX + repoDir, Math.min(await poolSize($, repoDir), total))
  } catch (error) {
    $.ui.log(`remove slot failed: ${String(error)}`, { to: 'debug' })
    await releaseSlot($, path)
    await $.ui.toast(error instanceof StepError ? error.message : `Could not remove slot ${number}.`)
  } finally {
    removing.delete(path)
    await refreshSlotsFor($, options, main)
  }
}

// The Worktrees tab's toggle, kept across sessions; until it is pressed,
// the autoWorktree option decides, off unless set.
async function isAutoOn($: $, options: PluginOptions): Promise<boolean> {
  const stored = await $.store.get(AUTO_WORKTREE_KEY)
  return typeof stored === 'boolean' ? stored : options.autoWorktree === true
}

async function setAuto($: $, options: PluginOptions, isOn: boolean): Promise<void> {
  await $.store.set(AUTO_WORKTREE_KEY, isOn)
  $.ui.invalidate('ui.render')
  const main = (await read($, worktree)).main ?? (await repoMain($))
  if (main === null) return
  if (isOn) $.clock.after(0, () => void prewarm($, options, main))
  else await unwireDesktopHook($, main)
}

async function startWorktree($: $, options: PluginOptions, cwd: string, { isForced = false, isDesktop = false } = {}): Promise<void> {
  if (hasStarted) return
  hasStarted = true
  const current = await read($, worktree)
  // On, the pool is checked at every load: a reload stops a warming run
  // midway, and a pool left short by other sessions tops up here.
  if (await isAutoOn($, options)) {
    const poolMain = current.main ?? (await repoMain($))
    if (poolMain !== null) $.clock.after(0, () => void prewarm($, options, poolMain))
  }
  if (current.phase === 'ready' && current.path !== null) {
    if (current.main !== null && (await isSlot($, options, current.main, current.path))) startHeartbeat($, current.path)
    return
  }
  if (current.phase === 'preparing') {
    await beginWorktree($, options)
    return
  }
  const repo = await $.session.repo()
  if (repo === null) return
  const top = await git($, ['rev-parse', '--show-toplevel'], cwd)
  if (top.exitCode !== 0) return
  const here = await realPath($, top.stdout.trim())
  // The main checkout is where the repository's .git lives; a worktree's
  // top level is not it.
  const common = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  const commonDir = common.stdout.trim()
  const main = common.exitCode === 0 && commonDir.endsWith('/.git') ? await realPath($, commonDir.slice(0, -'/.git'.length)) : here

  // Already in one of our slots (a session carried on there, or started
  // there): it is this session's, ready, whatever the toggle says.
  if (here !== main) {
    const repoDir = await slotsRoot($, options, main)
    const realDir = await realPath($, repoDir).catch(() => repoDir)
    const inside = [realDir, repoDir].find(dir => here.startsWith(`${dir}/`))
    if (inside !== undefined) {
      const path = `${repoDir}${here.slice(inside.length)}`
      const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'], here)).stdout.trim() || null
      const at = await $.clock.now()
      await update($, worktree, (): Worktree => ({ ...IDLE_WORKTREE, phase: 'ready', main, path, branch, step: 'Carried on in this slot', steps: [{ label: 'Carried on in this slot', at, isWarning: false }] }))
      await writeLease($, path)
      await signalPool($, path)
      startHeartbeat($, path)
      await refreshSlots($, options)
      return
    }
  }

  // Off, fishStack stays out of the way: no slot, no read-only guard, and
  // Claude Code's own worktree handling applies.
  if (!isForced && !(await isAutoOn($, options))) {
    if (here !== main) await update($, elsewhere, () => here)
    return
  }

  if (here !== main) {
    // A worktree Claude Code made itself (claude --worktree, the desktop's
    // worktree option): those are made before any mod loads, so its
    // WorktreeCreate never reaches fishStack. Any other worktree (a slot of
    // ours among them) is left as it is. Work already begun there (a reload
    // mid-session runs this again) stays with it.
    if (!here.startsWith(`${main}/.claude/worktrees/`) || !(await isUntouched($, here))) {
      await update($, elsewhere, () => here)
      return
    }
    // The desktop app's: set up where it is, read-only until then. The app's
    // diff, PR and archive follow the worktree it made, and it reuses its
    // worktrees as sessions end, so a slot would only duplicate it.
    if (isDesktop) {
      const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'], here)).stdout.trim() || null
      await update($, worktree, (): Worktree => ({ ...IDLE_WORKTREE, main, path: here, branch }))
      await beginWorktree($, options)
      return
    }
    // From the terminal: adopted into a slot on its name, read-only until
    // the slot is ready, then the session moves in. A slot starts from origin.
    adoptedName = here.split('/').pop()!.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)
  } else if (main !== (await realPath($, repo.root))) {
    return
  } else if (isDesktop && !isForced) {
    // The desktop's composer asks whether a session gets a worktree, and
    // makes one itself when it does (adopted above). In the main checkout,
    // the person asked for none: it stays there.
    return
  } else if (!isForced && (await terminalChoice($)) === 'ask') {
    // From the terminal or an editor, plain `claude` in the main checkout
    // says nothing about a worktree, so the person is asked, once a session,
    // unless they said always. The pool warms meanwhile, so a worktree is
    // still quick to take.
    if (await read($, isWhereAsked)) return
    await update($, isWhereAsked, () => true)
    $.clock.after(0, () => void askWhere($, options, main))
    return
  }

  await update($, worktree, now => ({ ...now, main }))
  await beginWorktree($, options)
}

const WHERE_QUESTION = 'Where should this session work?'
const WHERE_WORKTREE = 'A worktree'
const WHERE_MAIN = 'This main checkout'
const WHERE_ALWAYS = 'Always a worktree'

// What a new terminal session in a main checkout does with Use worktrees on:
// asks, or takes a worktree as the person said it always should. Kept across
// sessions, like the toggle.
export const TERMINAL_KEY = 'terminalWorktree'
type TerminalChoice = 'ask' | 'always'
const TERMINAL_CHOICES = [
  { value: 'ask', label: 'Ask each time' },
  { value: 'always', label: 'Always a worktree' },
] as const

async function terminalChoice($: $): Promise<TerminalChoice> {
  return (await $.store.get(TERMINAL_KEY)) === 'always' ? 'always' : 'ask'
}

async function setTerminalChoice($: $, choice: TerminalChoice): Promise<void> {
  await $.store.set(TERMINAL_KEY, choice)
  $.ui.invalidate('ui.render')
}

// What each answer to the where question leads to, the main checkout's
// branch among it: the dialog draws them under the labels (see the
// AskUserQuestion render below), as $.ui.ask carries labels alone.
let whereDetails: Record<string, string> | null = null

// Off the session's start, so its dialog never holds the start up. A
// worktree, now or always, claims one; the main checkout, a dismissed
// dialog or a typed answer leave the session where it is, with Create
// worktree now in the tab. A plugin's question, so Autopilot leaves it to
// the person.
async function askWhere($: $, options: PluginOptions, main: string): Promise<void> {
  let answer: string
  try {
    const on = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'], main)).stdout.trim()
    const base = await defaultBranch($, main).catch(() => 'the default branch')
    whereDetails = {
      [WHERE_WORKTREE]: `A branch of its own from the latest origin/${base}. It reads and plans at once and edits once it moves in, in seconds.`,
      [WHERE_MAIN]: `Right here, ${on === '' || on === 'HEAD' ? 'on a detached HEAD' : `on ${on}`}, with full access. Nothing is claimed.`,
      [WHERE_ALWAYS]: 'A worktree now, and for every new terminal session. Back to asking from /fs.',
    }
    answer = await $.ui.ask(WHERE_QUESTION, { header: 'Worktree', options: [WHERE_WORKTREE, WHERE_MAIN, WHERE_ALWAYS] })
  } catch {
    return
  } finally {
    whereDetails = null
  }
  if (answer === WHERE_ALWAYS) await setTerminalChoice($, 'always')
  if ((answer !== WHERE_WORKTREE && answer !== WHERE_ALWAYS) || (await read($, worktree)).phase !== 'off') return
  await update($, worktree, now => ({ ...now, main }))
  await beginWorktree($, options)
}

// Nothing uncommitted and no commit of its own: what any other branch or
// remote holds is not this worktree's. When git cannot say, it is touched.
async function isUntouched($: $, path: string): Promise<boolean> {
  const status = await git($, ['status', '--porcelain'], path)
  if (status.exitCode !== 0 || status.stdout.trim() !== '') return false
  const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'], path)).stdout.trim()
  const others = branch === '' || branch === 'HEAD' ? [] : [`--exclude=${branch}`]
  const own = await git($, ['rev-list', '-n', '1', 'HEAD', '--not', ...others, '--branches', '--remotes'], path)
  return own.exitCode === 0 && own.stdout.trim() === ''
}

// The name of the Claude Code worktree this session started in, which its
// slot's branch takes; null for a session started in the main checkout.
let adoptedName: string | null = null

// The empty state's button: claims a slot now, whether the toggle is on or off.
async function claimNow($: $, options: PluginOptions): Promise<void> {
  hasStarted = false
  await startWorktree($, options, await $.session.cwd(), { isForced: true })
  if ((await read($, worktree)).phase === 'off') {
    const other = await read($, elsewhere)
    await $.ui.toast(other === null ? "No worktree: this session isn't in a git repository." : `This session already works in a worktree fishStack does not manage: ${other}`)
  }
}

// Answers Claude Code's own worktree creation (claude --worktree, EnterWorktree
// with a name) with a slot: claimed at once so the session can enter it, then
// seeded while the session stays read-only. Null hands creation back.
async function claimForCreate($: $, options: PluginOptions, cwd: string, name: string): Promise<string | null> {
  try {
    const top = await gitOut($, ['rev-parse', '--show-toplevel'], cwd, 'Not inside a repository.')
    const repo = await $.session.repo()
    const main = await realPath($, repo?.root ?? top)
    const branchName = await defaultBranch($, main)
    const base = (await fetchBase($, main, branchName)) ? `origin/${branchName}` : branchName
    const baseSha = await gitOut($, ['rev-parse', base], main, `Could not resolve ${base}.`)
    const wanted = `fish/${name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40) || (await $.session.id()).slice(0, 6)}`
    hasStarted = true
    await update($, worktree, (): Worktree => ({ ...IDLE_WORKTREE, phase: 'preparing', step: 'Claiming a slot', main, base, baseSha }))
    const { path, branch } = await claimSlot($, options, main, base, baseSha, wanted)
    await update($, worktree, current => ({ ...current, path, branch }))
    startHeartbeat($, path)
    $.clock.after(0, () => void seedThenUnlock($, options, main, path))
    $.clock.after(0, () => void prewarm($, options, main))
    return path
  } catch (error) {
    $.ui.log(`WorktreeCreate fell back to Claude Code: ${String(error)}`, { to: 'debug' })
    await update($, worktree, () => IDLE_WORKTREE)
    return null
  }
}

async function seedThenUnlock($: $, options: PluginOptions, main: string, path: string): Promise<void> {
  try {
    await seedDependencies($, options, main, path, (label, isWarning) => setStep($, label, isWarning))
    await markReady($)
    await refreshSlots($, options)
  } catch (error) {
    await fail($, error)
  }
}

export function registerWorktree(on: On, options: PluginOptions): void {
  on('classic.WorktreeCreate', async ($, e, next) => {
    if (!(await isAutoOn($, options))) return next(e)
    const path = await claimForCreate($, options, e.cwd, e.name)
    return path === null ? next(e) : { worktreePath: path }
  })

  // The where question's options, each with what it leads to.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const details = whereDetails
    const [question, ...rest] = e.props.questions as { question?: string; options?: { label: string; description?: string }[] }[]
    if (details === null || question?.question !== WHERE_QUESTION || question.options === undefined) return next(e)
    const options = question.options.map(one => ({ ...one, description: details[one.label] ?? one.description }))
    return next({ ...e, props: { ...e.props, questions: [{ ...question, options }, ...rest] } })
  })

  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    await startWorktree($, options, e.cwd)
    return started
  })

  on('session.start', { isInteractive: false }, async ($, e, next) => {
    const started = await next(e)
    const surfaces = await $.session.surfaces()
    if (surfaces.some(one => one === 'desktop' || one === 'vscode')) await startWorktree($, options, e.cwd, { isDesktop: surfaces.includes('desktop') })
    return started
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    if (e.surface === 'desktop' || e.surface === 'vscode') await startWorktree($, options, await $.session.cwd(), { isDesktop: e.surface === 'desktop' })
    if (e.viewport?.isFullscreen === true && !hasAutoOpened) {
      hasAutoOpened = true
      $.clock.after(0, () => void $.ui.open({ id: PANE, title: PANE_TITLE }))
    }
    return attached
  })

  on('session.end', async ($, e, next) => {
    // A /clear ends the conversation, not the process: it goes on in the same
    // slot, so the lease stays, and what the next session needs is kept for
    // it (the state starts over, and no session.start follows).
    if (e.reason === 'clear') {
      carried = { worktree: await read($, worktree), elsewhere: await read($, elsewhere), isBandHidden: await read($, isBandHidden) }
      return next(e)
    }
    heartbeat?.cancel()
    const { main, path } = await read($, worktree)
    if (main !== null && path !== null && (await isSlot($, options, main, path))) {
      await freeDefaultBranch($, main, path)
      await releaseSlot($, path)
    }
    return next(e)
  })

  on('classic.SessionStart', { source: 'clear' }, async ($, e, next) => {
    const done = await next(e)
    await carryOverClear($, options)
    return done
  })

  // Every start arms the file watch the Slots list follows; Claude Code
  // takes watch paths from session start alone.
  on('classic.SessionStart', async ($, e, next) => {
    const done = await next(e)
    const paths = await poolWatchPaths($, options).catch(() => [])
    return paths.length === 0 ? done : { ...done, watchPaths: [...(done.watchPaths ?? []), ...paths] }
  })

  on('classic.FileChanged', async ($, e, next) => {
    const done = await next(e)
    if (e.file_path.endsWith(`/${POOL_SIGNAL}`) || /\/worktrees\/[^/]+\/HEAD$/.test(e.file_path)) queueRefresh($, options)
    return done
  })

  on('turn.start', async ($, e, next) => {
    // The dials' facts start over with each turn.
    beginTurn()
    await update($, isTurnRunning, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // Every turn's tokens count, a subagent's too: the session has no total of
    // its own, and /cost's dollars are list price, not what anyone is billed.
    const used = e.usage
    if (used !== undefined) {
      if ((await read($, tokenTotals)) === null) {
        const kept = await $.store.get(RAIL_STORE_KEY)
        if (kept !== null && typeof kept === 'object' && (kept as RailKept).sessionId === (await $.session.id()) && (kept as RailKept).tokens !== null) {
          await update($, tokenTotals, () => (kept as RailKept).tokens)
        }
      }
      // Claude's own counts, as each response reported them: what the cache
      // served and what was written to it, inside the input sent.
      await update($, tokenTotals, now => ({
        input: (now?.input ?? 0) + used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens,
        output: (now?.output ?? 0) + used.output_tokens,
        cacheRead: (now?.cacheRead ?? 0) + used.cache_read_input_tokens,
        cacheWrite: (now?.cacheWrite ?? 0) + used.cache_creation_input_tokens,
      }))
    }
    const sessionId = await $.session.id()
    if (e.agentId !== undefined) {
      await $.store.set(RAIL_STORE_KEY, { sessionId, repliedAt: await read($, lastReplyAt), tokens: await read($, tokenTotals) })
      return done
    }
    const repliedAt = await $.clock.now()
    await update($, lastReplyAt, () => repliedAt)
    await $.store.set(RAIL_STORE_KEY, { sessionId, repliedAt, tokens: await read($, tokenTotals) })
    await update($, isTurnRunning, () => false)
    if ((await read($, worktree)).phase === 'ready') await update($, isBandHidden, () => true)
    return done
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    $.ui.invalidate('ui.render')
    return closed
  })

  on('ui.open', { id: PANE }, async ($, e, next) => {
    const opened = await next(e)
    $.ui.invalidate('ui.render')
    $.clock.after(0, () => void refreshSlots($, options))
    return opened
  })

  on('ui.press', { plugin: 'fishstack', element: 'tab-worktree' }, async ($, e, next) => {
    const pressed = await next(e)
    await refreshSlots($, options)
    return pressed
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.viewport?.isFullscreen === true && !hasAutoOpened) {
      hasAutoOpened = true
      $.clock.after(0, () => void $.ui.open({ id: PANE, title: PANE_TITLE }))
    }
    const state = await read($, worktree)
    if (e.props.hasSurvey) {
      railHover = null
      return next(e)
    }
    if (state.phase === 'off' || (await read($, isBandHidden))) {
      // With no worktree news, the band is fishStack's status rail. Reading
      // isTurnRunning redraws it as each turn starts and ends.
      const isWorking = await read($, isTurnRunning)
      await read($, railTick)
      // State starts over on a reload or a rename; the store keeps this
      // session's last reply and token totals across both.
      const kept = await $.store.get(RAIL_STORE_KEY)
      const keptHere = kept !== null && typeof kept === 'object' && (kept as RailKept).sessionId === (await $.session.id()) ? (kept as RailKept) : null
      const repliedAt = (await read($, lastReplyAt)) ?? keptHere?.repliedAt ?? null
      const now = await $.clock.now()
      const cacheSecondsLeft = repliedAt === null ? null : Math.max(0, Math.round((CACHE_TTL_MS - (now - repliedAt)) / 1000))
      tickWhileWarm($, cacheSecondsLeft !== null && cacheSecondsLeft > 0 && !isWorking)
      const usage = await $.session.usage({ breakdown: 'summary' })
      const breakdown = usage.context.breakdown
      const last = breakdown?.apiUsage ?? null
      const input = last === null ? 0 : last.input_tokens + last.cache_read_input_tokens + last.cache_creation_input_tokens
      const list = await read($, sources)
      const values = await read($, dials)
      // Only while the dial is on Autopilot: lowered, or the dials off,
      // nothing is answered.
      const isDials = await read($, isDialsOn)
      const auto = isDials && values.autonomy === 5 ? await read($, autopilot) : null
      const ui: Ui = resolveUi($.ui.resolve(e), e.surface, await read($, isClientDown))
      return drawRail(
        ui,
        {
          isWorking,
          cacheSecondsLeft,
          cachePercent: last === null || input === 0 ? null : Math.round((last.cache_read_input_tokens / input) * 100),
          tokens: (await read($, tokenTotals)) ?? keptHere?.tokens ?? null,
          costUsd: usage.cost?.usd ?? null,
          preset: presetName(values),
          presetLevels: [values.foresight, values.crew, values.tenacity, values.autonomy, values.proof, values.voice],
          sourcesOn: list.filter(one => one.mode !== 'off').length,
          sourcesTotal: list.length,
          branch: state.phase === 'ready' ? state.branch : null,
          isDialsOn: isDials,
          isContextOn: await read($, isContextOn),
          autopilot:
            auto === null
              ? null
              : auto.kind === 'waiting'
                ? { kind: 'waiting', secondsLeft: Math.max(0, Math.round((auto.deadline - now) / 1000)), totalSeconds: Math.round((auto.deadline - auto.since) / 1000), picked: auto.picked, count: auto.count }
                : { kind: 'answered', at: clockTime(auto.at), picked: auto.picked, waitedMinutes: Math.round(auto.waitedMs / 60_000) },
        },
        at => void openAt($, at),
        railHover,
        (id, isOn) => {
          // Leaving A may land after entering B: only A's own leave clears it.
          const hovered = isOn ? id : railHover === id ? null : railHover
          if (hovered === railHover) return
          railHover = hovered
          void update($, railTick, n => n + 1)
        },
        e.props.bodyColumns,
      )
    }

    // The rail is not drawn, so its Clients send no leave: start unlit.
    railHover = null
    const { Box, Text, Button } = $.ui.resolve(e)
    if (state.phase === 'preparing') {
      return (
        <Text wrap="truncate-end">
          <Text color="warning" bold>Read-only until the worktree is ready</Text>
          <Text dimColor> · {state.step}</Text>
        </Text>
      )
    }
    if (state.phase === 'failed') {
      return (
        <Box gap={1}>
          <Text wrap="truncate-end">
            <Text color="error" bold>Worktree failed, still read-only</Text>
            <Text dimColor> · {state.error}</Text>
          </Text>
          <Button key="worktree-retry" label="Retry" variant="primary" onPress={() => void beginWorktree($, options)} />
        </Box>
      )
    }
    return (
      <Box gap={1}>
        <Text wrap="truncate-end">
          <Text color="success" bold>Worktree ready</Text>
          <Text dimColor> · {state.branch}</Text>
        </Text>
        <Button key="band-hide" label="Hide" dimColor onPress={() => void update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await read($, tab)) !== 'worktree') return next(e)
    const ui: Ui = resolveUi($.ui.resolve(e), e.surface, await read($, isClientDown))
    const { Box, Text, Button } = ui
    const state = await read($, worktree)
    const list = await read($, slots)
    const phase = PHASE[state.phase]
    const first = state.steps[0]?.at ?? 0
    const select = (id: Tab) => void update($, tab, () => id)

    const isAuto = await isAutoOn($, options)
    const terminal = await terminalChoice($)
    const isInSlot = state.main !== null && state.path !== null && (await isSlot($, options, state.main, state.path))
    const note = await read($, poolNote)
    const settingUp = list.filter(one => one.setup !== null).length
    const idle = list.filter(one => !one.isLeased && one.setup === null).length
    const autoCard = (
        <Box key="worktree-head" justifyContent="space-between" alignItems="flex-start" gap={1}>
          <Box flexDirection="column" flexShrink={1}>
            <Text bold>Where the agent works</Text>
            <Text dimColor>
              {isAuto
                ? `On: a new terminal session in a main checkout ${terminal === 'always' ? 'takes' : 'asks whether to take'} a lasting slot, and Claude's own worktrees (claude --worktree) get one. Read-only until it is ready, then the lock lifts. In the desktop app, its worktree option decides, and its worktree is set up where it is.`
                : "Off: fishStack leaves worktrees to Claude Code (the desktop's worktree option, claude --worktree, EnterWorktree)."}
            </Text>
            {isAuto && (
              <Box key="pool-line" gap={1} alignItems="center" flexWrap="wrap">
                <Text>
                  <Text color={idle > 0 ? 'success' : 'warning'}>● </Text>
                  <Text>
                    Pool: {list.length} {list.length === 1 ? 'slot' : 'slots'}, {idle} ready{settingUp > 0 ? `, ${settingUp} setting up` : ''}
                  </Text>
                  {note !== '' && <Text dimColor> · {note}</Text>}
                </Text>
              </Box>
            )}
            {isAuto && (
              <Box key="terminal-line" gap={1} alignItems="center" flexWrap="wrap">
                <Text dimColor>New terminal sessions</Text>
                {segmented(ui, 'terminal-worktree', TERMINAL_CHOICES, terminal, choice => void setTerminalChoice($, choice))}
              </Box>
            )}
          </Box>
          {useSwitch(ui, 'auto-worktree', 'Use worktrees', isAuto, isOn => void setAuto($, options, isOn))}
        </Box>
    )

    // Every slot of this repository's pool, whatever this session is doing,
    // with + Add slot at its head; a slot being made is listed from the
    // moment it is reserved, and a free one can be removed.
    const rich = ui.Svg !== undefined
    const ask = await read($, slotAsk)
    const slotRow = (slot: Slot) => {
      const number = slot.path.split('/').pop()
      const isSettingUp = slot.setup !== null
      const isRemovable = !slot.isMine && !slot.isLeased && !isSettingUp && !slot.isRemoving
      const isAsked = ask === slot.path && isRemovable
      const status = slot.isRemoving
        ? { text: '◌ removing…', color: 'inactive' }
        : isSettingUp
          ? { text: '◐ setting up', color: 'warning' }
          : slot.isMine
            ? { text: '● this session', color: 'success' }
            : slot.isLeased
              ? { text: '● leased', color: 'warning' }
              : { text: '○ free', color: 'inactive' }
      return card(
        ui,
        `slot-${slot.path}`,
        [
          <Box justifyContent="space-between" alignItems="center" gap={1}>
            <Text wrap="truncate-end">
              <Text bold>#{number}</Text> {isSettingUp ? '' : `${slot.branch ?? 'detached'} `}
              <Text color={status.color}>{status.text}</Text>
              {isSettingUp && <Text dimColor> · {slot.setup}</Text>}
            </Text>
            {!isSettingUp && !slot.isRemoving && (
              <Box gap={1} flexShrink={0}>
                <Button key={`slot-copy-${slot.path}`} label="Copy path" dimColor onPress={press => void $.ui.copy({ text: slot.path, surface: press.surface })} />
                {slot.isLeased && !slot.isMine && (
                  <Button key={`slot-release-${slot.path}`} label="Release" dimColor onPress={() => void releaseAndRefresh($, slot.path, options)} />
                )}
                {isRemovable && !isAsked && (
                  <Button key={`slot-remove-${slot.path}`} label="Remove" dimColor onPress={() => void update($, slotAsk, () => slot.path)} />
                )}
              </Box>
            )}
          </Box>,
          isAsked && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text>
                Remove slot <Text bold>#{number}</Text>? <Text dimColor>Its folder and node_modules go. Its branch stays, and anything uncommitted is saved under refs/fish/backup/ first.</Text>
              </Text>
              <Box gap={1} justifyContent="flex-end" flexWrap="wrap">
                <Button key="slot-remove-cancel" label="Cancel" dimColor onPress={() => void update($, slotAsk, () => null)} />
                <Button key="slot-remove-confirm" label="Remove" variant="primary" onPress={() => void removeSlot($, options, slot.path)} />
              </Box>
            </Box>
          ),
        ],
        { tone: isAsked ? 'danger' : slot.isMine ? 'selected' : isSettingUp ? 'warning' : slot.isRemoving ? 'muted' : 'plain' },
      )
    }
    const slotList =
      list.length === 0 && !isAuto ? null : (
        <Box key="slot-list" flexDirection="column" gap={rich ? 1 : 0}>
          <Box key="slot-head" justifyContent="space-between" alignItems="center" gap={1}>
            {label(ui, `Slots · ${list.length}`)}
            <Button key="pool-add" label="+ Add slot" dimColor onPress={() => void addSlot($, options)} />
          </Box>
          {list.map(slotRow)}
        </Box>
      )

    const other = await read($, elsewhere)
    if (state.phase === 'off' && other !== null) {
      // In a worktree that is not ours: say where, and offer nothing to make.
      return frame(
        ui,
        'worktree',
        e.props.bodyColumns,
        select,
        <Box flexDirection="column" gap={1}>
          {autoCard}
          {card(ui, 'worktree-elsewhere', [
            <Text bold>This session already works in a worktree</Text>,
            <Text dimColor>fishStack does not manage it, so it leaves it as it is. New sessions started in the main checkout get a slot of their own.</Text>,
            <Box marginTop={1} gap={1}>
              <Text dimColor>Path</Text>
              <Text wrap="truncate-start">{shortPath(other)}</Text>
            </Box>,
          ])}
          {slotList}
        </Box>,
      )
    }

    if (state.phase === 'off') {
      return frame(
        ui,
        'worktree',
        e.props.bodyColumns,
        select,
        <Box flexDirection="column" gap={1}>
          {autoCard}
          {card(ui, 'worktree-empty', [
            <Box gap={2} alignItems="flex-start">
              {svg(ui, branchArt(120, 72), 'A branch off the main line', 120, 72)}
              <Box flexDirection="column" flexShrink={1} flexGrow={1} gap={1}>
                <Box flexDirection="column">
                  <Text bold>No worktree for this session</Text>
                  <Text dimColor>{!isAuto ? 'Create one for this session now, or turn Use worktrees on for new sessions.' : (await read($, isWhereAsked)) ? 'This session works in the main checkout. Create one now if you change your mind.' : 'This session started before the toggle was on, or outside a main checkout.'}</Text>
                </Box>
                <Box flexDirection="column">
                  <Text dimColor>✓ An isolated branch and folder</Text>
                  <Text dimColor>✓ Safe to discard</Text>
                  <Text dimColor>✓ The main checkout stays as it is</Text>
                </Box>
                <Box>
                  <Button key="worktree-create" label="Create worktree now" variant="primary" onPress={() => void claimNow($, options)} />
                </Box>
              </Box>
            </Box>,
          ])}
          {slotList}
        </Box>,
      )
    }


    const stage = stageOf(state)
    const { Svg } = ui
    const isReady = state.phase === 'ready'
    const showSteps = !isReady || (await read($, isStepsShown))
    const stepperWidth = Math.max(320, (e.props.bodyColumns - 4) * 8)
    const isTimed = state.steps.some(step => step.at !== first)
    const detail = (label: string, value: string) => (
      <Box gap={1}>
        <Box width={8} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Text wrap="truncate-start">{value}</Text>
      </Box>
    )
    return frame(
      ui,
      'worktree',
      e.props.bodyColumns,
      select,
      <Box flexDirection="column" gap={1}>
        {autoCard}
        {card(
          ui,
          'worktree-status',
          [
            <Box justifyContent="space-between" alignItems="center" gap={1}>
              <Text>
                <Text color={phase.color} bold>
                  ● {phase.label}
                </Text>
                <Text dimColor> · {isReady ? (state.branch ?? '') : state.steps.length === 0 ? shortPath(state.main ?? '') : state.step}</Text>
              </Text>
              <Box gap={1}>
                {isReady && <Button key="steps-toggle" label={showSteps ? 'Hide steps' : 'Show steps'} dimColor onPress={() => void update($, isStepsShown, now => !now)} />}
                {state.phase !== 'preparing' && <Button key="slots-refresh" label="Refresh" hotkey="r" dimColor onPress={() => void refreshSlots($, options)} />}
                {state.phase === 'failed' && <Button key="worktree-retry" label="Retry" variant="primary" onPress={() => void beginWorktree($, options)} />}
              </Box>
            </Box>,
            showSteps &&
              (rich ? (
                <Box marginTop={1}>{svg(ui, stepper(stage, state.phase, stepperWidth), `Stage ${Math.min(stage + 1, 4)} of 4: ${STAGES[Math.min(stage, 3)]}`, stepperWidth, 58)}</Box>
              ) : (
                <Text>
                  {STAGES.map((name, index) => (
                    <Text color={index < stage || isReady ? 'success' : index === stage ? phase.color : undefined} dimColor={index > stage && !isReady}>
                      {index < stage || isReady ? '✓' : index === stage ? '●' : '○'} {name}
                      {index < STAGES.length - 1 ? '  ─  ' : ''}
                    </Text>
                  ))}
                </Text>
              )),
            state.phase === 'preparing' && (
              <Box marginTop={1}>
                <Text dimColor>Prompts work now: the agent reads, searches and plans in the main checkout, and edits once it moves in.</Text>
              </Box>
            ),
            showSteps && state.steps.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {state.steps.map(step => (
                  <Text color={step.isWarning ? 'warning' : undefined} dimColor={!step.isWarning}>
                    {isTimed ? `+${((step.at - first) / 1000).toFixed(1)}s  ` : '·  '}
                    {step.label}
                  </Text>
                ))}
              </Box>
            ),
            state.path !== null && (
              <Box flexDirection="column" marginTop={1}>
                {detail('Main', shortPath(state.main ?? ''))}
                {detail(isInSlot ? 'Slot' : 'Worktree', shortPath(state.path))}
                {detail('Branch', state.branch ?? '')}
                {state.base !== null && detail('Base', `${state.base}${state.baseSha === null ? '' : ` @ ${state.baseSha.slice(0, 7)}`}`)}
              </Box>
            ),
          ],
          { tone: state.phase === 'failed' ? 'danger' : isReady ? 'plain' : 'warning' },
        )}

        {slotList}
      </Box>,
    )
  })
}

// A time of day as the person's clock shows it: 4:12 pm.
function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// The prompt cache lives 5 minutes past the last reply. While it is warm
// the rail redraws every few seconds so its bars run down.
const CACHE_TTL_MS = 5 * 60_000
let cacheTick: Timer | null = null

function tickWhileWarm($: $, isWarm: boolean): void {
  if (isWarm && cacheTick === null) cacheTick = $.clock.every(5_000, () => void update($, railTick, n => n + 1))
  if (!isWarm && cacheTick !== null) {
    cacheTick.cancel()
    cacheTick = null
  }
}

// The rail's items open the pane, at their tab when they name one.
async function openAt($: $, at: Tab | null): Promise<void> {
  if (at !== null) await update($, tab, () => at)
  await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true })
}

// A home folder spelled ~, as the terminal shows paths.
function shortPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, '~')
}

const STAGES = ['Fetch', 'Claim a slot', 'Seed', 'Move in']

// Which of the four stages the steps so far have reached.
function stageOf(state: Worktree): number {
  if (state.phase === 'ready') return STAGES.length
  const patterns = [/^Fetching|^Could not fetch/, /^Claiming|^Reusing slot|^Creating a new worktree|^Setting up this worktree in place/, /^Cloning|^Could not clone|^Running|^Setup already done/, /^Moving the session in/]
  let reached = 0
  for (const step of state.steps) {
    patterns.forEach((pattern, index) => {
      if (pattern.test(step.label)) reached = Math.max(reached, index)
    })
  }
  return reached
}

function stepper(stage: number, phase: WorktreePhase, width: number): string {
  const gap = width / STAGES.length
  const parts = STAGES.map((name, index) => {
    const x = gap * index + gap / 2
    const isDone = index < stage
    const isCurrent = index === stage
    const color = isDone ? '#3fb6a8' : isCurrent ? (phase === 'failed' ? '#e5534b' : '#d6a24a') : '#8b949e'
    const line =
      index < STAGES.length - 1
        ? `<line x1="${x + 13}" y1="16" x2="${x + gap - 13}" y2="16" stroke="${isDone ? '#3fb6a8' : '#8b949e'}" stroke-opacity="${isDone ? 0.9 : 0.35}" stroke-width="2" stroke-dasharray="${isDone ? '' : '3 4'}"/>`
        : ''
    const mark = isDone
      ? `<path d="M${x - 4.5} 16.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<text x="${x}" y="20.5" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="12" font-weight="600" fill="${isCurrent ? '#fff' : '#8b949e'}">${index + 1}</text>`
    const halo = isCurrent ? `<circle cx="${x}" cy="16" r="15" fill="${color}" fill-opacity="0.2"/>` : ''
    return `${line}${halo}<circle cx="${x}" cy="16" r="11" fill="${isDone || isCurrent ? color : 'none'}" stroke="${color}" stroke-opacity="${isDone || isCurrent ? 1 : 0.5}" stroke-width="1.6"/>${mark}<text x="${x}" y="48" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="12" font-weight="${isCurrent ? 600 : 400}" fill="${isCurrent ? color : isDone ? '#9aa1ab' : '#6e7681'}">${name}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="58" viewBox="0 0 ${width} 58">${parts}</svg>`
}

// The Release button: also lets go of a desktop hold left behind (a session
// deleted without its worktree removed, or a subagent's, which the desktop
// never removes).
async function releaseAndRefresh($: $, path: string, options: PluginOptions): Promise<void> {
  await $.process.run(['rm', '-f', path + HELD])
  await releaseSlot($, path)
  await refreshSlots($, options)
}
