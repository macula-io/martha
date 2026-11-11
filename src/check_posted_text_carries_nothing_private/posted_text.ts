// What a posted text is, and how its lines are named. No I/O: the reader fills
// these in from the API, and the crew's decision reads them like any other
// Source, so the classes and the lookup are the ones the tree scan already uses
// (martha#265).

import type { Line, Source } from '../check_nothing_private_gets_in/check_nothing_private_gets_in.ts'

/** One posted object, named as a person acts on it: `pull 263 review 4810`. */
export interface PostedText {
  readonly where: string
  readonly text: string
}

const linesOf = (where: string, text: string): Line[] =>
  text.split('\n').map((one, index) => ({ where: `${where}:${index + 1}`, text: one }))

/** One Source per object, one Line per line of it. An empty text has no line. */
export const postedTextSources = (objects: readonly PostedText[]): Source[] =>
  objects.map((object) => ({
    name: object.where,
    lines: object.text === '' ? [] : linesOf(object.where, object.text),
  }))
