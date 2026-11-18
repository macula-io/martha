// Run the owner's act: npm run keep:lab-families
//
// The families come from MARTHA_LAB_HOSTS when the owner's own shell has it set,
// else they are asked for on the terminal, with what is typed not shown. Exit 0
// kept, 1 refused. What it does: ./keep_the_lab_families.ts.

import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { isatty } from 'node:tty'

import { KEY_BYTES } from '../check_nothing_private_gets_in/lab_family_digests.ts'
import { keepLabFamilies } from './keep_the_lab_families.ts'

const NAME = 'keep_the_lab_families'

/** Why the act is refused where no owner is at the keyboard. */
const NO_TERMINAL =
  'only the owner, at a terminal, keeps the lab families, and this is no terminal. This is a speed bump, not a wall: a member that sets out to can make a terminal of its own.'

/** One line read from the terminal, never echoed: the answer goes to a stream that writes nothing. */
const askUnshown = async (question: string): Promise<string> => {
  process.stderr.write(question)
  const silent = new Writable({ write: (_chunk, _encoding, done) => done() })
  const asking = createInterface({ input: process.stdin, output: silent, terminal: true })
  try {
    return await asking.question('')
  } finally {
    asking.close()
    process.stderr.write('\n')
  }
}

const main = async (): Promise<number> => {
  if (!isatty(0)) {
    console.error(`${NAME}: ${NO_TERMINAL}`)
    return 1
  }
  const set = process.env['MARTHA_LAB_HOSTS'] ?? ''
  const raw = set.trim() !== '' ? set : await askUnshown('The lab machine families, as CI\'s secret holds them (a JSON array; not shown): ')
  const kept = keepLabFamilies(process.env, raw, randomBytes(KEY_BYTES))
  if ('refusal' in kept) {
    console.error(`${NAME}: ${kept.refusal}`)
    return 1
  }
  console.error(`${NAME}: kept the digests of ${kept.families} famil${kept.families === 1 ? 'y' : 'ies'} in ${kept.kept}`)
  return 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Never the error's own text: it could quote what was typed.
    console.error(`${NAME}: the act failed (${error instanceof Error ? error.name : 'unknown'})`)
    process.exit(1)
  },
)
