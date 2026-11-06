// The mesh server loads modules from its recorded tree and nowhere else (martha#73).
//
// This exists so code planted above the tree or under HOME never runs in the
// proved mesh server (register row B1).
//
// The launcher proves every file of the installed tree (martha#65), but node
// resolves a bare `require` or `import` by walking up every node_modules above
// the requiring file, and a `require` also through the global folders
// ($HOME/.node_modules, $HOME/.node_libraries, <prefix>/lib/node). A module the
// tree does not hold, such as an optional dependency nobody installed, is looked
// for in each of them, and the member's own user can write any of them. A scan
// of the tree cannot list what is looked for: the recorded tree names about a
// hundred modules it does not hold (tests, browser builds, optional ones) and
// loads others by computed names.
//
// So the server is started confined: `node --import <this file>?tree=<url> <bin>`
// (./install_the_recorded_mesh_server.ts places it). Imported that way, this
// registers a resolve hook, which runs for every `require` and `import`,
// computed ones included. A module that resolves to anything heldByTheTree
// does not allow is refused as not found, the way an optional module the tree
// lacks is missing on a machine where nothing was planted. Imported without
// `?tree=`, by the launcher or a test, it only exports the rule.
//
// The hook is the launcher's own file, outside the tree and HOME. The flag is
// in the server's arguments, so a worker thread or a fork of the server keeps
// it (they inherit node's arguments); NODE_OPTIONS is emptied for the server
// anyway (SERVER_NEEDS).
//
// What this does not close: `process.dlopen` with an absolute path, and a child
// node process the server starts with arguments of its own, are not resolved
// through this hook. Only code of the tree can do either, and that code is
// compared file by file before every launch, so what it names is the tree's own
// choice, not the member's.

import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

/** The query parameter that names the tree, as a file URL. */
export const TREE_PARAMETER = 'tree'
const BUILTIN = 'node:'
const FILE = 'file:'

/** The tree's URL as a directory: ending in one slash, so a sibling whose name only starts like it is not inside. */
const asDirectory = (url: string): string => (url.endsWith('/') ? url : `${url}/`)

/** The tree named as a file URL, from its path. */
export const treeUrlOf = (tree: string): string => asDirectory(pathToFileURL(tree).href)

/**
 * Whether the server may load what `url` resolved to: one of node's own
 * modules, or a file inside `tree` (a path, or a file URL). The one allow rule.
 */
export function heldByTheTree(url: string, tree: string): boolean {
  if (url.startsWith(BUILTIN)) return true
  const inside = tree.startsWith(FILE) ? asDirectory(tree) : treeUrlOf(tree)
  return url.startsWith(inside)
}

/** The error a missing module gives, by how it was asked for, so optional loads fall back as they do without it. */
function notInTheTree(specifier: string, url: string, required: boolean): Error {
  const error = new Error(`Cannot find module '${specifier}': it resolves to ${url}, outside the recorded mesh server tree`) as Error & { code: string }
  error.code = required ? 'MODULE_NOT_FOUND' : 'ERR_MODULE_NOT_FOUND'
  return error
}

const confinedTo = new URL(import.meta.url).searchParams.get(TREE_PARAMETER)
if (confinedTo !== null) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      if (heldByTheTree(resolved.url, confinedTo)) return resolved
      throw notInTheTree(specifier, resolved.url, context.conditions.includes('require'))
    },
  })
}
