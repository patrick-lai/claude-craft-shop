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

export type Slot = { path: string; branch: string | null; isLeased: boolean; isMine: boolean }

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
// details, which folder new sources go into, and which form or confirmation
// shows.
export type ContextView = {
  openFolders: string[]
  openId: string | null
  target: string | null
  isNamingFolder: boolean
  menuFolder: string | null
  renamingFolder: string | null
  deletingFolder: string | null
  isEditingText: boolean
}

export type ContextDraft = { input: string; name: string }

declare module 'claude-code' {
  interface PluginState {
    'craft-shop': {
      tab: Tab
      worktree: Worktree
      slots: Slot[]
      isTurnRunning: boolean
      isBandHidden: boolean
      isStepsShown: boolean
      isHeadStartPrompted: boolean
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
    }
  }
}
