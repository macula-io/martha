// The owner's signed list of command shapes (martha#129): the commands a member may run through `martha run
// <name>` and keep its shell, and the one branch whose commits the owner vouches for.
//
// This exists so the only commands whose output a member reads without losing the shell are ones the owner
// named, at the keyboard, with the hardware key. The list is a signed document like every trust list
// (../trust_only_signed_lists): missing, unsigned, unpinned, expired, for another crew or kind, or at an older
// epoch, it opens as no shape at all, and every `martha run` then records A13 as any other `Bash` call does.
//
// The body is `{ base: { remote_url, branch }, shapes: [{ name, argv }] }` and nothing else.
//   - `argv` goes to the process call as an array with no shell, so pipes, `&&`, redirects, substitution,
//     globbing and env prefixes cannot be written at all.
//   - Two shapes of one name open the whole list as nothing: a receipt is keyed by name, and no rule could say
//     which argv the owner meant.
//   - `remote_url` is an https, ssh or file URL with no space in it, so git fetches it without running a command
//     (`ext::` and an option smuggled after a space cannot be written), and `branch` is a plain branch name.

import {
  COMMAND_SHAPES_KIND,
  openSignedDocument,
  type SignedDocumentToOpen,
} from '../trust_only_signed_lists/trust_only_signed_lists.ts'

/** A shape's name: what the member types after `martha run`. */
export const SHAPE_NAME = /^[a-z][a-z0-9-]{0,31}$/

/** A remote git fetches without running a command: https, ssh or file, with no space or control in it. */
const REMOTE_URL = /^(https|ssh|file):\/\/[^\s\u0000-\u001f\u007f]+$/
/** A plain branch name: words of letters, digits, dot, underscore and dash, joined by single slashes. */
const BRANCH = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/
const NOT_A_BRANCH = /\.\.|\.lock(\/|$)|\.$|^refs\//
const NUL = '\u0000'

const BODY_FIELDS = ['base', 'shapes'] as const
const BASE_FIELDS = ['branch', 'remote_url'] as const
const SHAPE_FIELDS = ['argv', 'name'] as const

/** The branch whose commits the owner vouches for, and where to fetch it from. */
export interface SignedBase {
  readonly remote_url: string
  readonly branch: string
}

/** One command the owner signed: the name the member types, and the argv the launcher runs. */
export interface CommandShape {
  readonly name: string
  readonly argv: readonly string[]
}

export type OpenedCommandShapes =
  | { readonly trusted: true; readonly base: SignedBase; readonly shapes: readonly CommandShape[]; readonly epoch: number }
  | { readonly trusted: false; readonly why: string; readonly base: undefined; readonly shapes: readonly CommandShape[] }

/** The signed list of command shapes to open. */
export type CommandShapesToOpen = Omit<SignedDocumentToOpen, 'kind'>

const NO_SHAPES: readonly CommandShape[] = []

interface ShapesBody {
  readonly base: SignedBase
  readonly shapes: readonly CommandShape[]
}

/** Open the owner's command shapes: its base and shapes when everything holds, and no shape otherwise. */
export function openCommandShapes(input: CommandShapesToOpen): OpenedCommandShapes {
  const opened = openSignedDocument({ ...input, kind: COMMAND_SHAPES_KIND }, shapesBodyOf)
  if (!opened.trusted) return { trusted: false, why: `the ${COMMAND_SHAPES_KIND} know no shape: ${opened.why}`, base: undefined, shapes: NO_SHAPES }
  return { trusted: true, base: opened.body.base, shapes: opened.body.shapes, epoch: opened.epoch }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactly = (value: Record<string, unknown>, fields: readonly string[]): boolean => Object.keys(value).sort().join() === [...fields].join()

function shapesBodyOf(body: unknown): ShapesBody | string {
  if (!isRecord(body) || !hasExactly(body, BODY_FIELDS)) return 'the body must hold base and shapes and nothing else'
  const base = baseOf(body.base)
  if (base === undefined) return 'the base is not a remote url git fetches without running a command and a plain branch'
  if (!Array.isArray(body.shapes)) return 'the shapes are not a list'
  const shapes = body.shapes.map(shapeOf)
  const bad = shapes.findIndex((shape) => shape === undefined)
  if (bad !== -1) return `shape ${bad} is not a plain name and a list of plain strings`
  const named = shapes.flatMap((shape) => (shape === undefined ? [] : [shape]))
  const twice = named.find((shape, at) => named.findIndex((other) => other.name === shape.name) !== at)
  return twice === undefined ? { base, shapes: named } : `there are two shapes named ${twice.name}`
}

function baseOf(base: unknown): SignedBase | undefined {
  if (!isRecord(base) || !hasExactly(base, BASE_FIELDS)) return undefined
  const { remote_url, branch } = base
  if (typeof remote_url !== 'string' || !REMOTE_URL.test(remote_url)) return undefined
  if (typeof branch !== 'string' || !BRANCH.test(branch) || NOT_A_BRANCH.test(branch)) return undefined
  return { remote_url, branch }
}

function shapeOf(shape: unknown): CommandShape | undefined {
  if (!isRecord(shape) || !hasExactly(shape, SHAPE_FIELDS)) return undefined
  const { name, argv } = shape
  if (typeof name !== 'string' || !SHAPE_NAME.test(name)) return undefined
  if (!Array.isArray(argv) || argv.length === 0 || argv[0] === '') return undefined
  if (!argv.every((word) => typeof word === 'string' && !word.includes(NUL))) return undefined
  return { name, argv: argv as string[] }
}
