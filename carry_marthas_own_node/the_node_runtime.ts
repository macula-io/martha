// The Node a standalone Martha carries (martha#547, package S3).
//
// This exists so Martha runs from one download on Linux, with no Node on the user's machine.
//
// A standalone release is Martha's tree beside one pinned Node, not a Node single-executable application. The
// single executable was tried first and fails two things Martha does at run time
// (./try_a_single_executable/try_a_single_executable.ts proves both, on every platform below):
//   - Martha runs npm as `<node> <prefix>/lib/node_modules/npm/bin/npm-cli.js` (run_the_nodes_own_npm_alone), and a
//     single executable carries no npm beside it.
//   - Martha starts the mesh server as `<process.execPath> --import <hook> <file>` (install_the_recorded_mesh_server),
//     and in a single executable process.execPath is the executable itself: that start runs Martha's own main again.
//
// the_node_runtime.json is the pin: the exact version and nodejs.org's sha256 of each platform's archive, written by
// ./record_the_node_runtime.ts from the SHASUMS256.txt of that version, never by hand. the_node_runtime.node-test.ts
// holds the version to the engines floor of package.json and to the Node line Martha's CI runs.

import { readFileSync } from 'node:fs'

/** Where nodejs.org serves each release: `<NODE_DIST>/v<version>/<archive>`. */
export const NODE_DIST = 'https://nodejs.org/dist'

/** The file of nodejs.org's own sha256 for every archive of a release. */
export const NODE_SHASUMS = 'SHASUMS256.txt'

/** The platforms a standalone Martha ships for, in nodejs.org's own `<os>-<arch>` words: Linux only
 * (DECIDED 2026-11-19 "we build for linux, not windows or macOS"). */
export const PLATFORMS = ['linux-arm64', 'linux-x64'] as const

export type Platform = (typeof PLATFORMS)[number]

/** The pinned Node: its version, and the sha256 nodejs.org gives each platform's archive. */
export interface NodeRuntime {
  readonly version: string
  readonly archives: Readonly<Record<Platform, { readonly sha256: string }>>
}

/** The recording, beside this file. */
export const THE_NODE_RUNTIME_FILE = new URL('./the_node_runtime.json', import.meta.url)

const SHA256 = /^[0-9a-f]{64}$/
/** A Node version as nodejs.org names its releases, without the v. */
export const VERSION = /^\d+\.\d+\.\d+$/

/** The pinned Node, read from its recording; or why the recording cannot be used. */
export function theNodeRuntime(text: string = readFileSync(THE_NODE_RUNTIME_FILE, 'utf8')): NodeRuntime | { readonly refusal: string } {
  const read = JSON.parse(text) as { version?: unknown; archives?: Record<string, { sha256?: unknown } | undefined> }
  if (typeof read.version !== 'string' || !VERSION.test(read.version)) return { refusal: 'the recording names no X.Y.Z version' }
  const hashOf = (platform: Platform): unknown => read.archives?.[platform]?.sha256
  const missing = PLATFORMS.filter((platform) => typeof hashOf(platform) !== 'string' || !SHA256.test(hashOf(platform) as string))
  if (missing.length > 0) return { refusal: `the recording holds no sha256 for ${missing.join(', ')}` }
  return read as NodeRuntime
}

/** The platform this process runs on, in nodejs.org's words; or why a standalone Martha has none for it. */
export function platformOf(os: string = process.platform, arch: string = process.arch): Platform | { readonly refusal: string } {
  const platform = `${os}-${arch}`
  return (PLATFORMS as readonly string[]).includes(platform) ? (platform as Platform) : { refusal: `a standalone Martha is not made for ${platform}` }
}

/** The name of a platform's archive, as nodejs.org names it, and the folder it unpacks to. */
export function archiveOf(version: string, platform: Platform): { readonly file: string; readonly folder: string } {
  const folder = `node-v${version}-${platform}`
  return { file: `${folder}.tar.xz`, folder }
}

/** Where nodejs.org serves `file` of `version`. */
export function urlOf(version: string, file: string): string {
  return `${NODE_DIST}/v${version}/${file}`
}
