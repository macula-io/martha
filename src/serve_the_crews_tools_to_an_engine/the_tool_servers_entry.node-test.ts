// The entry a Goose launch writes for the crew's tool server is the engine's own shape, starts Martha's own server by
// absolute paths confined to Martha's tree, and goes with the engine's process group (martha#541, packages 7-8 part C,
// C1).

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'

import { RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import { TREE_PARAMETER, treeUrlOf } from '../install_the_recorded_mesh_server/confine_to_the_recorded_tree.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { startTheEngine, theEnvironmentOfALaunch, thePlacesOfALaunch } from '../launch_a_goose_member/launch_a_goose_member.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { RELAY_SOCKET_NAME } from '../serve_the_relay_to_a_launch/relay_directory.ts'
import { A_TESTS_WAIT_MS, aScriptedRelay, theEntrysValue } from './a_stand_in_engine.ts'
import { MARTHAS_TREE, THE_SERVERS_FILE, theToolServersEntry } from './the_tool_servers_entry.ts'
import { THE_CREWS_TOOL_SERVER, THE_TOKEN_VARIABLE } from './the_tool_servers_words.ts'

const STDIO = RECORDED_GOOSE_ENGINE.stdio_extension

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-tool-server-entry-'))
  t.after(() => removeTheTree(dir))
  return dir
}

/** What a launch names in the entry, with a checkout of a test's own and a token no constant holds. */
function namesFor(t: TestContext): { readonly socket_path: string; readonly token: string; readonly checkout: string } {
  const dir = scratch(t)
  return { socket_path: join(dir, RELAY_SOCKET_NAME), token: 'a-token-a-test-names', checkout: dir }
}

test("every key of the entry is one the engine's stdio entry reads, picked by the recorded tag, and the server is Martha's", (t) => {
  const names = namesFor(t)
  const entry = theToolServersEntry(STDIO, names)
  assert.deepEqual(entry[0], [STDIO.tag, STDIO.type], 'the entry is not tagged as the stdio variant first')
  for (const [key] of entry.slice(1)) assert.ok(STDIO.keys.includes(key), `the engine's stdio entry reads no ${key}`)
  assert.equal(theEntrysValue(entry, 'name'), THE_CREWS_TOOL_SERVER)
  assert.deepEqual(theEntrysValue(entry, 'envs'), { [RELAY_SOCKET_VARIABLE]: names.socket_path, [THE_TOKEN_VARIABLE]: names.token })
})

test("the server starts by absolute paths: the launcher's own node, and the server inside Martha's tree, confined to it (mutant: the confining hook dropped)", (t) => {
  const entry = theToolServersEntry(STDIO, namesFor(t))
  const cmd = theEntrysValue(entry, 'cmd') as string
  const args = theEntrysValue(entry, 'args') as readonly string[]
  assert.equal(cmd, process.execPath, "the command is not the launcher's own node")
  assert.ok(isAbsolute(cmd))
  const server = args.at(-1) ?? ''
  assert.equal(server, THE_SERVERS_FILE)
  assert.ok(isAbsolute(server) && !relative(realpathSync(MARTHAS_TREE), realpathSync(server)).startsWith('..'), `${server} is not inside Martha's tree`)
  // The hook before the server: node loads it first, and it refuses every module outside the tree it names.
  const hook = new URL(args.at(-2) ?? '')
  assert.equal(args.at(-3), '--import')
  assert.ok(existsSync(fileURLToPath(hook)), 'the confining hook is not a file')
  assert.equal(hook.searchParams.get(TREE_PARAMETER), treeUrlOf(realpathSync(MARTHAS_TREE)))
})

test("a variable the engine drops from an entry refuses the entry by name, never a server started without it, and the refusal holds no token", (t) => {
  const names = namesFor(t)
  for (const dropped of [THE_TOKEN_VARIABLE, RELAY_SOCKET_VARIABLE.toLowerCase()]) {
    const stdio = { ...STDIO, disallowed_env: [...STDIO.disallowed_env, dropped] }
    assert.throws(() => theToolServersEntry(stdio, names), (error: Error) => error.message.includes(dropped.toUpperCase()) && !error.message.includes(names.token))
  }
})

test('a key the recorded stdio entry does not read refuses the entry by name', (t) => {
  const stdio = { ...STDIO, keys: STDIO.keys.filter((key) => key !== 'timeout') }
  assert.throws(() => theToolServersEntry(stdio, namesFor(t)), /reads no timeout/)
})

test("a checkout that holds Martha's tree, or sits inside it, refuses the entry: the member could write the server (mutant: the overlap check removed)", (t) => {
  const names = namesFor(t)
  const tree = join(names.checkout, 'martha')
  const server = join(tree, 'src', 'a_server.ts')
  mkdirSync(join(tree, 'src'), { recursive: true })
  writeFileSync(server, '')
  const where = { node: process.execPath, server, tree }
  assert.throws(() => theToolServersEntry(STDIO, names, where), /hold one another/)
  assert.throws(() => theToolServersEntry(STDIO, { ...names, checkout: join(tree, 'src') }, where), /hold one another/)
  const elsewhere = scratch(t)
  assert.doesNotThrow(() => theToolServersEntry(STDIO, { ...names, checkout: elsewhere }, where))
})

test("a server outside Martha's tree, or a path that is not absolute, refuses the entry", (t) => {
  const names = namesFor(t)
  const elsewhere = join(scratch(t), 'a_server.ts')
  writeFileSync(elsewhere, '')
  assert.throws(() => theToolServersEntry(STDIO, names, { node: process.execPath, server: elsewhere, tree: MARTHAS_TREE }), /outside Martha's tree/)
  assert.throws(() => theToolServersEntry(STDIO, names, { node: 'node', server: THE_SERVERS_FILE, tree: MARTHAS_TREE }), /not an absolute path/)
  assert.throws(() => theToolServersEntry(STDIO, { ...names, socket_path: RELAY_SOCKET_NAME }), /not an absolute path/)
})

/** Quotes a value for the stand-in engine's shell script. */
const shellQuoted = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/** Whether the process `pid` is still there. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test("the server the engine starts from the entry is in the engine's process group, and the group kill takes it (martha#541, part A's group test, extended)", async (t) => {
  const relay = await aScriptedRelay(t, () => ({ answer: 'an answer a test names' }))
  const dir = scratch(t)
  const root = join(dir, 'launch')
  mkdirSync(root)
  const made = thePlacesOfALaunch(root, relay.checkout)
  assert.ok('places' in made)
  const entry = theToolServersEntry(STDIO, relay)
  const envs = theEntrysValue(entry, 'envs') as Readonly<Record<string, string>>
  const command = [theEntrysValue(entry, 'cmd') as string, ...(theEntrysValue(entry, 'args') as readonly string[])].map(shellQuoted).join(' ')
  const assignments = Object.entries(envs).map(([name, value]) => `${name}=${shellQuoted(value)}`).join(' ')
  // The engine spawns the server with the entry's envs on its own environment, its stdin a pipe the engine holds open.
  const theServersPid = join(dir, 'the-servers-pid')
  const engine = join(dir, 'a-stand-in-engine')
  writeFileSync(engine, ['#!/bin/sh', `sleep 60 | env ${assignments} ${command} &`, `echo $! > ${shellQuoted(`${theServersPid}.being-written`)}`, `mv ${shellQuoted(`${theServersPid}.being-written`)} ${shellQuoted(theServersPid)}`, 'sleep 61', ''].join('\n'), { mode: 0o700 })

  const started = await startTheEngine(RECORDED_GOOSE_ENGINE, engine, made.places, theEnvironmentOfALaunch(RECORDED_GOOSE_ENGINE, made.places))
  assert.ok('pid' in started, 'the stand-in engine did not start')
  t.after(() => started.stop())
  let pid = 0
  for (let waited = 0; waited < A_TESTS_WAIT_MS && pid === 0; waited += 25) {
    if (existsSync(theServersPid)) pid = Number(readFileSync(theServersPid, 'utf8').trim())
    else await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.ok(pid > 0 && isRunning(pid), "the crew's tool server never ran under the stand-in engine")

  const ended = started.exited
  started.stop()
  await ended
  for (let waited = 0; waited < A_TESTS_WAIT_MS && isRunning(pid); waited += 25) await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(isRunning(pid), false, "the crew's tool server outlived its engine's group kill")
})
