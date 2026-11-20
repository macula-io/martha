// Re-records what the Goose engine says about itself, from a checkout of its source, or checks that the committed
// recording is still what that checkout says (macula-io/martha#541, package 10).
//
//   npm run record:goose-engine -- <engine checkout> <its commit>
//   npm run record:goose-engine -- --check <engine checkout> <its commit>
//
// The engine is the fork macula-apps/martha-engine. Run the first when the engine moves to a new version: it writes
// src/know_the_goose_engines_facts/recorded_goose_engine.json, with the commit it was read at.
//
// The second writes nothing. It reads the checkout in memory and compares every fact with the committed recording,
// the version included: the launch writes its config root from these facts, so a recording of another engine
// describes a launch nobody runs. The commit is where the facts were read, not one of them: a fork commit that
// changes none of them is no drift, and the output says both commits so a reader sees how far apart they are.
// It exits 0 when every fact is the same, 1 when a part cannot be read or any fact differs, and 2 on a bad call.
// Standard output carries versions, commits and the names of facts and parts only, since the drift job's log is
// public; why a part could not be read goes to standard error.

import { readFileSync, writeFileSync } from 'node:fs'
import { argv, exit, stderr, stdout } from 'node:process'

import { engineFactsIn, type EngineFacts } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { RECORDING_OF_THE_ENGINE, type RecordedEngine } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { NOTE } from '../record_claude_code_host/carry_over_what_is_restated_by_hand.ts'
import { anEngineCheckoutOnDisk } from './an_engine_checkout_on_disk.ts'

const CHECK = '--check'
const COMMIT = /^[0-9a-f]{40}$/
/** The recording's own fields that are not facts of the engine: why it exists, and where it was read. */
const NOT_FACTS: readonly string[] = [NOTE, 'engine_commit']
const WHY = 'What the Goose engine says about itself, read from its source so the launcher and the adapter derive from the engine and not from a list typed by hand (macula-io/martha#541). Re-record with: npm run record:goose-engine -- <engine checkout> <its commit>.'

/** The facts whose values differ between the recording and a checkout, in a stable order. */
function factsThatDiffer(recorded: Readonly<Record<string, unknown>>, read: Readonly<Record<string, unknown>>): readonly string[] {
  const fields = new Set([...Object.keys(recorded), ...Object.keys(read)].filter((field) => !NOT_FACTS.includes(field)))
  return [...fields].filter((field) => JSON.stringify(recorded[field]) !== JSON.stringify(read[field])).sort()
}

const checking = argv[2] === CHECK
const [checkout, commit] = argv.slice(checking ? 3 : 2)
if (checkout === undefined || commit === undefined || !COMMIT.test(commit)) {
  stderr.write(`usage: record_the_goose_engine.ts [${CHECK}] <engine checkout> <its commit, 40 hex>\n`)
  exit(2)
}

const recorded = JSON.parse(readFileSync(RECORDING_OF_THE_ENGINE, 'utf8')) as RecordedEngine
const { facts, unreadable } = engineFactsIn(anEngineCheckoutOnDisk(checkout))
for (const { part, why } of unreadable) stderr.write(`${part}: ${why}\n`)
const parts = unreadable.map(({ part }) => part)

if (checking) {
  const differing = parts.length > 0 ? [] : factsThatDiffer(recorded as unknown as Record<string, unknown>, facts)
  stdout.write(`recorded ${recorded.engine_version} at ${recorded.engine_commit}, engine ${facts.engine_version ?? '?'} at ${commit}\n`)
  if (parts.length > 0) stdout.write(`unreadable: ${parts.join(', ')}\n`)
  if (differing.length > 0) stdout.write(`differs: ${differing.join(', ')}\n`)
  exit(parts.length > 0 || differing.length > 0 ? 1 : 0)
}

if (parts.length > 0) {
  stderr.write(`record_the_goose_engine: not recorded, unreadable: ${parts.join(', ')}\n`)
  exit(1)
}
const recording: RecordedEngine = { [NOTE]: WHY, engine_commit: commit, ...(facts as EngineFacts) }
writeFileSync(RECORDING_OF_THE_ENGINE, `${JSON.stringify(recording, null, 2)}\n`)
