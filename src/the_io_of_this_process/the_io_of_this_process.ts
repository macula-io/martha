// This process's own io: its working directory, environment, terminal and standard streams (a pure move out of the
// command adapter, which is at its ceiling — martha#371, the same reason ../show_the_owners_text_safely was moved).
//
// It exists so the acts' code and this process's own wiring are two things: the command's acts are handed an io, and
// ./bin/martha is what hands them this one. Nothing here decides anything an act decides; it is the process's facts, as
// the rest of the tree reads them.

import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { isatty } from 'node:tty'

import type { OwnersTerminal } from '../approve_a_checkouts_config/approve_a_checkouts_config.ts'
import type { CommandIo } from '../run_the_martha_command/run_the_martha_command.ts'

/** The owner's terminal on this process's standard input; questions are asked on stderr. */
export const terminalOfThisProcess: OwnersTerminal = {
  is_terminal: isatty(0),
  ask: async (question) => {
    const asking = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return await asking.question(question)
    } finally {
      asking.close()
    }
  },
}

/** This process's own io: its working directory, environment, terminal and standard streams. */
export const ioOfThisProcess: CommandIo = {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  terminal: terminalOfThisProcess,
  out: (line) => void process.stdout.write(`${line}\n`),
  outBytes: (bytes) => void process.stdout.write(bytes),
  err: (line) => void process.stderr.write(`${line}\n`),
}
