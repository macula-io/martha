// Each of the launcher's direnv switches shuts a trusted .envrc by itself
// (martha#24, option 3): DIRENV_CONFIG at the empty directory on every direnv,
// and DIRENV_DISABLE on direnv 2.38 and later, with the owner's trusting config
// kept. Run for every direnv the tests prove (direnvs_under_test.ts); CI names
// two, one of each kind. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { DIRENV_CONFIG_VARIABLE, DIRENV_OFF_VARIABLE } from '../refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts'
import { DIRENVS_VARIABLE, direnvsUnderTest, type Direnv } from './direnvs_under_test.ts'
import { makeEmptyDirectory } from '../switch_a_checkouts_hooks_off/empty_directory.ts'
import { removeTheTree } from './relay_copy.ts'

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-direnv-switch-'))
  t.after(() => removeTheTree(dir))
  return dir
}

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
  // direnv matches the .envrc's real path against the prefix: a TMPDIR behind a link (macOS) needs the real one (martha#79).
  writeFileSync(join(config, 'direnv.toml'), `[whitelist]\nprefix = [${JSON.stringify(realpathSync(home))}]\n`)
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
