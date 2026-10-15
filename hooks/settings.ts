// Where fishStack keeps a setting: per repository, so each repo has its own
// dials, switches and worktree choices. A repository is its main checkout,
// so a session in one of its worktrees reads what the main checkout set;
// outside git, the folder the session works in.
import type { EngineInterface } from 'claude-code'

type $ = EngineInterface

// The main checkout of the session's repository, or null outside one: the
// folder holding the repository's .git, so a session working in a linked
// worktree finds the same pool (and settings) as one in the main checkout.
export async function repoMain($: $): Promise<string | null> {
  const repo = await $.session.repo()
  if (repo === null) return null
  const common = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo.root, timeoutMs: 120_000 })
  const dir = common.stdout.trim()
  const main = common.exitCode === 0 && dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : repo.root
  return (await $.fs.stat(main, { resolve: true })).realPath ?? main
}

// A folder's main checkout does not change, so it is asked of git once per
// folder, not on every draw of the pane.
const homes = new Map<string, Promise<string>>()

export async function settingsHome($: $): Promise<string> {
  const repo = await $.session.repo()
  if (repo === null) return $.session.root()
  let home = homes.get(repo.root)
  if (home === undefined) {
    home = (async () => (await repoMain($)) ?? repo.root)()
    homes.set(repo.root, home)
    home.catch(() => homes.delete(repo.root))
  }
  return home
}

export function repoSettingKey(key: string, home: string): string {
  return `${key}:${home}`
}

// This repository's value, or, until it sets its own, the one fishStack
// kept for every repository before settings were per repository.
export async function getSetting($: $, key: string): Promise<unknown> {
  const own = await $.store.get(repoSettingKey(key, await settingsHome($)))
  return own !== undefined ? own : $.store.get(key)
}

export async function setSetting($: $, key: string, value: unknown): Promise<void> {
  await $.store.set(repoSettingKey(key, await settingsHome($)), value as never)
}
