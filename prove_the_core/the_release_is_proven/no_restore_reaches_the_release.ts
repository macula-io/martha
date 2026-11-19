// No restore of installer/ reaches a release (martha#695, T1):
//
//   node prove_the_core/the_release_is_proven/no_restore_reaches_the_release.ts [--workflow <file>] [--top <dir>]
//
// Exit 0 nothing in the release path restores installer/ or runs the dry packer; 1 it does, each found line named;
// 2 the check could not be made. It never passes because it could not look.
//
// The dry packer, rehearse_a_release/place_main_as_a_dry_release/pack_main_as_a_dry_layer.sh, restores installer/ from
// the tag its version was published at, inside a clone of its own, so a dry run of a drifted main can still pack. That
// restore must never happen on the release path: a release that restored its installer/ would ship a layer whose tree
// its tag does not hold, while its pin named the published installer (martha#84). The dry commit is marked by
// DRY_RESTORE_SUBJECT and refused on a tag by pack_a_release/refuse_a_dry_restore_tag.sh; this checks the other half,
// that no step of the release does the restore itself.
//
// What it reads: the release workflow's `run:` lines, every script those lines name that exists in the tree, every
// local `uses: ./...` action and its own run lines, and so on until nothing new is named. An action from another
// repository (`uses: owner/repo@ref`) is named as not read, by name, because nothing here can.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/** What every line this check prints starts with. */
export const NAME = 'no_restore_reaches_the_release'

/** The workflow a release runs, from the repository's top. */
export const THE_RELEASE_WORKFLOW = '.github/workflows/release.yml'

/** The dry packer's own script: a release step that runs it is on the dry path. */
export const THE_DRY_PACKER = /\bpack_main_as_a_dry_layer\b/

/**
 * A text with its comment lines taken out: a path or a word named in prose is not something the release runs, and a
 * guard that says what it is guarding against must not read as the thing it refuses (shell and YAML both start a
 * comment with `#`).
 * @param {string} text
 */
export const commentless = (text: string): string =>
  text.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')

/** What a line does when it puts another ref's installer/ in the tree. */
export const REWRITES_THE_INSTALLER: readonly RegExp[] = [
  /\bcheckout\b[^\n]*\binstaller\/?['"\s]*$/m,
  /\brestore\b[^\n]*(?:--source\b|\s-s)[^\n]*installer/,
  /\bcheckout\b[^\n]*--\s+installer\b/,
  /\bgit\s+rm\b[^\n]*\binstaller\b/
]

/** A local action a workflow step names, as a folder from the repository's top. */
const A_LOCAL_ACTION = /uses:\s*\.\/([\w./-]+)/g
/** An action from another repository, which this check cannot read and says so. */
const AN_ACTION_ELSEWHERE = /uses:\s*(?!\.\/)([\w.-]+\/[\w.-]+)(?:\/[\w./-]*)?@/g
/**
 * A file a run line names, which may be a script the release runs: a shell script, or a module a step runs by name.
 * A `.ts` module is not followed -- the release runs no TypeScript, and following the imports of what it does run would
 * walk the whole repository to answer a question about the release path.
 */
const A_FILE = /(?:\.\/)?[\w][\w./-]*\.(?:sh|mjs|js)/g

/**
 * The local actions and the actions from elsewhere that a workflow names.
 * @param {string} workflow
 */
export function theActionsOf(workflow: string): { local: string[]; elsewhere: string[] } {
  return {
    local: [...workflow.matchAll(A_LOCAL_ACTION)].map((found) => (found[1] ?? '').replace(/\/$/, '')),
    elsewhere: [...new Set([...workflow.matchAll(AN_ACTION_ELSEWHERE)].map((found) => found[1] ?? ''))]
  }
}

/**
 * The files a text names that are really in the tree.
 * @param {string} text @param {string} top
 */
export function theFilesIn(text: string, top: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(A_FILE)) {
    const path = match[0].replace(/^\.\//, '')
    if (existsSync(join(top, path))) found.push(path)
  }
  return found
}

/**
 * What comes next from a text: the files of every local action it names, and the scripts its run lines name, each as a
 * path from the top and only when it is really there. A local `uses:` path that is itself a `.yml` or `.yaml` file is a
 * workflow the release calls, not a folder holding an action, and it is read as it is (martha#695, Venus r=1 R3).
 * @param {string} code @param {string} top
 */
export function theFilesAfter(code: string, top: string): string[] {
  const actions = theActionsOf(code).local.flatMap((action) =>
    /\.ya?ml$/.test(action) ? [action] : ['action.yml', 'action.yaml'].map((name) => `${action}/${name}`))
  return [...actions.filter((at) => existsSync(join(top, at))), ...theFilesIn(code, top)]
}

/**
 * Every script a release runs, read from the workflow and from the scripts it names, until nothing new is named, and
 * the actions it runs from elsewhere, which cannot be read and are named as such.
 * @param {string} top @param {string} workflowPath
 */
export function theReleasePath(top: string, workflowPath: string): { read: Map<string, string>; elsewhere: string[] } {
  const read = new Map<string, string>()
  const elsewhere: string[] = []
  const queue: string[] = [workflowPath]
  while (queue.length > 0) {
    const path = queue.shift()
    if (path === undefined || read.has(path)) continue
    const text = readFileSync(join(top, path), 'utf8')
    read.set(path, text)
    const code = commentless(text)
    elsewhere.push(...theActionsOf(code).elsewhere)
    queue.push(...theFilesAfter(code, top).filter((file) => !read.has(file)))
  }
  return { read, elsewhere: [...new Set(elsewhere)].filter((one) => !one.startsWith('.')) }
}

/**
 * What is wrong in a text: the lines that run the dry packer, and the lines that put another ref's installer/ in the
 * tree. A line that does both is named once.
 * @param {string} text
 */
export function whatIsWrongIn(text: string): string[] {
  const wrong: string[] = []
  for (const line of text.split('\n')) {
    if (THE_DRY_PACKER.test(line) || REWRITES_THE_INSTALLER.some((rule) => rule.test(line))) wrong.push(line.trim())
  }
  return wrong
}

/** The value after an option, or undefined. @param {string[]} argv @param {string} name */
const option = (argv: string[], name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

/**
 * The check, over the release workflow at `workflowPath` in the tree at `top`: [code, lines to print].
 * @param {string} top @param {string} workflowPath
 */
export function theGate(top: string, workflowPath: string): [number, string[]] {
  if (!existsSync(join(top, workflowPath))) return [2, [`${NAME}: no ${workflowPath} to read, so nothing was checked`]]
  let read: Map<string, string>
  let elsewhere: string[]
  try {
    ({ read, elsewhere } = theReleasePath(top, workflowPath))
  } catch (error) {
    return [2, [`${NAME}: the release path could not be read: ${error instanceof Error ? error.message : String(error)}`]]
  }
  const wrong = [...read].flatMap(([path, text]) => whatIsWrongIn(commentless(text)).map((line) => `${path}: ${line}`))
  const notRead = elsewhere.length === 0 ? [] : [`${NAME}: not read, because they are another repository's: ${elsewhere.join(', ')}`]
  if (wrong.length > 0) return [1, [`${NAME}: the release path restores installer/ from another ref, or runs the dry packer:`, ...wrong.map((one) => `  ${one}`), ...notRead]]
  return [0, [`${NAME}: read ${read.size} file(s) of the release path and found no restore of installer/ in it`, ...notRead]]
}

// Run when it is run, and only read when the test reads it in: a module whose runner ran on import would set the exit
// code of whatever process imported it.
if (import.meta.main) {
  const [code, lines] = theGate(option(process.argv.slice(2), '--top') ?? join(import.meta.dirname, '../..'), option(process.argv.slice(2), '--workflow') ?? THE_RELEASE_WORKFLOW)
  for (const line of lines) (code === 0 ? process.stdout : process.stderr).write(`${line}\n`)
  process.exitCode = code
}
