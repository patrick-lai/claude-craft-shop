// A port of CommissionAI's read_only_shell (service/src/threads.rs): a shell
// command passes only when every segment is an allowlisted read.

const READ_ONLY_PROGRAMS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'rg', 'grep', 'egrep', 'fgrep', 'pwd', 'echo', 'printf',
  'stat', 'file', 'tree', 'du', 'df', 'which', 'basename', 'dirname', 'realpath', 'readlink',
  'date', 'true', 'sort', 'cut', 'tr', 'jq', 'nl', 'cd',
])
const READ_ONLY_GIT = new Set([
  'status', 'log', 'diff', 'show', 'ls-files', 'ls-tree', 'rev-parse', 'grep', 'blame',
  'describe', 'cat-file',
])
const FIND_WRITES = [
  '-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls',
]

export function isReadOnlyShell(command: string): boolean {
  const segments = shellSegments(command.trim())
  return segments !== null && segments.length > 0 && segments.every(isReadOnlyWords)
}

function isReadOnlyWords(words: string[]): boolean {
  const [program, ...args] = words
  if (program === undefined) return false
  const isFlagged = (flags: string[]) =>
    args.some(arg => flags.some(flag => arg === flag || arg.startsWith(`${flag}=`)))

  switch (program) {
    case 'git': {
      let index = 0
      while (args[index] === '-C' || args[index] === '--no-pager') {
        index += args[index] === '-C' ? 2 : 1
      }
      const subcommand = args[index]
      return (
        subcommand !== undefined &&
        READ_ONLY_GIT.has(subcommand) &&
        !isFlagged(['--output', '--ext-diff', '--textconv'])
      )
    }
    case 'find':
      return !isFlagged(FIND_WRITES)
    case 'sed': {
      const isScriptOnly = !args.some(
        arg => arg.startsWith('-i') || arg.startsWith('--in-place') || arg === '-e' || arg === '-f',
      )
      const script = args.find(arg => !arg.startsWith('-'))
      return (
        args.includes('-n') &&
        isScriptOnly &&
        (script === undefined || /^[\d,$p]+$/.test(script))
      )
    }
    case 'sort':
      return !isFlagged(['-o', '--output'])
    case 'tree':
      return !isFlagged(['-o'])
    case 'file':
      return !isFlagged(['-C', '--compile'])
    case 'date':
      return !isFlagged(['-s', '--set'])
    case 'rg':
      return !isFlagged(['--pre'])
    default:
      return READ_ONLY_PROGRAMS.has(program)
  }
}

// Splits on `;`, `&&`, `||`, `|` and newlines into argv lists. Returns null
// for anything it cannot read safely: substitution, subshells, a lone `&`,
// input redirection, output redirection other than to /dev/null or a merge
// of stdout/stderr, and a leading `VAR=` assignment.
function shellSegments(command: string): string[][] | null {
  const chars = [...command]
  const segments: string[][] = [[]]
  let word = ''
  let isOpen = false
  const finish = () => {
    if (isOpen) segments[segments.length - 1]!.push(word)
    word = ''
    isOpen = false
  }

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!
    const following = chars[index + 1]
    switch (char) {
      case "'": {
        const end = chars.indexOf("'", index + 1)
        if (end === -1) return null
        word += chars.slice(index + 1, end).join('')
        isOpen = true
        index = end
        break
      }
      case '"': {
        let cursor = index + 1
        for (;;) {
          const inner = chars[cursor]
          if (inner === undefined || inner === '`') return null
          if (inner === '"') break
          if (inner === '$' && chars[cursor + 1] === '(') return null
          if (inner === '\\') {
            const escaped = chars[cursor + 1]
            if (escaped === undefined) return null
            word += escaped
            cursor += 1
          } else {
            word += inner
          }
          cursor += 1
        }
        isOpen = true
        index = cursor
        break
      }
      case '\\':
        if (following === undefined) return null
        word += following
        isOpen = true
        index += 1
        break
      case ' ':
      case '\t':
        finish()
        break
      case '>': {
        if (!['', '1', '2', '&'].includes(word)) return null
        word = ''
        isOpen = false
        const rest = chars.slice(index + 1).join('')
        const target = rest.trimStart()
        const skipped = rest.length - target.length
        const taken = target.startsWith('&1') || target.startsWith('&2')
          ? 2
          : target.startsWith('/dev/null')
            ? 9
            : -1
        if (taken === -1) return null
        index += skipped + taken
        break
      }
      case ';':
      case '|':
      case '&':
      case '\n':
        finish()
        if (char === '&' && following !== '&') return null
        if ((following === '&' || following === '|') && char !== ';' && char !== '\n') index += 1
        segments.push([])
        break
      case '`':
      case '<':
      case '(':
      case ')':
      case '{':
      case '}':
        return null
      case '$':
        if (following === '(') return null
        word += char
        isOpen = true
        break
      default:
        word += char
        isOpen = true
    }
  }
  finish()

  const filled = segments.filter(words => words.length > 0)
  return filled.every(words => !words[0]!.includes('=')) ? filled : null
}

// A branch a shell command would check out (git checkout or switch, one it
// makes with -b, -B, -c or -C too), with the folder it runs in when the
// command names one absolutely (git -C, or an earlier cd); null is the
// session's own. A detach, a checkout of files and a start point take none.
export type CheckedOut = { branch: string; dir: string | null }

const CREATE_FLAGS = new Set(['-b', '-B', '-c', '-C', '--create', '--force-create', '--orphan'])
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

export function checkedOutBranches(command: string): CheckedOut[] {
  const segments =
    shellSegments(command.trim()) ??
    command.split(/[;&|\n]+/).map(part => part.trim().split(/\s+/).filter(word => word !== ''))
  const found: CheckedOut[] = []
  let cwd: string | null = null
  for (const words of segments) {
    if (words[0] === 'cd') {
      const to = words[1]
      if (to !== undefined && to.startsWith('/')) cwd = to
      continue
    }
    const one = checkoutOf(words)
    if (one !== null) found.push({ branch: one.branch, dir: one.dir ?? cwd })
  }
  return found
}

function checkoutOf(words: string[]): { branch: string; dir: string | null } | null {
  if (words[0] !== 'git') return null
  let dir: string | null = null
  let index = 1
  while (words[index]?.startsWith('-')) {
    if (words[index] === '-C' && words[index + 1]?.startsWith('/')) dir = words[index + 1]!
    index += GIT_VALUE_FLAGS.has(words[index]!) ? 2 : 1
  }
  const subcommand = words[index]
  if (subcommand !== 'checkout' && subcommand !== 'switch') return null
  let args = words.slice(index + 1)
  if (args.includes('--detach') || (subcommand === 'switch' && args.includes('-d'))) return null
  const dash = args.indexOf('--')
  if (dash !== -1) {
    // Files after `--` are restored, not switched to.
    if (dash < args.length - 1) return null
    args = args.slice(0, dash)
  }
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!
    if (CREATE_FLAGS.has(arg)) return args[at + 1] === undefined ? null : { branch: args[at + 1]!, dir }
    const inline = /^--(?:create|force-create|orphan)=(.+)$/.exec(arg)
    if (inline !== null) return { branch: inline[1]!, dir }
  }
  const targets = args.filter(arg => !arg.startsWith('-'))
  // `git checkout <tree> <file>…` restores files too.
  if (targets.length !== 1) return null
  return { branch: targets[0]!, dir }
}
