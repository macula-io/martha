// The bus a member gets, and the judgement of a unit that already runs under the bus's name (martha#989, C4, C5): a
// port of crew-code's memberBusOf and busUnitUnlike (tests/away_from_the_desktop.mjs at macula-sponsors 6f353d51).

import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { busUnitUnlike, NO_DESKTOP_BUS, PROXY, SYSTEMD_TALK, theMemberBusOf, type AMemberBus } from './the_systemd_only_bus.ts'

/** A bus block none of whose names is the one `martha init` writes, so a default read would show. */
const BUS = { unit: 'tests-only-bus', socket: 'tests-only-bus-socket' }

/** A place of the test's own: a runtime dir, a bin dir, removed after. */
function aPlace(t: { after(fn: () => void): void }): { readonly runtime: string; readonly bin: string } {
  const root = mkdtempSync(join(tmpdir(), 'martha-989-bus-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runtime = join(root, 'run')
  const bin = join(root, 'bin')
  mkdirSync(join(runtime, 'systemd'), { recursive: true })
  mkdirSync(bin)
  return { runtime, bin }
}

/** A unix socket listening at `path` until the test ends: what `isSocket` reads. */
async function aSocketAt(t: { after(fn: () => void): void }, path: string): Promise<void> {
  const server: Server = createServer()
  await new Promise<void>((resolve) => server.listen(path, resolve))
  t.after(() => server.close())
}

/** A program named `name` in `bin` that does nothing. */
function aProgram(bin: string, name: string): string {
  const at = join(bin, name)
  writeFileSync(at, '#!/bin/sh\nexit 0\n')
  chmodSync(at, 0o755)
  return at
}

const closedWhy = (bus: AMemberBus): string => {
  assert.ok('closed' in bus, `the bus was not closed: ${JSON.stringify(bus)}`)
  assert.equal(bus.address, NO_DESKTOP_BUS)
  return bus.closed
}

test('#989 C4: with a user manager, the proxy and a session bus, a member gets the proxy\'s socket, and the proxy narrows to systemd alone', async (t) => {
  const { runtime, bin } = aPlace(t)
  await aSocketAt(t, join(runtime, 'systemd', 'private'))
  await aSocketAt(t, join(runtime, 'bus'))
  const proxy = aProgram(bin, PROXY)
  const bus = theMemberBusOf({ XDG_RUNTIME_DIR: runtime, PATH: bin }, BUS)

  assert.ok(!('closed' in bus), `the bus was closed: ${JSON.stringify(bus)}`)
  assert.equal(bus.address, `unix:path=${join(runtime, BUS.socket)}`)
  assert.equal(bus.unit, BUS.unit)
  assert.equal(bus.socket, join(runtime, BUS.socket))
  assert.deepEqual(bus.argv, [proxy, `unix:path=${join(runtime, 'bus')}`, join(runtime, BUS.socket), '--filter', `--talk=${SYSTEMD_TALK}`])
})

test('#989 C4: with no runtime dir, no user manager, no proxy or no session bus, the member\'s bus is closed, and why is said', async (t) => {
  const { runtime, bin } = aPlace(t)
  assert.match(closedWhy(theMemberBusOf({ PATH: bin }, BUS)), /XDG_RUNTIME_DIR is unset/)
  assert.match(closedWhy(theMemberBusOf({ XDG_RUNTIME_DIR: runtime, PATH: bin }, BUS)), /no user manager listens/)
  await aSocketAt(t, join(runtime, 'systemd', 'private'))
  assert.match(closedWhy(theMemberBusOf({ XDG_RUNTIME_DIR: runtime, PATH: bin }, BUS)), new RegExp(`no ${PROXY} on PATH`))
  aProgram(bin, PROXY)
  assert.match(closedWhy(theMemberBusOf({ XDG_RUNTIME_DIR: runtime, PATH: bin }, BUS)), /no session bus listens/)
})

test('#989 C5: a unit\'s process is the bus only when its program is the very file and every other word is the command\'s', (t) => {
  const { bin } = aPlace(t)
  const proxy = aProgram(bin, PROXY)
  const lookalike = join(bin, 'elsewhere')
  copyFileSync(proxy, lookalike)
  const link = join(bin, 'linked-proxy')
  symlinkSync(proxy, link)
  const argv = [proxy, 'unix:path=/run/user/1/bus', '/run/user/1/s', '--filter', `--talk=${SYSTEMD_TALK}`]

  assert.equal(busUnitUnlike(argv, { program: proxy, words: ['any-name-it-gave-itself', ...argv.slice(1)] }), undefined)
  assert.equal(busUnitUnlike([link, ...argv.slice(1)], { program: proxy, words: argv }), undefined, 'a command naming the proxy through a link was not read by real path')
  assert.match(busUnitUnlike(argv, { program: undefined, words: [] }) ?? '', /runs no command that can be read/)
  assert.match(busUnitUnlike(argv, { program: lookalike, words: argv }) ?? '', /as the program/)
  // A wider talk, no filter, one word more or one fewer: each is another bus.
  for (const words of [
    [...argv.slice(0, 4), '--talk=org.freedesktop.secrets'],
    argv.filter((word) => word !== '--filter'),
    [...argv, '--talk=org.kde.kwalletd6'],
    argv.slice(0, -1),
  ]) {
    assert.match(busUnitUnlike(argv, { program: proxy, words }) ?? '', /^runs `/, `${words.join(' ')} was taken for the bus`)
  }
})
