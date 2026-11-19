// What an ACP agent asks the owner, held until the owner answers it (macula-io/martha#541, package 9a).
//
// This exists because an engine Martha drives over ACP has no terminal of its own for the owner. On Claude Code the
// owner answers in the host's own dialog and Martha only watches (../say_what_the_host_is_asking). Over ACP every tool
// call comes to Martha, so Martha is also where the owner answers.
//
// WHICH CALLS WAIT ON THE OWNER: the gate first, then the owner's approved list (DECIDED 2026-11-18 "B: gate, then ask
// (Recommended)", martha#541 issuecomment-6976234191). A call the gate denies is refused once, and no one is asked. A
// call the gate allows whose tool is on the owner's approved list runs once. Every other call the gate allows waits on
// the owner, and `martha answer` gives the answer. The list matches tool names only; a tool on it is allowed whatever its
// input, so the shell tool is all or nothing until input patterns exist (the design's r=2 states that cost).
//
// The gate is handed in, never decided here: reading an engine's call into the entry's words and asking the entry is
// the Goose adapter's (#541 part C, C4). This slice takes the gate's verdict and the tool it named.
//
// THE ROW AND THE BELL come from the records the watching half already reads: an ask raises a `permission` keyed by the
// call's own id, and its answer is the call `answered`, which closes it. So `tell_the_owner_a_session_waits` and
// `ring_the_owner` work unchanged, and no Claude Code mapping is touched.
//
// ONE ANSWER PER ASK. An ask is answered by the first of: the owner's answer, or its withdrawal (the client cancelled the
// turn, the turn ended, or the agent's output ended; ../speak_acp_to_an_agent aborts the decision's `withdrawn` signal
// then). Any later answer answers nothing and says why: too late, already answered, or no ask held under that key.
//
// ONE ASK PER KEY, NEVER OVERWRITTEN. An agent's id for a call is unique within its session only, and providers number
// them call_0, call_1, … in every session, so an ask's key names its session as well as its call: two sessions asking
// under the same call id are two asks, each answered and withdrawn on its own. A second ask under a key already held
// (the same session reusing a call id it has not finished) is refused once and noted; the ask already held keeps its row.
//
// AN ANSWER WITH NO OWNER ACT BEHIND IT. The route an answer comes in by is a socket of the owner's own OS user, so a
// member can write to it and skip `martha answer`. That is a speed bump, said plainly (DECIDED 2026-11-18 "Speed bumps,
// said plainly"). Each answer is looked for in the record `martha answer` writes before it sends, and an answer with no
// record behind it is still applied, kept with `owner_act: false` and noted. That catches only an answer sent to the
// socket without the record: the record is the owner's own user's file too, and so is the entry that says where an act
// was typed, so a member that writes the socket can write a matching line first, and then nothing shows.

import type { ADecision } from '../speak_acp_to_an_agent/answer_a_permission_once.ts'
import type { APermissionRequest, Decide } from '../speak_acp_to_an_agent/the_acp_client.ts'
import { theKeyOfAPermission } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import type { TheScreenKeeper } from '../say_what_the_host_is_asking/the_owners_screen.ts'

/** The gate's two verdicts, as its own protocol names them (../claude_code_relay/hooks/relay_protocol.ts, Verdict). */
export type AGateVerdict = 'allow' | 'deny'

/** What the gate said of one call: its verdict, and the tool the call names in the entry's words. */
export interface WhatTheGateSaid {
  readonly verdict: AGateVerdict
  readonly tool: string
}

/** The gate, as the Goose adapter hands it in. A throw is a refusal (the client's own rule). */
export type TheGate = (request: APermissionRequest) => WhatTheGateSaid | Promise<WhatTheGateSaid>

/** The way a call goes once the gate and the approved list have spoken. */
export type TheWayAfterTheGate = 'run-once' | 'refuse-once' | 'ask-the-owner'

/** The two answers the owner gives a permission. */
export const THE_OWNERS_ANSWERS = ['allow', 'reject'] as const
export type AnOwnersAnswer = (typeof THE_OWNERS_ANSWERS)[number]

/**
 * The way a call goes: a deny is refused and no one is asked; an allow whose tool is on the approved list runs; every
 * other allow waits on the owner. The list is compared by the tool's whole name, never a prefix.
 */
export function theWayAfterTheGate(said: WhatTheGateSaid, approved: readonly string[]): TheWayAfterTheGate {
  if (said.verdict !== 'allow') return 'refuse-once'
  return approved.includes(said.tool) ? 'run-once' : 'ask-the-owner'
}

/** One ask the owner has not answered yet, as `martha answer` lists it. Every word but the key is the agent's. */
export interface AnOpenAsk {
  readonly key: string
  readonly session_id: string
  /** The agent's own id for the call, which the key is made from. */
  readonly tool_call_id: string
  readonly tool: string
  readonly title: string
  readonly input: unknown
  readonly opened_at: number
}

/** An answer as it reaches the launcher: the ask's key, the answer, and the id of the owner act's record, if any. */
export interface AnAnswerHeard {
  readonly key: string
  readonly answer: AnOwnersAnswer
  readonly act?: string
}

/** What one answer did: it answered an open ask, or it answered nothing and says why. */
export type WhatAnAnswerDid = { readonly did: 'answered'; readonly owner_act: boolean } | { readonly did: 'answered-nothing'; readonly why: string }

/** One answer kept, with whether an owner act stood behind it. */
export interface AnAnswerKept {
  readonly key: string
  readonly answer: AnOwnersAnswer
  readonly owner_act: boolean
  readonly at: number
}

/** Why an ask that is no longer open closed. */
type WhyItClosed = 'answered' | 'withdrawn'

/** The key one ask is held, listed and answered under: its call's own key, and the session it was asked in. */
export const theKeyOfAnAsk = (request: APermissionRequest, tool: string): string => `${theKeyOfAPermission('', tool, request.rawInput, request.toolCallId)}@${request.sessionId}`

/** Why a late answer answered nothing, by why its ask closed; and for a key never held. */
export const TOO_LATE = 'too late: the ask was withdrawn when its turn was cancelled or ended, and the call did not run'
export const ALREADY_ANSWERED = 'the ask was already answered'
export const NOT_HELD = 'no ask is held under that key'

const WHY_NOTHING: Readonly<Record<WhyItClosed, string>> = { withdrawn: TOO_LATE, answered: ALREADY_ANSWERED }

/** The asks one launch holds, the answers it kept, and the Decide its ACP client is given. */
export interface TheOwnersAsks {
  /** The Decide for the ACP client: the gate, then the approved list, then the owner. */
  decide(gate: TheGate, approved: readonly string[]): Decide
  /** Every ask still open, oldest first. */
  open(): readonly AnOpenAsk[]
  /** One answer applied to the ask its key names, or why it answered nothing. */
  answer(heard: AnAnswerHeard): WhatAnAnswerDid
  /** Every answer that answered an ask, in order. */
  readonly kept: readonly AnAnswerKept[]
  /** What happened that the owner should be able to read: a withdrawn ask, an answer with no owner act behind it. */
  readonly notes: readonly string[]
}

/** What a launch hands the asks: the owner's screen, the clock, and how an answer's owner act is found. */
export interface WhereTheAsksAreKept {
  readonly screen: TheScreenKeeper
  readonly now: () => number
  /** Whether `martha answer` recorded this very answer before it was sent. */
  readonly anOwnerActStandsBehind: (heard: AnAnswerHeard) => boolean
}

interface AHeldAsk {
  readonly ask: AnOpenAsk
  readonly settle: (decision: ADecision) => void
}

/** The asks of one launch, held until each has its one answer. */
export function theOwnersAsks(where: WhereTheAsksAreKept): TheOwnersAsks {
  const held = new Map<string, AHeldAsk>()
  const closed = new Map<string, WhyItClosed>()
  const kept: AnAnswerKept[] = []
  const notes: string[] = []

  /** The ask put away under `why`: the row closed by the call's own answer, and the decision settled. */
  const close = (key: string, why: WhyItClosed, decision: ADecision): AHeldAsk | undefined => {
    const one = held.get(key)
    if (one === undefined) return undefined
    held.delete(key)
    closed.set(key, why)
    const { ask } = one
    where.screen.heard(ask.session_id, { said: 'answered', call: { id: ask.tool_call_id, tool: ask.tool, input: ask.input } }, where.now())
    one.settle(decision)
    return one
  }

  const waitOnTheOwner = (request: APermissionRequest, tool: string, withdrawn: AbortSignal): Promise<ADecision> => {
    const key = theKeyOfAnAsk(request, tool)
    if (held.has(key)) {
      notes.push(`a second ask under ${key} was refused: the ask already held under that key keeps it`)
      return Promise.resolve('reject')
    }
    const ask: AnOpenAsk = { key, session_id: request.sessionId, tool_call_id: request.toolCallId, tool, title: request.title, input: request.rawInput, opened_at: where.now() }
    const answered = new Promise<ADecision>((settle) => held.set(ask.key, { ask, settle }))
    where.screen.heard(ask.session_id, { said: 'permission', call: { id: request.toolCallId, tool, input: request.rawInput } }, ask.opened_at)
    const withdraw = (): void => {
      if (close(ask.key, 'withdrawn', 'reject') !== undefined) notes.push(`the ask ${ask.key} was withdrawn before the owner answered: its turn was cancelled or ended`)
    }
    if (withdrawn.aborted) withdraw()
    else withdrawn.addEventListener('abort', withdraw, { once: true })
    return answered
  }

  return {
    decide: (gate, approved) => async (request, withdrawn) => {
      const said = await gate(request)
      const way = theWayAfterTheGate(said, approved)
      if (way === 'refuse-once') return 'reject'
      if (way === 'run-once') return 'allow'
      return waitOnTheOwner(request, said.tool, withdrawn)
    },
    open: () => [...held.values()].map((one) => one.ask),
    answer: (heard) => {
      if (!held.has(heard.key)) {
        const why = closed.get(heard.key)
        return { did: 'answered-nothing', why: why === undefined ? NOT_HELD : WHY_NOTHING[why] }
      }
      const owner_act = where.anOwnerActStandsBehind(heard)
      close(heard.key, 'answered', heard.answer === 'allow' ? 'allow' : 'reject')
      kept.push({ key: heard.key, answer: heard.answer, owner_act, at: where.now() })
      if (!owner_act) notes.push(`the ask ${heard.key} was answered ${heard.answer} with no owner act behind it: no \`martha answer\` recorded this answer`)
      return { did: 'answered', owner_act }
    },
    kept,
    notes,
  }
}
