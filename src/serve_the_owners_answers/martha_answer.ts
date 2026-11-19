// `martha answer`: the owner's one place to answer what a Goose member's engine asks (macula-io/martha#541, package 9a).
//
// `martha answer` lists every ask still open, by member, oldest first. `martha answer <member> <key> allow|reject`
// answers one. It is an owner's act: the command refuses it from inside a member and records where it was typed
// (../refuse_an_owner_act_from_inside_a_member, ../record_where_an_owners_act_was_typed), and it asks for a terminal, as
// every act of the owner's own does. All three are speed bumps, not walls (DECIDED 2026-11-18 "Speed bumps, said
// plainly").
//
// Before it sends an answer, it keeps the answer's own line in the project's record, so the launch can tell an answer
// the owner typed from one written straight to its socket (./the_owners_answer_route.ts).
//
// Every word the agent wrote (a tool's name, a call's title) reaches the owner through the command's own safe lines,
// which strip what a terminal would act on (../show_the_owners_text_safely).

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { EXIT_DONE, EXIT_USAGE, refused, type LinesShownToTheOwner } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import { cutForTheRow } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { THE_OWNERS_ANSWERS, type AnOwnersAnswer } from '../hear_an_acp_agents_asks/hear_an_acp_agents_asks.ts'
import { appendStateLine, crewSubdirectory, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { askTheRoute, THE_ANSWER_ROUTES_PLACE, THE_OWNERS_ANSWERS_FILE, theLineOfAnAnswer, theMembersWithARoute, theRouteOf } from './the_owners_answer_route.ts'

/** Why an answer is refused where no owner is at the keyboard. */
export const AN_ANSWER_NEEDS_A_TERMINAL = 'only the owner, at a terminal, answers what a member asks, and this is no terminal.'

/** What the list says when nothing is open. */
export const NOTHING_WAITS = 'Nothing waits on you: no Goose member has an ask open.'

/** `answer`, or `answer <member> <key> allow|reject`: the words, or undefined when they are no way it is used. */
export function answerOf(act: string, argv: readonly string[]): { readonly act: string; readonly member?: string; readonly args: readonly string[] } | undefined {
  if (argv.length === 1) return { act, args: [] }
  const [, member = '', key = '', verb = ''] = argv
  return argv.length === 4 && aWord(member) && key !== '' && (THE_OWNERS_ANSWERS as readonly string[]).includes(verb) ? { act, member, args: [key, verb] } : undefined
}

/** A member's name as the command takes one: not empty, and not a switch. */
const aWord = (word: string): boolean => word !== '' && !word.startsWith('-')

/** Where the act reads and writes: the crew's route records, and the project's record of answers typed. */
export interface WhereAnAnswerGoes {
  readonly routes: string
  /** Appends one line to the record of answers typed; says why not when it could not. */
  readonly keep: (line: string) => string | undefined
}

/** The terminal the act is typed at, and the lines it shows. */
export interface TheAnswersIo extends LinesShownToTheOwner {
  readonly is_terminal: boolean
}

/** The command's io, as much of it as the act reads. */
export interface TheCommandsIo extends LinesShownToTheOwner {
  readonly terminal: { readonly is_terminal: boolean }
}

/**
 * The act in a project: the crew's place for the launches' routes, and the project's record of the answers typed, handed
 * to the act. The command (../run_the_martha_command) only routes the word here.
 */
export async function answerInAProject(io: TheCommandsIo, places: { readonly root: string; readonly state: MarthaState }, member: string | undefined, args: readonly string[]): Promise<number> {
  const routes = crewSubdirectory(places.state.state_root, places.root, THE_ANSWER_ROUTES_PLACE)
  if ('refusal' in routes) return refused(io, routes.refusal)
  const record = join(places.state.directory, THE_OWNERS_ANSWERS_FILE)
  const keep = (line: string): string | undefined => appendStateLine(record, line, 'answer')?.refusal
  return answerAct({ out: io.out, err: io.err, is_terminal: io.terminal.is_terminal }, { routes: routes.path, keep }, member, args)
}

/** The act: the list, or one answer. */
export async function answerAct(io: TheAnswersIo, where: WhereAnAnswerGoes, member: string | undefined, args: readonly string[]): Promise<number> {
  if (member === undefined) return theList(io, where.routes)
  const [key, verb] = args
  if (key === undefined || verb === undefined) return EXIT_USAGE
  return theAnswer(io, where, member, key, verb as AnOwnersAnswer)
}

/** Every open ask of every member with a route, one line each, oldest first within a member. */
async function theList(io: TheAnswersIo, routes: string): Promise<number> {
  let shown = 0
  for (const member of theMembersWithARoute(routes)) {
    const route = theRouteOf(routes, member)
    if ('why' in route) {
      io.err(`${member}: ${route.why}`)
      continue
    }
    const reply = await askTheRoute(route.socket_path, { open: 1 })
    if (!('open' in reply)) {
      io.err(`${member}: its launch did not list its asks: ${'unreachable' in reply ? reply.unreachable : 'refused' in reply ? reply.refused : 'it answered something else'}`)
      continue
    }
    for (const ask of [...reply.open].sort((a, b) => a.opened_at - b.opened_at)) {
      io.out(`${member}  ${ask.key}  ${cutForTheRow(`${ask.tool}: ${ask.title}`)}`)
      shown += 1
    }
  }
  if (shown === 0) io.out(NOTHING_WAITS)
  return EXIT_DONE
}

/** One answer: kept in the record first, then sent to the launch that holds the ask. */
async function theAnswer(io: TheAnswersIo, where: WhereAnAnswerGoes, member: string, key: string, answer: AnOwnersAnswer): Promise<number> {
  if (!io.is_terminal) return refused(io, AN_ANSWER_NEEDS_A_TERMINAL)
  const route = theRouteOf(where.routes, member)
  if ('why' in route) return refused(io, route.why)
  const act = randomUUID()
  const unkept = where.keep(theLineOfAnAnswer({ act, member, key, answer, at: new Date().toISOString() }))
  if (unkept !== undefined) return refused(io, `the answer is not sent, because it could not be recorded: ${unkept}`)
  const reply = await askTheRoute(route.socket_path, { answer: { key, answer, act } })
  if ('unreachable' in reply) return refused(io, `${member}'s launch did not take the answer: ${reply.unreachable}`)
  if ('refused' in reply) return refused(io, `${member}'s launch refused the answer: ${reply.refused}`)
  if (!('did' in reply)) return refused(io, `${member}'s launch answered something else`)
  if (reply.did.did === 'answered-nothing') return refused(io, `the answer answered nothing: ${reply.did.why}`)
  io.out(`${member}: ${key} answered ${answer}`)
  return EXIT_DONE
}
