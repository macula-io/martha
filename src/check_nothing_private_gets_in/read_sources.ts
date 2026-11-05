// What the check reads, from git: the tracked tree, and every commit of a range
// (its message and its added lines). A file git does not track is not read: it
// is never published. A binary file has no lines to read.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Line, Source } from './check_nothing_private_gets_in.ts'

const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const linesOf = (name: string, text: string, first = 1): Line[] =>
  text.split('\n').map((one, index) => ({ where: `${name}:${first + index}`, text: one }))

const isBinary = (bytes: Buffer) => bytes.includes(0)

// A path is published too: it is read as a line of its own, whether or not the
// file has text to read.
const pathLine = (path: string): Line => ({ where: `path ${path}`, text: path })

export const treeSources = (root: string): Source[] =>
  git(root, ['ls-files', '-z'])
    .split('\0')
    .filter((path) => path !== '')
    .map((path) => ({ path, bytes: readFileSync(join(root, path)) }))
    .map((file) => (isBinary(file.bytes) ? { ...file, bytes: Buffer.alloc(0) } : file))
    .map((file) => ({ name: file.path, lines: [pathLine(file.path), ...linesOf(file.path, file.bytes.toString('utf8'))] }))

const ZERO = /^0+$/

// The commits of base..head, oldest first. A base of all zeros (a branch's first
// push) has no range: the tree is all there is to read.
export const commitsOf = (root: string, range: string): string[] => {
  const [base, head] = range.split('..')
  if (base === undefined || head === undefined || base === '' || head === '') throw new Error(`not a range: ${range}`)
  if (ZERO.test(base)) return []
  return git(root, ['rev-list', '--reverse', `${base}..${head}`]).split('\n').filter((sha) => sha !== '')
}

const HUNK = /^@@ -[0-9,]+ \+([0-9]+)(?:,[0-9]+)? @@/

interface DiffState {
  readonly path: string
  readonly next: number
  readonly lines: readonly Line[]
}

// One line of a unified diff with no context: track the file and the new line
// number, keep each added line.
const step = (prefix: string) => (state: DiffState, text: string): DiffState => {
  if (text.startsWith('+++ ')) return { ...state, path: text.slice(4).replace(/^b\//, ''), next: 0 }
  const hunk = HUNK.exec(text)
  if (hunk !== null) return { ...state, next: Number(hunk[1]) }
  if (!text.startsWith('+') || state.next === 0) return state
  const line = { where: `${prefix} ${state.path}:${state.next}`, text: text.slice(1) }
  return { ...state, next: state.next + 1, lines: [...state.lines, line] }
}

export const commitSources = (root: string, sha: string): Source[] => {
  const short = sha.slice(0, 12)
  const message = git(root, ['log', '-1', '--format=%B', sha])
  const diff = git(root, ['show', '--format=', '--unified=0', '--no-color', '--no-ext-diff', '--diff-merges=first-parent', sha])
  const added = diff.split('\n').reduce(step(`commit ${short}`), { path: '', next: 0, lines: [] })
  // Every path the commit adds or keeps, from git's own list: a rename, an empty
  // file and a binary file name a path with no added line to carry it.
  const paths = git(root, ['show', '--format=', '--name-only', '-z', '--diff-filter=d', '--diff-merges=first-parent', sha])
    .split('\0')
    .filter((path) => path.trim() !== '')
    .map((path) => ({ where: `commit ${short} path ${path}`, text: path }))
  return [
    { name: `commit ${short} paths`, lines: paths },
    { name: `commit ${short} message`, lines: linesOf(`commit ${short} message`, message) },
    { name: `commit ${short}`, lines: added.lines },
  ]
}
