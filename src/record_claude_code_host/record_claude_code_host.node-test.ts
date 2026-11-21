// The drift check bites (martha#139): `--check` passes on a host that says what
// the committed recording says, and fails, naming the field, on one that does
// not. CI runs this file in its own job on every PR, with no host installed: the
// host is a text made of the recording's own parts, so the checker is proven on
// every tip and only the scheduled comparison depends on a release.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST, recordedHostFrom } from '../claude_code_host/recorded_claude_code_host.ts'
import { CHUNK } from '../cut_the_rules_from_the_host_binary/protected_config_places.ts'
import { MEMORY_OFF, type Committed } from './carry_over_what_is_restated_by_hand.ts'
import { boundNameOf, bundleHolding } from './a_bundle_holding_a_recording.ts'
import { calleesFieldOf } from '../compare_two_host_recordings/compare_two_recordings.ts'
import { NOTICE_DAYS, NOTICE_RELEASES } from './how_long_a_notice_lasts.ts'
import type { GuardCalls } from '../compare_two_host_recordings/what_a_recorded_text_calls.ts'
import { fileModeGuardCallsIn } from './what_the_hosts_guards_call.ts'
import { CLAUDE_MEMORY_OFF } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { CLAUDE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'

const RECORDER = fileURLToPath(new URL('./record_claude_code_host.ts', import.meta.url))
const RECORDING = new URL('../claude_code_host/recorded_claude_code_host.json', import.meta.url)
const MODELS = new URL('../claude_code_host/recorded_claude_code_models.json', import.meta.url)
const CHECK = '--check'

/**
 * The committed recording's parts as a host binary holds them, by field. Each
 * text part is the host's own code as recorded; the managed settings place,
 * which is recorded as values, is written back in the shapes the host spells it.
 */
/** The name a recorded function or statement gives to what `pattern`'s group 1 marks. */
function nameIn(text: string, pattern: RegExp): string {
  const name = pattern.exec(text)?.[1]
  if (name === undefined) throw new Error(`The recording holds no ${String(pattern)}: ${text}`)
  return name
}

/** The host's function that returns the managed folder, as the recorded loader calls it. */
const MANAGED = nameIn(RECORDED_HOST.markdown_loader, /([\w$]+)\(\),"\.claude",/)
const LOADER = nameIn(RECORDED_HOST.markdown_loader, /^async function ([\w$]+)\(/)
const [PARSER_HEAD = '', BOM_STRIP = ''] = RECORDED_HOST.frontmatter_reader
const FRONTMATTER_PATTERN = nameIn(PARSER_HEAD, /\.match\(([\w$]+)\);$/)

/**
 * The markdown parts (martha#146), in the shapes the host spells them: the
 * frontmatter parser closed after its recorded opening, the pattern it matches
 * as a literal, the loader and the one function that calls it, called with
 * each kind, and the output-style schema. The skills loader's managed folder is the recorded skills loader's own
 * (martha#747), which RECORDED_PARTS carries whole.
 */
const MARKDOWN_PARTS: Readonly<Record<string, string>> = {
  frontmatter_reader: `${PARSER_HEAD}return 0};${BOM_STRIP}`,
  frontmatter_pattern: `var aKeptDeclarator=1,${FRONTMATTER_PATTERN}=/${RECORDED_HOST.frontmatter_pattern}/;`,
  markdown_loader: RECORDED_HOST.markdown_loader,
  markdown_kinds: [
    `function Wq(e,n,r){return Kq(()=>${LOADER}(e,n,r,0))}`,
    ...RECORDED_HOST.markdown_kinds.map((kind) => `Wq("${kind}",0)`),
  ].join(';'),
  output_style_schema: `var Uq=p(()=>u(${RECORDED_HOST.output_style_schema}))`,
  // The session-init response's field the launcher reads the owner's styles folder from (martha#154), in the shape a
  // schema object literal spells it: among other members, so the field must be found where it is not the only one.
  user_output_styles_dir: `var Vq=p(()=>u({session_id:j(),model:j(),${RECORDED_HOST.user_output_styles_dir},output_style:j()}))`,
}

const PROTECTED = RECORDED_HOST.protected_config_names
const CODE_PLACES = RECORDED_HOST.config_code_places
/** The recorded name the host builds its three signature files from: the one other recorded names extend. */
const SIGNED_BASE = PROTECTED.find((name) => PROTECTED.some((other) => other.startsWith(`${name}.`)))
const SIGNED = PROTECTED.filter((name) => SIGNED_BASE !== undefined && name.startsWith(`${SIGNED_BASE}.`))
const SUFFIXES = SIGNED.map((name) => name.slice((SIGNED_BASE ?? '').length + 1))
/** The functions the host builds those files with, and the constant the last of them closes over. */
const BUILDERS = SUFFIXES.map((_suffix, index) => `builtNumber${String(index + 1)}`)
const SUFFIX_CONSTANT = 'aConstantTheStreamsFileIsBuiltWith'
/** The global config file the host prefers over `.claude.json`, as recorded (martha#187 r=3). */
const PREFERRED_GLOBAL_CONFIG = RECORDED_HOST.legacy_global_config_names[0] ?? ''
const PREFERRED_CONSTANT = 'aNameOnlyTheHostDefines'

/**
 * The protected config places (martha#187), in the shapes the host spells them:
 * the Set built beside the array and the loop over it, the array the spread
 * brings in, one function per computed file that returns the host's own
 * template (the last from a constant it closes over), the host's own
 * statements naming the folders it runs and the sentence naming some of them
 * with the file beside them, and the one chooser that builds the global config
 * file it prefers from a constant it defines (martha#187 r=3).
 */
const PLACE_PARTS: Readonly<Record<string, string>> = {
  protected_config_names: [
    `var ${SUFFIX_CONSTANT}=".${SUFFIXES.at(-1) ?? ''}",kept=1`,
    ...BUILDERS.map((builder, index) =>
      index === BUILDERS.length - 1 ? `function ${builder}(e){return\`\${e}\${${SUFFIX_CONSTANT}}\`}` : `function ${builder}(e){return\`\${e}.${SUFFIXES[index] ?? ''}\`}`,
    ),
    `let spread=[${BUILDERS.map((builder) => `${builder}("${SIGNED_BASE ?? ''}")`).join(',')}],chosen=new Set(["${PROTECTED[0] ?? ''}",...spread])`,
    `for(let X of[${PROTECTED.map((name) => (SIGNED.includes(name) ? '...spread' : `"${name}"`)).filter((entry, index, all) => entry !== '...spread' || all.indexOf('...spread') === index).join(',')}]){let ue=ei(ut(Be(),X));be.push(chosen.has(X)?ue:So(ue))}`,
  ].join(';'),
  config_code_places: [
    ...CODE_PLACES.folders.flatMap((folder) => [`This writes to the Claude Code ${folder} folder. A file there is run.`, `This writes to the Claude Code ${folder} folder. A file there is run.`]),
    // The sentence names no more folders than the host's own wording lists: the host may state a place its catch-all
    // sentence does not, which is how 2.1.330's rm-guard folder reads (martha#1031).
    `So the write may land in the ${CODE_PLACES.folders[0] ?? ''}, ${CODE_PLACES.folders[1] ?? ''}, ${CODE_PLACES.folders[2] ?? ''} or ${CODE_PLACES.folders[3] ?? ''} folder or in ${CODE_PLACES.files[0] ?? ''} of the Claude Code config directory.`,
  ].join(' '),
  legacy_global_config_names: [
    `var ${PREFERRED_CONSTANT}="${PREFERRED_GLOBAL_CONFIG}",kept=1`,
    `function aChooserOfTheGlobalConfig(){if(aCheck())return{file:noConfig()};let o=aJoin(theConfigDir(),"${PREFERRED_GLOBAL_CONFIG}"),_=noConfig();try{let E=aStat().statSync(o);if(!E.isFile())return{file:_}}catch{}return{file:_}}`,
  ].join(';'),
}

/**
 * Which rules the host's file permission checks match (martha#226), in the shape the host spells it: the statement that
 * maps a rule's tool name to the one those checks use, inside the complaint it words that mapping with.
 */
const RULE_PARTS: Readonly<Record<string, string>> = {
  file_permission_rules: `if(s.ruleContent!==void 0){${RECORDED_HOST.file_permission_rules.matcher}if(g!==void 0)return{valid:!0,warning:\`\${yn(s)} is not matched by file permission checks\`}}`,
}


/**
 * The two lists the host keeps about the dialogs it raises (martha#313), in the shapes it spells them: the notification
 * types as one array of its own words, and the hook events a module hears as the array the host maps to its
 * `classic.<event>` names, through the one alias it holds it in.
 */
const DIALOG_PARTS: Readonly<Record<string, string>> = {
  notification_types: `var aListOfTheHostsNotifications=[${RECORDED_HOST.notification_types.map((notification_type) => `"${notification_type}"`).join(',')}],kept=1`,
  classic_hook_events: [
    `var aListOfTheHostsEvents=[${RECORDED_HOST.classic_hook_events.map((event) => `"${event}"`).join(',')}],theAlias=aListOfTheHostsEvents`,
    'var theModuleEvents=theAlias.map((e)=>`classic.${e}`)',
  ].join(';'),
}

/** The variables one host's report of a failed agent holds its names in; the minifier's own, matched by shape only. */
const REPORT_NAMES = ['eA', 'eB', 'eC', 'eD', 'eE', 'eF']

/**
 * The report a host writes for a failed agent (martha#390), in the shape the host spells it: the notification's name and
 * one constant per element, the one function that builds the report by walking its map, and the switch that gives a task
 * its status. Each value is the recording's own, so this part says what the binary said.
 */
const REPORT_PARTS: Readonly<Record<string, string>> = {
  failed_agents_report: [
    `var nA="${RECORDED_HOST.failed_agents_report.notification}",${RECORDED_HOST.failed_agents_report.elements.map(({ element }, at) => `${REPORT_NAMES[at] ?? ''}="${element}"`).join(',')}`,
    `function bR({taskId:t,toolUseId:n,taskType:r,outputFile:i,status:s,summary:e,summaryLead:d,body:T,trailing:p}){let l=[${['t', 'n', 'r', 'i', 's', 'e'].map((argument, at) => `[${REPORT_NAMES[at] ?? ''},${argument}]`).join(',')}],a=\`<\${nA}>\`;return a}`,
    `function gT(e){switch(e.status){${RECORDED_HOST.failed_agents_report.task_statuses.map((status) => `case"${status}":return{taskId:q,status:"${status}"}`).join(';')}}}`,
  ].join(';'),
}

const COMMITTED = JSON.parse(readFileSync(RECORDING, 'utf8')) as Committed
/** The functions the managed-folder guard reaches, as recorded (martha#412). */
const GUARD = COMMITTED.managed_folder_guard_calls
/** The functions the file-mode memory guard reaches, as recorded (martha#438). */
const FILE_GUARD = COMMITTED.file_mode_guard_calls
/** The prefix each guard's modules export under, so the two walks' exports never share a name. */
const MANAGED_EXPORTS = 'guardFunction'
const FILE_MODE_EXPORTS = 'fileModeFunction'
const exportedAs = (index: number, prefix = MANAGED_EXPORTS): string => `${prefix}${String(index)}`
const importing = (calls: Readonly<Record<string, number>>, prefix = MANAGED_EXPORTS): string =>
  `import{${Object.entries(calls).map(([name, index]) => `${exportedAs(index, prefix)} as ${name}`).join(',')}}from"/$bunfs/root/a-module.js";`

/** Each function a guard reaches, in a module of its own that imports what it calls and exports itself under a name of the module's. */
const modulesOf = (guard: GuardCalls, prefix: string): string[] =>
  guard.functions.map((entry, index) => {
    const name = boundNameOf(entry.function)
    return `\n${CHUNK}\n${importing(Object.fromEntries(Object.entries(entry.calls).filter(([called]) => called !== name)), prefix)}${entry.function};export{${name} as ${exportedAs(index, prefix)}};`
  })

/**
 * The memory guard restated by hand (martha#136): the texts it quotes, as the host holds them (martha#412). The on check
 * it quotes is a function the guard calls, so it sits in a module of its own that the guard's module imports (martha#438).
 */
const MEMORY_TEXT = `${RECORDED_HOST.memory_off.file_mode_guard};var Mq=process.env.${RECORDED_HOST.memory_off.hosted_mode_variable}`

/** The file-mode guard's own module (martha#438): it imports what the guard calls and holds `memory`, the guard among it. */
const fileGuardModule = (fileGuard: GuardCalls, memory: string): string => `\n${CHUNK}\n${importing(fileGuard.guard_calls, FILE_MODE_EXPORTS)}${memory}`

/**
 * Both guards and their callees as a bundle holds them (martha#412, martha#438): the loader's module imports what its
 * managed-folder guard calls, the file-mode guard sits in a module of its own that imports what it calls, and each
 * function either reaches sits in a module of its own.
 */
function guardModules(guard: GuardCalls, fileGuard: GuardCalls = FILE_GUARD, memory = MEMORY_TEXT): string {
  return [importing(guard.guard_calls), ...modulesOf(guard, MANAGED_EXPORTS), fileGuardModule(fileGuard, memory), ...modulesOf(fileGuard, FILE_MODE_EXPORTS)].join('')
}

/** The two places the host reads its sign-in store variable (martha#602), in the shapes it spells them. */
const signInParts = (variable: string): string =>
  [
    `function i5(){let n=process.env.${variable};if(n!==void 0)return(n||s(u(),".claude")).normalize("NFC");return Ye()}`,
    `function TNe(n=""){let e=process.env.${variable},t=e!==void 0?!e:!process.env.CLAUDE_CONFIG_DIR,r=e;return r}`,
  ].join(';')


/** The gateway's gate and the host's one provider choice (martha#916 r=4), in the shapes 2.1.329 spells them. */
const providerChoiceParts = ([gateway, ...chain]: readonly string[]): string =>
  [
    `function Iws(){{if(!s.${gateway ?? ''})return!1;let e=s.ANTHROPIC_BASE_URL,n=s.ANTHROPIC_AUTH_TOKEN||JWt();return n}}`,
    `function ve(){if(Po()||v7e()||Sre())return"gateway";return ${chain.map((name) => `s.${name}?"${name.toLowerCase()}":`).join('')}"firstParty"}`,
  ].join(';')

/** What the recording says a code field's texts call (martha#811). */
const recordedCallees = (field: string): GuardCalls => (COMMITTED as unknown as Record<string, GuardCalls>)[calleesFieldOf(field)] ?? { guard_calls: {}, functions: [] }

/** Every definition the recording says a field or a guard reaches (martha#811). */
const REACHED_TEXTS: readonly string[] = Object.entries(COMMITTED as unknown as Record<string, unknown>)
  .filter(([field]) => field.endsWith('_callees') || field.endsWith('_guard_calls'))
  .flatMap(([, list]) => (list as GuardCalls).functions.map((entry) => entry.function))

/** Whether a definition the recording reaches already holds `literal`, so the host holds it there and nowhere else. */
const reachedHolds = (literal: string): boolean => REACHED_TEXTS.some((text) => text.includes(JSON.stringify(literal)))

/**
 * The functions the hook set's exits call, as the bundle spells them (martha#811): where the recorder wrote a constant
 * in by value (martha#122), the definition the follower recorded is the bundle's own text, which reads the constant, and
 * the constant is defined beside it as the host defines it.
 */
const ARGV_CONSTANT = /process\.argv\.includes\(([\w$]+)\)/
const ARGV_FLAG = /process\.argv\.includes\("([^"]+)"\)/
const HOOK_EXITS = RECORDED_HOST.hooks_switch_calls.map((text) => {
  const name = boundNameOf(text)
  const bundled = REACHED_TEXTS.find((reached) => reached !== text && reached.startsWith(`function ${name}(`) && ARGV_CONSTANT.test(reached))
  const [constant, flag] = [ARGV_CONSTANT.exec(bundled ?? '')?.[1], ARGV_FLAG.exec(text)?.[1]]
  return bundled === undefined || constant === undefined || flag === undefined ? { text } : { text: bundled, constant: `var ${constant}="${flag}"` }
})

const RECORDED_PARTS: Readonly<Record<string, string>> = {
  session_start_schema: RECORDED_HOST.session_start_schema,  prompt_origin_mapper: RECORDED_HOST.prompt_origin_mapper,
  prompt_origin_fallback: RECORDED_HOST.prompt_origin_fallback,
  prompt_origin_subkinds: RECORDED_HOST.prompt_origin_subkinds,
  hooks_switches: RECORDED_HOST.hooks_switches,
  hooks_switch_calls: [...HOOK_EXITS.flatMap((exit) => exit.constant ?? []), ...HOOK_EXITS.map((exit) => exit.text)].join(';'),
  // Each place in the shape the host spells it, unless a definition the guard reaches holds it already (martha#811).
  managed_settings: [
    ...(reachedHolds(RECORDED_HOST.managed_settings.dir) ? [] : [`switch(P()){case"windows":return"C:\\\\ClaudeCode";default:return"${RECORDED_HOST.managed_settings.dir}"}`]),
    ...(reachedHolds(RECORDED_HOST.managed_settings.drop_in) ? [] : [`getDropInDir(){return this.dropInDir??=qC(${MANAGED}(),"${RECORDED_HOST.managed_settings.drop_in}")`]),
    ...(reachedHolds(RECORDED_HOST.managed_settings.file) ? [] : [`function jw(){return Ce(${MANAGED}(),"${RECORDED_HOST.managed_settings.file}")}`]),
  ].join(';'),
  ...MARKDOWN_PARTS,
  // The skills loader, the bare-mode test and the catalog reader it calls, each as recorded (martha#747).
  skills_loader: [RECORDED_HOST.skills_loader, RECORDED_HOST.bare_mode_test, RECORDED_HOST.host_skill_catalog].join(';'),
  ...PLACE_PARTS,
  ...RULE_PARTS,
  ...DIALOG_PARTS,
  ...REPORT_PARTS,
  sign_in_store_variable: signInParts(RECORDED_HOST.sign_in_store_variable),
  provider_switch_variables: providerChoiceParts(RECORDED_HOST.provider_switch_variables),
  // Last, so the import of what the managed-folder guard calls is in the loader's module, before the first module of
  // its own; the memory guard restated by hand sits in a module of its own among them (martha#438).
  guards: guardModules(GUARD),
}

/** A host text holding `parts` and the callees `recording` says the code fields reach, in a scratch file the test removes. */
function hostHolding(t: TestContext, parts: Readonly<Record<string, string>>, recording: Readonly<Record<string, unknown>> = COMMITTED as unknown as Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'martha-host-drift-'))
  t.after(() => removeTheTree(root))
  const host = join(root, CLAUDE)
  writeFileSync(host, `#!junk\n${bundleHolding(parts, recording, RECORDED_PARTS)}\n`, 'latin1')
  return host
}


/** The models the recording says the host accepts (martha#315). */
const RECORDED_MODELS = (JSON.parse(readFileSync(MODELS, 'utf8')) as { readonly aliases: readonly string[] }).aliases

/** A release's `sdk-tools.d.ts` as far as --check reads it: `AgentInput.model`, a union of `models` (martha#811). */
const declarationOf = (models: readonly string[]): string =>
  `export interface AgentInput {\n  description: string;\n  model?: ${models.map((model) => JSON.stringify(model)).join(' | ')};\n}\n`

const DAY_MS = 24 * 60 * 60 * 1000

/** npm's answer for the package's `time` and `versions`, with each of `released` published `ago` ms before now. */
function npmAnswerOf(released: ReadonlyArray<{ readonly version: string; readonly ago: number }>): unknown {
  const all = [{ version: RECORDED_HOST.host_version, ago: 30 * DAY_MS }, ...released]
  return {
    time: Object.fromEntries(all.map(({ version, ago }) => [version, new Date(Date.now() - ago).toISOString()])),
    versions: all.map(({ version }) => version),
  }
}

/** What --check reads beside the binary, planted next to it: the declaration, and npm's answer. */
interface Beside {
  readonly models?: readonly string[]
  /** The declaration's text; null plants none, as a release that ships no `sdk-tools.d.ts`. */
  readonly declaration?: string | null
  readonly npm?: unknown
}

/** `--check` run on a host text, as the drift job runs it, with the declaration and npm's answer planted beside it. */
function check(host: string, version: string, beside: Beside = {}): { status: number | null; stdout: string } {
  const declaration = join(dirname(host), 'sdk-tools.d.ts')
  const npm = join(dirname(host), 'npm-answer.json')
  if (beside.declaration !== null) writeFileSync(declaration, beside.declaration ?? declarationOf(beside.models ?? RECORDED_MODELS))
  writeFileSync(npm, typeof beside.npm === 'string' ? beside.npm : JSON.stringify(beside.npm ?? npmAnswerOf([{ version, ago: DAY_MS }])))
  const run = spawnSync(process.execPath, [RECORDER, CHECK, host, version, declaration, npm], { encoding: 'utf8' })
  return { status: run.status, stdout: run.stdout }
}

/**
 * That --check failed on exactly `differs` (the line it prints, fields joined by `, `), with one "first difference" line
 * for each field in the same order (martha#811). Where in a field it differs is the host's, so only the field is held.
 */
function assertDiffers(run: { status: number | null; stdout: string }, differs: string, version = RECORDED_HOST.host_version): void {
  assert.equal(run.status, 1, run.stdout)
  const [head, line, ...firsts] = run.stdout.trimEnd().split('\n')
  assert.equal(head, `recorded ${RECORDED_HOST.host_version}, host ${version}`)
  assert.equal(line, `differs: ${differs}`)
  assert.deepEqual(firsts.map((first) => /^first difference: ([\w]+) at ./.exec(first)?.[1]), differs.split(', '))
}

/** A version that differs from the recorded one in its patch number. */
function anotherVersion(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number)
  return [major, minor, (patch ?? 0) + 1].join('.')
}

test('a host that says what the recording says passes the check, and the recording is left as it was', (t) => {
  const before = readFileSync(RECORDING)
  const run = check(hostHolding(t, RECORDED_PARTS), RECORDED_HOST.host_version)
  assert.equal(run.status, 0, run.stdout)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\n`)
  assert.deepEqual(readFileSync(RECORDING), before)
})

// The field is required of the recording itself (martha#154): the fold-in the reviewer asked for, a recording that
// lost it is not one this build runs on, rather than a gate that refuses every launch while the field is missing.
test('a recording the user-output-styles field is cut from does not load (martha#154)', () => {
  const recording = JSON.parse(readFileSync(RECORDING, 'utf8')) as Record<string, unknown>
  assert.equal(typeof recording['user_output_styles_dir'], 'string')
  const { user_output_styles_dir: _dropped, ...without } = recording
  assert.throws(() => recordedHostFrom(JSON.stringify(without)), /user-output-styles field/)
  // The whole recording loads, and the field it names is the one the launch reads.
  assert.equal(recordedHostFrom(JSON.stringify(recording)).host_version, RECORDED_HOST.host_version)
})

/** The recorded prompt-origin subkinds with one more planted: a literal of the host's code that changed. */
const PLANTED_SUBKINDS = RECORDED_HOST.prompt_origin_subkinds.replace('"projects-relay"', '"projects-relay","session-inbox"')
// The mapper and the fallback reach a definition the subkinds field holds, so what they reach differs with it (martha#811).
const SUBKINDS_DIFFER = [
  ...['prompt_origin_fallback', 'prompt_origin_mapper'].filter((field) =>
    recordedCallees(field).functions.some((entry) => RECORDED_HOST.prompt_origin_subkinds.includes(entry.function)),
  ),
  'prompt_origin_subkinds',
].join(', ')

test('a host whose code differs fails the check, naming the field and nothing of the host\'s code', (t) => {
  assert.notEqual(PLANTED_SUBKINDS, RECORDED_HOST.prompt_origin_subkinds, 'the planted set differs')
  assertDiffers(check(hostHolding(t, { ...RECORDED_PARTS, prompt_origin_subkinds: PLANTED_SUBKINDS }), RECORDED_HOST.host_version), SUBKINDS_DIFFER)
})

/** That --check passed a release of `version` on its version alone, saying a routine re-record is due (martha#811). */
function assertNotice(run: { status: number | null; stdout: string }, version: string): void {
  assert.equal(run.status, 0, run.stdout)
  const [head, notice, ...rest] = run.stdout.trimEnd().split('\n')
  assert.equal(head, `recorded ${RECORDED_HOST.host_version}, host ${version}`)
  assert.match(notice ?? '', new RegExp(`^notice: Claude Code ${escapedForRegExp(version)} carries the same facts as the recorded ${escapedForRegExp(RECORDED_HOST.host_version)}: `))
  assert.deepEqual(rest, [])
}

/** A text matched as itself inside a pattern. */
const escapedForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// DECIDED 2026-11-19 "Every release (Recommended)" (martha#811): a release whose facts are all the recorded ones passes
// on its version alone, with a notice, whether its patch, minor or major number moved.
test('a host of another version whose facts are the recorded ones passes the check with a notice that a re-record is due (martha#811)', (t) => {
  const host = hostHolding(t, RECORDED_PARTS)
  const [major = 0, minor = 0] = RECORDED_HOST.host_version.split('.').map(Number)
  for (const version of [anotherVersion(RECORDED_HOST.host_version), [major, minor + 1, 0].join('.'), [major + 1, 0, 0].join('.')]) {
    assertNotice(check(host, version), version)
  }
})

/** That --check failed on `unreadable` alone (the line it prints, parts joined by `, `), naming no fact as differing. */
function assertUnreadable(run: { status: number | null; stdout: string }, unreadable: string, version = RECORDED_HOST.host_version): void {
  assert.equal(run.status, 1, run.stdout)
  assert.deepEqual(run.stdout.trimEnd().split('\n'), [`recorded ${RECORDED_HOST.host_version}, host ${version}`, `unreadable: ${unreadable}`])
}

// A release whose facts changed fails on its new version as on the recorded one, naming the fields (martha#811). The
// pass path under a renaming is proven on the real 2.1.328 recording renamed (compare_two_recordings.node-test.ts):
// the bundle these tests build is the recording's parts with scaffolding between them, not a program a renamer can read.
test('a release of another version whose literal changed fails naming the fields, with no notice (martha#811)', (t) => {
  const version = anotherVersion(RECORDED_HOST.host_version)
  assertDiffers(check(hostHolding(t, { ...RECORDED_PARTS, prompt_origin_subkinds: PLANTED_SUBKINDS }), version), SUBKINDS_DIFFER, version)
})

test('a release whose declaration accepts other models fails naming models, and one whose declaration cannot be read is unreadable (martha#811)', (t) => {
  const host = hostHolding(t, RECORDED_PARTS)
  assertDiffers(check(host, RECORDED_HOST.host_version, { models: [...RECORDED_MODELS, 'a-model-no-recording-names'] }), 'models')
  assertUnreadable(check(host, RECORDED_HOST.host_version, { declaration: 'export interface SomethingElse {}\n' }), 'models the host accepts')
})

test('a release that ships no declaration is unreadable naming the file it lacks, never a raw error (martha#811 r=1; mutant: the file is read unchecked)', (t) => {
  const host = hostHolding(t, RECORDED_PARTS)
  assertUnreadable(check(host, RECORDED_HOST.host_version, { declaration: null }), `models the host accepts: no declaration at ${join(dirname(host), 'sdk-tools.d.ts')}`)
})

// R6 (martha#811): what a code field calls is part of its fact. A call the follower cannot bind is unreadable, never
// passed; a definition the field reaches that changed makes the field differ though its own text did not.
test('a code field calling a function the host does not define is unreadable, and one whose callee changed differs (martha#811)', (t) => {
  const unbound = MARKDOWN_PARTS.output_style_schema?.replace(',description:', ',aPlantedKey:aCalleeNoHostDefines(),description:') ?? ''
  assert.ok(unbound.includes('aCalleeNoHostDefines()'), 'the planted call is in the schema')
  assertUnreadable(check(hostHolding(t, { ...RECORDED_PARTS, output_style_schema: unbound }), RECORDED_HOST.host_version), 'what output_style_schema calls, output_style_schema')
  const callees = recordedCallees('session_start_schema')
  const [first] = callees.functions
  assert.ok(first !== undefined && first.function.includes('"literal"'), 'the planted callee holds the literal it changes')
  const changed = { ...callees, functions: [{ ...first, function: first.function.replace('"literal"', '"literals"') }, ...callees.functions.slice(1)] }
  const recording = { ...(COMMITTED as unknown as Record<string, unknown>), [calleesFieldOf('session_start_schema')]: changed }
  assertDiffers(check(hostHolding(t, RECORDED_PARTS, recording), RECORDED_HOST.host_version), 'session_start_schema')
})

/** A definition the recording holds as one name set to another, `var X=Y`, and its name. */
const AN_ALIAS = /^var ([\w$]+)=[\w$]+$/

// A bundle can set a module's binding lazily, `var X;` and later `X=...` in the module's init, where another release
// sets it where it is declared (martha#811). The follower writes the one assignment as the declaration's value, so the
// two read the same.
test('a host that sets a recorded definition lazily, declared bare and assigned later, passes the check (martha#811)', (t) => {
  const alias = recordedCallees('output_style_schema').functions.map((entry) => entry.function).find((text) => AN_ALIAS.test(text))
  const name = alias === undefined ? undefined : AN_ALIAS.exec(alias)?.[1]
  assert.ok(alias !== undefined && name !== undefined, 'the schema reaches no definition of the form var X=Y')
  const host = hostHolding(t, RECORDED_PARTS)
  const text = readFileSync(host, 'latin1')
  assert.equal(text.split(alias).length, 2, 'the bundle holds the definition once')
  writeFileSync(host, text.replace(alias, `var ${name};${alias.slice('var '.length)}`), 'latin1')
  const run = check(host, RECORDED_HOST.host_version)
  assert.equal(run.status, 0, run.stdout)
})

/** The versions after the recorded one, `count` of them, each one patch on. */
function newerVersions(count: number): string[] {
  const versions: string[] = []
  for (let version = RECORDED_HOST.host_version; versions.length < count; versions.push(version)) version = anotherVersion(version)
  return versions
}

/** That --check failed a release on a notice that has aged. */
function assertAged(run: { status: number | null; stdout: string }, version: string): void {
  assert.equal(run.status, 1, run.stdout)
  const [head, aged, ...rest] = run.stdout.trimEnd().split('\n')
  assert.equal(head, `recorded ${RECORDED_HOST.host_version}, host ${version}`)
  assert.match(aged ?? '', /^aged: .+: the re-record is overdue$/)
  assert.deepEqual(rest, [])
}

// DECIDED 2026-11-19 "7 days or 5 versions (Recommended)" (martha#811): the notice lasts until the first newer release
// is NOTICE_DAYS old or NOTICE_RELEASES newer releases exist; a prerelease is no release, and an npm answer that cannot
// be read never lets a notice pass.
test('the notice lasts until the first newer release is old enough or enough newer releases exist, and an unread npm answer fails (martha#811)', (t) => {
  const host = hostHolding(t, RECORDED_PARTS)
  const [version = ''] = newerVersions(1)
  const released = (ago: number) => npmAnswerOf([{ version, ago }])
  assertNotice(check(host, version, { npm: released(NOTICE_DAYS * DAY_MS - 60 * 60 * 1000) }), version)
  assertAged(check(host, version, { npm: released(NOTICE_DAYS * DAY_MS) }), version)
  const each = (versions: readonly string[]) => versions.map((one) => ({ version: one, ago: DAY_MS }))
  assertNotice(check(host, version, { npm: npmAnswerOf(each(newerVersions(NOTICE_RELEASES - 1))) }), version)
  assertAged(check(host, version, { npm: npmAnswerOf(each(newerVersions(NOTICE_RELEASES))) }), version)
  const prerelease = `${newerVersions(NOTICE_RELEASES).at(-1) ?? ''}-beta.1`
  assertNotice(check(host, version, { npm: npmAnswerOf(each([...newerVersions(NOTICE_RELEASES - 1), prerelease])) }), version)
  assertUnreadable(check(host, version, { npm: 'not an npm answer' }), "npm's release times or versions", version)
  assertUnreadable(check(host, version, { npm: { versions: [version] } }), "npm's release times or versions", version)
})

test('a host the recorder cannot read fails the check, naming the part', (t) => {
  const { prompt_origin_mapper: _mapper, ...withoutMapper } = RECORDED_PARTS
  const run = check(hostHolding(t, withoutMapper), RECORDED_HOST.host_version)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: prompt origins\n`)
})

test('a host that picks its sign-in store by another variable fails the check naming the field, and one whose two rules disagree cannot be read (martha#602)', (t) => {
  const renamed = check(hostHolding(t, { ...RECORDED_PARTS, sign_in_store_variable: signInParts('ANOTHER_STORE_DIR') }), RECORDED_HOST.host_version)
  assertDiffers(renamed, 'sign_in_store_variable')
  const disagreeing = signInParts(RECORDED_HOST.sign_in_store_variable).replace(/(process\.env\.)[A-Z_]+(,)/, '$1ANOTHER_STORE_DIR$2')
  const run = check(hostHolding(t, { ...RECORDED_PARTS, sign_in_store_variable: disagreeing }), RECORDED_HOST.host_version)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: sign-in store\n`)
})

test('martha#916 r=4: a host that adds a cloud provider fails the check naming the field, and one with no provider choice cannot be read', (t) => {
  const added = check(hostHolding(t, { ...RECORDED_PARTS, provider_switch_variables: providerChoiceParts([...RECORDED_HOST.provider_switch_variables, 'A_PROVIDER_THIS_TEST_MADE_UP']) }), RECORDED_HOST.host_version)
  assertDiffers(added, 'provider_switch_variables')
  const { provider_switch_variables: _choice, ...withoutChoice } = RECORDED_PARTS
  const run = check(hostHolding(t, withoutChoice), RECORDED_HOST.host_version)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: provider switches\n`)
})

/**
 * A folder kind no host loads, planted to make the markdown folders differ. It was `output-styles` until 2.1.327 began
 * loading that one itself, and a planted kind the host already loads adds nothing, so the check stayed green
 * (martha#624). The test below holds it outside the recording, so a host that ships it fails there by name.
 */
const A_KIND_NO_HOST_LOADS = 'planted-kind-no-host-loads'
/** A function the recorded output-style schema calls, which the bundle binds (martha#811). */
const SCHEMA_CALLS_FIRST = Object.keys(recordedCallees('output_style_schema').guard_calls)[0] ?? ''

test('a host whose frontmatter pattern, markdown folders or output-style schema differ fails the check, naming the field (martha#146)', (t) => {
  assert.ok(!RECORDED_HOST.markdown_kinds.includes(A_KIND_NO_HOST_LOADS), `the recorded host loads ${A_KIND_NO_HOST_LOADS}, so planting it changes nothing; plant another kind`)
  for (const [field, planted] of [
    ['frontmatter_pattern', MARKDOWN_PARTS.frontmatter_pattern?.replace('\\s*\\n(', '[ \\t]*\\n(')],
    ['markdown_kinds', `${MARKDOWN_PARTS.markdown_kinds ?? ''};Wq("${A_KIND_NO_HOST_LOADS}",0)`],
    // A member built by a function the schema already calls, so the follower binds it and the change is one of meaning.
    ['output_style_schema', MARKDOWN_PARTS.output_style_schema?.replace('"force-for-plugin":', `hooks:${SCHEMA_CALLS_FIRST}().optional(),"force-for-plugin":`)],
  ] as const) {
    assert.notEqual(planted, MARKDOWN_PARTS[field], `the planted ${field} differs`)
    const run = check(hostHolding(t, { ...RECORDED_PARTS, [field]: planted ?? '' }), RECORDED_HOST.host_version)
    assertDiffers(run, `${field}`)
  }
})

test('a host whose frontmatter pattern carries a flag, or that has two markdown loaders, cannot be read, naming the part (martha#146)', (t) => {
  for (const planted of [
    { frontmatter_pattern: `var aKeptDeclarator=1,${FRONTMATTER_PATTERN}=/${RECORDED_HOST.frontmatter_pattern}/m;` },
    { markdown_loader: `${RECORDED_HOST.markdown_loader};${RECORDED_HOST.markdown_loader.replace(`function ${LOADER}(`, 'function Zq(')}` },
  ]) {
    const run = check(hostHolding(t, { ...RECORDED_PARTS, ...planted }), RECORDED_HOST.host_version)
    assert.equal(run.status, 1, JSON.stringify(Object.keys(planted)))
    assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: markdown the host loads\n`)
  }
})

// The minifier reuses a short name in another module (martha#1031): 2.1.330 gives the frontmatter pattern's name to a
// markdown-escape pattern too. The frontmatter pattern is the literal that opens at the start with no flags, so a
// literal of another shape given that name changes nothing, and two of the shape cannot be told apart.
test('a host that gives the frontmatter pattern\'s name another literal still reads, and one that gives it two of the shape cannot be read (martha#1031)', (t) => {
  const named = check(hostHolding(t, { ...RECORDED_PARTS, frontmatter_pattern: `${MARKDOWN_PARTS.frontmatter_pattern ?? ''}var aKeptSecondDeclarator=1,${FRONTMATTER_PATTERN}=/[!*<]/g;` }), RECORDED_HOST.host_version)
  assert.equal(named.status, 0, named.stdout)
  assert.equal(named.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\n`)
  const twice = check(hostHolding(t, { ...RECORDED_PARTS, frontmatter_pattern: `${MARKDOWN_PARTS.frontmatter_pattern ?? ''}var aKeptThirdDeclarator=1,${FRONTMATTER_PATTERN}=/^---other/;` }), RECORDED_HOST.host_version)
  assert.equal(twice.status, 1, twice.stdout)
  assert.equal(twice.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: markdown the host loads\n`)
})

test('a host that renames the global config it prefers fails the check naming the field, and one with two choosers cannot be read (martha#187 r=3)', (t) => {
  const renamed = PLACE_PARTS.legacy_global_config_names?.replaceAll(PREFERRED_GLOBAL_CONFIG, 'a-renamed-global-config.json') ?? ''
  assert.equal(renamed.includes(PREFERRED_GLOBAL_CONFIG), false, 'the renamed host names only the new file')
  const differs = check(hostHolding(t, { ...RECORDED_PARTS, legacy_global_config_names: renamed }), RECORDED_HOST.host_version)
  assertDiffers(differs, 'legacy_global_config_names')
  const two = check(hostHolding(t, { ...RECORDED_PARTS, legacy_global_config_names: `${PLACE_PARTS.legacy_global_config_names ?? ''};${PLACE_PARTS.legacy_global_config_names ?? ''}` }), RECORDED_HOST.host_version)
  assert.equal(two.status, 1)
  assert.equal(two.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: protected config places\n`)
})

// The recorded name is only trusted because the host also holds it as a constant of its own (martha#203, the
// refusal #187 left untested): a host whose chooser joins a name it defines nowhere else is one whose global
// config file cannot be told, and the check says so by the part rather than denying a name nothing reads.
test('a host that joins the global config it prefers to its config dir but holds it as no constant of its own cannot be read (martha#203)', (t) => {
  const chooserOnly = (PLACE_PARTS.legacy_global_config_names ?? '').split(';').filter((part) => !part.includes(PREFERRED_CONSTANT)).join(';')
  assert.ok(chooserOnly.includes(PREFERRED_GLOBAL_CONFIG), 'the planted host joins the recorded name to its config dir')
  assert.equal(chooserOnly.includes(`var ${PREFERRED_CONSTANT}=`), false, 'the planted host holds the name as no constant of its own')
  const run = check(hostHolding(t, { ...RECORDED_PARTS, legacy_global_config_names: chooserOnly }), RECORDED_HOST.host_version)
  assert.equal(run.status, 1, run.stdout)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: protected config places\n`)
})

/** A folder the host runs whose name is no part of the file named beside it, so renaming it changes one thing. */
const RENAMABLE = CODE_PLACES.folders.find((folder) => !(CODE_PLACES.files[0] ?? '').startsWith(folder)) ?? CODE_PLACES.folders[0] ?? ''

test('a host that adds a protected config-dir place, or renames a folder it runs, fails the check naming the field (martha#187)', (t) => {
  for (const [field, planted] of [
    ['protected_config_names', PLACE_PARTS.protected_config_names?.replace('...spread,', '"a-place-a-later-host-added",...spread,')],
    ['config_code_places', PLACE_PARTS.config_code_places?.replaceAll(RENAMABLE, 'a-renamed-place')],
  ] as const) {
    assert.notEqual(planted, PLACE_PARTS[field], `the planted ${field} differs`)
    const run = check(hostHolding(t, { ...RECORDED_PARTS, [field]: planted ?? '' }), RECORDED_HOST.host_version)
    assertDiffers(run, `${field}`)
  }
})

test('a host whose statements and sentence name different places, or that walks two protected arrays, cannot be read, naming the part (martha#187)', (t) => {
  const sentence = PLACE_PARTS.config_code_places ?? ''
  const misnamed = sentence.replace(`land in the ${CODE_PLACES.folders[0] ?? ''},`, 'land in the a-new-place,')
  assert.notEqual(misnamed, sentence, 'the planted sentence names a folder the statements do not')
  for (const planted of [
    { config_code_places: misnamed },
    { protected_config_names: `${PLACE_PARTS.protected_config_names ?? ''};${PLACE_PARTS.protected_config_names ?? ''}` },
  ]) {
    const run = check(hostHolding(t, { ...RECORDED_PARTS, ...planted }), RECORDED_HOST.host_version)
    assert.equal(run.status, 1, JSON.stringify(Object.keys(planted)))
    assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: protected config places\n`)
  }
})

// The host states a place before its catch-all sentence lists it: 2.1.330's statements name the rm-guard folder it runs
// and its sentence still lists the four it listed before (martha#1031), so the statements are the places and the
// sentence is a second witness that may name fewer. A place only so stated is recorded, and the check names the field.
test('a host whose statements name a place its sentence does not still reads, and the check names the field (martha#1031)', (t) => {
  const planted = `${PLACE_PARTS.config_code_places ?? ''} This writes to the Claude Code a-place-only-the-statements-name folder.`
  assert.notEqual(planted, PLACE_PARTS.config_code_places, 'the planted host states a place its sentence does not')
  assertDiffers(check(hostHolding(t, { ...RECORDED_PARTS, config_code_places: planted }), RECORDED_HOST.host_version), 'config_code_places')
})

// The minifier reuses a short name inside one module (martha#908): 2.1.329 names an empty array in its sandbox setup
// `zn`, as the spread its protected array brings in. The spread is the one declared beside the Set the host walks, so
// another array of that name elsewhere in the module changes nothing, and a spread declared anywhere else is not read.
test('a host that names another array like the spread still reads, and one that declares the spread apart from its Set cannot be read (martha#908)', (t) => {
  const places = PLACE_PARTS.protected_config_names ?? ''
  const named = check(hostHolding(t, { ...RECORDED_PARTS, protected_config_names: `let spread=[],aSecondArray=[];${places}` }), RECORDED_HOST.host_version)
  assert.equal(named.status, 0, named.stdout)
  const apart = places.replace('],chosen=new Set(', '];let chosen=new Set(')
  assert.notEqual(apart, places, 'the planted host declares the spread in a statement of its own')
  const run = check(hostHolding(t, { ...RECORDED_PARTS, protected_config_names: apart }), RECORDED_HOST.host_version)
  assert.equal(run.status, 1, run.stdout)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: protected config places\n`)
})

// Which rules the host's file permission checks match is what a launch writes its rules under and what it reads the
// host's complaint against (martha#226): a host that maps a file tool's rules another way fails the check by that
// field, rather than leaving the launch writing a rule the new host would ignore.
test('a host that matches a file tool\'s rules another way fails the check naming the field (martha#226)', (t) => {
  const planted = RECORDED_HOST.file_permission_rules.matcher.replace('"Edit"', '"Write"')
  assert.notEqual(planted, RECORDED_HOST.file_permission_rules.matcher, 'the planted statement differs')
  const run = check(hostHolding(t, { ...RECORDED_PARTS, file_permission_rules: RULE_PARTS.file_permission_rules?.replace(RECORDED_HOST.file_permission_rules.matcher, planted) ?? '' }), RECORDED_HOST.host_version)
  assertDiffers(run, `file_permission_rules`)
})

// The two lists the dialogs are heard from are compared like every other part (martha#313, Pluto's correction): a host
// that adds a hook event a module hears, or a notification type, fails the check by that field rather than being read
// as a host this build knows.
test('a host that adds a hook event a module hears, or a notification type, fails the check naming the field (martha#313)', (t) => {
  for (const [field, planted] of [
    ['classic_hook_events', DIALOG_PARTS.classic_hook_events?.replace('"PreToolUse"', '"PreToolUsed"')],
    ['notification_types', DIALOG_PARTS.notification_types?.replace('"idle_prompt"', '"idle_prompt","a_later_host_added_this"')],
  ] as const) {
    assert.notEqual(planted, DIALOG_PARTS[field], `the planted ${field} differs`)
    const run = check(hostHolding(t, { ...RECORDED_PARTS, [field]: planted ?? '' }), RECORDED_HOST.host_version)
    assertDiffers(run, `${field}`)
  }
})

test('a host whose two lists cannot be found cannot be read, naming each part (martha#313)', (t) => {
  for (const [part, missing] of [
    ['hook events a module hears', { classic_hook_events: 'var unrelated=1' }],
    ['notification types', { notification_types: 'var unrelated=1' }],
  ] as const) {
    const run = check(hostHolding(t, { ...RECORDED_PARTS, ...missing }), RECORDED_HOST.host_version)
    assert.equal(run.status, 1, part)
    assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: ${part}\n`)
  }
})

// A host that maps a second list of hook events — the full one under another name, or a shorter one with the same
// prefix — cannot be told which list the module events come from, so it is refused by the part (martha#313, Pluto's
// correction; the bundle really does hold shorter arrays beside the full one).
test('a host that maps a second list of hook events cannot be read, naming the part (martha#313)', (t) => {
  const first = DIALOG_PARTS.classic_hook_events ?? ''
  assert.ok(first.includes('theAlias.map('), 'the recorded part maps its list')
  for (const second of [
    first.replaceAll('aListOfTheHostsEvents', 'anotherListOfTheHostsEvents').replaceAll('theAlias', 'anotherAlias'),
    first.replace(/\[[^\]]*\]/, '["PreToolUse","PostToolUse"]').replaceAll('aListOfTheHostsEvents', 'aShorterList').replaceAll('theAlias', 'aShorterAlias'),
  ]) {
    assert.notEqual(second, first, 'the planted second list is another list')
    const run = check(hostHolding(t, { ...RECORDED_PARTS, classic_hook_events: `${first};${second}` }), RECORDED_HOST.host_version)
    assert.equal(run.status, 1, second.slice(0, 80))
    assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: hook events a module hears\n`)
  }
})

// The report a host writes for a failed agent is compared like every other part (martha#390): a host that renames an
// element or stops writing the report fails the check by that field, rather than a review that stopped reading as one
// that never ran.
test('a host that renames an element of a failed agent\'s report fails the check naming the field (martha#390)', (t) => {
  const planted = (REPORT_PARTS.failed_agents_report ?? '').replace('="tool-use-id"', '="task-call-id"')
  assert.notEqual(planted, REPORT_PARTS.failed_agents_report, 'the planted report differs')
  const run = check(hostHolding(t, { ...RECORDED_PARTS, failed_agents_report: planted }), RECORDED_HOST.host_version)
  assertDiffers(run, `failed_agents_report`)
})

test('a host that no longer builds the report cannot be read, naming the part (martha#390)', (t) => {
  const run = check(hostHolding(t, { ...RECORDED_PARTS, failed_agents_report: 'var unrelated=1' }), RECORDED_HOST.host_version)
  assert.equal(run.status, 1, run.stdout)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: a failed agent's report\n`)
})

/** The recorded guard with the one function `name` declares changed by `change` (martha#412). */
function withChangedFunction(name: string, change: (source: string) => string, guard: GuardCalls = GUARD): GuardCalls {
  const at = guard.functions.findIndex((entry) => entry.function.startsWith(`function ${name}(`))
  assert.ok(at >= 0, `the recording holds a function ${name} the guard reaches`)
  return { ...guard, functions: guard.functions.map((entry, index) => (index === at ? { ...entry, function: change(entry.function) } : entry)) }
}

/** The name the recorded guard's first call reaches, past the guard, by its own first call: the deepest a loader byte cannot show. */
const SECOND_STEP = Object.keys(GUARD.functions[Object.values(GUARD.guard_calls)[0] ?? 0]?.calls ?? {}).at(-1) ?? ''

// The gap #401's review named (martha#412): the loader stays byte-equal while a function its managed-folder guard calls
// two steps down changes what it returns, or a name the guard calls binds to another function. Both fail by the field.
test('a host whose managed-folder guard reaches a changed function, or binds a name to another, fails the check naming the field (martha#412)', (t) => {
  assert.notEqual(SECOND_STEP, '', 'the recorded guard reaches a function two steps down')
  const changed = withChangedFunction(SECOND_STEP, (source) => source.replace(/\{return(.*)\}$/, '{return!($1)}'))
  const [firstCall = '', firstEntry = 0] = Object.entries(GUARD.guard_calls)[0] ?? []
  const rebound = { ...GUARD, guard_calls: { ...GUARD.guard_calls, [firstCall]: GUARD.functions.length - 1 - firstEntry } }
  // The loader calls the guard's first call itself (martha#811 records what the loader calls), so binding that name to
  // another function changes what the loader reaches too; a change two steps down is past the loader's one level.
  const loaderCallsIt = firstCall in recordedCallees('markdown_loader').guard_calls
  for (const [planted, differs] of [
    [changed, 'managed_folder_guard_calls'],
    [rebound, loaderCallsIt ? 'managed_folder_guard_calls, markdown_loader' : 'managed_folder_guard_calls'],
  ] as const) {
    assert.notDeepEqual(planted, GUARD, 'the planted guard differs')
    assert.equal(RECORDED_PARTS.markdown_loader, MARKDOWN_PARTS.markdown_loader, 'the loader itself is byte-equal')
    const run = check(hostHolding(t, { ...RECORDED_PARTS, guards: guardModules(planted) }), RECORDED_HOST.host_version)
    assertDiffers(run, differs)
  }
})

test('a host whose bundle exports a name the guard calls from two modules cannot be read, naming the part (martha#412)', (t) => {
  const twice = `${guardModules(GUARD)}\n${CHUNK}\nfunction aSecondOne(){return!0}export{aSecondOne as ${exportedAs(0)}};`
  const run = check(hostHolding(t, { ...RECORDED_PARTS, guards: twice }), RECORDED_HOST.host_version)
  assert.equal(run.status, 1, run.stdout)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: markdown the host loads\n`)
})

test('a host whose module declares a function the guard reaches two ways cannot be read, naming the part (martha#412 r=2)', (t) => {
  const last = GUARD.functions.at(-1)?.function ?? ''
  const name = /^function\*? ?([\w$]+)\(/.exec(last)?.[1] ?? ''
  assert.notEqual(name, '', 'the recorded guard reaches a function')
  // The last function's module is the bundle's last when no file-mode module follows, so a second, different declaration
  // of it lands in that module; the file-mode guard's modules come after it here.
  const twice = `${[importing(GUARD.guard_calls), fileGuardModule(FILE_GUARD, MEMORY_TEXT), ...modulesOf(FILE_GUARD, FILE_MODE_EXPORTS), ...modulesOf(GUARD, MANAGED_EXPORTS)].join('')}function ${name}(){return!(${String(GUARD.functions.length)})}`
  const run = check(hostHolding(t, { ...RECORDED_PARTS, guards: twice }), RECORDED_HOST.host_version)
  assert.equal(run.status, 1, run.stdout)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: markdown the host loads\n`)
})

test('a host whose loader assigns a name its managed-folder guard reads two ways cannot be read, naming the part (martha#412 r=2)', (t) => {
  const loader = RECORDED_HOST.markdown_loader
  const guard = /\[\(([^?]+)\?Promise\.resolve\(\[\]\)/.exec(loader)?.[1] ?? ''
  const read = [...guard.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$(])/g)].map((match) => match[1] ?? '')
  const assigned = read.map((name) => new RegExp(`,${name.replaceAll('$', '\\$')}=(?![=>])([^,;]+)`).exec(loader)).find((match) => match !== null)
  assert.ok(assigned !== undefined && assigned !== null, 'the recorded guard reads a name its loader assigns')
  const [assignment, expression = ''] = assigned
  const name = assignment.slice(1, assignment.indexOf('='))
  const twoWays = loader.replace(assignment, `${assignment},${name}=!(${expression})`)
  const run = check(hostHolding(t, { ...RECORDED_PARTS, markdown_loader: twoWays }), RECORDED_HOST.host_version)
  assert.equal(run.status, 1, run.stdout)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: markdown the host loads\n`)
})

// memory_off is restated by hand, so nothing derives it (martha#136); --check holds it to the host's code instead
// (martha#412), so a host that changed the guard it quotes fails by the field rather than only by a test elsewhere.
test('a host whose memory guard, on check or hosted-mode variable is not the one restated fails the check naming memory_off (martha#412)', (t) => {
  const { file_mode_guard, on_check, hosted_mode_variable } = RECORDED_HOST.memory_off
  // The on check is a function both guards reach, so a host that changes it changes what each calls too (martha#438).
  const reached = [
    ...(FILE_GUARD.functions.some((entry) => entry.function === on_check) ? ['file_mode_guard_calls'] : []),
    ...(GUARD.functions.some((entry) => entry.function === on_check) ? ['managed_folder_guard_calls'] : []),
  ]
  for (const [quoted, planted, fields] of [
    [file_mode_guard, file_mode_guard.replace('return"off";', 'return"on";'), [MEMORY_OFF]],
    [on_check, on_check.replace('"on"', '"enabled"'), [...reached, MEMORY_OFF]],
    [hosted_mode_variable, [...`${hosted_mode_variable}_RENAMED`].reverse().join(''), [MEMORY_OFF]],
  ] as const) {
    assert.notEqual(planted, quoted, 'the planted text differs')
    const memory = MEMORY_TEXT.replace(quoted, planted)
    const plant = (guard: GuardCalls): GuardCalls => ({ ...guard, functions: guard.functions.map((entry) => (entry.function === quoted ? { ...entry, function: planted } : entry)) })
    const run = check(hostHolding(t, { ...RECORDED_PARTS, guards: guardModules(plant(GUARD), plant(FILE_GUARD), memory) }), RECORDED_HOST.host_version)
    assertDiffers(run, `${fields.join(', ')}`)
  }
})

/** The name a recorded function declares. */
const declaredName = (source: string): string => /^function\*? ?([\w$]+)\(/.exec(source)?.[1] ?? ''
/** The file-mode guard's recorded callee that `test` picks, by the name it declares. */
function fileGuardCallee(pick: (source: string) => boolean, what: string): string {
  const name = declaredName(FILE_GUARD.functions.find((entry) => pick(entry.function))?.function ?? '')
  assert.notEqual(name, '', `the recorded file-mode guard reaches ${what}`)
  return name
}
/** The off switch the launch sets, as the host reads it. */
const OFF_SWITCH_READ = `process.env.${Object.keys(CLAUDE_MEMORY_OFF)[0] ?? ''}`

// The gap #412's review named (martha#438): the file-mode guard memory_off restates stays byte-equal while a function it
// calls moves toward memory on. The check that holds of the value the launch sets (on 2.1.325 `ws`) holds for more
// values, the check that turns memory off when a remote store is set (`Nb`) stops holding, or a function a step further
// down changes. Each fails by file_mode_guard_calls alone: memory_off still holds, since every text it quotes is there.
test('a host whose file-mode memory guard reaches a changed function fails the check naming file_mode_guard_calls (martha#438)', (t) => {
  const { file_mode_guard } = RECORDED_HOST.memory_off
  // A function only a callee of the guard calls, whose body is one returned expression to negate.
  const secondStep = Object.values(FILE_GUARD.guard_calls)
    .flatMap((entry) => Object.entries(FILE_GUARD.functions[entry]?.calls ?? {}))
    .filter(([name]) => !(name in FILE_GUARD.guard_calls))
    .map(([name, entry]) => [name, FILE_GUARD.functions[entry]?.function ?? ''] as const)
    .find(([, source]) => /\{return(.*)\}$/.test(source))?.[0] ?? ''
  assert.notEqual(secondStep, '', 'the recorded file-mode guard reaches a function two steps down')
  const offValues = fileGuardCallee((source) => source.includes('"off"]'), 'the check of an off value')
  const remoteStore = fileGuardCallee((source) => /^function [\w$]+\(\)\{if\(/.test(source) && source.includes('return!0'), 'the check that turns memory off on its own')
  for (const planted of [
    withChangedFunction(offValues, (source) => source.replace('"off"]', '"off","1"]'), FILE_GUARD),
    withChangedFunction(remoteStore, (source) => source.replace('return!0', 'return!1'), FILE_GUARD),
    withChangedFunction(secondStep, (source) => source.replace(/\{return(.*)\}$/, '{return!($1)}'), FILE_GUARD),
  ]) {
    assert.notDeepEqual(planted, FILE_GUARD, 'the planted callees differ')
    assert.ok(MEMORY_TEXT.includes(file_mode_guard), 'the file-mode guard itself is byte-equal')
    const run = check(hostHolding(t, { ...RECORDED_PARTS, guards: guardModules(GUARD, planted) }), RECORDED_HOST.host_version)
    assertDiffers(run, `file_mode_guard_calls`)
  }
})

test('a host whose file-mode memory guard binds a name it calls to another function fails the check naming file_mode_guard_calls (martha#438)', (t) => {
  const [firstCall = '', firstEntry = 0] = Object.entries(FILE_GUARD.guard_calls)[0] ?? []
  const rebound = { ...FILE_GUARD, guard_calls: { ...FILE_GUARD.guard_calls, [firstCall]: FILE_GUARD.functions.length - 1 - firstEntry } }
  assert.notDeepEqual(rebound, FILE_GUARD, 'the planted binding differs')
  const run = check(hostHolding(t, { ...RECORDED_PARTS, guards: guardModules(GUARD, rebound) }), RECORDED_HOST.host_version)
  assertDiffers(run, `file_mode_guard_calls`)
})

// The guard is found by the one function that reads the off switch the launch sets (martha#438): a host that reads it
// twice, or outside any function declaration, cannot be told which function decides, and is refused by the part.
test('a host that reads the memory off switch twice, or outside a function, cannot be read, naming the part (martha#438)', (t) => {
  const memory = MEMORY_TEXT
  assert.ok(memory.includes(OFF_SWITCH_READ), 'the recorded file-mode guard reads the off switch')
  for (const planted of [
    `${memory};var aSecondRead=${OFF_SWITCH_READ}`,
    `var aTopLevelRead=${OFF_SWITCH_READ};${memory.replace(OFF_SWITCH_READ, 'process.env.A_SWITCH_NOBODY_SETS')}`,
  ]) {
    const run = check(hostHolding(t, { ...RECORDED_PARTS, guards: guardModules(GUARD, FILE_GUARD, planted) }), RECORDED_HOST.host_version)
    assert.equal(run.status, 1, run.stdout)
    assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: file-mode memory guard\n`)
  }
  // A longer variable whose name starts with the switch's is another variable, not a second read of the switch.
  for (const longer of [`${OFF_SWITCH_READ}_AND_MORE`, `${OFF_SWITCH_READ}$`]) {
    const run = check(hostHolding(t, { ...RECORDED_PARTS, guards: guardModules(GUARD, FILE_GUARD, `${memory};var aLongerName=${longer}`) }), RECORDED_HOST.host_version)
    assert.equal(run.status, 0, run.stdout)
    assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\n`)
  }
})

/**
 * A host whose guard declares a helper before it reads the off switch, as a release does when it lifts a piece of the
 * guard into a function of its own (martha#564): the nearest declaration before the read is the helper's, which ends
 * before the read, so it is walked past and the guard that holds the read is the one found.
 */
const withHelperFirst = (memory: string): string => memory.replace('{', '{function aHelper(){return 1};')

test('a guard that declares a helper before it reads the off switch is read, not refused (martha#564)', (t) => {
  const memory = withHelperFirst(MEMORY_TEXT)
  assert.notEqual(memory, MEMORY_TEXT, 'the helper is planted inside the guard')
  const run = check(hostHolding(t, { ...RECORDED_PARTS, guards: guardModules(GUARD, FILE_GUARD, memory) }), RECORDED_HOST.host_version)
  // The guard's own text changed, which memory_off restates by hand, so the release differs there and nowhere else: the
  // helper is declared inside the guard, so it is the guard's own text rather than a callee (martha#811), what the guard
  // calls is as recorded, and no part is unreadable.
  assertDiffers(run, MEMORY_OFF)
})

/**
 * A host that reads the switch inside a function nested in its guard (martha#564's reverse case): the guard's own
 * callees decide, so the guard is found, not the nested function that happens to hold the read. A function nested in
 * the guard is the guard's own text, never one of its callees (martha#811), so the guard found calls what the recorded
 * one calls; the nested reader taken for the guard would call nothing.
 */
const withReadNestedInTheGuard = (memory: string): string =>
  memory.replace(`let e=${OFF_SWITCH_READ};`, `function aReader(){return ${OFF_SWITCH_READ}}let e=aReader();`)

test("a read inside a function nested in the guard is the guard's, not the nested function's (martha#564)", () => {
  const memory = withReadNestedInTheGuard(MEMORY_TEXT)
  assert.notEqual(memory, MEMORY_TEXT, 'the read is planted inside a function nested in the guard')
  const { guard_calls } = fileModeGuardCallsIn(guardModules(GUARD, FILE_GUARD, memory))
  assert.notDeepEqual(Object.keys(FILE_GUARD.guard_calls), [], 'the recorded guard calls something, so a guard that calls nothing is told from it')
  assert.deepEqual(Object.keys(guard_calls).sort(), Object.keys(FILE_GUARD.guard_calls).sort())
})

// Both shapes at once (martha#564 r=2): a helper declared before a nested reader is a declaration that does not hold
// the read sitting between the read and the declaration that does, so a walk that stops at the first one behind a
// holder records the nested reader -- and calls its callees the guard's, with no refusal to show for it.
test('a helper before a reader nested in the guard leaves the guard the one recorded (martha#564 r=2)', () => {
  const memory = withHelperFirst(withReadNestedInTheGuard(MEMORY_TEXT))
  assert.notEqual(memory, withReadNestedInTheGuard(MEMORY_TEXT), 'the helper is planted before the nested reader')
  const { guard_calls } = fileModeGuardCallsIn(guardModules(GUARD, FILE_GUARD, memory))
  assert.deepEqual(Object.keys(guard_calls).sort(), Object.keys(FILE_GUARD.guard_calls).sort())
})

// Where the walk ends (martha#564 r=2): a declaration in the module before the read's, whose braces run past the
// boundary into it, holds the read by span alone. The walk stops at the start of the read's module, so it is never
// the guard, and the guard's own callees are the ones recorded.
test('a declaration in the module before, whose braces cross into the read, is not the guard (martha#564 r=2)', () => {
  const guards = `\n${CHUNK}\nfunction aCutOff(){${guardModules(GUARD, FILE_GUARD)}`
  const { guard_calls } = fileModeGuardCallsIn(guards)
  assert.deepEqual(Object.keys(guard_calls).sort(), Object.keys(FILE_GUARD.guard_calls).sort())
})

// A declaration that ends exactly where the read begins does not hold it (martha#564 r=2): the read is at module
// level, so the host is refused rather than read as the helper's.
test('a declaration that ends where the read begins does not hold it (martha#564 r=2)', (t) => {
  const memory = `function aHelper(){return 1}${OFF_SWITCH_READ}`
  const run = check(hostHolding(t, { ...RECORDED_PARTS, guards: guardModules(GUARD, FILE_GUARD, memory) }), RECORDED_HOST.host_version)
  assert.equal(run.status, 1, run.stdout)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: file-mode memory guard\n`)
})
