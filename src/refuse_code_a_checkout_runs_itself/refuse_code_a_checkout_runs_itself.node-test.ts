// The settings that keep a checkout from running code through a member's
// ordinary commands (martha#24, option 3), each read back by the real tool.
// The end-to-end proof, a planted checkout and a launched member, is
// ../launch_a_claude_code_member/run_nothing_a_checkout_planted.node-test.ts.
// Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'
import { gunzipSync } from 'node:zlib'

import { launchEnvironment } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { DIRENVS_VARIABLE, direnvsUnderTest, type Direnv } from './direnvs_under_test.ts'
import {
  DIRENV_CONFIG_VARIABLE,
  DIRENV_OFF_VARIABLE,
  EMPTY_DIRECTORY_MODE,
  GIT_HOOK_EVENTS,
  GIT_SETTINGS_VARIABLE,
  makeEmptyDirectory,
  NPM_GIT_VARIABLE,
  NPM_SCRIPTS_OFF_VARIABLE,
  npmSettingOf,
  switchesThatRunNothingFromACheckout,
} from './refuse_code_a_checkout_runs_itself.ts'

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-runs-nothing-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function gitConfigGet(env: Record<string, string>, cwd: string, key: string): string {
  return execFileSync('git', ['config', '--get', key], { cwd, env, encoding: 'utf8' }).trim()
}

test('git reads every setting back as written, a path with a quote and a bang included', (t) => {
  const dir = scratch(t)
  const empty = join(dir, "it's here!")
  const env = launchEnvironment({ PATH: process.env.PATH }, switchesThatRunNothingFromACheckout({}, empty))
  assert.equal(gitConfigGet(env, dir, 'core.hooksPath'), empty)
  assert.equal(gitConfigGet(env, dir, 'core.fsmonitor'), 'false')
  for (const event of GIT_HOOK_EVENTS) assert.equal(gitConfigGet(env, dir, `hook.${event}.enabled`), 'false', event)
})

test('the owner\'s own command-scope git settings are kept, and ours come after theirs', (t) => {
  const dir = scratch(t)
  const inherited = {
    PATH: process.env.PATH,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/from-count',
    [GIT_SETTINGS_VARIABLE]: "'user.name'='The Owner' 'core.hooksPath'='/from-parameters'",
  }
  const env = launchEnvironment(inherited, switchesThatRunNothingFromACheckout(inherited, join(dir, 'empty')))
  assert.equal(gitConfigGet(env, dir, 'user.name'), 'The Owner')
  assert.equal(gitConfigGet(env, dir, 'core.hooksPath'), join(dir, 'empty'))
  assert.equal(env.GIT_CONFIG_COUNT, '1', 'the owner\'s numbered settings are left alone')
})

test('npm sees scripts off: every inherited spelling is dropped, and a checkout\'s .npmrc loses', (t) => {
  const dir = scratch(t)
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture","version":"0.0.0","private":true}')
  writeFileSync(join(dir, '.npmrc'), 'ignore-scripts=false\n')
  const inherited = {
    ...process.env,
    npm_config_ignore_scripts: 'false',
    NPM_CONFIG_IGNORE_SCRIPTS: 'false',
    'npm_config_ignore-scripts': 'false',
    Npm_Config_Ignore_Scripts: 'false',
    npm_config_ignore_scripts_elsewhere: 'kept',
  }
  const switches = switchesThatRunNothingFromACheckout(inherited, join(dir, 'empty'))
  const env = launchEnvironment(inherited, switches)
  assert.deepEqual(
    Object.keys(env).filter((name) => /^npm_config_ignore/i.test(name)).sort(),
    [NPM_SCRIPTS_OFF_VARIABLE, 'npm_config_ignore_scripts_elsewhere'].sort(),
  )
  assert.equal(env[NPM_SCRIPTS_OFF_VARIABLE], 'true')
  assert.equal(execFileSync('npm', ['config', 'get', 'ignore-scripts'], { cwd: dir, env, encoding: 'utf8' }).trim(), 'true')
})

test('the empty directory is made new, 0500 and empty; a path that exists or a link refuses', (t) => {
  const dir = scratch(t)
  const made = join(dir, 'nothing')
  assert.deepEqual(makeEmptyDirectory(made), { made: true })
  assert.equal(lstatSync(made).mode & 0o777, EMPTY_DIRECTORY_MODE)
  assert.deepEqual(readdirSync(made), [])

  assert.equal(makeEmptyDirectory(made).made, false, 'an existing directory is never reused')
  const link = join(dir, 'link')
  symlinkSync(dir, link)
  assert.equal(makeEmptyDirectory(link).made, false, 'a link is never followed')
  assert.equal(makeEmptyDirectory(join(dir, 'missing', 'nothing')).made, false, 'a parent that is not there refuses')
})

test("npm runs the member's own git: every inherited spelling is dropped, and a checkout's .npmrc git= loses", (t) => {
  const dir = scratch(t)
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture","version":"0.0.0","private":true}')
  writeFileSync(join(dir, '.npmrc'), 'git=./planted-git\n')
  const inherited = {
    ...process.env,
    npm_config_git: './planted-git',
    NPM_CONFIG_GIT: './planted-git',
    Npm_Config_Git: './planted-git',
    npm_config_git_tag_version: 'kept',
  }
  const env = launchEnvironment(inherited, switchesThatRunNothingFromACheckout(inherited, join(dir, 'empty')))
  assert.deepEqual(
    Object.keys(env).filter((name) => npmSettingOf(name) === npmSettingOf(NPM_GIT_VARIABLE)),
    [NPM_GIT_VARIABLE],
  )
  assert.equal(env.npm_config_git_tag_version, 'kept')
  assert.equal(execFileSync('npm', ['config', 'get', 'git'], { cwd: dir, env, encoding: 'utf8' }).trim(), env[NPM_GIT_VARIABLE])
})

/** The hook events the installed git documents, read from its githooks(5) page. */
function hookEventsGitDocuments(): string[] {
  const man5 = join(execFileSync('git', ['--man-path'], { encoding: 'utf8' }).trim(), 'man5')
  const page = ['githooks.5.gz', 'githooks.5'].map((name) => join(man5, name)).find((path) => existsSync(path))
  assert.ok(page !== undefined, `the installed git's githooks(5) page is not under ${man5}`)
  const raw = readFileSync(page)
  const roff = (page.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8').split('\n')
  const hooks = roff.findIndex((line) => line === '.SH "HOOKS"')
  assert.notEqual(hooks, -1, 'the page has a HOOKS section')
  const end = roff.findIndex((line, at) => at > hooks && line.startsWith('.SH '))
  return roff
    .slice(hooks + 1, end === -1 ? undefined : end)
    .flatMap((line) => /^\.SS "(.+)"$/.exec(line)?.[1] ?? [])
    .map((name) => name.replaceAll('\\-', '-'))
}

test('every hook event the installed git documents is switched off', () => {
  const documented = hookEventsGitDocuments()
  assert.ok(documented.length > 0, 'the page names hook events')
  const known: readonly string[] = GIT_HOOK_EVENTS
  assert.deepEqual(documented.filter((event) => !known.includes(event)), [], 'events git documents that GIT_HOOK_EVENTS lacks')
})

test(`the direnvs ${DIRENVS_VARIABLE} names are installed, one of them knowing ${DIRENV_OFF_VARIABLE}`, (t) => {
  const { direnvs, missing, named } = direnvsUnderTest(process.env)
  if (!named) {
    t.skip(`${DIRENVS_VARIABLE} is not set: the .envrc tests prove the direnv on PATH, if any (${direnvs.length})`)
    return
  }
  assert.deepEqual(missing, [], `named in ${DIRENVS_VARIABLE} but not a direnv that runs`)
  assert.ok(direnvs.some((direnv) => direnv.knows_disable), `no direnv named in ${DIRENVS_VARIABLE} knows ${DIRENV_OFF_VARIABLE}`)
})

interface Envrc {
  readonly dir: string
  readonly marker: string
  /** The owner's environment: a direnv config that trusts the whole scratch directory. */
  readonly owner_env: Record<string, string | undefined>
}

function trustedEnvrc(t: TestContext, direnv: Direnv): Envrc {
  const home = scratch(t)
  const dir = join(home, 'checkout')
  mkdirSync(dir)
  const marker = join(home, 'marker')
  writeFileSync(join(dir, '.envrc'), `: > '${marker}'\n`)
  const config = join(home, 'direnv-config')
  mkdirSync(config)
  writeFileSync(join(config, 'direnv.toml'), `[whitelist]\nprefix = [${JSON.stringify(home)}]\n`)
  const owner_env = {
    ...process.env,
    PATH: `${dirname(direnv.path)}${delimiter}${process.env.PATH ?? ''}`,
    [DIRENV_CONFIG_VARIABLE]: config,
    XDG_DATA_HOME: join(home, 'xdg-data'),
  }
  return { dir, marker, owner_env }
}

function direnvExport(envrc: Envrc, env: Record<string, string | undefined>): void {
  rmSync(envrc.marker, { force: true })
  spawnSync('direnv', ['export', 'bash'], { cwd: envrc.dir, env, stdio: 'ignore' })
}

for (const direnv of direnvsUnderTest(process.env).direnvs) {
  test(`direnv ${direnv.version} (${direnv.path}): each switch shuts a trusted .envrc by itself`, (t) => {
    const envrc = trustedEnvrc(t, direnv)
    direnvExport(envrc, envrc.owner_env)
    assert.equal(existsSync(envrc.marker), true, "the owner's direnv runs the .envrc (the control)")

    const empty = join(dirname(envrc.dir), 'empty')
    assert.deepEqual(makeEmptyDirectory(empty), { made: true })
    direnvExport(envrc, { ...envrc.owner_env, [DIRENV_CONFIG_VARIABLE]: empty })
    assert.equal(existsSync(envrc.marker), false, `${DIRENV_CONFIG_VARIABLE} at the empty directory, alone, shuts it`)

    if (!direnv.knows_disable) {
      t.diagnostic(`direnv ${direnv.version} predates ${DIRENV_OFF_VARIABLE}: only the ${DIRENV_CONFIG_VARIABLE} fallback is proven here`)
      return
    }
    direnvExport(envrc, { ...envrc.owner_env, [DIRENV_OFF_VARIABLE]: '1' })
    assert.equal(existsSync(envrc.marker), false, `${DIRENV_OFF_VARIABLE}=1, alone, with the owner's trusting config kept, shuts it`)
  })
}
