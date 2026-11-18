// npm run stand-in:openai-model -- <turns file> [<record file>]
//
// Serves the OpenAI-compatible model stand-in on a free local port, for a run of the Goose engine by hand
// (macula-io/martha#541): give the engine the printed URL as its OpenAI host. The turns file is a JSON array of
// scripted turns ({"text": ...}, {"tool": ..., "input": {...}} or {"refused": {...}}); the request that offers tools
// numbered n is answered with turn n, and every one past the end with the last. On SIGINT or SIGTERM it writes what
// it heard to the record file, when one was named, and stops.
//
// Exit: 0 stopped by a signal, 1 the stand-in failed to answer a request, 2 a bad call.

import { readFileSync, writeFileSync } from 'node:fs'
import { argv, exit, on, stderr, stdout } from 'node:process'

import { theOpenAiStandIn, type ModelRequest, type ScriptedTurn } from './the_openai_stand_in.ts'

const [turnsFile, recordFile] = argv.slice(2)
if (turnsFile === undefined) {
  stderr.write('usage: main.ts <turns file, a JSON array of scripted turns> [<record file>]\n')
  exit(2)
}
const turns = JSON.parse(readFileSync(turnsFile, 'utf8')) as readonly ScriptedTurn[]
const last = turns.at(-1)
if (!Array.isArray(turns) || last === undefined) {
  stderr.write(`${turnsFile} holds no turn\n`)
  exit(2)
}

const heard: ModelRequest[] = []
let failure: string | undefined
const stand = await theOpenAiStandIn((request) => turns[request.number - 1] ?? last, heard, (why) => {
  failure ??= why
  stderr.write(`${why}\n`)
})
stdout.write(`${stand.url}\n`)

const stop = (): void => {
  if (recordFile !== undefined) writeFileSync(recordFile, `${JSON.stringify(heard, null, 2)}\n`)
  void stand.close().then(() => exit(failure === undefined ? 0 : 1))
}
on('SIGINT', stop)
on('SIGTERM', stop)
