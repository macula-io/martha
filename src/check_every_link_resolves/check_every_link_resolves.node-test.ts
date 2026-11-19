// A link to a file or a heading of this repository that is not there fails the check at once and by name
// (martha#231; links to other sites are not checked, DECIDED 2026-11-19 "Links: internal only"). The scan is
// injected here, so what is proved is this check's own rule: one scan decides, and a check that could not look
// never passes. The end-to-end cases at the bottom drive main.ts over a stand-in checker, because a rule that is
// never wired to the command is no rule.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { checkEveryLinkResolves, failuresIn, type Scan } from './check_every_link_resolves.ts'

type Named = { file: string; url: string }

/** A lychee report naming these failures, as 0.24.2 writes it under --offline. */
const reportOf = (named: readonly Named[]): string => {
  const error_map: Record<string, unknown[]> = {}
  for (const one of named) {
    const entries = error_map[one.file] ?? []
    entries.push({ url: one.url, status: { text: 'File not found. Check if file exists and path is correct' }, span: { line: 2, column: 3 } })
    error_map[one.file] = entries
  }
  return JSON.stringify({ total: named.length, error_map })
}

/** One scan, answered every time it is asked, counting how often it was asked. */
const scanning = (run: Scan) => {
  let asked = 0
  return {
    get asked(): number {
      return asked
    },
    scan: async (): Promise<Scan> => {
      asked += 1
      return run
    },
  }
}

const missingPage = { file: 'docs/x.md', url: 'file:///nowhere/missing-page.md' }
const missingHeading = { file: 'README.md', url: 'file:///repo/docs/guide.md#no-such-heading' }

test('a scan that resolved is a pass', async () => {
  const scans = scanning({ exitCode: 0, report: reportOf([]) })
  const verdict = await checkEveryLinkResolves(scans.scan)
  assert.equal(verdict.verdict, 'resolved')
  assert.equal(scans.asked, 1)
})

test('a failing scan is made exactly once, and every link it names fails by name', async () => {
  const scans = scanning({ exitCode: 2, report: reportOf([missingPage, missingHeading]) })
  const verdict = await checkEveryLinkResolves(scans.scan)
  assert.equal(scans.asked, 1)
  assert.equal(verdict.verdict, 'unresolved')
  assert.deepEqual(
    verdict.verdict === 'unresolved' ? verdict.failures.map((failure) => failure.url) : [],
    [missingPage.url, missingHeading.url],
  )
})

test('a report this check cannot read is never a pass', async () => {
  const verdict = await checkEveryLinkResolves(async () => ({ exitCode: 2, report: 'lychee: panic' }))
  assert.equal(verdict.verdict, 'unknown')
})

test('a checker that failed and named no link is never a pass', async () => {
  const verdict = await checkEveryLinkResolves(async () => ({ exitCode: 2, report: reportOf([]) }))
  assert.equal(verdict.verdict, 'unknown')
})

test('every failure a report names is read, with its place', () => {
  const failures = failuresIn(reportOf([missingPage, missingHeading]))
  assert.equal(failures?.length, 2)
  assert.deepEqual(failures?.[0], {
    file: missingPage.file,
    url: missingPage.url,
    line: 2,
    column: 3,
    status: 'File not found. Check if file exists and path is correct',
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
    env: { ...process.env, MARTHA_LYCHEE: checker, STAND_IN_REPORT: report, STAND_IN_EXIT: String(exitCode) },
  })

test('the command fails a missing file by name, and passes when every link resolves', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-231-'))
  t.after(() => removeTheTree(directory))
  const stand = join(directory, 'stand-in.cjs')
  writeFileSync(stand, STAND_IN, { mode: 0o755 })
  const dead = reportOf([missingPage])
  const broken = runMain(stand, dead, 2)
  assert.equal(broken.status, 1)
  assert.match(broken.stderr, /^docs\/x\.md:2:3 file:\/\/\/nowhere\/missing-page\.md \|/m)
  assert.match(broken.stderr, /1 link\(s\) unresolved/)
  const clean = runMain(stand, dead, 0)
  assert.equal(clean.status, 0)
})

test('the command cannot look without a checker, and says so', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-231-'))
  t.after(() => removeTheTree(directory))
  const missing = runMain(join(directory, 'not-a-checker'), '', 0)
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /could not be made/)
})
