// The host's skills loader, as the recorder cuts it from the binary, and what Martha relies on it for (martha#747).
//
// A Claude Code member gets the skills of the checkout the owner approved by having them copied into its own config
// folder, which the host reads as user-scope skills, while project settings stay off. That holds only while the
// loader does three things, each checked here on the recorded text rather than assumed:
//   - it reads `<config folder>/skills` under userSettings, so the copies load;
//   - it reads a project's `.claude/skills` only under its projectSettings guard, so the checkout's own folder does not;
//   - in bare mode it returns before either read, reading added folders' skills with no guard. Bare mode is the one
//     test `bare_mode_test` holds whole, so the variable the launch drops is the one that test reads.
// The host skill catalog, a mount named by an inherited variable, is the fourth source of user-scope skills; the
// function that reads it is recorded whole, and the variable is read from its own warning, never typed.

import { readFileSync } from 'node:fs'

import { closingBrace } from '../cut_the_rules_from_the_host_binary/the_rules_a_hosts_binary_carries.ts'
import { enclosingAsyncFunction } from './markdown_the_host_loads.ts'

/** The skills loader and the two functions it reaches that a launch depends on, each whole, as the binary spells them. */
export interface TheSkillsLoader {
  /** The host's skills loader, whole: the function that logs `Loading skills from:`. */
  readonly skills_loader: string
  /** The bare-mode test, whole: `function <f>(){return <g>(process.env.<NAME>)||<h>("--bare")}`. */
  readonly bare_mode_test: string
  /** The function that reads the host skill catalog, whole, holding the warning that names its variable. */
  readonly host_skill_catalog: string
}

/** Where the loader reports what it searched, as a template only it writes: the binary holds the bare words elsewhere too. */
const SKILLS_LOADER_MARK = '`Loading skills from: managed=${'
/** The bare-mode test, whole, with the variable it reads as group 2. */
const BARE_MODE_TEST = /^function ([\w$]+)\(\)\{return [\w$]+\(process\.env\.([A-Z][A-Z0-9_]*)\)\|\|[\w$]+\("--bare"\)\}$/
/** The catalog's own warning, naming the variable it is read from as group 1. */
const CATALOG_WARNING = /Ignoring ([A-Z][A-Z0-9_]*): expected \{"skills"/
/** The loader's user-scope read: a folder that is set, read under userSettings, as `skills`. */
const USER_READ = /([\w$]+)!==null&&[\w$]+\("userSettings"\)&&![\w$]+\?[\w$]+\(\1,"userSettings","skills"/
/** The loader's projectSettings guard: the name it binds the setting to. */
const PROJECT_GUARD = /[,;]([\w$]+)=[\w$]+\("projectSettings"\)&&!/
const PROJECT_READ = '"projectSettings")'

const escaped = (name: string): string => name.replaceAll('$', '\\$')

/**
 * The one distinct function the host text holds around a match of `mark` that `keep` takes; refuses none, or two that
 * differ. Minified names repeat across the bundle's scopes, so a name alone is never the test; and a mark no function
 * holds is no part of the host's code, so it is passed over.
 */
function theOneFunctionAround(text: string, mark: RegExp | string, enclosing: (at: number) => string, what: string, keep: (source: string) => boolean = () => true): string {
  const pattern = typeof mark === 'string' ? new RegExp(mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : new RegExp(mark.source, 'g')
  const found = new Set([...text.matchAll(pattern)].flatMap((match) => heldBy(enclosing, match.index)).filter(keep))
  const [first] = found
  if (found.size !== 1 || first === undefined) throw new Error(`The host text holds ${String(found.size)} of ${what}, not one.`)
  return first
}

/** The function `enclosing` finds around `at`, or none when no function holds it. */
function heldBy(enclosing: (at: number) => string, at: number): readonly string[] {
  try {
    return [enclosing(at)]
  } catch {
    return []
  }
}

/** The plain function in `text` whose body holds `at`, whole. */
function enclosingFunction(text: string, at: number): string {
  for (let start = text.lastIndexOf('function ', at); start >= 0; start = text.lastIndexOf('function ', start - 1)) {
    const source = text.slice(start, closingBrace(text, text.indexOf('{', start)))
    if (start + source.length > at) return source
  }
  throw new Error('No function holds the host skill catalog warning in the host text.')
}

/** The name a recorded function is declared with. */
const nameOf = (source: string): string => /^(?:async )?function ([\w$]+)\(/.exec(source)?.[1] ?? ''

/** The skills loader, the bare-mode test it calls and the catalog reader it calls, from the host text, each checked. */
export function theSkillsLoaderIn(text: string): TheSkillsLoader {
  const skills_loader = theOneFunctionAround(text, SKILLS_LOADER_MARK, (at) => enclosingAsyncFunction(text, at).source, 'the skills loader')
  const bare = new RegExp(`if\\(([\\w$]+)\\(\\)\\)return\\(await`).exec(skills_loader)?.[1]
  if (bare === undefined) throw new Error('The skills loader has no bare-mode branch this reads.')
  const bare_mode_test = theOneFunctionAround(text, new RegExp(`function ${escaped(bare)}\\(\\)\\{`), (at) => enclosingFunction(text, at + 1), 'the bare-mode test', (source) => BARE_MODE_TEST.test(source))
  const host_skill_catalog = theOneFunctionAround(text, CATALOG_WARNING, (at) => enclosingFunction(text, at), 'the host skill catalog reader', (source) => /^function [\w$]+\(\)\{/.test(source) && skills_loader.includes(`${nameOf(source)}()`))
  const recorded = { skills_loader, bare_mode_test, host_skill_catalog }
  theSkillsLoaderHolds(recorded)
  return recorded
}

/**
 * Refuses, by what no longer holds, a recorded skills loader a launch cannot rely on: the copies in the member's
 * config folder would not load, the checkout's own folder would, or bare mode reads a variable the launch does not
 * drop. The recorder runs it on what it cuts, and the recording runs it on what is committed.
 */
export function theSkillsLoaderHolds({ skills_loader, bare_mode_test, host_skill_catalog }: TheSkillsLoader): void {
  const userRead = USER_READ.exec(skills_loader)
  if (userRead === null) throw new Error('The skills loader does not read the config folder\'s skills under userSettings, so the skills a launch copies there would not load (martha#747).')
  const guard = PROJECT_GUARD.exec(skills_loader)?.[1]
  if (guard === undefined) throw new Error('The skills loader binds no projectSettings guard, so whether it reads the checkout\'s own skills cannot be told (martha#747).')
  const bare = BARE_MODE_TEST.exec(bare_mode_test)
  if (bare === null) throw new Error('The recorded bare-mode test is not one this reads, so the variable a launch drops cannot be told (martha#747).')
  const branch = skills_loader.indexOf(`if(${bare[1] ?? ''}())return(`)
  if (branch < 0 || branch > userRead.index) throw new Error('The skills loader does not return on the bare-mode test before its user-scope read (martha#747).')
  const afterBranch = skills_loader.indexOf(';let ', branch)
  const guarded = skills_loader.split(`${guard}?Promise.all(`).length - 1
  const reads = skills_loader.slice(afterBranch).split(PROJECT_READ).length - 1
  if (guarded < 2 || reads !== guarded) {
    throw new Error(`The skills loader reads project skills ${String(reads)} time(s) outside bare mode, ${String(guarded)} of them under its projectSettings guard, so the checkout's own skills could load (martha#747).`)
  }
  if (!skills_loader.includes(`${nameOf(host_skill_catalog)}()`)) throw new Error('The skills loader does not call the recorded host skill catalog reader (martha#747).')
  hostSkillCatalogVariableOf(host_skill_catalog)
}

/** The variable bare mode is read from, as the recorded test reads it. */
export function bareModeVariableOf(bare_mode_test: string): string {
  const name = BARE_MODE_TEST.exec(bare_mode_test)?.[2]
  if (name === undefined) throw new Error('The recorded bare-mode test reads no variable this can name (martha#747).')
  return name
}

/** The variable the host skill catalog is named by, as the recorded reader's own warning names it. */
export function hostSkillCatalogVariableOf(host_skill_catalog: string): string {
  const name = CATALOG_WARNING.exec(host_skill_catalog)?.[1]
  if (name === undefined) throw new Error('The recorded host skill catalog reader names no variable in its warning (martha#747).')
  return name
}

/**
 * The committed recording's skills loader, held to what a launch relies on. It is read here, beside its own checks,
 * rather than through the recording's module, because the launch gate needs the two variables below and the
 * recording's module reaches the gate through the crew's taint carry: one import from there would close a loop.
 */
const RECORDED_SKILLS_LOADER: TheSkillsLoader = ((): TheSkillsLoader => {
  const recording = JSON.parse(readFileSync(new URL('../claude_code_host/recorded_claude_code_host.json', import.meta.url), 'utf8')) as TheSkillsLoader
  const loader = { skills_loader: recording.skills_loader, bare_mode_test: recording.bare_mode_test, host_skill_catalog: recording.host_skill_catalog }
  theSkillsLoaderHolds(loader)
  return loader
})()

/**
 * The variable that puts the recorded host in bare mode (martha#747): a member in bare mode would load none of the
 * skills its launch copies, and none of its gate's hooks, so a launch drops it.
 */
export const CLAUDE_CODE_BARE_MODE_VARIABLE: string = bareModeVariableOf(RECORDED_SKILLS_LOADER.bare_mode_test)

/** The variable that names the recorded host's skill catalog mount (martha#747): no approval reads that mount, so a launch drops it. */
export const CLAUDE_CODE_HOST_SKILL_CATALOG_VARIABLE: string = hostSkillCatalogVariableOf(RECORDED_SKILLS_LOADER.host_skill_catalog)
