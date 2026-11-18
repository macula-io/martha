// One test run lives inside one temporary root (martha#724). These are the claims the wrapper makes: its roots go when
// the run ends, whatever the run left in them; a root a hard-killed run left is removed by the next run, and a live
// run's root is never touched; the runtime root it picks can hold the deepest relay socket this repository builds, and a
// directory that cannot is not used; and a TMPDIR reached through a link stays the path it was given.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { setTimeout as after } from 'node:timers/promises'

import { SYSTEM_TEMPORARY_DIRECTORY } from '../src/host_contract/host_contract.ts'
import { RELAY_ROOT_PREFIX } from '../src/drive_the_recorded_host/short_relay_root.ts'
import { longestSocketPath, makeRelayDirectory, RELAY_SOCKET_NAME } from '../src/serve_the_relay_to_a_launch/relay_directory.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { withoutTheTestContext } from './every_test_run_ends.ts'
import { RUN_RUNTIME_ROOT_VARIABLE, RUN_TEMP_ROOT_VARIABLE } from './every_test_file_cleans_up.ts'
import { RUN_ROOT_PREFIX, THE_WRAPPER } from './keep_a_test_run_in_one_temporary_root.ts'

const repository = join(import.meta.dirname, '..')
/** How long a wrapped command may take before the check calls it hung and stops it. */
const RUN_DEADLINE_MS = 30_000
/** How many times a check looks again for what a run writes, and how long between. */
const WAITS = 100
const WAIT_MS = 50

/**
 * This process's environment without the roots the suite gave this file, so a run started here makes roots of its own —
 * which is the run this file's claims are about.
 */
function withoutTheRootsOfThisRun(): NodeJS.ProcessEnv {
  const names = [RUN_RUNTIME_ROOT_VARIABLE, RUN_TEMP_ROOT_VARIABLE]
  return Object.fromEntries(Object.entries(withoutTheTestContext(process.env)).filter(([name]) => !names.includes(name)))
}

/** Runs `words` through the wrapper as the test script does, with `env` added, and answers what it wrote. */
function throughTheWrapper(words: readonly string[], env: NodeJS.ProcessEnv = {}): { code: number | null; output: string } {
  const ran = spawnSync(process.execPath, [THE_WRAPPER, ...words], {
    cwd: repository,
    encoding: 'utf8',
    timeout: RUN_DEADLINE_MS,
    env: { ...withoutTheRootsOfThisRun(), ...env },
  })
  return { code: ran.status, output: `${ran.stdout ?? ''}${ran.stderr ?? ''}` }
}

/** A node program that writes `text` into the temp directory the run gave it, then answers where everything is. */
const makesAndAnswers = (where: string): readonly string[] => [
  process.execPath,
  '--input-type=module',
  '-e',
  [
    `const fs = await import('node:fs')`,
    `fs.writeFileSync(process.env.TMPDIR + '/what-the-run-wrote', 'x')`,
    `fs.writeFileSync(${JSON.stringify(where)}, [process.env.TMPDIR, process.env.XDG_RUNTIME_DIR].join('\\n'))`,
    `process.stdout.write('the run answered')`,
  ].join('\n'),
]

test('a run\'s roots, and what it wrote in them, are gone when it ends', (t) => {
  const holder = mkdtempSync(join(tmpdir(), 'martha-724-roots-'))
  t.after(() => removeTheTree(holder))
  const where = join(holder, 'the-roots')
  const ran = throughTheWrapper(makesAndAnswers(where))
  assert.equal(ran.code, 0, ran.output)
  const [temp, runtime] = readFileSync(where, 'utf8').split('\n')
  // The temp root goes under the TMPDIR the run inherited, as given and never resolved (ci.yml runs the whole suite
  // again under a long one reached through a link), and never under the system's own directory: the two are the same
  // folder only where TMPDIR names none, which is why this reads the folder the run would have reached for itself.
  assert.ok(temp !== undefined && temp.startsWith(join(tmpdir(), RUN_ROOT_PREFIX)), `the run's temp root was ${temp}`)
  assert.equal(existsSync(temp), false, 'the run\'s temp root is still there after the run ended')
  assert.ok(runtime !== undefined && runtime.includes(RUN_ROOT_PREFIX), `the run's runtime root was ${runtime}`)
  assert.equal(existsSync(runtime), false, 'the run\'s runtime root is still there after the run ended')
})

test('a runtime directory too long for the deepest socket is not used, and the system temporary directory is', (t) => {
  const longer = mkdtempSync(join(tmpdir(), 'martha-724-long-runtime-'))
  t.after(() => removeTheTree(longer))
  const printsItsRuntime = [process.execPath, '-e', 'process.stdout.write(process.env.XDG_RUNTIME_DIR ?? "")']
  const unset = throughTheWrapper(printsItsRuntime, { XDG_RUNTIME_DIR: '' })
  assert.equal(unset.code, 0, unset.output)
  assert.ok(unset.output.startsWith(join(SYSTEM_TEMPORARY_DIRECTORY, RUN_ROOT_PREFIX)), `with no runtime directory the fallback was not used: ${unset.output}`)
  const tooLong = throughTheWrapper(printsItsRuntime, { XDG_RUNTIME_DIR: longer })
  assert.equal(tooLong.code, 0, tooLong.output)
  assert.ok(tooLong.output.startsWith(join(SYSTEM_TEMPORARY_DIRECTORY, RUN_ROOT_PREFIX)), `a runtime directory with no room for the deepest socket was used: ${tooLong.output}`)
})

test('the deepest relay socket this repository builds has room in the runtime root the run picked', (t) => {
  // Measured inside the root the run itself made, with every piece of the path the repository's own: the per-file
  // directory's name and length, the relay root's prefix and mkdtemp's six characters, the runtime scope the command
  // nests under this user's, a launch's uuid, and the socket's own name.
  const printsItsRuntime = [process.execPath, '-e', 'process.stdout.write(process.env.XDG_RUNTIME_DIR ?? "")']
  const ran = throughTheWrapper(printsItsRuntime)
  assert.equal(ran.code, 0, ran.output)
  const runtime_root = ran.output.trim()
  const per_file = join(runtime_root, 'f1a2b')
  const deepest = join(per_file, `${RELAY_ROOT_PREFIX}aB3dE9`, `martha-${String(process.getuid?.() ?? -1)}`, '00000000-0000-4000-8000-000000000000', RELAY_SOCKET_NAME)
  assert.equal(existsSync(runtime_root), false, 'the run\'s runtime root outlived it, so what this measured was not a run\'s root')
  assert.ok(
    Buffer.byteLength(deepest) <= longestSocketPath(),
    `${deepest} is ${String(Buffer.byteLength(deepest))} bytes, longer than the ${String(longestSocketPath())} a socket address holds on ${process.platform}`,
  )
  assert.ok(runtime_root.startsWith(join(SYSTEM_TEMPORARY_DIRECTORY, RUN_ROOT_PREFIX)), `the root this measured was not one the wrapper made: ${runtime_root}`)
  t.diagnostic(`${String(longestSocketPath() - Buffer.byteLength(deepest))} bytes spare in ${runtime_root}`)
})

test('a socket path one byte past what an address holds is refused, and one that exactly fits is not', (t) => {
  const parent = mkdtempSync(join(SYSTEM_TEMPORARY_DIRECTORY, 'martha-724-budget-'))
  t.after(() => removeTheTree(parent))
  const longest = longestSocketPath()
  // `<parent>/<name>/relay.sock` is the parent's length, two separators, the name, and the socket's own name.
  const nameOfLength = (name: number): string => join(parent, 'd'.repeat(name))
  const aNameMaking = (bytes: number): string => nameOfLength(bytes - Buffer.byteLength(parent) - 2 - Buffer.byteLength(RELAY_SOCKET_NAME))
  const fits = aNameMaking(longest)
  const over = aNameMaking(longest + 1)
  const made = makeRelayDirectory(fits)
  t.after(() => {
    if (made.made) made.remove()
  })
  assert.equal(made.made, true, `a socket path of exactly ${String(longest)} bytes was refused: ${'refusal' in made ? made.refusal : ''}`)
  assert.equal('refusal' in makeRelayDirectory(over), true, `a socket path one byte past ${String(longest)} was accepted`)
})

test('a TMPDIR reached through a link stays the path it was given, and its entries are found through the link', (t) => {
  const private_place = mkdtempSync(join(SYSTEM_TEMPORARY_DIRECTORY, 'martha-724-private-'))
  const holder = mkdtempSync(join(SYSTEM_TEMPORARY_DIRECTORY, 'martha-724-link-'))
  t.after(() => removeTheTree(private_place))
  t.after(() => removeTheTree(holder))
  const linked_place = join(holder, 'through-a-link')
  symlinkSync(private_place, linked_place)
  const printsBoth = [process.execPath, '--input-type=module', '-e',
    [
      `const fs = await import('node:fs')`,
      `fs.writeFileSync(process.env.TMPDIR + '/made-through-the-link', 'x')`,
      `process.stdout.write(process.env.TMPDIR + '\\n' + fs.realpathSync(process.env.TMPDIR))`,
    ].join('\n')]
  const ran = throughTheWrapper(printsBoth, { TMPDIR: linked_place })
  assert.equal(ran.code, 0, ran.output)
  const [given, resolved] = ran.output.split('\n')
  assert.ok(given !== undefined && given.startsWith(linked_place), `the run's temp directory was ${String(given)}, not the link it was given`)
  assert.ok(resolved !== undefined && resolved.startsWith(realpathSync(private_place)), `the link was resolved to ${String(resolved)}, so a path built under TMPDIR is no longer the linked one`)
})

/** Whether the file at `path` has been written yet, looked for a while: a run writes it as soon as it starts. */
async function afterTheFile(path: string): Promise<boolean> {
  for (let wait = 0; wait < WAITS; wait += 1) {
    if (existsSync(path)) return true
    await after(WAIT_MS)
  }
  return false
}

test('the root a hard-killed run left is removed by the next run', async (t) => {
  if (!existsSync('/proc/self/stat')) {
    t.skip('this kernel keeps no /proc, so no run can tell a root whose run is gone from a live one')
    return
  }
  const holder = mkdtempSync(join(tmpdir(), 'martha-724-killed-'))
  t.after(() => removeTheTree(holder))
  const where = join(holder, 'the-roots')
  // A run that never ends by itself: it writes its roots where this check can read them, then waits to be killed.
  const waiting = [process.execPath, '-e',
    [
      `const fs = require('node:fs')`,
      `fs.writeFileSync(${JSON.stringify(where)}, [process.env.TMPDIR, process.env.XDG_RUNTIME_DIR].join('\\n'))`,
      `setTimeout(() => {}, 1e9)`,
    ].join('\n')]
  const child = spawn(process.execPath, [THE_WRAPPER, ...waiting], { cwd: repository, env: withoutTheRootsOfThisRun(), detached: true, stdio: 'ignore' })
  const group = child.pid
  t.after(() => {
    try {
      process.kill(-(group ?? 0), 'SIGKILL')
    } catch {
      // Nothing left in the group: what this check wants.
    }
  })
  const written = await afterTheFile(where)
  assert.ok(written, 'the run never wrote its roots, so this check could not tell what it left')
  const [temp, runtime] = readFileSync(where, 'utf8').split('\n')
  // Killed, and then waited for: a process this one has not reaped is still a pid the kernel holds, and a sweep that
  // saw it would rightly think its run alive.
  const ended = once(child, 'exit')
  process.kill(-(group ?? 0), 'SIGKILL')
  await ended
  // The wrapper dies with the run, so nothing of that run removes its roots: the next run's sweep does.
  assert.ok(temp !== undefined && existsSync(temp), 'the roots went with a run that was killed, so this check proves nothing')
  assert.equal(existsSync(runtime ?? ''), true, 'the runtime root went with a run that was killed, so this check proves nothing')
  const next = throughTheWrapper([process.execPath, '-e', 'process.stdout.write("ran")'])
  assert.equal(next.code, 0, next.output)
  assert.equal(existsSync(temp), false, 'the temp root a hard-killed run left was still there after the next run')
  assert.equal(existsSync(runtime ?? ''), false, 'the runtime root a hard-killed run left was still there after the next run')
})
