// The entry a Goose launch writes into its config root so the engine starts the crew's tool server (martha#541,
// packages 7-8 part C, C1).
//
// This exists so the engine starts Martha's own server and nothing else under that name, and so the entry's shape is
// the engine's, read from the recording and never typed here. Every key written is one the recorded stdio variant
// reads (`stdio_extension.keys`), the variant is picked by the recorded tag and value, and the two variables it hands
// the server are checked against the names the engine drops from an entry's `envs` with only a warning: a variable the
// engine would drop fails here by name, and never reaches a launch whose server silently has no token.
//
// What the engine does with the entry (read at the pin, issue comment 6998895527): it spawns `cmd` with `args` and the
// entry's `envs`, without clearing its own environment, and sets PATH to its own search path. So:
//   - the server inherits only the launch's environment, which part A builds from nothing, and the entry's `envs`;
//     no variable of the owner's reaches it;
//   - `cmd` is the launcher's own node by its absolute path, and `args` names the server by its absolute path inside
//     Martha's own tree, so neither the engine's command lookup nor the PATH it sets decides anything for this start;
//   - the server is started confined to Martha's tree, the way the recorded mesh server is confined to its own
//     (`../install_the_recorded_mesh_server/confine_to_the_recorded_tree.ts`): every module it loads resolves inside
//     that tree or is one of node's, so nothing above it or under HOME is loaded in its place;
//   - Martha's tree and the member's checkout must not hold one another: bytes the member can write never serve the
//     crew's tools.
// The engine runs a command other than npx or uvx without asking the network anything, so the start makes no call.

import { realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { execPath } from 'node:process'
import { fileURLToPath } from 'node:url'

import { RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import { TREE_PARAMETER, treeUrlOf } from '../install_the_recorded_mesh_server/confine_to_the_recorded_tree.ts'
import type { StdioExtension } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { THE_CREWS_TOOL_SERVER, THE_TOKEN_VARIABLE } from './the_tool_servers_words.ts'

/** What the engine is told the server is for. */
export const THE_SERVERS_DESCRIPTION = "The crew's own tools, each answered by Martha's launcher."

/** How long the engine waits on the server, in seconds: the relay's own deadline is shorter, so the launcher's refusal arrives first. */
export const THE_SERVERS_TIMEOUT_S = 300

/** The flag that has node load the confining hook before the server. */
const IMPORT_FLAG = '--import'

/** The server's own file, and the hook that confines what it loads, both in Martha's tree. */
export const THE_SERVERS_FILE = fileURLToPath(new URL('./serve_the_crews_tools.ts', import.meta.url))
const THE_CONFINING_HOOK = new URL('../install_the_recorded_mesh_server/confine_to_the_recorded_tree.ts', import.meta.url)

/** Martha's own tree: the folder that holds `src/`, where the server and every module it loads must be. */
export const MARTHAS_TREE = fileURLToPath(new URL('../../', import.meta.url))

/** One value of the entry: text, a number, a list of text, or a mapping of text to text. */
export type AnEntrysValue = string | number | readonly string[] | Readonly<Record<string, string>>

/** The entry, its keys in the order they are written; the engine's `enabled` switch is the config's, not the entry's. */
export type TheToolServersEntry = ReadonlyArray<readonly [string, AnEntrysValue]>

/** What one launch gives the entry: its relay socket, its token, and the checkout its member works in. */
export interface WhatTheEntryNames {
  readonly socket_path: string
  readonly token: string
  readonly checkout: string
}

/** Where the server's start comes from, a test's to change: the node that runs it, the server, and Martha's tree. */
export interface WhereTheServerIs {
  readonly node: string
  readonly server: string
  readonly tree: string
}

const THIS_LAUNCHER: WhereTheServerIs = { node: execPath, server: THE_SERVERS_FILE, tree: MARTHAS_TREE }

/**
 * The entry for one launch, or a throw naming what makes it one the engine would not run as written: a key the
 * recorded variant does not read, a variable the engine drops, a path that is not absolute, a server outside
 * Martha's tree, or a tree that holds the checkout or sits in it. The throw never carries the token.
 */
export function theToolServersEntry(stdio: StdioExtension, names: WhatTheEntryNames, where: WhereTheServerIs = THIS_LAUNCHER): TheToolServersEntry {
  for (const [what, path] of [['the node', where.node], ['the server', where.server], ['the checkout', names.checkout], ['the relay socket', names.socket_path]] as const) {
    if (!isAbsolute(path)) throw new Error(`the crew's tool server is not written: ${what} is named by ${path}, which is not an absolute path`)
  }
  const tree = realpathSync(where.tree)
  const checkout = realpathSync(names.checkout)
  if (!holds(tree, realpathSync(where.server))) throw new Error(`the crew's tool server is not written: ${where.server} is outside Martha's tree ${tree}`)
  if (holds(tree, checkout) || holds(checkout, tree)) {
    throw new Error(`the crew's tool server is not written: Martha's tree ${tree} and the checkout ${checkout} hold one another, so the member could write the server's bytes`)
  }
  const envs = { [RELAY_SOCKET_VARIABLE]: names.socket_path, [THE_TOKEN_VARIABLE]: names.token }
  const dropped = Object.keys(envs).filter((name) => stdio.disallowed_env.some((disallowed) => disallowed.toLowerCase() === name.toLowerCase()))
  if (dropped.length > 0) throw new Error(`the crew's tool server is not written: the engine drops ${dropped.join(', ')} from an entry, so the server would start without it`)
  const confined = new URL(THE_CONFINING_HOOK)
  confined.searchParams.set(TREE_PARAMETER, treeUrlOf(tree))
  const entry: TheToolServersEntry = [
    [stdio.tag, stdio.type],
    ['name', THE_CREWS_TOOL_SERVER],
    ['description', THE_SERVERS_DESCRIPTION],
    ['cmd', where.node],
    ['args', [IMPORT_FLAG, confined.href, where.server]],
    ['envs', envs],
    ['timeout', THE_SERVERS_TIMEOUT_S],
  ]
  const unread = entry.map(([key]) => key).filter((key) => key !== stdio.tag && !stdio.keys.includes(key))
  if (unread.length > 0) throw new Error(`the crew's tool server is not written: the engine's stdio entry reads no ${unread.join(', ')}`)
  return entry
}

/** Whether `outer` is `inner` or a folder above it. */
function holds(outer: string, inner: string): boolean {
  const between = relative(outer, inner)
  return between === '' || (!between.startsWith(`..${sep}`) && between !== '..' && !isAbsolute(between))
}
