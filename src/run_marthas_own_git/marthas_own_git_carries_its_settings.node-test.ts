// The settings every run of Martha's own git carries (martha#192).
//
// Three things are pinned here, and each answers a way the switch could be lost:
// that the list holds the setting, that git itself obeys it where Martha runs git
// through the host contract, and that no file in `src/` starts git without the
// shared list — the last of these is what a ninth call site would otherwise slip
// past, whichever spelling it chose.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test, type TestContext } from 'node:test'

import { realPathOf } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { GIT_SETTINGS_VARIABLE, switchesThatRunNothingFromACheckout } from '../refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts'
import { launchEnvironment } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { blobAsGitAdds } from '../refuse_launch_of_unapproved_config/checkout_tree.ts'
import { readTheCheckoutOnce } from '../run_an_owner_signed_command/read_the_checkout_once.ts'
import { MARTHAS_OWN_GIT_SETTINGS, marthasOwnGitArgs, marthasOwnGitSettingsArgs } from './run_marthas_own_git.ts'

/** The one setting this package adds: a bare repository git was not told about is refused. */
const THE_SWITCH = 'safe.bareRepository'

test('the settings carry safe.bareRepository=explicit, and the arguments splice them in front (#192)', () => {
  const settings = MARTHAS_OWN_GIT_SETTINGS.map(([name, value]) => `${name}=${value}`)
  assert.ok(settings.includes(`${THE_SWITCH}=explicit`), `the list holds ${THE_SWITCH}=explicit (${settings.join(', ')})`)
  assert.ok(settings.includes('core.fsmonitor=false'), `the list still holds core.fsmonitor=false (${settings.join(', ')})`)
  assert.deepEqual(marthasOwnGitSettingsArgs(), MARTHAS_OWN_GIT_SETTINGS.flatMap(([name, value]) => ['-c', `${name}=${value}`]))
  assert.deepEqual(marthasOwnGitArgs(['status']), [...marthasOwnGitSettingsArgs(), 'status'])
  assert.deepEqual(marthasOwnGitArgs([]), marthasOwnGitSettingsArgs(), 'no arguments of its own still carries the settings')
})

/** A directory holding what git takes for a bare repository, and a file beside it. */
function plantedBareDirectory(t: TestContext): { readonly dir: string; readonly file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'martha-192-planted-'))
  t.after(() => removeTheTree(dir))
  mkdirSync(join(dir, 'objects'), { recursive: true })
  mkdirSync(join(dir, 'refs', 'heads'), { recursive: true })
  writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/main\n')
  const file = join(dir, 'a.txt')
  writeFileSync(file, 'a member wrote this\n')
  return { dir, file }
}

test('a run through the host contract is given the settings, so a planted bare directory is refused (#192)', (t) => {
  const { dir, file } = plantedBareDirectory(t)
  // The host contract is where the five adapter sites reach git, and a recording host
  // shows what they are given. `hash-object` answers outside a repository, so it is
  // the arguments this pins, not git's answer to them.
  const given: string[][] = []
  const recording = {
    stores: thisMachine.stores,
    processes: {
      runNow: (request: Parameters<typeof thisMachine.processes.runNow>[0]) => {
        given.push([...request.args])
        return thisMachine.processes.runNow(request)
      },
    },
  }
  blobAsGitAdds(dir, file, recording)
  assert.equal(given.length, 1, 'one run reaches git')
  assert.ok(given[0]!.includes(`${THE_SWITCH}=explicit`), `the run carries ${THE_SWITCH}=explicit (${given[0]!.join(' ')})`)
  assert.ok(given[0]!.includes('core.fsmonitor=false'), `and core.fsmonitor=false, which was there before (${given[0]!.join(' ')})`)
})

test('a run through spawnSync refuses a planted bare directory (#192)', (t) => {
  const { dir } = plantedBareDirectory(t)
  // `ls-files` is what the owner-signed command reads a checkout through, and it is
  // the run a planted bare directory would otherwise answer from its own index.
  const read = readTheCheckoutOnce(dir, 'sha1', { PATH: process.env['PATH'] ?? '' })
  assert.equal(typeof read, 'string', `the checkout cannot be listed out of a planted bare directory (${typeof read})`)
  assert.ok((read as string).includes('cannot use bare repository'), `the refusal is git\'s own (${String(read)})`)
})

test('the switch stays off the member\'s environment, where a bare checkout is a legitimate place to work (#192)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-192-a-members-git-'))
  t.after(() => removeTheTree(dir))
  const bare = join(dir, 'bare')
  mkdirSync(join(bare, 'objects'), { recursive: true })
  mkdirSync(join(bare, 'refs', 'heads'), { recursive: true })
  writeFileSync(join(bare, 'HEAD'), 'ref: refs/heads/main\n')
  mkdirSync(join(dir, 'empty'), { recursive: true })
  // The environment a launch gives the member: the switches that keep a checkout
  // from running code, and nothing of Martha's own git settings among them.
  const env = launchEnvironment({ PATH: process.env['PATH'] }, switchesThatRunNothingFromACheckout({ PATH: process.env['PATH'] }, join(dir, 'empty')))
  assert.ok(!(env[GIT_SETTINGS_VARIABLE] ?? '').includes(THE_SWITCH), `the member\'s git settings do not carry ${THE_SWITCH} (${env[GIT_SETTINGS_VARIABLE] ?? ''})`)
  // And a member's own git in a directory that is a bare checkout still answers:
  // moving the switch into the launch environment is what this test fails on.
  const answered = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: bare, env, encoding: 'utf8' }).trim()
  assert.equal(answered, realPathOf(bare), `a member\'s git in a bare checkout answers (${answered})`)
})

// --- every way this repository starts git ------------------------------------------
//
// A call site written without the shared list is the way the switch would be lost, and
// a grep for one spelling misses the others: `exec` and `execSync` take a shell string,
// so their first argument is `git …` and never the bare word, and `command: 'git'` is
// how the five host-contract sites name it. Every spelling is matched here.

/** What starts git: the command the host contract is given, or a process call whose first argument is git. */
const STARTS_GIT = [/(?:^|[^\w.])command:\s*(['"])git\1/, /(?:^|[^\w.])(?:spawn|spawnSync|exec|execFile|execFileSync|execSync)\(\s*(['"`])git(?:\1\s*[,)]|\s)/]

/** Why a probe script starts git: the probe runner and the auto-memory rows both make their own scratch repository. */
const A_PROBES_OWN_SCRATCH = 'probe scripts that git init a scratch repository they made themselves'

/** The files that start git for a reason of their own, and are not Martha's runs on a member's choice. */
const OUTSIDE: Readonly<Record<string, string>> = {
  'src/probe_launch_hosts/probe_hosts.ts': A_PROBES_OWN_SCRATCH,
  'src/probe_the_hosts_auto_memory/probe_the_hosts_auto_memory.ts': A_PROBES_OWN_SCRATCH,
  'src/check_nothing_private_gets_in/read_sources.ts': 'the repository\'s own check, reading this repo\'s sources and never a member\'s tree',
}

/** Every `.ts` file under a folder, tests left out. */
function sourcesUnder(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const at = join(folder, name)
    if (statSync(at).isDirectory()) return sourcesUnder(at)
    return at.endsWith('.ts') && !at.endsWith('.node-test.ts') ? [at] : []
  })
}

test('every place in src that starts git carries Martha\'s own settings, or is named as outside (#192)', () => {
  const root = join(import.meta.dirname, '..')
  const starting = sourcesUnder(root).filter((file) => {
    const text = readFileSync(file, 'utf8')
    return STARTS_GIT.some((pattern) => pattern.test(text))
  })
  assert.ok(starting.length >= 7, `the scan finds the sites it is meant to police (${starting.length})`)

  const missing = starting
    .filter((file) => !readFileSync(file, 'utf8').includes('marthasOwnGit'))
    .map((file) => relative(join(root, '..'), file))
    .filter((file) => OUTSIDE[file] === undefined)
  assert.deepEqual(missing, [], `these start git without the shared settings: ${missing.join(', ')}`)

  // The list is a decision, not a hiding place: a file joins it by being named here,
  // with the reason, in the same change that starts git there.
  assert.deepEqual(Object.keys(OUTSIDE).sort(), Object.keys(OUTSIDE).filter((file) => starting.some((found) => relative(join(root, '..'), found) === file)).sort(), 'every file named as outside still starts git')
})
