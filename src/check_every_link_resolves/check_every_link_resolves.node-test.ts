// A slow host is asked again, a broken link fails at once and by name
// (martha#231). The scans are injected here, so what is proved is this check's
// own rule: which failure means "come back later" and which means "this link is
// broken". The end-to-end case at the bottom drives main.ts over a stand-in
// checker, because a rule that is never wired to the command is no rule.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { checkEveryLinkResolves, failuresIn, retryable, type Options, type Scan } from './check_every_link_resolves.ts'

type Named = { file: string; url: string; code?: number; timeout?: boolean }

/** A lychee report naming these failures, as 0.24.2 writes it. */
const reportOf = (named: readonly Named[]): string => {
  const error_map: Record<string, unknown[]> = {}
  const timeout_map: Record<string, unknown[]> = {}
  for (const one of named) {
    const into = one.timeout === true ? timeout_map : error_map
    const status =
      one.code === undefined ? { text: 'File not found. Check if file exists and path is correct' } : { text: `Rejected status code: ${one.code}`, code: one.code }
    const entries = into[one.file] ?? []
    entries.push({ url: one.url, status, span: { line: 2, column: 3 } })
    into[one.file] = entries
  }
  return JSON.stringify({ total: named.length, error_map, timeout_map })
}

/** The scans, in order; the last one repeats if the check asks for more. */
const scanning = (runs: readonly Scan[]) => {
  let asked = 0
  return {
    get asked(): number {
      return asked
    },
    scan: async (): Promise<Scan> => {
      const run = runs[Math.min(asked, runs.length - 1)] ?? { exitCode: 0, report: '{}' }
      asked += 1
      return run
    },
  }
}

const optionsWith = (slept: number[]): Options => ({
  scans: 3,
  waits_ms: [5, 15],
  sleep: async (ms: number) => {
    slept.push(ms)
  },
})

const shields = { file: 'README.md', url: 'https://img.shields.io/github/actions/workflow/status/x?label=CI', code: 408 }

test('a scan that resolved is not made again', async () => {
  const slept: number[] = []
  const verdict = await checkEveryLinkResolves(async () => ({ exitCode: 0, report: '{}' }), optionsWith(slept))
  assert.equal(verdict.verdict, 'resolved')
  assert.deepEqual(slept, [])
})

test('a 408 from a badge host is asked again, and the clean scan resolves it', async () => {
  const slept: number[] = []
  const scans = scanning([
    { exitCode: 2, report: reportOf([shields]) },
    { exitCode: 0, report: reportOf([]) },
  ])
  const verdict = await checkEveryLinkResolves(scans.scan, optionsWith(slept))
  assert.equal(verdict.verdict, 'resolved')
  assert.equal(scans.asked, 2)
  assert.deepEqual(slept, [5])
})

test('a timeout is a slow host too', async () => {
  const slept: number[] = []
  const scans = scanning([
    { exitCode: 2, report: reportOf([{ file: 'README.md', url: 'https://example.invalid/slow', timeout: true }]) },
    { exitCode: 0, report: reportOf([]) },
  ])
  const verdict = await checkEveryLinkResolves(scans.scan, optionsWith(slept))
  assert.equal(verdict.verdict, 'resolved')
  assert.equal(scans.asked, 2)
})

test('a 404 fails at once, with no second scan and no wait', async () => {
  const slept: number[] = []
  const scans = scanning([{ exitCode: 2, report: reportOf([{ file: 'README.md', url: 'https://example.invalid/gone', code: 404 }]) }])
  const verdict = await checkEveryLinkResolves(scans.scan, optionsWith(slept))
  assert.equal(verdict.verdict, 'unresolved')
  assert.equal(verdict.verdict === 'unresolved' ? verdict.scans : 0, 1)
  assert.deepEqual(slept, [])
})

test('a 404 fails the very scan that also names a 408, and both are named', async () => {
  const slept: number[] = []
  const gone = { file: 'docs/x.md', url: 'https://example.invalid/gone', code: 404 }
  const scans = scanning([{ exitCode: 2, report: reportOf([shields, gone]) }])
  const verdict = await checkEveryLinkResolves(scans.scan, optionsWith(slept))
  assert.equal(verdict.verdict, 'unresolved')
  const unresolved = verdict.verdict === 'unresolved' ? verdict.failures : []
  assert.equal(verdict.verdict === 'unresolved' ? verdict.scans : 0, 1)
  assert.equal(scans.asked, 1)
  assert.deepEqual(slept, [])
  assert.deepEqual(unresolved.map((failure) => failure.url), [shields.url, gone.url])
})

test('a file that is not there is not a slow host', async () => {
  const slept: number[] = []
  const scans = scanning([{ exitCode: 2, report: reportOf([{ file: 'README.md', url: 'file:///nowhere/missing-page.md' }]) }])
  const verdict = await checkEveryLinkResolves(scans.scan, optionsWith(slept))
  assert.equal(verdict.verdict, 'unresolved')
  assert.equal(scans.asked, 1)
})

test('a host that never answers is unresolved after every scan, and named', async () => {
  const slept: number[] = []
  const scans = scanning([{ exitCode: 2, report: reportOf([shields]) }])
  const verdict = await checkEveryLinkResolves(scans.scan, optionsWith(slept))
  assert.equal(verdict.verdict, 'unresolved')
  assert.equal(verdict.verdict === 'unresolved' ? verdict.scans : 0, 3)
  assert.deepEqual(slept, [5, 15])
  assert.equal(verdict.verdict === 'unresolved' ? verdict.failures[0]?.status : '', 'Rejected status code: 408')
})

test('a report this check cannot read is never a pass', async () => {
  const slept: number[] = []
  const verdict = await checkEveryLinkResolves(async () => ({ exitCode: 2, report: 'lychee: panic' }), optionsWith(slept))
  assert.equal(verdict.verdict, 'unknown')
})

test('a checker that failed and named no link is never a pass', async () => {
  const slept: number[] = []
  const verdict = await checkEveryLinkResolves(async () => ({ exitCode: 2, report: reportOf([]) }), optionsWith(slept))
  assert.equal(verdict.verdict, 'unknown')
})

test('a status a host asks us to come back for is the only thing retried', () => {
  assert.equal(retryable({ file: 'a.md', url: 'u', line: 1, column: 1, status: 's', code: 408, timeout: false }), true)
  assert.equal(retryable({ file: 'a.md', url: 'u', line: 1, column: 1, status: 's', code: 429, timeout: false }), true)
  assert.equal(retryable({ file: 'a.md', url: 'u', line: 1, column: 1, status: 's', code: 503, timeout: false }), true)
  assert.equal(retryable({ file: 'a.md', url: 'u', line: 1, column: 1, status: 's', code: 404, timeout: false }), false)
  assert.equal(retryable({ file: 'a.md', url: 'u', line: 1, column: 1, status: 's', code: 400, timeout: false }), false)
  assert.equal(retryable({ file: 'a.md', url: 'u', line: 1, column: 1, status: 's', code: undefined, timeout: false }), false)
})

test('every failure a report names is read, both maps, with its place', () => {
  const failures = failuresIn(reportOf([shields, { file: 'docs/x.md', url: 'https://example.invalid/gone', code: 404 }]))
  assert.equal(failures?.length, 2)
  assert.deepEqual(failures?.[0], {
    file: 'README.md',
    url: shields.url,
    line: 2,
    column: 3,
    status: 'Rejected status code: 408',
    code: 408,
    timeout: false,
  })
})

// The stand-in checker: writes the report it is handed to `--output`, exits with
// the code it is handed. It exists because the real rule is the wiring, not just
// the decision above (martha#231).
const STAND_IN = `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
const at = args.indexOf('--output')
if (at >= 0) writeFileSync(args[at + 1], process.env.STAND_IN_REPORT ?? '')
process.exit(Number(process.env.STAND_IN_EXIT ?? '0'))
`

const runMain = (checker: string, report: string, exitCode: number) =>
  spawnSync(process.execPath, [join(import.meta.dirname, 'main.ts'), 'README.md'], {
    encoding: 'utf8',
    env: { ...process.env, MARTHA_LYCHEE: checker, MARTHA_LINK_WAIT_MS: '1', STAND_IN_REPORT: report, STAND_IN_EXIT: String(exitCode) },
  })

test('the command fails a broken link by name, and passes when every link resolves', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-231-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const stand = join(directory, 'stand-in.cjs')
  writeFileSync(stand, STAND_IN, { mode: 0o755 })
  const dead = reportOf([{ file: 'README.md', url: 'file:///nowhere/missing-page.md' }])
  const refused = runMain(stand, dead, 2)
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /missing-page\.md/)
  const clean = runMain(stand, dead, 0)
  assert.equal(clean.status, 0)
})

test('the command cannot look without a checker, and says so', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-231-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const missing = runMain(join(directory, 'not-a-checker'), '', 0)
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /could not be made/)
})
