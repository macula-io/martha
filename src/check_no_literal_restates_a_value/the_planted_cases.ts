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

import { GONE, lineOfAFinding, lineOfAMarkerNotHeld, lineOfAnExceptionNotHeld, THE_MARKER, type Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
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
  /** The coincidences the tree declares, judged as a slice's coincidences.ts is (martha#682); none when absent. */
  readonly declares?: readonly Exception[]
  /** Every line the gate prints for the range: the coincidences it cannot hold, then markers, then findings, in order. */
  readonly prints: readonly string[]
}

const TOOL = { 'a_tool/a_tool.ts': "export const TOOL = 'the-tool'\n" }
const MARKED = { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({ Edit: 'file_path' }) satisfies DefinesItsValues\n" }
const UNMARKED = { 'a_tool/tools.ts': "export const TOOLS = Object.freeze({ Edit: 'file_path' })\n" }
const MARKER = `is marked ${THE_MARKER} but`
const MISPLACED = `${THE_MARKER} ${MARKER} stands where no record is marked: it must be the outermost \`satisfies\` of a top-level exported const`
/**
 * A module holding one word twice (martha#682): exported as the folder a store sits in, and privately as the key an
 * engine saves under, which is another thing spelled the same way.
 */
const A_STORE = 'a_store/a_store.ts'
const THE_FOLDER = "export const THE_FOLDER = 'the-saved-word'\n"
const BOTH = `${THE_FOLDER}const THE_KEY = 'the-saved-word'\n`
const THE_KEY_IS_A_COPY = `${A_STORE}:2: 'the-saved-word' restates ${A_STORE} THE_FOLDER`
const THE_KEY_IS_A_COINCIDENCE: Exception = { value: 'the-saved-word', file: A_STORE, reason: "the engine saves under this key; the folder is the store's own" }
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
    what: 'two exported constants the change adds for one new value, in two new modules',
    base: TOOL,
    head: { 'a_one/a_one.ts': "export const ONE = 'a-brand-new-word'\n", 'a_two/a_two.ts': "export const TWO = 'a-brand-new-word'\n" },
    prints: ["a_one/a_one.ts:1: 'a-brand-new-word' restates a_two/a_two.ts TWO", "a_two/a_two.ts:1: 'a-brand-new-word' restates a_one/a_one.ts ONE"],
  },
  {
    what: 'a number the change defines, with a copy of it in another slice',
    base: { 'a_user/a_user.ts': 'call(60_000)\n' },
    head: { 'a_new/a_new.ts': 'export const A_MINUTE_MS = 60_000\n' },
    prints: ["a_user/a_user.ts:1: '60000' restates a_new/a_new.ts A_MINUTE_MS"],
  },
  {
    what: 'a number the tree defines, divided out on a line the change adds',
    base: { 'a_tool/a_tool.ts': 'export const A_MINUTE_MS = 60_000\n' },
    head: { 'a_user/a_user.ts': 'const minutes = Math.floor(ms / 60_000)\n' },
    prints: ["a_user/a_user.ts:1: '60000' restates a_tool/a_tool.ts A_MINUTE_MS"],
  },
  {
    what: 'a number below the floor, which is a count and not a magnitude',
    base: { 'a_user/a_user.ts': 'call(9_999)\n' },
    head: { 'a_new/a_new.ts': 'export const A_COUNT = 9_999\n' },
    prints: [],
  },
  {
    what: 'a number at the floor, which is a magnitude the tree defines',
    base: { 'a_user/a_user.ts': 'call(10_000)\n' },
    head: { 'a_new/a_new.ts': 'export const A_CEILING = 10_000\n' },
    prints: ["a_user/a_user.ts:1: '10000' restates a_new/a_new.ts A_CEILING"],
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
    // The issue's own case (martha#682): the range names the private copy, so the coincidence its message offers must be
    // held, and the whole-tree pass that holds the list names the same site.
    what: 'a private copy, in the same file, of a constant the change adds, declared a coincidence (martha#682)',
    base: {},
    head: { [A_STORE]: BOTH },
    declares: [THE_KEY_IS_A_COINCIDENCE],
    prints: [],
  },
  {
    what: 'a private copy the change adds beside a holder its own file already has (martha#682)',
    base: { [A_STORE]: THE_FOLDER },
    head: { [A_STORE]: BOTH },
    prints: [THE_KEY_IS_A_COPY],
  },
  {
    what: "a private copy beside its own file's holder, declared a coincidence, in a change that touches neither (martha#682)",
    base: { [A_STORE]: BOTH },
    head: { 'a_user/a_user.ts': "call('elsewhere')\n" },
    declares: [THE_KEY_IS_A_COINCIDENCE],
    prints: [],
  },
  {
    what: "a coincidence declared where only the holder's own initializer stands, which no run names (martha#682)",
    base: { [A_STORE]: THE_FOLDER },
    head: { 'a_user/a_user.ts': "call('elsewhere')\n" },
    declares: [THE_KEY_IS_A_COINCIDENCE],
    prints: ["'the-saved-word' in a_store/a_store.ts is declared a coincidence but matches nothing there, or carries no reason, or repeats another entry."],
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
    what: 'a constant written as a whole segment of a path literal the change adds (martha#437)',
    base: { 'a_config/a_config.ts': "export const CONFIG = 'config'\n" },
    head: { 'a_user/a_user.ts': "const at = join(checkout, '.git/config')\n" },
    prints: ["a_user/a_user.ts:1: 'config' (a path segment) restates a_config/a_config.ts CONFIG"],
  },
  {
    // The relay is the one place in the tree that holds a private copy of a value the core also holds, and its hooks
    // are the files that spell paths (Jupiter's note on PR 469). A planted case in a hooks file proves the check reads
    // them, not only the core.
    what: 'a constant written as a whole segment of a path literal a hooks file of the relay adds (martha#437)',
    base: { 'a_relay_copy/a_relay_copy.ts': "export const A_RELAYS_PLACE = 'a-relays-place'\n" },
    head: { 'claude_code_relay/hooks/register.ts': "const at = join(place, 'hooks/a-relays-place/register.js')\n" },
    prints: ["claude_code_relay/hooks/register.ts:1: 'a-relays-place' (a path segment) restates a_relay_copy/a_relay_copy.ts A_RELAYS_PLACE"],
  },
  {
    what: 'a constant inside prose the change adds, which only a path separator would split out (martha#437)',
    base: { 'a_config/a_config.ts': "export const CONFIG = 'config'\n" },
    head: { 'a_user/a_user.ts': "say('read the config before the run')\n" },
    prints: [],
  },
  {
    what: 'a coincidence entry the change adds in a slice named like a constant, whose file path names a source (martha#437, r=1)',
    base: { 'a_crews_tools/a_crews_tools.ts': "export const WAKE_IT = 'wake_it'\n", 'wake_it/wake_it.ts': 'export const run = () => 0\n' },
    head: { 'wake_it/coincidences.ts': "export const COINCIDENCES = [{ value: 'x', file: 'wake_it/wake_it.ts', reason: 'r' }]\nconst notes = 'wake_it/notes.md'\n" },
    prints: ["wake_it/coincidences.ts:2: 'wake_it' (a path segment) restates a_crews_tools/a_crews_tools.ts WAKE_IT"],
  },
  {
    what: "a URL the change adds, holding a constant as a path segment, judged whole (the owner's ruling on martha#437, r=3)",
    base: { 'a_repo/a_repo.ts': "export const THE_REPO = 'the-repo'\n" },
    head: { 'a_user/a_user.ts': "call('https://example.invalid/anorg/the-repo/issues')\ncall('refs/the-repo/base')\n" },
    prints: ["a_user/a_user.ts:2: 'the-repo' (a path segment) restates a_repo/a_repo.ts THE_REPO"],
  },
  {
    what: "an owner/repo name the change adds, bare and in an API route, judged whole (the owner's ruling on martha#437, r=3)",
    base: { 'a_repo/a_repo.ts': "export const THE_REPO = 'the-repo'\n" },
    head: { 'a_user/a_user.ts': "call('an-org/the-repo')\ncall('repos/an-org/the-repo/actions/runs')\ncall('anorg/the-repo')\n" },
    prints: ["a_user/a_user.ts:3: 'the-repo' (a path segment) restates a_repo/a_repo.ts THE_REPO"],
  },
  {
    what: 'a value a template with a substitution holds in its own text, judged piece by piece (martha#437)',
    base: TOOL, head: { 'a_user/a_user.ts': 'call(`${settingsDir}/the-tool`)\n' },
    prints: ["a_user/a_user.ts:1: 'the-tool' (a path segment) restates a_tool/a_tool.ts TOOL"],
  },
  {
    what: 'a value the run time builds inside a template, never judged: a substitution in the piece, and one joined to it (martha#437)',
    base: TOOL, head: { 'a_user/a_user.ts': 'call(`${settingsDir}/the-${flavour}`)\ncall(`${settingsDir}the-tool`)\n' }, prints: [],
  },
  {
    what: 'a GitHub API route whose owner has no hyphen, an address whatever stands before it (martha#437, Jupiter on PR 469)',
    base: TOOL, head: { 'a_user/a_user.ts': "call('repos/rgfaber/the-tool/actions/runs')\n" }, prints: [],
  },
  {
    what: 'a GitHub API route with a leading slash, an address (martha#437, Jupiter on PR 469)',
    base: TOOL, head: { 'a_user/a_user.ts': "call('/repos/macula-io/the-tool/issues')\n" }, prints: [],
  },
  {
    what: 'a GitHub API route whose owner a substitution builds, an address (martha#437, Jupiter on PR 469)',
    base: TOOL, head: { 'a_user/a_user.ts': 'call(`repos/${owner}/the-tool/issues`)\n' }, prints: [],
  },
  {
    // The instance martha#776 was filed with: the word is a shell `case` pattern inside the text a function builds, and
    // no piece of that text equals it, so only reading the quoted word finds it.
    what: "a value a template with a substitution holds as one quoted word, in single quotes (martha#776)",
    base: TOOL, head: { 'a_user/a_user.ts': 'const run = `case "$1" in \'the-tool\') exec ${node} "$@";; esac`\n' },
    prints: ["a_user/a_user.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"],
  },
  {
    what: 'a value a template with a substitution holds as one quoted word, in double quotes (martha#776)',
    base: TOOL, head: { 'a_user/a_user.ts': 'const run = `case "$1" in "the-tool") exec ${node} "$@";; esac`\n' },
    prints: ["a_user/a_user.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"],
  },
  {
    what: 'a value a template with no substitution holds as one quoted word (martha#776)',
    base: TOOL, head: { 'a_user/a_user.ts': "const run = `exec 'the-tool'`\n" },
    prints: ["a_user/a_user.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"],
  },
  {
    what: 'a quoted word whose own path names a value, judged by its segment (martha#776)',
    base: TOOL, head: { 'a_user/a_user.ts': "const run = `cat 'refs/the-tool/base'`\n" },
    prints: ["a_user/a_user.ts:1: 'the-tool' (a path segment) restates a_tool/a_tool.ts TOOL"],
  },
  {
    what: 'a quoted word a substitution stands inside, never judged: the run time builds it (martha#776)',
    base: TOOL, head: { 'a_user/a_user.ts': 'const run = `exec ${node} \'the-${flavour}\'`\n' }, prints: [],
  },
  {
    what: 'prose between two apostrophes inside a template, never judged as one quoted word (martha#776)',
    base: TOOL, head: { 'a_user/a_user.ts': "const said = `the tool's name is 'the-tool' elsewhere`\n" },
    prints: ["a_user/a_user.ts:1: 'the-tool' restates a_tool/a_tool.ts TOOL"],
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
  execFileSync('git', ['-C', root, ...marthasOwnGitArgs(['-c', 'user.name=planted', '-c', 'user.email=planted@example.invalid', '-c', 'commit.gpgsign=false', ...args])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

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
    const verdict = verdictOf(root, `${base}..${head}`, planted.declares ?? [])
    return [...verdict.stale.map(lineOfAnExceptionNotHeld), ...verdict.markers.map(lineOfAMarkerNotHeld), ...verdict.findings.map(lineOfAFinding)]
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** The planted cases the gate does not print exactly as they require: empty when the check bites every way. */
export function casesThatDoNotBite(): string[] {
  return PLANTED_CASES.filter((planted) => JSON.stringify(printedFor(planted)) !== JSON.stringify(planted.prints)).map((planted) => planted.what)
}
