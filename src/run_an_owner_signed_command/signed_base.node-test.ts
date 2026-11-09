import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { BASE_REF, openSignedBase } from './signed_base.ts'

const GIT_ENV = { PATH: process.env['PATH'] ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim()

/** A remote with one commit on main holding `files`, a checkout of it, and a state directory; removed after. */
function place(t: { after(fn: () => void): void }, files: Record<string, string>) {
  const top = mkdtempSync(join(tmpdir(), 'martha-129-base-'))
  t.after(() => rmSync(top, { recursive: true, force: true }))
  const remote = join(top, 'remote')
  mkdirSync(remote)
  git(remote, 'init', '--quiet', '--initial-branch=main')
  for (const [path, text] of Object.entries(files)) writeFileSync(join(remote, path), text)
  git(remote, 'add', '-A')
  git(remote, 'commit', '--quiet', '-m', 'base')
  const checkout = join(top, 'checkout')
  git(top, 'clone', '--quiet', remote, checkout)
  const state_root = join(top, 'state')
  mkdirSync(state_root, { mode: 0o700 })
  const state = openState(state_root, checkout)
  if ('refusal' in state) throw new Error(state.refusal)
  return { top, remote, checkout, state, base: { remote_url: `file://${remote}`, branch: 'main' }, inherited: { PATH: GIT_ENV.PATH, HOME: top } }
}

test('the signed branch opens to its commit, its entries with their modes, and blob bytes that hash to their ids', (t) => {
  const p = place(t, { 'a.ts': 'one\n', 'package-lock.json': '{}' })
  const opened = openSignedBase(p.state, p.checkout, p.base, p.inherited)
  assert.ok(typeof opened !== 'string', String(opened))
  assert.equal(opened.fetched, true)
  assert.equal(opened.commit, git(p.remote, 'rev-parse', 'HEAD'))
  assert.deepEqual(opened.entries.map((e) => [e.path, e.mode]), [['a.ts', '100644'], ['package-lock.json', '100644']])
  const entry = opened.entries.find((e) => e.path === 'a.ts')!
  assert.equal(opened.blob(entry.blob)?.toString('utf8'), 'one\n')
  assert.equal(git(p.remote, 'rev-parse', 'HEAD:a.ts'), entry.blob)
})

test('origin re-pointed, its HEAD moved and its URL rewritten in the checkout do not move the base', (t) => {
  const p = place(t, { 'a.ts': 'one\n' })
  const other = join(p.top, 'other')
  mkdirSync(other)
  git(other, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(other, 'only-other.ts'), 'stranger\n')
  git(other, 'add', '-A')
  git(other, 'commit', '--quiet', '-m', 'other')
  git(p.checkout, 'remote', 'set-url', 'origin', other)
  git(p.checkout, 'config', `url.${other}.insteadOf`, p.remote)
  writeFileSync(join(p.top, '.gitconfig'), `[url "${other}"]\n\tinsteadOf = ${p.remote}\n`)
  const opened = openSignedBase(p.state, p.checkout, p.base, p.inherited)
  assert.ok(typeof opened !== 'string', String(opened))
  assert.equal(opened.commit, git(p.remote, 'rev-parse', 'HEAD'))
  assert.equal(opened.entries.some((e) => e.path === 'only-other.ts'), false)
})

test('offline, the base is the commit the launcher last fetched itself; never fetched, there is none', (t) => {
  const p = place(t, { 'a.ts': 'one\n' })
  const first = openSignedBase(p.state, p.checkout, p.base, p.inherited)
  assert.ok(typeof first !== 'string')
  const gone = { ...p.base, remote_url: `file://${join(p.top, 'missing')}` }
  const offline = openSignedBase(p.state, p.checkout, gone, p.inherited)
  assert.ok(typeof offline !== 'string')
  assert.equal(offline.fetched, false)
  assert.equal(offline.commit, first.commit)
  const fresh = place(t, { 'a.ts': 'one\n' })
  assert.match(String(openSignedBase(fresh.state, fresh.checkout, gone, fresh.inherited)), /could not be fetched and none was fetched before/)
})

test('a push to the signed branch moves the base, a force-push included', (t) => {
  const p = place(t, { 'a.ts': 'one\n' })
  assert.ok(typeof openSignedBase(p.state, p.checkout, p.base, p.inherited) !== 'string')
  writeFileSync(join(p.remote, 'a.ts'), 'two\n')
  git(p.remote, 'commit', '--quiet', '--amend', '-am', 'rewritten')
  const moved = openSignedBase(p.state, p.checkout, p.base, p.inherited)
  assert.ok(typeof moved !== 'string')
  assert.equal(moved.commit, git(p.remote, 'rev-parse', 'HEAD'))
  assert.equal(git(join(p.state.directory, 'signed_base.git'), 'rev-parse', BASE_REF), moved.commit)
})

test('a remote url with a protocol the list does not allow is not fetched', (t) => {
  const p = place(t, { 'a.ts': 'one\n' })
  const ext = { ...p.base, remote_url: `ext::sh -c touch% ${join(p.top, 'ran')}` }
  assert.match(String(openSignedBase(p.state, p.checkout, ext, p.inherited)), /could not be fetched/)
  assert.equal(existsSync(join(p.top, 'ran')), false)
})
