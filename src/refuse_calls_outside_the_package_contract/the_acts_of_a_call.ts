// What act a tool call is, in the words a package's contract allows (martha#513 slice 2).
//
// This exists so a contract's `allowed` line can be held against every tool call without the gate knowing what a host
// calls its tools. The table is closed: a call that is not on it is not an act, and no contract refuses it. Every act is
// read from what the call itself says, never from a name given to it — the same rule the shell gate reads text by.
//
//   land     the crew's own tools that move the default branch
//   push     a shell command whose argv runs `git push`
//   tag      a shell command whose argv runs `git tag`; `git push --tags` is both, and needs both allowed
//   handoff  a message whose first line readACrewLine reads as a HANDOFF for the package this member holds
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

/** The words that end one command and begin the next, so a `git` after one of them is a command of its own. */
const THE_NEXT_COMMAND = new Set(['&&', ';', '||', '|', '\n'])

/**
 * The words a command is made of, a quoted run being one word: `echo "git push"` is the words `echo` and `git push`.
 *
 * A line break is a word of its own outside a quote, because it is where the shell starts another command: the commonest
 * way a member pushes is the last line of a script, and a reader that dropped the break would see `git` as the argument
 * of the line above it and let that push through. Inside a quote it is part of the word, so a commit message that
 * mentions a push is not one.
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
  for (const character of command) {
    const inQuotes = quoted !== undefined
    if (inQuotes && character === quoted) quoted = undefined
    else if (inQuotes) word += character
    else if (character === '"' || character === "'") quoted = character
    else if (character === '\n') {
      keep()
      words.push(character)
    } else if (/\s/.test(character)) keep()
    else word += character
  }
  keep()
  return words
}

/** Whether the word at `at` starts a command: the first word, or one right after a separator. */
const startsACommand = (words: readonly string[], at: number): boolean => at === 0 || THE_NEXT_COMMAND.has(words[at - 1] ?? '')

/** The acts the words at `at` are, when they are the start of a `git` command: none for any other word. */
function theActsAt(words: readonly string[], at: number): readonly AContractAct[] {
  if (words[at] !== 'git' || !startsACommand(words, at)) return []
  if (words[at + 1] === 'tag') return ['tag']
  if (words[at + 1] !== 'push') return []
  return words.slice(at + 2).includes('--tags') ? ['push', 'tag'] : ['push']
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
export function theActsOfACall(call: AReadableCall, held_package: string): readonly AContractAct[] {
  const acts: AContractAct[] = [...theActsOfAShellCall(call)]
  if (call.tool === LAND_BATCH || call.tool === FAST_FORWARD_AFTER_THE_OWNERS_YES) acts.push(LAND)
  if (isAHandoffFor(call, held_package)) acts.push('handoff')
  return [...new Set(acts)]
}
