// The relay an engine launch serves on its socket (#541 package A, design G1, PASS r=7 issuecomment-7010033523): the
// crew's tool server (C1) posts each crew tool call here, and it is answered by the launch's one entry, through the
// entry's one order, so a crew tool call and an ACP event are answered in one order.
//
// An engine launch in package A puts no hook, no `martha run` and no git shim in front of its member, so nothing should
// ask the relay's other questions. One that arrives anyway is refused by name, never answered as allowed.

import { bodyOfAToolCall, type MemberRelay } from '../answer_the_relay/answer_the_relay.ts'
import type { TheAnswersOfOneLaunch } from '../answer_what_a_host_reports/answer_what_a_host_reports.ts'

/** Why an engine launch refuses a relay question its member has nothing to ask with. */
export const AN_ENGINE_LAUNCH_ASKS_NO = (what: string): string =>
  `an engine launch puts no ${what} in front of its member, so it answers no such question (#541 package A, design G1)`

/** The crew tool body the relay cannot read, refused by name. */
export const AN_UNREAD_CREW_CALL = 'the tool call is not one this launcher reads: it wants a session, a tool and its arguments'

/** The relay of one engine launch, over its entry. */
export function anEngineRelay(answers: Pick<TheAnswersOfOneLaunch, 'inOrder' | 'aCrewToolAsked'>): MemberRelay {
  return {
    answer: async () => ({ answered: true, body: { refused: AN_ENGINE_LAUNCH_ASKS_NO('hook') } }),
    run: async () => ({ refused: AN_ENGINE_LAUNCH_ASKS_NO('signed run') }),
    answerTool: async (body) => {
      const ask = bodyOfAToolCall(body)
      if (ask === undefined) return { refused: AN_UNREAD_CREW_CALL }
      return answers.inOrder(async () => answers.aCrewToolAsked(ask))
    },
    judgeAGitCall: async () => ({ refused: AN_ENGINE_LAUNCH_ASKS_NO('git shim') }),
    judgeARefTransaction: async () => ({ refused: AN_ENGINE_LAUNCH_ASKS_NO('git hook') }),
  }
}
