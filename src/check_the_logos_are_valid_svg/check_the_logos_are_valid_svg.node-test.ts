// The logo check bites (martha#271). The logos this repository ships are well-formed, an SVG a browser would show
// as a broken image is refused and named, and a file the check could not read is never a pass. Everything a test
// makes is removed after it.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { checkTheLogosAreValidSvg } from './check_the_logos_are_valid_svg.ts'

const REPO = join(import.meta.dirname, '..', '..')
const ASSETS = join(REPO, 'assets')

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-logos-'))
  t.after(() => removeTheTree(dir))
  return dir
}

const logosShipped = (): string[] =>
  readdirSync(ASSETS)
    .filter((file) => file.endsWith('.svg'))
    .map((file) => join(ASSETS, file))

test('every logo this repository ships is well-formed SVG', () => {
  const logos = logosShipped()
  assert.notEqual(logos.length, 0, 'no logo was found, so nothing would be checked')
  assert.deepEqual(checkTheLogosAreValidSvg(logos), { verdict: 'valid', checked: logos.length })
})

test('an SVG a browser would show as a broken image is refused, and named', (t) => {
  const broken = join(scratch(t), 'broken-logo.svg')
  writeFileSync(broken, '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>\n')
  const verdict = checkTheLogosAreValidSvg([broken])
  assert.equal(verdict.verdict, 'malformed')
  assert.deepEqual(
    verdict.verdict === 'malformed' ? verdict.logos.map((logo) => logo.file) : [],
    [broken],
    'the refusal names the file it refused',
  )
})

test('a logo the check could not read is not a pass', (t) => {
  const missing = join(scratch(t), 'not-there.svg')
  const verdict = checkTheLogosAreValidSvg([missing])
  assert.equal(verdict.verdict, 'unreadable')
  assert.match(verdict.verdict === 'unreadable' ? verdict.reason : '', /not-there\.svg/)
})

/** The command the workflow runs, so the exit codes below are the ones CI reads. */
const runCli = (files: readonly string[]) =>
  spawnSync(process.execPath, [join(import.meta.dirname, 'main.ts'), ...files], { encoding: 'utf8' })

test('the command answers 0 for a logo, 1 for a broken one and names it, 2 when it could not look', (t) => {
  const signed = join(scratch(t), 'broken-logo.svg')
  writeFileSync(signed, '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>\n')
  const good = runCli(logosShipped().slice(0, 1))
  assert.equal(good.status, 0, good.stderr)
  const broken = runCli([signed])
  assert.equal(broken.status, 1, broken.stderr)
  assert.match(broken.stderr, /broken-logo\.svg/)
  const missing = runCli([join(scratch(t), 'not-there.svg')])
  assert.equal(missing.status, 2, missing.stderr)
})
