// What the check judges, read from a repository: the relay job's list of recorded-host runs, and every test file under
// src/. A list that cannot be read, or an entry not of the list's shape, is an error, never an empty list: a check that
// read nothing would pass everything (martha#385).

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { RECORDED_HOST_RUNS } from './recorded_host_skip.ts'
import type { RecordedHostRun, TestFile } from './check_every_recorded_host_test_is_run.ts'

/** Where the test files the check reads live, and how their names end. */
const TESTS_UNDER = 'src'
const TEST_FILE = /\.node-test\.ts$/

const isARun = (entry: unknown): entry is RecordedHostRun => {
  if (typeof entry !== 'object' || entry === null) return false
  const run = entry as Record<string, unknown>
  const pattern = run.name_pattern === undefined || typeof run.name_pattern === 'string'
  return typeof run.file === 'string' && typeof run.cases === 'number' && typeof run.proves === 'string' && pattern
}

/** The relay job's list as parsed, held to its shape. */
export function runsFrom(listed: unknown): RecordedHostRun[] {
  if (!Array.isArray(listed) || listed.length === 0) throw new Error(`${RECORDED_HOST_RUNS} is not a list of runs`)
  const odd = listed.findIndex((entry) => !isARun(entry))
  if (odd !== -1) throw new Error(`${RECORDED_HOST_RUNS}: entry ${odd} is not {file, name_pattern?, cases, proves}`)
  return listed as RecordedHostRun[]
}

/** The relay job's list, read from the repository. */
export const readTheRuns = (repository: string): RecordedHostRun[] =>
  runsFrom(JSON.parse(readFileSync(join(repository, RECORDED_HOST_RUNS), 'utf8')))

/** Every test file under src/, by its path from the repository. */
export function readTheTestFiles(repository: string): TestFile[] {
  return readdirSync(join(repository, TESTS_UNDER), { recursive: true, encoding: 'utf8' })
    .filter((path) => TEST_FILE.test(path))
    .sort()
    .map((path) => join(TESTS_UNDER, path))
    .map((path) => ({ path, text: readFileSync(join(repository, path), 'utf8') }))
}
