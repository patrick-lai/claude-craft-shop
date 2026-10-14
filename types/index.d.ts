export type Tab = 'worktree' | 'dials' | 'context'

export type WorktreePhase = 'off' | 'preparing' | 'ready' | 'failed'

export type WorktreeStep = { label: string; at: number; isWarning: boolean }

export type Worktree = {
  phase: WorktreePhase
  step: string
  steps: WorktreeStep[]
  main: string | null
  path: string | null
  branch: string | null
  base: string | null
  baseSha: string | null
  error: string | null
}

// Autopilot's answer for a person who is away, as the rail shows it: a
// question waiting until its deadline, then what was picked for it.
export type AutopilotWait =
  | { kind: 'waiting'; since: number; deadline: number; picked: string; count: number }
  | { kind: 'answered'; at: number; picked: string; waitedMs: number }

export type Slot = {
  path: string
  branch: string | null
  isLeased: boolean
  isMine: boolean
  // While the pool makes it: what it is doing now; null once it is ready.
  setup: string | null
  isRemoving: boolean
}

export type DialKey = 'foresight' | 'crew' | 'tenacity' | 'autonomy' | 'proof' | 'voice'

export type DialValues = Record<DialKey, number>

export type SourceMode = 'off' | 'guidance' | 'strict'

export type SourceKind = 'note' | 'link' | 'file'

export type Source = {
  id: string
  kind: SourceKind
  title: string
  text: string
  url: string | null
  // A file's path, relative to the checkout's top.
  path: string | null
  mode: SourceMode
  folderId: string | null
}

export type Folder = { id: string; name: string }

// Where the Context tab is: which folders are open, which source shows its
// details, which file dialog or confirmation shows.
export type ContextView = {
  openFolders: string[]
  openId: string | null
  // Which file dialog is open, while one is.
  picking: 'file' | 'folder' | null
  deletingFolder: string | null
  isEditingText: boolean
}

export type ContextDraft = { input: string }

declare module 'claude-code' {
  interface PluginState {
    'fishstack': {
      tab: Tab
      worktree: Worktree
      slots: Slot[]
      poolNote: string
      // The slot whose Remove waits for a second press, by path.
      slotAsk: string | null
      elsewhere: string | null
      railTick: number
      autopilot: AutopilotWait | null
      isTurnRunning: boolean
      isDialsOn: boolean
      isEnforced: boolean
      isContextOn: boolean
      lastReplyAt: number | null
      tokenTotals: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null
      isStepsShown: boolean
      isHeadStartPrompted: boolean
      // A terminal session in the main checkout was asked where it works:
      // once per session, so a reload does not ask again.
      isWhereAsked: boolean
      // Where the session moved mid-turn with no head start told: the note the
      // agent is owed at its next batch or prompt.
      owedMoveNote: string | null
      toldStyle: string | null
      dials: DialValues
      selectedDial: DialKey | null
      isBriefShown: boolean
      sources: Source[]
      folders: Folder[]
      contextView: ContextView
      contextDraft: ContextDraft
      contextStatus: string
      isWindowShown: boolean
      // A Client failed on a surface (ui.fault): drawn controls fall back to
      // Buttons until the next load.
      isClientDown: boolean
    }
  }
}
