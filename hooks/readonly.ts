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
