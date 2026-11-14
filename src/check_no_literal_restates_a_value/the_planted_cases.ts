// The ways a copy gets in, each planted in a throwaway repository and judged on a real range (martha#289).
//
// One table, run by `--self-test` in CI and by this slice's test, so neither can
// drift from the other. Every case commits a base and a head and runs the gate's
// own reading of the range (./judge_a_change.ts), never a hand-built list of the
// values a change defines: a range reader that stops seeing a value goes red here.
//
// Each case names what it plants and the exact lines the gate must print for it,
// so a case that bites for the wrong reason, or names the wrong constant, is red
// too. The repositories are removed when the run ends, whatever it found.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { GONE, lineOfAFinding, lineOfAMarkerNotHeld, THE_MARKER } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { verdictOf } from './judge_a_change.ts'
import { CORE } from './the_core_the_check_reads.ts'

type Files = Readonly<Record<string, string>>

export interface PlantedCase {
  readonly what: string
  /** Paths relative to the core, as the findings name them. */
  readonly base: Files
  /** What the head commit writes over the base; an empty text deletes the file. */
  readonly head: Files
  /** Every line the gate prints for the range, markers first, in order. */
  readonly prints: readonly string[]
}

const TOOL = { 'a_tool/a_tool.ts': "export const TOOL = 'the-tool'\n" }
const MARKED = { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({ Edit: 'file_path' }) satisfies DefinesItsValues\n" }
const UNMARKED = { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({ Edit: 'file_path' })\n" }
const MARKER = `is marked ${THE_MARKER} but`
const MISPLACED = `${THE_MARKER} ${MARKER} stands where no record is marked: it must be the outermost \`satisfies\` of a top-level exported const`
/** Twelve constants that stay, so git would pair a file moved with one constant changed as a rename. */
const FILLER = Array.from({ length: 12 }, (_, index) => `export const FILLER_${index} = 'filler-number-${index}'\n`).join('')

export const PLANTED_CASES: readonly PlantedCase[] = [
  {
    what: 'a literal the change adds',
    base: TOOL,
    head: { 'a_user/a_user.ts': "call('the-tool')\n" },
    prints: ["a_user/a_user.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"],
  },
  {
    what: 'a constant the change adds, with an old copy elsewhere',
    base: { 'a_old/a_old.ts': "call('a-fresh-value')\n" },
    head: { 'a_new/a_new.ts': "export const FRESH = 'a-fresh-value'\n" },
    prints: ["a_old/a_old.ts:1: 'a-fresh-value' restates a_new/a_new.ts FRESH"],
  },
  {
    what: 'a second exported constant the change adds, beside a holder that stays',
    base: TOOL,
    head: { 'a_new/a_new.ts': "export const AGAIN = 'the-tool'\n" },
    prints: ["a_new/a_new.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"],
  },
  {
    what: 'a constant the change revalues, with a copy of the old value',
    base: { 'a_tool/a_tool.ts': "export const TOOL = 'the-old-value'\n", 'a_user/a_user.ts': "call('the-old-value')\n" },
    head: { 'a_tool/a_tool.ts': "export const TOOL = 'the-newer-value'\n" },
    prints: [`a_user/a_user.ts:1: 'the-old-value' restates a_tool/a_tool.ts TOOL ${GONE}`],
  },
  {
    what: 'a constant the change renames, its value kept',
    base: { ...TOOL, 'a_user/a_user.ts': "call('the-tool')\n" },
    head: { 'a_tool/a_tool.ts': "export const TOOL_NAME = 'the-tool'\n" },
    prints: ["a_user/a_user.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL_NAME"],
  },
  {
    what: 'a constant the change renames and revalues, with a copy of the old value',
    base: { ...TOOL, 'a_user/a_user.ts': "call('the-tool')\n" },
    head: { 'a_tool/a_tool.ts': "export const TOOL_NAME = 'the-new-tool'\n" },
    prints: [`a_user/a_user.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL ${GONE}`],
  },
  {
    what: 'a constant the change removes, with a copy left',
    base: { ...TOOL, 'a_user/a_user.ts': "call('the-tool')\n" },
    head: { 'a_tool/a_tool.ts': '' },
    prints: [`a_user/a_user.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL ${GONE}`],
  },
  {
    what: 'a file the change moves, its constant removed, with a copy left',
    base: { 'a_tool/a_tool.ts': `${FILLER}export const TOOL = 'the-old-value'\n`, 'a_user/a_user.ts': "call('the-old-value')\n" },
    head: { 'a_tool/a_tool.ts': '', 'b_tool/b_tool.ts': FILLER },
    prints: [`a_user/a_user.ts:1: 'the-old-value' restates a_tool/a_tool.ts TOOL ${GONE}`],
  },
  {
    what: 'a file the change moves, its constant revalued, with a copy of the old value',
    base: { 'a_tool/a_tool.ts': `${FILLER}export const TOOL = 'the-old-value'\n`, 'a_user/a_user.ts': "call('the-old-value')\n" },
    head: { 'a_tool/a_tool.ts': '', 'b_tool/b_tool.ts': `${FILLER}export const TOOL = 'the-newer-value'\n` },
    prints: [`a_user/a_user.ts:1: 'the-old-value' restates a_tool/a_tool.ts TOOL ${GONE}`],
  },
  {
    what: 'a file the change moves unchanged, its constant still held',
    base: { 'a_tool/a_tool.ts': `${FILLER}export const TOOL = 'the-old-value'\n`, 'a_user/a_user.ts': "call('the-old-value')\n" },
    head: { 'a_tool/a_tool.ts': '', 'b_tool/b_tool.ts': `${FILLER}export const TOOL = 'the-old-value'\n` },
    prints: [],
  },
  {
    what: 'a file the change moves unchanged, holding a marked record with an old copy of its key',
    base: { ...MARKED, 'a_user/a_user.ts': "call('Edit')\n" },
    head: { 'a_tool/tools.ts': '', 'b_tool/tools.ts': MARKED['a_tool/tools.ts'] },
    prints: [],
  },
  {
    what: 'a private copy, in the same file, of a constant the change adds',
    base: {},
    head: { 'a_new/a_new.ts': "export const FRESH = 'a-fresh-value'\nconst COPY = 'a-fresh-value'\n" },
    prints: ["a_new/a_new.ts:2: 'a-fresh-value' restates a_new/a_new.ts FRESH"],
  },
  {
    what: 'a private copy, in the same file, of a key the change marks',
    base: {},
    head: { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({ Edit: 'file_path' }) satisfies DefinesItsValues\nconst T = 'Edit'\n" },
    prints: ["a_tool/tools.ts:2: 'Edit' restates a_tool/tools.ts TOOLS.Edit (key)"],
  },
  {
    what: 'an exported constant beside the record it names a key of, which holds the value too',
    base: { 'a_tool/tools.ts': "export const EDIT_TOOL = 'Edit'\n" },
    head: { 'a_tool/tools.ts': "export const EDIT_TOOL = 'Edit'\nexport const TOOLS = Object.freeze({ Edit: 'file_path' }) satisfies DefinesItsValues\n" },
    prints: [],
  },
  {
    what: 'a local redefinition of an exported value (R2)',
    base: TOOL,
    head: { 'a_copy/a_copy.ts': "const DEPENDENCIES = 'the-tool'\n" },
    prints: ["a_copy/a_copy.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"],
  },
  {
    what: 'a record the change marks on its closing line only, with old copies of a key and a value',
    base: { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({\n  Edit: 'file_path',\n})\n", 'a_user/a_user.ts': "call('Edit')\ncall('file_path')\n" },
    head: { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({\n  Edit: 'file_path',\n}) satisfies DefinesItsValues\n" },
    prints: ["a_user/a_user.ts:1: 'Edit' restates a_tool/tools.ts TOOLS.Edit (key)", "a_user/a_user.ts:2: 'file_path' restates a_tool/tools.ts TOOLS.Edit"],
  },
  {
    what: 'a key the change adds to a marked record, with an old copy',
    base: { ...MARKED, 'a_user/a_user.ts': "call('NotebookEdit')\n" },
    head: { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({\n  Edit: 'file_path',\n  NotebookEdit: 'notebook_path',\n}) satisfies DefinesItsValues\n" },
    prints: ["a_user/a_user.ts:1: 'NotebookEdit' restates a_tool/tools.ts TOOLS.NotebookEdit (key)"],
  },
  {
    what: 'a key the change renames in a marked record, with a copy of the old key',
    base: { ...MARKED, 'a_user/a_user.ts': "call('Edit')\n" },
    head: { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({ Modify: 'file_path' }) satisfies DefinesItsValues\n" },
    prints: [`a_user/a_user.ts:1: 'Edit' restates a_tool/tools.ts TOOLS.Edit (key) ${GONE}`],
  },
  {
    what: "a literal equal to a marked record's key",
    base: MARKED,
    head: { 'a_user/a_user.ts': "allow(['Edit'])\n" },
    prints: ["a_user/a_user.ts:1: 'Edit' restates a_tool/tools.ts TOOLS.Edit (key)"],
  },
  {
    what: "a literal equal to a marked record's value",
    base: MARKED,
    head: { 'a_user/a_user.ts': "read('file_path')\n" },
    prints: ["a_user/a_user.ts:1: 'file_path' restates a_tool/tools.ts TOOLS.Edit"],
  },
  {
    what: "a local redefinition of a marked record's key (R2)",
    base: MARKED,
    head: { 'a_copy/a_copy.ts': "const T = 'Edit'\n" },
    prints: ["a_copy/a_copy.ts:1: 'Edit' restates a_tool/tools.ts TOOLS.Edit (key)"],
  },
  {
    what: "an unmarked record's key, which stays a word",
    base: UNMARKED,
    head: { 'a_user/a_user.ts': "allow(['Edit'])\n" },
    prints: [],
  },
  {
    what: 'a value both a constant and a marked entry hold, named by the constant',
    base: { 'a_tool/tools.ts': "export const WHOLE = 'Write'\nexport const TOOLS = Object.freeze({ Write: 'file_path' }) satisfies DefinesItsValues\n" },
    head: { 'a_user/a_user.ts': "allow(['Write'])\n" },
    prints: ["a_user/a_user.ts:1: 'Write' restates a_tool/tools.ts WHOLE"],
  },
  {
    what: 'a record marked through a namespace, with a copy of its key',
    base: { 'a_tool/tools.ts': "import type * as M from './marker.ts'\nexport const TOOLS = Object.freeze({ Edit: 'file_path' }) satisfies M.DefinesItsValues\n" },
    head: { 'a_user/a_user.ts': "allow(['Edit'])\n" },
    prints: ["a_user/a_user.ts:1: 'Edit' restates a_tool/tools.ts TOOLS.Edit (key)"],
  },
  {
    what: 'a marker inside the call',
    base: {},
    head: { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({ Edit: 'file_path' } satisfies DefinesItsValues)\n" },
    prints: [`a_tool/tools.ts:1: ${MISPLACED}`],
  },
  {
    what: 'a marker on a const that is not exported',
    base: {},
    head: { 'a_tool/tools.ts': "const TOOLS = Object.freeze({ Edit: 'file_path' }) satisfies DefinesItsValues\n" },
    prints: [`a_tool/tools.ts:1: ${MISPLACED}`],
  },
  {
    what: 'a marker on a value that is not an object literal',
    base: {},
    head: { 'a_tool/tools.ts': "export const TOOLS = Object.freeze(['Edit']) satisfies DefinesItsValues\n" },
    prints: [`a_tool/tools.ts:1: TOOLS ${MARKER} marks a value that is not an object literal`],
  },
  {
    what: 'a marker on a record with a shorthand entry',
    base: {},
    head: { 'a_tool/tools.ts': "const Edit = 'file_path'\nexport const TOOLS = Object.freeze({ Edit }) satisfies DefinesItsValues\n" },
    prints: [`a_tool/tools.ts:2: TOOLS ${MARKER} holds a shorthand entry, which the check cannot read`],
  },
  {
    what: 'a marker on a record with a computed key',
    base: {},
    head: { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({ ['Ed' + 'it']: 'file_path' }) satisfies DefinesItsValues\n" },
    prints: [`a_tool/tools.ts:1: TOOLS ${MARKER} holds a computed or non-string key, which the check cannot read`],
  },
  {
    what: 'a marker on a record with a method',
    base: {},
    head: { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({ Edit() { return 'file_path' } }) satisfies DefinesItsValues\n" },
    prints: [`a_tool/tools.ts:1: TOOLS ${MARKER} holds a method or accessor, which the check cannot read`],
  },
  {
    what: 'a marker given a second name by a type alias',
    base: {},
    head: { 'a_tool/tools.ts': "type D = DefinesItsValues\nexport const TOOLS = Object.freeze({ Edit: 'file_path' }) satisfies D\n" },
    prints: [`a_tool/tools.ts:1: D ${MARKER} aliases DefinesItsValues, which must be written by its own name`],
  },
  {
    what: 'a marker on a record with a spread',
    base: {},
    head: { 'a_tool/tools.ts': "const MORE = { Write: 'notebook_path' }\nexport const TOOLS = Object.freeze({ ...MORE, Edit: 'file_path' }) satisfies DefinesItsValues\n" },
    prints: [`a_tool/tools.ts:2: TOOLS ${MARKER} holds a spread, which the check cannot read`],
  },
  {
    what: 'a marker on a record with a value that is not a string',
    base: {},
    head: { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({ Edit: 3 }) satisfies DefinesItsValues\n" },
    prints: [`a_tool/tools.ts:1: TOOLS ${MARKER} holds a value that is not a string at 'Edit', which the check cannot read`],
  },
  {
    what: 'a literal in a type position, beside the same word as a value (part b, rule 1)',
    base: TOOL,
    head: { 'a_user/a_user.ts': "type T = 'the-tool' | 'other-word'\ncall('the-tool')\n" },
    prints: ["a_user/a_user.ts:2: 'the-tool' restates a_tool/a_tool.ts TOOL"],
  },
  {
    what: 'a property named at the use site, beside the same word as a value (part b, rule 2)',
    base: TOOL,
    head: { 'a_user/a_user.ts': "const has = 'the-tool' in record\nconst got = record['the-tool']\ncall('the-tool')\n" },
    prints: ["a_user/a_user.ts:3: 'the-tool' restates a_tool/a_tool.ts TOOL"],
  },
  {
    what: 'an alias the change adds, with an old use of its member elsewhere (part b, rule 3)',
    base: { 'a_old/a_old.ts': "send({ tag: 'the-tag' })\n" },
    head: { 'a_tag/a_tag.ts': "export const THE_TAG: Tag = 'the-tag'\n", 'a_new/a_new.ts': "send({ tag: 'the-tag' })\n" },
    prints: [],
  },
  {
    what: 'a constant the change turns into an alias, with a copy left (part b, rule 3 is no way out)',
    base: { ...TOOL, 'a_user/a_user.ts': "call('the-tool')\n" },
    head: { 'a_tool/a_tool.ts': "export const TOOL: Tool = 'the-tool'\n" },
    prints: [`a_user/a_user.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL ${GONE}`],
  },
  {
    what: 'a marker imported under a second name',
    base: {},
    head: { 'a_tool/tools.ts': "import type { DefinesItsValues as D } from './marker.ts'\nexport const TOOLS = Object.freeze({ Edit: 'file_path' }) satisfies D\n" },
    prints: [`a_tool/tools.ts:1: D ${MARKER} renames DefinesItsValues, which must be written by its own name`],
  },
]

/** git with an identity and no signing, which a throwaway repository has no config for. */
const gitIn = (root: string, ...args: readonly string[]): string =>
  execFileSync('git', ['-C', root, ...marthasOwnGitArgs(['-c', 'user.name=planted', '-c', 'user.email=planted@example.invalid', '-c', 'commit.gpgsign=false', ...args])], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

/** One commit holding what `files` writes over the tree (an empty text deletes), and its sha. */
function commitOn(root: string, files: Files): string {
  for (const [path, text] of Object.entries(files)) {
    const at = join(root, CORE, path)
    if (text === '') {
      rmSync(at, { force: true })
      continue
    }
    mkdirSync(dirname(at), { recursive: true })
    writeFileSync(at, text)
  }
  gitIn(root, 'add', '-A')
  gitIn(root, 'commit', '-q', '--allow-empty', '-m', 'planted')
  return gitIn(root, 'rev-parse', 'HEAD')
}

/** What the gate prints for one planted case, read on its real range. */
export function printedFor(planted: PlantedCase): string[] {
  const root = mkdtempSync(join(tmpdir(), 'restated-planted-'))
  try {
    gitIn(root, 'init', '-q')
    mkdirSync(join(root, CORE), { recursive: true })
    const base = commitOn(root, planted.base)
    const head = commitOn(root, planted.head)
    const verdict = verdictOf(root, `${base}..${head}`, [])
    return [...verdict.markers.map(lineOfAMarkerNotHeld), ...verdict.findings.map(lineOfAFinding)]
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** The planted cases the gate does not print exactly as they require: empty when the check bites every way. */
export function casesThatDoNotBite(): string[] {
  return PLANTED_CASES.filter((planted) => JSON.stringify(printedFor(planted)) !== JSON.stringify(planted.prints)).map((planted) => planted.what)
}
