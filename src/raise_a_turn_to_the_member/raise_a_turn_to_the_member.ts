// The one place a turn a member's host took in is raised to whatever waits on turns (martha#253, slice 0).
//
// This exists so `onTurn` is real in a launched member. A member's launcher builds no host contract of its own: the
// turns it can raise are the prompts the relay reports, and today `promptSubmitted` gave those to `takeInTurn` and to
// nobody else, so an `onTurn` listener in a live member never heard anything. The launcher now holds one of these
// beside its session records, `promptSubmitted` raises each kept turn through it, and the Claude Code adapter's own
// `prompted` raises through the same object, so both read one arrival mapping (`arrivalOfPrompt`) and one shape.
//
// It decides nothing. It carries the text the host took in and the origin kind the engine stamped, and gives every
// listener the arrival the host contract names.

import type { ArrivingTurn } from '../host_contract/host_contract.ts'
import { arrivalOfPrompt, CLAUDE_CODE_PROMPT_ORIGINS, type PromptCarries } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'

/** What a member's launcher raises turns to, built once per launch. */
export interface TurnRaising {
  /** Calls `take` with every turn raised from now on. */
  onTurn(take: (turn: ArrivingTurn) => void): void
  /**
   * Raises one turn: the text the host took in, the origin kind the engine stamped on it, and what the prompt carried
   * beside its text. A turn is raised only once the session it arrived in took it in.
   */
  prompted(text: string, origin_kind: string, carries: PromptCarries): void
}

/** A raising that starts with no listeners; a member's launcher puts it on the relay's place. */
export function turnsRaised(): TurnRaising {
  const listeners: ((turn: ArrivingTurn) => void)[] = []
  return {
    onTurn: (take) => void listeners.push(take),
    prompted: (text, origin_kind, carries) => {
      const turn: ArrivingTurn = { text, arrival: arrivalOfPrompt(CLAUDE_CODE_PROMPT_ORIGINS, origin_kind, carries) }
      for (const take of listeners) take(turn)
    },
  }
}
