// The markdown files Claude Code loads from the owner's user scope and the
// managed scope, and how it opens their frontmatter, as the recorder cuts them
// from the host binary (martha#146).
//
// An agent, a skill or a command in those folders can carry hooks in its
// frontmatter, and a member started on Martha's switches runs them, with what
// they print reaching the member and no row recording it (probed live on
// 2.1.319). The launcher refuses such a file (./hooks_and_plugins_the_owner_declares.ts),
// so it has to read the same files the host reads, and open their frontmatter
// where the host opens it. Neither is typed here:
//   - `frontmatter_pattern`: the pattern the host's frontmatter parser matches,
//     after it strips one leading byte-order mark; `frontmatter_reader` holds
//     that parser's opening statements and the strip function whole, so a host
//     that changes either fails the recording;
//   - `markdown_kinds`: the folders the host's one markdown loader is called
//     for by name, and the skills folder its skills loader joins to the managed
//     folder; `markdown_loader` holds that loader whole: it reads each kind from
//     `<managed folder>/.claude/<kind>` and from `<user config folder>/<kind>`,
//     and from project folders only when project settings are on, which
//     Martha's switches turn off;
//   - `output_style_schema`: the output-style frontmatter schema, which the
//     recorded host has no hooks key for, so output styles stay out of the
//     refusal. The recording check fails when it changes, and a test fails when
//     it gains one.
//   - `user_output_styles_dir` (martha#154): the session-init response's field
//     for the user-level output-styles folder, name and describe text, whole.
//     Its folder under the config home is read from that text, never typed
//     here; the path itself is the one the session's own init reports at launch,
//     since the host resolves it after the settings env blocks.

import { MANAGED_MARKDOWN_FOLDER } from './hooks_and_plugins_the_owner_declares.ts'
import { closingBrace } from './settings_that_turn_hooks_off.ts'

/** What the host binary says about the markdown it loads, as recorded. */
export interface MarkdownTheHostLoads {
  /** The source of the pattern that opens and closes a frontmatter; group 1 is the frontmatter. */
  readonly frontmatter_pattern: string
  /** The frontmatter parser's opening statements, then the byte-order-mark strip function, whole. */
  readonly frontmatter_reader: readonly string[]
  /** The host's one loader of markdown folders, whole. */
  readonly markdown_loader: string
  /** Each folder name the host loads markdown from in the user and managed scopes, sorted. */
  readonly markdown_kinds: readonly string[]
  /** The output-style frontmatter schema, as the binary spells it. */
  readonly output_style_schema: string
  /**
   * The session-init response's user-output-styles field, whole: its name and the host's own describe
   * text, cut from the binary (martha#154). A path is not recorded, since the host resolves it after
   * the settings env blocks, so the folder is taken from the session's own init at launch.
   */
  readonly user_output_styles_dir: string
}

const escaped = (name: string): string => name.replaceAll('$', '\\$')

/** The one distinct match of `pattern` in the host text; refuses none, or two that differ. */
function theOne(text: string, pattern: RegExp, what: string): RegExpMatchArray {
  const found = [...text.matchAll(pattern)]
  const distinct = new Set(found.map((match) => match[0]))
  if (distinct.size !== 1) throw new Error(`The host text holds ${String(distinct.size)} of ${what}, not one, so the markdown it loads cannot be derived.`)
  const [first] = found
  if (first === undefined) throw new Error(`The host text holds no ${what}.`)
  return first
}

/** The function named `name` that starts at `at`, whole. */
const functionAt = (text: string, at: number): string => text.slice(at, closingBrace(text, text.indexOf('{', at)))

// The frontmatter parser opens by keeping the text, stripping a byte-order
// mark, and matching one pattern, unless no second `---` follows the first.
const PARSER_HEAD =
  /function [\w$]+\(([\w$]+),[\w$]+,[\w$]+\)\{let [\w$]+=\1;\1=([\w$]+)\(\1\);let [\w$]+=\1\.indexOf\("---",3\)<0\?null:\1\.match\(([\w$]+)\);/g
const BOM_STRIP = /^function [\w$]+\(([\w$]+)\)\{return \1\.charCodeAt\(0\)===65279\?\1\.slice\(1\):\1\}$/
/** The opening a recorded pattern must start with: `---` at the start of the text. */
const OPENS_AT_THE_START = '^---'

/** The frontmatter pattern, its parser's opening and its byte-order-mark strip, from the host text. */
function frontmatterIn(text: string): Pick<MarkdownTheHostLoads, 'frontmatter_pattern' | 'frontmatter_reader'> {
  const head = theOne(text, PARSER_HEAD, 'the frontmatter parser')
  const [statement, , strip, patternName] = head
  if (strip === undefined || patternName === undefined) throw new Error('The frontmatter parser cannot be read from the host.')
  const strips = [...text.matchAll(new RegExp(`function ${escaped(strip)}\\(`, 'g'))].map((match) => functionAt(text, match.index)).filter((one) => BOM_STRIP.test(one))
  if (new Set(strips).size !== 1) throw new Error(`The host strips a byte-order mark by ${String(new Set(strips).size)} functions named ${strip}, not one of the shape this reads.`)
  return { frontmatter_pattern: patternNamed(text, patternName), frontmatter_reader: [statement, strips[0] ?? ''] }
}

/** The source of the regular expression literal assigned to `name`, checked to open at the start with no flags. */
function patternNamed(text: string, name: string): string {
  const literal = theOne(text, new RegExp(`[,\\s]${escaped(name)}=\\/((?:\\\\.|[^/\\\\\\n])+)\\/([a-z]*)[,;]`, 'g'), 'the frontmatter pattern')
  const [, source, flags] = literal
  if (source === undefined || flags !== '' || !source.startsWith(OPENS_AT_THE_START)) {
    throw new Error(`The frontmatter pattern is /${source ?? ''}/${flags ?? ''}, not one that opens at the start with no flags.`)
  }
  return source
}

/** Where the loader reports what it searched, which only it does. */
const LOADER_MARK = '"tengu_dir_search"'

/** The async function in the host text that holds `at`, whole. */
function enclosingAsyncFunction(text: string, at: number): { readonly name: string; readonly source: string } {
  for (let start = text.lastIndexOf('async function ', at); start >= 0; start = text.lastIndexOf('async function ', start - 1)) {
    const source = functionAt(text, start)
    if (start + source.length > at) return { name: /^async function ([\w$]+)\(/.exec(source)?.[1] ?? '', source }
  }
  throw new Error('No function holds the markdown loader in the host text.')
}

/** The host's markdown loader, whole, checked to read the managed and the user scope. */
export function loaderIn(text: string, managed: string): { readonly name: string; readonly source: string } {
  const marks = [...text.matchAll(new RegExp(LOADER_MARK, 'g'))]
  if (marks.length !== 1) throw new Error(`The host text marks ${String(marks.length)} markdown loaders, not one.`)
  const loader = enclosingAsyncFunction(text, marks[0]?.index ?? 0)
  const reads = [`${managed}(),${JSON.stringify(MANAGED_MARKDOWN_FOLDER)},`, 'source:"policySettings"', 'source:"userSettings"']
  const missing = reads.filter((read) => !loader.source.includes(read))
  if (missing.length > 0) throw new Error(`The markdown loader does not read ${missing.join(', ')}, so the folders it loads cannot be told.`)
  return loader
}

/** Each folder name passed by name to the function that calls the loader, and the skills folder joined to the managed folder. */
function kindsIn(text: string, loader: string, managed: string): string[] {
  // Every function that holds the call holds it, the outer ones too; the caller is the innermost.
  const holding = [...text.matchAll(/function ([\w$]+)\([^)]*\)\{/g)]
    .map((match) => ({ name: match[1] ?? '', source: functionAt(text, match.index) }))
    .filter(({ source }) => source.includes(`=>${loader}(`))
  const shortest = Math.min(...holding.map(({ source }) => source.length))
  const callers = holding.filter(({ source }) => source.length === shortest)
  if (callers.length !== 1) throw new Error(`${String(callers.length)} innermost functions call the markdown loader, not one.`)
  const caller = escaped(callers[0]?.name ?? '')
  const named = [...text.matchAll(new RegExp(`[^\\w$]${caller}\\("([a-z-]+)"`, 'g'))].map((match) => match[1] ?? '')
  const skills = theOne(
    text,
    new RegExp(`([\\w$]+)=[\\w$]+\\(${escaped(managed)}\\(\\),"${MANAGED_MARKDOWN_FOLDER.replace('.', '\\.')}","([a-z-]+)"\\)[^\`]{0,4000}?\`Loading skills from: managed=\\$\\{\\1\\}`, 'g'),
    'the skills loader',
  )[2]
  if (named.length === 0 || skills === undefined) throw new Error('The folders the host loads markdown from cannot be read.')
  return [...new Set([...named, skills])].sort()
}

/** Where the output-style schema says what its one boolean key does. */
const OUTPUT_STYLE_MARK = '"keep-coding-instructions":'
const SCHEMA_OPEN = '({name:'

/** The output-style frontmatter schema, as an object literal. */
function outputStyleSchemaIn(text: string): string {
  const marks = [...text.matchAll(new RegExp(OUTPUT_STYLE_MARK, 'g'))]
  if (marks.length !== 1) throw new Error(`The host text holds ${String(marks.length)} output-style schemas, not one.`)
  const open = text.lastIndexOf(SCHEMA_OPEN, marks[0]?.index ?? 0) + 1
  const schema = text.slice(open, closingBrace(text, open))
  if (open === 0 || !schema.includes(OUTPUT_STYLE_MARK)) throw new Error('The output-style schema cannot be cut from the host text.')
  return schema
}

/** Where a session-init field's describe text names a folder of the config home: the name it gives it. */
const A_FOLDER_OF_THE_CONFIG_HOME = /the ([a-z][a-z-]*) folder of the config home/

/**
 * The session-init response's user-output-styles field, from its name to the end of its describe text, as the
 * binary spells it: `user_output_styles_dir:<schema>().optional().describe("<text>")` (martha#154).
 */
const OUTPUT_STYLES_FIELD = /[,{]user_output_styles_dir:[\w$]+\(\)\.optional\(\)\.describe\("((?:\\"|[^"])*)"\)/g

/**
 * The session-init response's user-output-styles field, whole, checked to name the config home's folder it lists
 * the owner's styles from: a host that says it any other way fails the recording rather than leaving the gate short
 * (martha#154).
 */
function userOutputStylesDirIn(text: string): string {
  const found = theOne(text, OUTPUT_STYLES_FIELD, "the session-init response's user-output-styles field")
  const describe = found[1] ?? ''
  if (!A_FOLDER_OF_THE_CONFIG_HOME.test(describe)) {
    throw new Error("The session-init response's user-output-styles field names no folder of the config home, so the folder the host lists styles from cannot be told.")
  }
  return found[0].replace(/^[,{]/, '')
}

/**
 * The folder under the config home the recorded statement names as the user output-styles folder (martha#154). A
 * recording whose statement names none does not load.
 */
export function outputStylesFolderIn(statement: string): string {
  const folder = A_FOLDER_OF_THE_CONFIG_HOME.exec(statement)?.[1]
  if (folder === undefined) throw new Error('The recorded user-output-styles statement names no folder of the config home, so a member cannot be kept out of it.')
  return folder
}

/** The name of the session-init field the recorded statement declares, as the host spells it (martha#154). */
export function outputStylesFieldIn(statement: string): string {
  const name = /^([\w$]+):/.exec(statement)?.[1]
  if (name === undefined) throw new Error('The recorded user-output-styles statement does not open with a field name, so the session-init response cannot be read for it.')
  return name
}

/** What a host's text says about the markdown it loads; `managed` names its function that returns the managed folder. */
export function markdownTheHostLoadsIn(text: string, managed: string): MarkdownTheHostLoads {
  const loader = loaderIn(text, managed)
  return {
    ...frontmatterIn(text),
    markdown_loader: loader.source,
    markdown_kinds: kindsIn(text, loader.name, managed),
    output_style_schema: outputStyleSchemaIn(text),
    user_output_styles_dir: userOutputStylesDirIn(text),
  }
}

/** A key named `hooks` anywhere in a schema object literal, bare or quoted: nested ones count too. */
const HOOKS_KEY = /[{,]["']?hooks["']?:/

/** Whether a recorded output-style schema lets a style carry hooks. */
export const outputStylesTakeHooks = (schema: string): boolean => HOOKS_KEY.test(schema)
