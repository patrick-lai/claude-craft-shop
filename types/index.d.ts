export type Tab = 'worktree' | 'dials' | 'context' | 'api'

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

export type Source = {
  id: string
  kind: 'note' | 'link'
  title: string
  text: string
  url: string | null
  mode: SourceMode
}

export type NoteDraft = { title: string; text: string }

export type Exchange = {
  id: string
  actor: 'you' | 'agent'
  method: string
  path: string
  url: string
  status: number | null
  ms: number
  isPass: boolean
  expectStatus: number | null
  request: string
  response: string
}

export type ApiParam = { name: string; in: string; isRequired: boolean; type: string }

export type ApiOp = {
  id: string
  method: string
  path: string
  tag: string
  summary: string
  params: ApiParam[]
  example: string | null
  responses: { status: string; description: string }[]
}

export type ApiLens = 'reference' | 'send' | 'log'

export type SendDraft = { method: string; path: string; body: string }

declare module 'claude-code' {
  interface PluginState {
    'craft-shop': {
      tab: Tab
      worktree: Worktree
      slots: Slot[]
      isTurnRunning: boolean
      isBandHidden: boolean
      isHeadStartPrompted: boolean
      toldStyle: string | null
      dials: DialValues
      selectedDial: DialKey | null
      isBriefShown: boolean
      sources: Source[]
      noteDraft: NoteDraft
      linkStatus: string
      exchanges: Exchange[]
      apiLens: ApiLens
      selectedOp: string | null
      selectedExchange: string | null
      ops: ApiOp[]
      specStatus: string
      isApiUp: boolean | null
      sendDraft: SendDraft
    }
  }
}
