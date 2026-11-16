// The owner's to-do list as a tool answers it (martha#316, #443 part 5): the two tools a member writes the list with, the
// pane's ask that draws it, and the sweep that keeps it true.
//
// The declaration's table says whether this launch's member may keep the owner's list, and every row is written as this
// launch's member, never as a name the call carries. The tools slice (../a_crews_tools) keeps only the table that calls
// this, and the standing items it draws under the list are that slice's own.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { Processes } from '../host_contract/host_contract.ts'
import { STANDING_HEADING, theStandingList, todayOf } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { theStandingItemsOf } from '../keep_the_supervisors_standing_items/the_standing_tools.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import {
  OWNER_TODO_ADD,
  OWNER_TODO_ADD_DESCRIPTION,
  OWNER_TODO_DONE,
  OWNER_TODO_DONE_DESCRIPTION,
  OWNER_TODO_STREAM,
  SWEEP_INTERVAL_MS,
  mayKeepTheOwnersList,
  sweepTheList,
  theListForThePane,
  theOpenRows,
  theStandingLines,
  whoMayKeepTheList,
  type TodoAnswer,
} from './keep_the_owners_todo_list.ts'

/** What `owner_todo_add` takes: the act, its goal, who waits on it, and the commands that do it. */
export const OWNER_TODO_ADD_TOOL = {
  name: OWNER_TODO_ADD,
  description: OWNER_TODO_ADD_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'A slug naming the act, such as martha-317 (a package ref is refused): letters, digits, ".", "_" or "-"' },
      title: { type: 'string', description: 'What the owner is asked to do, in one line' },
      goal: { type: 'string', description: 'The end goal the act serves, in one line' },
      waiting_on: { type: 'string', description: 'Who waits on it, so the owner knows who to tell when it is done' },
      commands: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The exact command the owner runs; variable names only, never a secret' },
            does: { type: 'string', description: 'What the command does and what success looks like, in one line' },
          },
          required: ['command', 'does'],
        },
      },
      check: {
        type: 'object',
        description: 'Optional: how Martha can tell the act is done by itself — { pr_merged: { repo, number } } or { tag_exists: { repo, tag } }',
      },
    },
    required: ['id', 'title', 'commands'],
  },
}

/** What `owner_todo_done` takes: the act's id, as it was added. */
export const OWNER_TODO_DONE_TOOL = {
  name: OWNER_TODO_DONE,
  description: OWNER_TODO_DONE_DESCRIPTION,
  inputSchema: { type: 'object', properties: { id: { type: 'string', description: "The act's id, as it was added" } }, required: ['id'] },
}

/** What a list tool is handed: the streams, this member, the declaration's table, and the checkout its checks run in. */
export interface TheTodoAsked {
  readonly ledger: LedgerHost
  readonly member: string
  readonly settings: CrewSettings
  readonly root: string
  readonly processes?: Processes
  readonly now: number
}

/** What the pane's ask is handed: the streams it draws from, and the day the list is dated by. */
export interface TheListAsked {
  readonly ledger: LedgerHost
  readonly now: number
}

/** What the tools answer: the line the member is told, or why the table did not let it write. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/**
 * `owner_todo_add` and `owner_todo_done` (martha#316): the declaration's table says whether this launch's member may
 * keep the owner's list, and the row is written as this launch's member, never as a name the call carries.
 */
export async function keepTheOwnersList(asked: TheTodoAsked, act: () => Promise<TodoAnswer>): Promise<AToolAnswer> {
  if (!mayKeepTheOwnersList(asked.settings, asked.member)) return { refused: whoMayKeepTheList(asked.settings, asked.member) }
  const done = await act()
  return 'told' in done ? { answer: done.told } : { refused: done.refused }
}

/** The owner's list as the pane draws it (martha#316), with `focus` the row the owner's keyboard is on. */
export async function theOwnersTodoAsk(asked: TheListAsked, args: Readonly<Record<string, unknown>>): Promise<AToolAnswer> {
  const pane = theListForThePane(theOpenRows(await asked.ledger.stores.rows.read(OWNER_TODO_STREAM)), args['focus'], asked.now)
  const items = await theStandingItemsOf(asked.ledger)
  // The standing items under the list (martha#317): a heading and one line each, or nothing when none stands.
  const standing = items.length === 0 ? [] : [STANDING_HEADING, ...theStandingList(items, todayOf(asked.now))]
  return { answer: JSON.stringify({ ...pane, standing, drawn: [...pane.drawn, ...theStandingLines(standing)], lines: pane.lines + standing.length }) }
}

/** What a sweep is handed: the streams, the checkout its checks run in, this member, and the declaration read afresh. */
export interface TheSweepAsked {
  readonly ledger: LedgerHost
  readonly root: string
  readonly member: string
  readonly processes: Processes
  /** The declaration as it stands at this sweep, read again each time so an edited table takes effect without a relaunch. */
  readonly settings: () => Promise<CrewSettings | { readonly refused: string }>
}

/**
 * The sweep of the owner's list: at most once per SWEEP_INTERVAL_MS, and never two at once. A member the table does not
 * let keep the list sweeps nothing, and a declaration that cannot be read sweeps nothing either.
 */
export function startSweeping(asked: TheSweepAsked): () => void {
  let sweeping = false
  const timer = setInterval(() => {
    if (sweeping) return
    sweeping = true
    void sweepOnce(asked).finally(() => {
      sweeping = false
    })
  }, SWEEP_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}

/** One sweep, when this member may keep the list; a declaration that cannot be read sweeps nothing. */
async function sweepOnce(asked: TheSweepAsked): Promise<void> {
  const settings = await asked.settings()
  if ('refused' in settings || !mayKeepTheOwnersList(settings, asked.member)) return
  await sweepTheList({ ...asked.ledger, processes: asked.processes }, asked.root).catch(() => undefined)
}
