// The Context tab, after CommissionAI's context library: the sources the user
// shares with the agent (notes, links, files from the repository), each On or
// Off and On ones optionally Strict, kept loose or grouped in folders that
// switch as one. The live context window sits in a footer. session.ts puts
// the sources that are on in the system prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ContextView, Folder, Source, SourceMode, Tab } from '../types'
import { card, chip, folderArt, glyph, GLYPH_COLOR, isRich, svg, tickMeter, track } from './kit'
import { bar, frame, PANE, resolveUi, tokens } from './ui'
import type { Ui } from './ui'

const contextDraft = atom({ plugin: 'craft-shop', key: 'contextDraft' } as const, { input: '', name: '' })
const contextStatus = atom({ plugin: 'craft-shop', key: 'contextStatus' } as const, '')
const contextView = atom({ plugin: 'craft-shop', key: 'contextView' } as const, {
  openFolders: [],
  openId: null,
  target: null,
  isNamingFolder: false,
  picking: null,
  menuFolder: null,
  renamingFolder: null,
  deletingFolder: null,
  isEditingText: false,
})
const folders = atom({ plugin: 'craft-shop', key: 'folders' } as const, [])
const isTurnRunning = atom({ plugin: 'craft-shop', key: 'isTurnRunning' } as const, false)
const isWindowShown = atom({ plugin: 'craft-shop', key: 'isWindowShown' } as const, false)
const sources = atom({ plugin: 'craft-shop', key: 'sources' } as const, [])
const tab = atom({ plugin: 'craft-shop', key: 'tab' } as const, 'worktree')

type $ = EngineInterface

export const CONTEXT_SECTION_ID = 'craft-shop:context'
const CHAR_CAP = 12_000
const TOKEN_BUDGET = 12_000
const IMPORT_CAP = 40
const TEXT_FILE = /\.(md|mdx|markdown|txt|rst|adoc|json|ya?ml|toml|graphql|proto|sql|csv)$/i
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'target'])


const KIND_LABEL: Record<Source['kind'], string> = { note: 'Note', link: 'Link', file: 'File' }

// What a source looks like in the library, and what it costs the agent.
export function libraryStoreKey(root: string): string {
  return `context:${root}`
}

// The store key the library used before folders, read once to carry it over.
export function legacyStoreKey(root: string): string {
  return `sources:${root}`
}

export function parseLibrary(stored: unknown, legacy: unknown): { sources: Source[]; folders: Folder[] } {
  const library = stored as { sources?: unknown; folders?: unknown } | undefined
  if (library !== undefined && library !== null && Array.isArray(library.sources)) {
    return {
      sources: (library.sources as Source[]).map(normalize),
      folders: Array.isArray(library.folders) ? (library.folders as Folder[]) : [],
    }
  }
  return { sources: Array.isArray(legacy) ? (legacy as Source[]).map(normalize) : [], folders: [] }
}

function normalize(one: Source): Source {
  return { ...one, path: one.path ?? null, folderId: one.folderId ?? null }
}

function approxTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

function chars(count: number): string {
  return count >= 1_000 ? `${(count / 1_000).toFixed(1)}k chars` : `${count} chars`
}

// A title cut to fit its row at a word, the whole one kept in the store.
function shorten(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, room - 1).replace(/\s+\S*$/, '').replace(/[.,;:]$/, '')}…`
}

function host(url: string): string {
  return /^https?:\/\/([^/]+)/.exec(url)?.[1] ?? url
}

function facts(source: Source): string {
  if (source.kind === 'link' && source.url !== null) return `Link · ${host(source.url)} · ${chars(source.text.length)}`
  if (source.kind === 'file' && source.path !== null) return `File · ${source.path} · ${chars(source.text.length)}`
  return `${KIND_LABEL[source.kind]} · ${chars(source.text.length)}`
}

// One mode for a folder's members, or 'mixed' when they differ.
export function folderMode(members: Source[]): SourceMode | 'mixed' {
  if (members.length === 0) return 'off'
  const first = members[0]!.mode
  return members.every(one => one.mode === first) ? first : 'mixed'
}

function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null
  const text = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  return { title, text }
}

export function contextSection(list: Source[], groups: Folder[] = []): string | null {
  const enabled = list.filter(one => one.mode !== 'off')
  if (enabled.length === 0) return null
  const folderName = new Map(groups.map(one => [one.id, one.name]))
  const blocks = enabled.map(one => {
    const group = one.folderId === null ? undefined : folderName.get(one.folderId)
    const heading = group === undefined ? one.title : `${group} › ${one.title}`
    const origin = one.url !== null ? ` (${one.url})` : one.path !== null ? ` (${one.path})` : ''
    const weight =
      one.mode === 'strict'
        ? 'STRICT: binding ground truth. Follow it over your own assumptions, and say so if the code disagrees.'
        : 'Guidance: weigh it, but the code and the user win when they disagree.'
    return `### ${heading}${origin}\n${weight}\n\n${one.text}`
  })
  return ['## Project context the user shared', ...blocks].join('\n\n')
}

// The thresholds CommissionAI's ContextRing turns amber and red at.
function fillColor(percent: number): string {
  return percent >= 85 ? 'error' : percent >= 65 ? 'warning' : 'success'
}

async function libraryRoot($: $): Promise<string> {
  const repo = await $.session.repo()
  return repo?.root ?? (await $.session.root())
}

async function save($: $): Promise<void> {
  await $.store.set(libraryStoreKey(await libraryRoot($)), {
    sources: await read($, sources),
    folders: await read($, folders),
  })
}

async function saveSources($: $, change: (list: Source[]) => Source[]): Promise<void> {
  await update($, sources, change)
  await save($)
}

async function newId($: $): Promise<string> {
  return `${(await $.clock.now()).toString(36)}-${crypto.randomUUID().slice(0, 4)}`
}

const VIEW: ContextView = {
  openFolders: [],
  openId: null,
  target: null,
  isNamingFolder: false,
  picking: null,
  menuFolder: null,
  renamingFolder: null,
  deletingFolder: null,
  isEditingText: false,
}

// The view as this version draws it. $.state outlives a reload, so a view
// saved by an older version can lack fields; they start at their defaults.
async function readView($: $): Promise<ContextView> {
  return { ...VIEW, ...(await read($, contextView)) }
}

async function updateView($: $, change: (now: ContextView) => ContextView): Promise<void> {
  await update($, contextView, now => change({ ...VIEW, ...now }))
}

async function setView($: $, change: Partial<ContextView>): Promise<void> {
  await updateView($, now => ({ ...now, ...change }))
}

async function say($: $, text: string): Promise<void> {
  await update($, contextStatus, () => text)
}

async function addSource($: $, source: Omit<Source, 'id' | 'mode' | 'folderId'>): Promise<Source> {
  const { target } = await readView($)
  const added: Source = { ...source, id: await newId($), mode: 'guidance', folderId: target }
  await saveSources($, list => [...list, added])
  // A source added into a folder shows there: the folder opens.
  if (target !== null) await updateView($, now => ({ ...now, openFolders: [...new Set([...now.openFolders, target])] }))
  return added
}

async function fetchLink($: $, url: string): Promise<{ title: string; text: string } | string> {
  let response
  try {
    response = await $.http.fetch(url)
  } catch (error) {
    $.ui.log(`fetch ${url} failed: ${String(error)}`, { to: 'debug' })
    return 'Could not reach that link.'
  }
  if (!response.ok) return `That link answered ${response.status}.`
  const isHtml = (response.headers['content-type'] ?? '').includes('html')
  const page = isHtml ? htmlToText(response.text) : { title: null, text: response.text.trim() }
  return { title: page.title || url.replace(/^https?:\/\//, '').replace(/\/$/, ''), text: page.text.slice(0, CHAR_CAP) }
}

async function readText($: $, path: string): Promise<string> {
  const text = await $.fs.read(path)
  return typeof text === 'string' ? text.slice(0, CHAR_CAP) : ''
}

// The text files under a directory, breadth first, at most IMPORT_CAP, as
// absolute paths.
async function textFiles($: $, directory: string): Promise<string[]> {
  const found: string[] = []
  const queue = [directory]
  while (queue.length > 0 && found.length < IMPORT_CAP) {
    const dir = queue.shift()!
    const entries = await $.fs.list(dir)
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      const path = `${dir}/${entry.name}`
      if (entry.kind === 'dir' && !SKIPPED_DIRS.has(entry.name)) queue.push(path)
      else if (entry.kind === 'file' && TEXT_FILE.test(entry.name) && found.length < IMPORT_CAP) found.push(path)
    }
  }
  return found
}

// The one add field: a link is fetched, a path in the repository is read (a
// directory becomes a folder of its text files), anything else is a note.
async function addFromInput($: $, raw: string): Promise<void> {
  const text = raw.trim()
  if (text === '') return say($, 'Paste a link or write a note, or choose files.')
  if (/^https?:\/\/\S+$/.test(text)) {
    await say($, `Fetching ${text}`)
    const page = await fetchLink($, text)
    if (typeof page === 'string') return say($, page)
    await addSource($, { kind: 'link', title: page.title, text: page.text, url: text, path: null })
    return clearInput($, `Added ${page.title}`)
  }
  const looksLikePath = !/\s/.test(text) && /[/.]/.test(text)
  if (looksLikePath) {
    const path = text.replace(/^\.\//, '').replace(/\/+$/, '')
    const top = await $.session.root()
    const stat = await $.fs.stat(`${top}/${path}`).catch(() => undefined)
    if (stat?.kind === 'dir') return importDirectory($, `${top}/${path}`, path)
    if (stat?.kind === 'file') {
      const body = await readText($, `${top}/${path}`).catch(() => null)
      if (body === null) return say($, `Could not read ${path}.`)
      await addSource($, { kind: 'file', title: path.split('/').pop() ?? path, text: body, url: null, path })
      return clearInput($, `Added ${path}`)
    }
  }
  const firstLine = text.split('\n')[0]!
  const title = firstLine.slice(0, 120)
  await addSource($, { kind: 'note', title, text, url: null, path: null })
  return clearInput($, 'Added a note. Open it to rename it or add more.')
}

// The macOS file dialog, run through osascript on the machine Claude Code
// runs on: the picked paths, [] when the person cancels, null when there is
// no dialog to show (not macOS, or osascript failed).
async function pickPaths($: $, kind: 'file' | 'folder'): Promise<string[] | null> {
  const top = (await $.session.root()).replace(/"/g, '')
  const chooser =
    kind === 'file'
      ? `choose file with prompt "Add files to Craftshop context" default location (POSIX file "${top}") with multiple selections allowed`
      : `choose folder with prompt "Add folders to Craftshop context" default location (POSIX file "${top}") with multiple selections allowed`
  const ran = await $.process
    .run(['osascript', '-e', 'activate', '-e', `set picked to ${chooser}`, '-e', 'set out to ""', '-e', 'repeat with one in picked', '-e', 'set out to out & POSIX path of one & linefeed', '-e', 'end repeat', '-e', 'return out'], { timeoutMs: 600_000 })
    .catch(() => null)
  if (ran === null) return null
  if (ran.exitCode !== 0) return /-128/.test(ran.stderr) ? [] : null
  return ran.stdout
    .split('\n')
    .map(line => line.trim().replace(/\/$/, ''))
    .filter(line => line !== '')
}

// A path as a source keeps it: relative to the checkout when inside it.
function relativePath(top: string, path: string): string {
  return path.startsWith(`${top}/`) ? path.slice(top.length + 1) : path
}

// Set before the first await, so a second press while the dialog is coming
// up (it can take a few seconds) is dropped rather than opening another.
let isPicking = false

async function choose($: $, kind: 'file' | 'folder'): Promise<void> {
  if (isPicking) return
  isPicking = true
  try {
    await setView($, { picking: kind })
    await say($, 'Waiting for the file dialog. It can take a moment to open, sometimes behind this window.')
    await addPicked($, kind, await pickPaths($, kind))
  } finally {
    isPicking = false
    await setView($, { picking: null })
  }
}

async function addPicked($: $, kind: 'file' | 'folder', picked: string[] | null): Promise<void> {
  if (picked === null) return say($, 'Could not open the file dialog here. Type a path in the field instead.')
  if (picked.length === 0) return say($, '')
  const top = await $.session.root()
  const added: string[] = []
  for (const path of picked) {
    if (kind === 'folder') {
      await importDirectory($, path, relativePath(top, path))
      added.push(relativePath(top, path))
      continue
    }
    const body = await readText($, path).catch(() => null)
    if (body === null || body.includes('\u0000')) {
      await say($, `Skipped ${path.split('/').pop()}: only text files can be sources.`)
      continue
    }
    await addSource($, { kind: 'file', title: path.split('/').pop() ?? path, text: body, url: null, path: relativePath(top, path) })
    added.push(path.split('/').pop() ?? path)
  }
  if (kind === 'file' && added.length > 0) await say($, `Added ${added.join(', ')}`)
}

async function clearInput($: $, status: string): Promise<void> {
  await update($, contextDraft, now => ({ ...now, input: '' }))
  await say($, status)
}

async function importDirectory($: $, directory: string, path: string): Promise<void> {
  const top = await $.session.root()
  const files = await textFiles($, directory)
  if (files.length === 0) return say($, `No text files under ${path}.`)
  const folder: Folder = { id: await newId($), name: path.split('/').pop() || path }
  const added: Source[] = []
  for (const file of files) {
    added.push({
      id: await newId($),
      kind: 'file',
      title: file.split('/').pop() ?? file,
      text: await readText($, file),
      url: null,
      path: relativePath(top, file),
      mode: 'guidance',
      folderId: folder.id,
    })
  }
  await update($, folders, list => [...list, folder])
  await saveSources($, list => [...list, ...added])
  await updateView($, now => ({ ...now, openFolders: [...now.openFolders, folder.id] }))
  await clearInput($, `Added ${path} as a folder of ${files.length} files`)
}

async function addFolder($: $, raw: string): Promise<void> {
  const name = raw.trim()
  if (name === '') return setView($, { isNamingFolder: false })
  const folder: Folder = { id: await newId($), name }
  await update($, folders, list => [...list, folder])
  await save($)
  await update($, contextDraft, now => ({ ...now, name: '' }))
  await setView($, { isNamingFolder: false, target: folder.id })
  await updateView($, now => ({ ...now, openFolders: [...now.openFolders, folder.id] }))
  await say($, `Made ${name}. New sources go into ${name} until you pick another folder.`)
}

async function refresh($: $, source: Source): Promise<void> {
  await say($, `Refreshing ${source.title}`)
  let text: string | null = null
  if (source.kind === 'link' && source.url !== null) {
    const page = await fetchLink($, source.url)
    if (typeof page === 'string') return say($, page)
    text = page.text
  } else if (source.kind === 'file' && source.path !== null) {
    const file = source.path.startsWith('/') ? source.path : `${await $.session.root()}/${source.path}`
    text = await readText($, file).catch(() => null)
  }
  if (text === null) return say($, `Could not refresh ${source.title}.`)
  await saveSources($, list => list.map(one => (one.id === source.id ? { ...one, text: text! } : one)))
  await say($, `Refreshed ${source.title}`)
}

async function setMode($: $, id: string, mode: SourceMode): Promise<void> {
  await saveSources($, list => list.map(one => (one.id === id ? { ...one, mode } : one)))
}

// A folder's switch: everything on (strict members stay strict), or all off.
async function setFolderOn($: $, folderId: string, isOn: boolean): Promise<void> {
  await saveSources($, list =>
    list.map(one => (one.folderId !== folderId ? one : { ...one, mode: isOn ? (one.mode === 'off' ? 'guidance' : one.mode) : 'off' })),
  )
}

async function moveSource($: $, id: string, folderId: string | null): Promise<void> {
  await saveSources($, list => list.map(one => (one.id === id ? { ...one, folderId } : one)))
  if (folderId !== null) await updateView($, now => ({ ...now, openFolders: [...new Set([...now.openFolders, folderId])] }))
}

async function renameSource($: $, id: string, title: string): Promise<void> {
  if (title.trim() === '') return
  await saveSources($, list => list.map(one => (one.id === id ? { ...one, title: title.trim() } : one)))
}

async function editNote($: $, id: string, text: string): Promise<void> {
  await saveSources($, list => list.map(one => (one.id === id ? { ...one, text } : one)))
  await setView($, { isEditingText: false })
}

async function removeSource($: $, id: string): Promise<void> {
  await saveSources($, list => list.filter(one => one.id !== id))
  await setView($, { openId: null })
}

async function renameFolder($: $, id: string, name: string): Promise<void> {
  if (name.trim() !== '') await update($, folders, list => list.map(one => (one.id === id ? { ...one, name: name.trim() } : one)))
  await save($)
  await setView($, { renamingFolder: null })
}

async function deleteFolder($: $, id: string, isKeepingSources: boolean): Promise<void> {
  await update($, sources, list =>
    isKeepingSources ? list.map(one => (one.folderId === id ? { ...one, folderId: null } : one)) : list.filter(one => one.folderId !== id),
  )
  await update($, folders, list => list.filter(one => one.id !== id))
  await save($)
  await updateView($, now => ({ ...now, deletingFolder: null, target: now.target === id ? null : now.target, openFolders: now.openFolders.filter(one => one !== id) }))
}

async function toggleFolderOpen($: $, id: string): Promise<void> {
  await updateView($, now => ({
    ...now,
    openFolders: now.openFolders.includes(id) ? now.openFolders.filter(one => one !== id) : [...now.openFolders, id],
  }))
}

export function registerContext(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await read($, tab)) !== 'context') return next(e)
    const ui: Ui = resolveUi($.ui.resolve(e), e.surface)
    const { Box, Text, Button, Input, Select, Markdown } = ui
    const rich = isRich(ui)
    const list = await read($, sources)
    const groups = await read($, folders)
    const view = await readView($)
    const draft = await read($, contextDraft)
    const status = await read($, contextStatus)
    const columns = e.props.bodyColumns
    const go = (change: Partial<ContextView>) => () => void setView($, change)

    const sharedList = list.filter(one => one.mode !== 'off')
    const sharedChars = sharedList.reduce((sum, one) => sum + one.text.length, 0)
    const sharedTokens = approxTokens(sharedChars)
    const isOver = sharedTokens > TOKEN_BUDGET
    const loose = list.filter(one => one.folderId === null)
    const targetName = view.target === null ? null : (groups.find(one => one.id === view.target)?.name ?? null)
    const isThin = (source: Source) => source.kind === 'link' && source.text.length < 200

    // On/Off is the main switch, drawn the same for a source and a folder.
    const onOff = (key: string, state: 'on' | 'off' | 'some', onPress: () => void) => (
      <Button key={key} onPress={onPress}>
        {state === 'on' ? (
          <Text color="success" bold>
            ● On
          </Text>
        ) : state === 'some' ? (
          <Text color="warning" bold>
            ◐ Some on
          </Text>
        ) : (
          <Text dimColor>○ Off</Text>
        )}
      </Button>
    )

    const sourceRow = (source: Source, isNested: boolean) => {
      const isOn = source.mode !== 'off'
      const isOpen = view.openId === source.id
      const moveOptions = [{ value: '', label: 'No folder' }, ...groups.map(one => ({ value: one.id, label: one.name }))]
      const parts = [
              <Box justifyContent="space-between" alignItems="center" gap={1}>
                <Box gap={1} alignItems="center" flexShrink={1}>
                  {onOff(`toggle-${source.id}`, isOn ? 'on' : 'off', () => void setMode($, source.id, isOn ? 'off' : 'guidance'))}
                  {rich ? svg(ui, glyph(source.kind), source.kind, 18, 18) : <Text color={GLYPH_COLOR[source.kind]}>{KIND_MARK[source.kind]}</Text>}
                  <Button key={`open-${source.id}`} plain onPress={go({ openId: isOpen ? null : source.id, isEditingText: false })}>
                    <Text dimColor>{isOpen ? '▾ ' : '▸ '}</Text>
                    <Text bold dimColor={!isOn}>
                      {shorten(source.title, Math.max(20, columns - (isNested ? 52 : 46)))}
                    </Text>
                  </Button>
                </Box>
                <Box gap={1} alignItems="center" flexShrink={0}>
                  <Text dimColor>{facts(source).replace(/^\w+ · /, '')}</Text>
                  {isThin(source) && <Text color="warning">may be empty</Text>}
                  {isOn && (
                    <Button key={`strict-${source.id}`} plain onPress={() => void setMode($, source.id, source.mode === 'strict' ? 'guidance' : 'strict')}>
                      {source.mode === 'strict' ? chip(ui, 'Strict', 'suggestion') : <Text dimColor>Make strict</Text>}
                    </Button>
                  )}
                </Box>
              </Box>,
              isOpen && (
                <Box flexDirection="column" gap={1} marginTop={1}>
                  {card(
                    ui,
                    `preview-${source.id}`,
                    [
                      source.kind === 'file' && /\.mdx?$/i.test(source.path ?? '') ? (
                        <Markdown key={`text-${source.id}`} text={source.text.slice(0, 1_500)} />
                      ) : (
                        <Text wrap="wrap">{source.text.slice(0, 1_500) || 'No readable text.'}</Text>
                      ),
                      source.text.length > 1_500 && <Text dimColor>… {chars(source.text.length - 1_500)} more reach the agent</Text>,
                    ],
                    { tone: 'muted' },
                  )}
                  {view.isEditingText && source.kind === 'note' && Input !== undefined && (
                    <Input key={`edit-text-${source.id}`} label="Text " value={source.text} submitLabel="save" autoFocus onSubmit={value => void editNote($, source.id, value)} />
                  )}
                  <Box gap={1} alignItems="center" flexWrap="wrap">
                    {Input !== undefined && (
                      <Box flexGrow={1}>
                        <Input key={`rename-source-${source.id}`} label="Title " value={source.title} submitLabel="rename" onSubmit={value => void renameSource($, source.id, value)} />
                      </Box>
                    )}
                    {Select !== undefined && (
                      <Select key={`move-${source.id}`} label="Folder " options={moveOptions} value={source.folderId ?? ''} onSelect={value => void moveSource($, source.id, value === '' ? null : value)} />
                    )}
                  </Box>
                  <Box gap={1} justifyContent="flex-end" alignItems="center">
                    <Box flexGrow={1}>
                      <Text dimColor>
                        {!isOn ? 'Off: hidden from the agent.' : source.mode === 'strict' ? 'Strict: the agent must follow it.' : 'On: the agent weighs it.'}
                      </Text>
                    </Box>
                    {source.kind === 'note' && Input !== undefined && (
                      <Button key={`edit-text-start-${source.id}`} label={view.isEditingText ? 'Done' : 'Edit text'} dimColor onPress={go({ isEditingText: !view.isEditingText })} />
                    )}
                    {source.kind !== 'note' && <Button key={`refresh-${source.id}`} label="Refresh" dimColor onPress={() => void refresh($, source)} />}
                    <Button key={`remove-${source.id}`} onPress={() => void removeSource($, source.id)}>
                      <Text color="error">Delete</Text>
                    </Button>
                  </Box>
                </Box>
              ),
            ]
      return isNested ? (
        <Box key={`row-${source.id}`} flexDirection="column" marginTop={1} paddingLeft={2}>
          {parts}
        </Box>
      ) : (
        card(ui, `row-card-${source.id}`, parts, { tone: source.mode === 'strict' ? 'accent' : isOn ? 'plain' : 'muted' })
      )
    }

    const folderBlock = (folder: Folder) => {
      const members = list.filter(one => one.folderId === folder.id)
      const onCount = members.filter(one => one.mode !== 'off').length
      const state = members.length === 0 || onCount === 0 ? 'off' : onCount === members.length ? 'on' : 'some'
      const isOpen = view.openFolders.includes(folder.id)
      const isMenuOpen = view.menuFolder === folder.id
      return card(
        ui,
        `folder-card-${folder.id}`,
        [
          <Box justifyContent="space-between" alignItems="center" gap={1}>
            <Box gap={1} alignItems="center" flexShrink={1}>
              <Button key={`fold-${folder.id}`} plain onPress={() => void toggleFolderOpen($, folder.id)}>
                <Text dimColor>{isOpen ? '▾ ' : '▸ '}</Text>
                <Text bold>{folder.name}</Text>
                <Text dimColor>
                  {members.length === 0 ? '  empty' : `  ${members.length} ${members.length === 1 ? 'source' : 'sources'} · ${onCount} on`}
                </Text>
              </Button>
              {rich && svg(ui, glyph('folder'), 'folder', 18, 18)}
            </Box>
            <Box gap={1} alignItems="center" flexShrink={0}>
              {members.length > 0 && onOff(`folder-toggle-${folder.id}`, state, () => void setFolderOn($, folder.id, state !== 'on'))}
              <Button key={`folder-menu-${folder.id}`} label="⋯" dimColor onPress={go({ menuFolder: isMenuOpen ? null : folder.id, renamingFolder: null, deletingFolder: null })} />
            </Box>
          </Box>,
          isMenuOpen && (
            <Box gap={1} justifyContent="flex-end" marginTop={1}>
              <Button key={`folder-rename-${folder.id}`} label="Rename" dimColor onPress={go({ renamingFolder: folder.id, deletingFolder: null })} />
              <Button key={`folder-delete-${folder.id}`} onPress={go({ deletingFolder: folder.id, renamingFolder: null })}>
                <Text color="error">Delete folder</Text>
              </Button>
            </Box>
          ),
          view.renamingFolder === folder.id && Input !== undefined && (
            <Box marginTop={1}>
              <Input key="rename-folder" label="Name " value={folder.name} submitLabel="rename" autoFocus onSubmit={value => void renameFolder($, folder.id, value)} />
            </Box>
          ),
          view.deletingFolder === folder.id && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text>
                Delete <Text bold>{folder.name}</Text>? <Text dimColor>The agent stops receiving its {members.length} sources.</Text>
              </Text>
              <Box gap={1} justifyContent="flex-end" flexWrap="wrap">
                <Button key="delete-cancel" label="Cancel" dimColor onPress={go({ deletingFolder: null, menuFolder: null })} />
                <Button key="delete-folder-keep" label="Keep its sources" onPress={() => void deleteFolder($, folder.id, true)} />
                <Button key="delete-folder" label="Delete folder and sources" variant="primary" onPress={() => void deleteFolder($, folder.id, false)} />
              </Box>
            </Box>
          ),
          ...(isOpen ? members.map(source => sourceRow(source, true)) : []),
          isOpen && members.length === 0 && (
            <Box marginTop={1} paddingLeft={2}>
              <Text dimColor>Pick {folder.name} in "to" above and add a source, or move one in from its details.</Text>
            </Box>
          ),
        ],
        { tone: view.deletingFolder === folder.id ? 'danger' : state === 'off' ? 'muted' : 'plain' },
      )
    }

    const targetOptions = [{ value: '', label: 'No folder' }, ...groups.map(one => ({ value: one.id, label: one.name }))]
    const isWarning = /^(Could|That link|No text|Skipped)/.test(status)
    const adder = (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
          <Box gap={1} alignItems="center" flexWrap="wrap">
            <Button
              key="pick-files"
              label={view.picking === 'file' ? 'Choosing…' : 'Choose files…'}
              variant={view.picking === null ? 'primary' : undefined}
              dimColor={view.picking !== null}
              onPress={() => void choose($, 'file')}
            />
            <Button
              key="pick-folder"
              label={view.picking === 'folder' ? 'Choosing…' : 'Choose folder…'}
              dimColor={view.picking !== null}
              onPress={() => void choose($, 'folder')}
            />
            <Button key="folder-new" label="New folder" variant={view.isNamingFolder ? 'secondary' : undefined} dimColor={!view.isNamingFolder} onPress={go({ isNamingFolder: !view.isNamingFolder })} />
          </Box>
          {Select !== undefined && groups.length > 0 && (
            <Select key="add-target" label="Into " options={targetOptions} value={view.target ?? ''} onSelect={value => void setView($, { target: value === '' ? null : value })} />
          )}
        </Box>
        {view.isNamingFolder && Input !== undefined && (
          <Box gap={1} alignItems="center">
            <Input key="folder-name" placeholder="Folder name, e.g. Payments" value={draft.name} submitLabel="create" autoFocus onInput={value => void update($, contextDraft, now => ({ ...now, name: value }))} onSubmit={value => void addFolder($, value)} />
            <Button key="folder-cancel" label="Cancel" dimColor onPress={go({ isNamingFolder: false })} />
          </Box>
        )}
        {Input !== undefined && (
          <Input
            key="add-input"
            placeholder="Or paste a link, or write a note"
            value={draft.input}
            submitLabel="add"
            onInput={value => void update($, contextDraft, now => ({ ...now, input: value }))}
            onSubmit={value => void addFromInput($, value)}
          />
        )}
        {(status !== '' || targetName !== null) && (
          <Text color={isWarning ? 'warning' : undefined} dimColor={!isWarning}>
            {status !== '' ? status : `New sources go into ${targetName}.`}
          </Text>
        )}
      </Box>
    )

    const meter = (
      <Box justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
        <Box gap={1} alignItems="center">
          {rich ? (
            svg(ui, tickMeter(list.length === 0 ? 0 : sharedList.length / list.length, 160), `${sharedList.length} of ${list.length} on`, 160, 10)
          ) : (
            <Text color="success">{bar(list.length === 0 ? 0 : sharedList.length / list.length, 16)}</Text>
          )}
          <Text>
            <Text bold>{sharedList.length}</Text>
            <Text dimColor> of </Text>
            <Text bold>{list.length}</Text>
            <Text dimColor> sources on</Text>
          </Text>
        </Box>
        <Text color={isOver ? 'error' : undefined} dimColor={!isOver}>
          about {tokens(sharedTokens)} of {tokens(TOKEN_BUDGET)} tokens{isOver ? ' · over budget, switch some off' : ''}
        </Text>
      </Box>
    )

    const isEmpty = list.length === 0 && groups.length === 0
    return frame(
      ui,
      'context',
      columns,
      (id: Tab) => void update($, tab, () => id),
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Context the agent reads</Text>
          <Text dimColor>Sources that are On go into every request. Group them in folders and switch a folder at once.</Text>
        </Box>
        {adder}
        {!isEmpty && meter}
        {isEmpty ? (
          card(
            ui,
            'empty',
            [
              <Box gap={2} alignItems="center">
                {svg(ui, folderArt(0, 0, 120, 70), 'An empty folder', 120, 70)}
                <Box flexDirection="column" flexShrink={1}>
                  <Text bold>No sources yet</Text>
                  <Text dimColor>Choose files or a folder from your Mac, paste a link to your API docs, or write a note like "Amounts are integer cents".</Text>
                </Box>
              </Box>,
            ],
            { tone: 'muted' },
          )
        ) : (
          <Box flexDirection="column" gap={rich ? 1 : 0}>
            {groups.map(folderBlock)}
            {loose.map(source => sourceRow(source, false))}
          </Box>
        )}
        {!isEmpty && (await drawWindow($, ui, columns))}
      </Box>,
    )
  })
}

const FILL_HEX: Record<string, string> = { success: '#3fb6a8', warning: '#d6a24a', error: '#e5534b' }

const KIND_MARK: Record<Source['kind'], string> = { note: '¶', link: '↗', file: '▢' }

// The live context window, folded to one line under the library.
async function drawWindow($: $, ui: Ui, columns: number) {
  const { Box, Text, Button } = ui
  // Reading isTurnRunning redraws the tab as each turn starts and ends, so
  // the window figures below are read fresh then.
  const isRunning = await read($, isTurnRunning)
  const isShown = await read($, isWindowShown)
  const usage = await $.session.usage({ breakdown: 'summary' })
  const breakdown = usage.context.breakdown
  const used = breakdown?.totalTokens ?? usage.context.tokens ?? 0
  const window = breakdown?.rawMaxTokens ?? usage.context.window
  const percent = breakdown?.percentage ?? usage.context.percent ?? 0
  const categories = (breakdown?.categories ?? []).filter(one => one.kind === 'used' && one.tokens > 0)
  const last = breakdown?.apiUsage ?? null
  const barWidth = Math.max(10, Math.min(30, columns - 50))
  return card(
    ui,
    'window',
    [
      <Box justifyContent="space-between" alignItems="center" gap={1}>
        <Box gap={1} alignItems="center" flexShrink={1}>
          <Text dimColor>Context window</Text>
          {isRich(ui) ? (
            svg(ui, track(percent / 100, Math.max(120, (columns - 52) * 8), FILL_HEX[fillColor(percent)]), `${percent}% of the context window`, Math.max(120, (columns - 52) * 8), 6)
          ) : (
            <Text color={fillColor(percent)}>{bar(percent / 100, barWidth)}</Text>
          )}
          <Text>
            <Text bold>{percent}%</Text>
            <Text dimColor> · {tokens(used)} of {tokens(window)}</Text>
          </Text>
        </Box>
        <Box gap={1}>
          <Button key="window-details" label={isShown ? 'Hide' : 'Details'} dimColor onPress={() => void update($, isWindowShown, now => !now)} />
          {!isRunning && <Button key="usage-compact" label="Compact" dimColor onPress={() => void $.session.compact({})} />}
        </Box>
      </Box>,
      ...(isShown
        ? categories.map(category => (
            <Text>
              <Text dimColor>{category.name.slice(0, 18).padEnd(19)}</Text>
              {tokens(category.tokens).padStart(6)} <Text color="promptBorder">{bar(category.tokens / Math.max(1, used), 12)}</Text>
            </Text>
          ))
        : []),
      isShown && last !== null && (
        <Text dimColor>
          Last response: in {tokens(last.input_tokens)} · out {tokens(last.output_tokens)} · cache read {tokens(last.cache_read_input_tokens)} · cache write{' '}
          {tokens(last.cache_creation_input_tokens)}
          {usage.cost === undefined ? '' : ` · session $${usage.cost.usd.toFixed(2)}`}
        </Text>
      ),
    ],
    { tone: 'muted' },
  )
}
