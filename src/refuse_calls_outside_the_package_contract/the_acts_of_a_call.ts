// What act a tool call is, in the words a package's contract allows (martha#513 slice 2).
//
// This exists so a contract's `allowed` line can be held against every tool call without the gate knowing what a host
// calls its tools. The table is closed: a call that is not on it is not an act, and no contract refuses it. Every act is
// read from what the call itself says, never from a name given to it — the same rule the shell gate reads text by.
//
//   land     the crew's own tools that move the default branch, under whatever name the host calls them by
//   push     a shell command that runs `git push`, wherever in its words that sits
//   tag      a shell command that runs `git tag`; `git push --tags` is both, and needs both allowed
//   handoff  a message whose first line readACrewLine reads as a HANDOFF for the package this member holds
//
// A push is read wherever `git` appears rather than only where a command begins: a member writes it as the last line of
// a script, behind `cd x&&`, inside `( )`, after an `&`, behind an assignment or behind git's own `-C` and `-c`. Reading
// only a command's first word missed every one of those. The cost is the other way round: `echo git push` is read as a
// push and refused, where the quoted `echo "git push"` is one word and no act at all. A refusal that is too eager is
// recoverable; one that is too shy is not, so the table errs towards refusing. `sh -c "git push"` and `eval` stay out:
// a word the reader cannot take apart is a word it does not guess at.
//
// Writing a handover is deliberately not an act and is never refused: it is how a member outlives its context, and a
// contract that could refuse it could trap a member whose context runs out (martha#513 slice 2, Mercurius's ruling).

import { CONTRACT_ACTIONS, type ContractAction } from '../keep_the_package_contract/the_contract_in_a_brief.ts'
import { FAST_FORWARD_AFTER_THE_OWNERS_YES, LAND, LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { readACrewLine } from '../read_a_crew_line/read_a_crew_line.ts'
import { isShellTool } from '../shell_tools/shell_tools.ts'

/** The acts a contract's `allowed` line may name: slice 1's own list, so the two vocabularies cannot drift apart. */
export const CONTRACT_ACTS = CONTRACT_ACTIONS
export type AContractAct = ContractAction

/** A call as the act table reads it: the tool it names, and the arguments it carries. */
export interface AReadableCall {
  readonly tool: string
  readonly input?: Readonly<Record<string, unknown>> | undefined
}

/**
 * The name a tool's own server gave it (`host_contract.ts`'s ownNameOf): a land arrives as `land_batch` under one host
 * and `mcp__martha__land_batch` under another, so the table asks the host rather than spelling either. A caller with no
 * split of its own says the called name is the own one.
 */
export type TheOwnNameOf = (called: string) => string

/** The default split: the name a call arrives under is the tool's own, which is right for a host with no server names. */
const itsOwnName: TheOwnNameOf = (called) => called

/** The characters that end one command and begin the next, each a word of its own once it is spaced from its neighbours. */
const A_SEPARATOR = new Set([';', '&', '|', '(', ')'])

/**
 * The command with every separator spaced from its neighbours, `&&` and `||` as one each: `cd x&&git push` reads as
 * `cd x && git push`. Spacing a separator inside a quote changes nothing the table reads — a quoted run stays one word.
 */
const withTheSeparatorsSpaced = (command: string): string => command.replace(/(&&|\|\||[;&|()])/g, ' $1 ')

/**
 * The words a command is made of, a quoted run being one word: `echo "git push"` is the words `echo` and `git push`.
 *
 * Outside a quote a separator is a word of its own even when nothing spaced it from its neighbours, so `cd x&&git push`
 * reads as `cd`, `x`, `&&`, `git`, `push` and `git push;` keeps its `;` off the `push`. Inside a quote nothing splits: a
 * commit message that mentions a push is still one word.
 */
export function theWordsOfACommand(command: string): readonly string[] {
  const words: string[] = []
  let word = ''
  let quoted: string | undefined
  const keep = (): void => {
    if (word === '') return
    words.push(word)
    word = ''
  }
  for (const character of withTheSeparatorsSpaced(command)) {
    const inQuotes = quoted !== undefined
    if (inQuotes && character === quoted) quoted = undefined
    else if (inQuotes) word += character
    else if (character === '"' || character === "'") quoted = character
    else if (/\s/.test(character)) keep()
    else word += character
  }
  keep()
  return words
}

/** git's own options that take the word after them: `git -C <dir> push` and `git -c <key>=<value> push` run push. */
const GIT_OPTIONS_THAT_TAKE_A_WORD = new Set(['-C', '-c'])

/** Where git's command word sits, past git's own options, and what it is: `git -C /repo push` runs `push` in /repo. */
interface TheCommandOfGit {
  readonly word: string | undefined
  readonly at: number
}

/** Where the command a `git` word runs sits: `-C` and `-c` are read with their word, any other option takes none. */
function theCommandOfGit(words: readonly string[], at: number): TheCommandOfGit {
  let next = at + 1
  let word = words[next]
  while (word !== undefined && word.startsWith('-')) {
    next += GIT_OPTIONS_THAT_TAKE_A_WORD.has(word) ? 2 : 1
    word = words[next]
  }
  return { word, at: next }
}

/** The words a `push` carries, up to the one that ends its command: its own `--tags` is among them. */
function theWordsOfThePush(words: readonly string[], at: number): readonly string[] {
  const end = words.findIndex((word, index) => index > at && A_SEPARATOR.has(word))
  return words.slice(at + 1, end === -1 ? words.length : end)
}

/** The acts the word at `at` begins, when it is `git`: none for any other word. */
function theActsAt(words: readonly string[], at: number): readonly AContractAct[] {
  if (words[at] !== 'git') return []
  const command = theCommandOfGit(words, at)
  if (command.word === 'tag') return ['tag']
  if (command.word !== 'push') return []
  return theWordsOfThePush(words, command.at).includes('--tags') ? ['push', 'tag'] : ['push']
}

/** The acts a run of words is: `git push` is push, `git tag` is tag, and a push carrying `--tags` is both. */
function theActsOfTheWords(words: readonly string[]): readonly AContractAct[] {
  return words.flatMap((_word, at) => theActsAt(words, at))
}

/** The acts a shell call is, by the command's own words: none for a command that runs no git act, none when it has none. */
function theActsOfAShellCall(call: AReadableCall): readonly AContractAct[] {
  if (!isShellTool(call.tool)) return []
  const command = call.input?.['command']
  return typeof command === 'string' ? theActsOfTheWords(theWordsOfACommand(command)) : []
}

/** Whether the call's text is a HANDOFF line for this package, as readACrewLine reads it. */
function isAHandoffFor(call: AReadableCall, held_package: string): boolean {
  const text = call.input?.['text']
  if (typeof text !== 'string') return false
  const reading = readACrewLine(text)
  if (!('line' in reading) || reading.line === null) return false
  return reading.line.verb === 'HANDOFF' && reading.line.package === held_package
}

/** Every act this call is, in the contract's own words: deduplicated, and none for a call the table does not name. */
export function theActsOfACall(call: AReadableCall, held_package: string, ownNameOf: TheOwnNameOf = itsOwnName): readonly AContractAct[] {
  const acts: AContractAct[] = [...theActsOfAShellCall(call)]
  const own_name = ownNameOf(call.tool)
  if (own_name === LAND_BATCH || own_name === FAST_FORWARD_AFTER_THE_OWNERS_YES) acts.push(LAND)
  if (isAHandoffFor(call, held_package)) acts.push('handoff')
  return [...new Set(acts)]
}
