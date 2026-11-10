// What a headless run said, read as an answer or as the absence of one (martha#223). A row
// whose evidence is the model's reply cannot rest on whether anything was printed: a run that
// stopped on its turn budget prints its error, and "the codeword was not said" is then the same
// text as "the host never answered". The run is asked for json output, whose `result` field is
// the answer and whose `is_error` says whether there was one, so the two are told apart.
//
// `spawnSync` hands its output back as a string when it was asked for one; the text is taken
// here, in one place, and not at the call site.

import { isRecord } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** What a run's own answer says: whether it answered, what it said, and why there is no answer to read. */
export interface HostAnswer {
  readonly answered: boolean
  readonly text: string
  readonly why: string
}

/** The json the run printed last: the host prints its answer as one object, after anything else. */
function lastJson(printed: string): unknown {
  try {
    return JSON.parse(printed.trim().split('\n').at(-1) ?? '')
  } catch {
    return undefined
  }
}

/** Why the run gave no answer, from what it printed beside the error. */
function stoppedFor(answer: Readonly<Record<string, unknown>>): string {
  const said = typeof answer['result'] === 'string' ? answer['result'].trim() : ''
  return said === '' ? 'it said no more than that it stopped' : said
}

/**
 * The answer a run gave, read from what it printed. A run that errored — on its turn budget,
 * on a refusal, on anything — did not answer, and a run whose answer is empty did not either:
 * neither may be read as an answer that did not name what the row looks for.
 */
export function answerIn(printed: string): HostAnswer {
  const answer = lastJson(printed)
  if (!isRecord(answer)) return { answered: false, text: '', why: 'the host printed no answer of its own' }
  const text = typeof answer['result'] === 'string' ? answer['result'] : ''
  if (answer['is_error'] === true) return { answered: false, text, why: `the host stopped before answering: ${stoppedFor(answer)}` }
  if (text.trim() === '') return { answered: false, text, why: 'the host answered with no words' }
  return { answered: true, text, why: '' }
}
