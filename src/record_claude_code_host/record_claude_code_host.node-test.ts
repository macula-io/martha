// The drift check bites (martha#139): `--check` passes on a host that says what
// the committed recording says, and fails, naming the field, on one that does
// not. CI runs this file in its own job on every PR, with no host installed: the
// host is a text made of the recording's own parts, so the checker is proven on
// every tip and only the scheduled comparison depends on a release.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'

const RECORDER = fileURLToPath(new URL('./record_claude_code_host.ts', import.meta.url))
const RECORDING = new URL('../claude_code_host/recorded_claude_code_host.json', import.meta.url)
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
 * each kind, the skills loader's managed folder, and the output-style schema.
 */
const MARKDOWN_PARTS: Readonly<Record<string, string>> = {
  frontmatter_reader: `${PARSER_HEAD}return 0};${BOM_STRIP}`,
  frontmatter_pattern: `var a=1,${FRONTMATTER_PATTERN}=/${RECORDED_HOST.frontmatter_pattern}/;`,
  markdown_loader: RECORDED_HOST.markdown_loader,
  markdown_kinds: [
    `function Wq(e,n,r){return Kq(()=>${LOADER}(e,n,r,0))}`,
    ...RECORDED_HOST.markdown_kinds.map((kind) => `Wq("${kind}",0)`),
    `let h=Lg(${MANAGED}(),".claude","${RECORDED_HOST.markdown_kinds[0] ?? ''}"),k=1;t(\`Loading skills from: managed=\${h}\`)`,
  ].join(';'),
  output_style_schema: `var Uq=p(()=>u(${RECORDED_HOST.output_style_schema}))`,
}

const RECORDED_PARTS: Readonly<Record<string, string>> = {
  session_start_schema: RECORDED_HOST.session_start_schema,
  prompt_origin_mapper: RECORDED_HOST.prompt_origin_mapper,
  prompt_origin_fallback: RECORDED_HOST.prompt_origin_fallback,
  prompt_origin_subkinds: RECORDED_HOST.prompt_origin_subkinds,
  hooks_switches: RECORDED_HOST.hooks_switches,
  hooks_switch_calls: RECORDED_HOST.hooks_switch_calls.join(';'),
  managed_settings: [
    `switch(P()){case"windows":return"C:\\\\ClaudeCode";default:return"${RECORDED_HOST.managed_settings.dir}"}`,
    `getDropInDir(){return this.dropInDir??=qC(${MANAGED}(),"${RECORDED_HOST.managed_settings.drop_in}")`,
    `function jw(){return Ce(${MANAGED}(),"${RECORDED_HOST.managed_settings.file}")}`,
  ].join(';'),
  ...MARKDOWN_PARTS,
}

/** A host text holding `parts`, written to a scratch file the test removes. */
function hostHolding(t: TestContext, parts: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'martha-host-drift-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const host = join(root, 'claude')
  writeFileSync(host, `#!junk\n${Object.values(parts).join(';other code;')}\n`, 'latin1')
  return host
}

/** `--check` run on a host text, as the drift job runs it. */
function check(host: string, version: string): { status: number | null; stdout: string } {
  const run = spawnSync(process.execPath, [RECORDER, CHECK, host, version], { encoding: 'utf8' })
  return { status: run.status, stdout: run.stdout }
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

test('a host whose code differs fails the check, naming the field and nothing of the host\'s code', (t) => {
  const planted = RECORDED_HOST.prompt_origin_subkinds.replace('"projects-relay"', '"projects-relay","session-inbox"')
  assert.notEqual(planted, RECORDED_HOST.prompt_origin_subkinds, 'the planted set differs')
  const run = check(hostHolding(t, { ...RECORDED_PARTS, prompt_origin_subkinds: planted }), RECORDED_HOST.host_version)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\ndiffers: prompt_origin_subkinds\n`)
})

test('a host of another version fails the check by its version alone, even when its code is the same', (t) => {
  const other = anotherVersion(RECORDED_HOST.host_version)
  const run = check(hostHolding(t, RECORDED_PARTS), other)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${other}\ndiffers: host_version\n`)
})

test('a host the recorder cannot read fails the check, naming the part', (t) => {
  const { prompt_origin_mapper: _mapper, ...withoutMapper } = RECORDED_PARTS
  const run = check(hostHolding(t, withoutMapper), RECORDED_HOST.host_version)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: prompt origins\n`)
})

test('a host whose frontmatter pattern, markdown folders or output-style schema differ fails the check, naming the field (martha#146)', (t) => {
  for (const [field, planted] of [
    ['frontmatter_pattern', MARKDOWN_PARTS.frontmatter_pattern?.replace('\\s*\\n(', '[ \\t]*\\n(')],
    ['markdown_kinds', `${MARKDOWN_PARTS.markdown_kinds ?? ''};Wq("output-styles",0)`],
    ['output_style_schema', MARKDOWN_PARTS.output_style_schema?.replace('"force-for-plugin":', 'hooks:Jq().optional(),"force-for-plugin":')],
  ] as const) {
    assert.notEqual(planted, MARKDOWN_PARTS[field], `the planted ${field} differs`)
    const run = check(hostHolding(t, { ...RECORDED_PARTS, [field]: planted ?? '' }), RECORDED_HOST.host_version)
    assert.equal(run.status, 1, field)
    assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\ndiffers: ${field}\n`)
  }
})

test('a host whose frontmatter pattern carries a flag, or that has two markdown loaders, cannot be read, naming the part (martha#146)', (t) => {
  for (const planted of [
    { frontmatter_pattern: `var a=1,${FRONTMATTER_PATTERN}=/${RECORDED_HOST.frontmatter_pattern}/m;` },
    { markdown_loader: `${RECORDED_HOST.markdown_loader};${RECORDED_HOST.markdown_loader.replace(`function ${LOADER}(`, 'function Zq(')}` },
  ]) {
    const run = check(hostHolding(t, { ...RECORDED_PARTS, ...planted }), RECORDED_HOST.host_version)
    assert.equal(run.status, 1, JSON.stringify(Object.keys(planted)))
    assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: markdown the host loads\n`)
  }
})
