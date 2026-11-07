// A launch's own read-only copy of the relay (martha#117).
//
// The host writes its generated types into the folder --plugin-dir names, but
// only the files that are missing, and it keeps whatever is already there. So
// the installed relay folder is never named to the host: each launch gets a
// copy of the relay's declared files, read-only, inside its relay directory,
// gone when the launch ends.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RELAY_PLUGIN_DIR } from './launch_a_claude_code_member.ts'
import { makeRelayDirectory } from './relay_directory.ts'
import * as relayCopy from './relay_copy.ts'
import { shortRelayRoot } from './short_relay_root.ts'

const PERMISSION_BITS = 0o777
const WRITE_BITS = 0o222

/** An installed relay folder made from the repo's relay, in a scratch directory the test removes. */
function installedRelay(t: TestContext): { readonly installed: string; readonly scratch: string } {
  const scratch = mkdtempSync(join(tmpdir(), 'relay-copy-'))
  t.after(() => relayCopy.removeTheTree(scratch))
  const installed = join(scratch, 'claude_code_relay')
  for (const file of relayCopy.RELAY_FILES) {
    mkdirSync(dirname(join(installed, file)), { recursive: true })
    writeFileSync(join(installed, file), readFileSync(join(RELAY_PLUGIN_DIR, file)))
  }
  return { installed, scratch }
}

function filesUnder(directory: string): string[] {
  return execFileSync('find', ['.', '-mindepth', '1'], { cwd: directory, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.slice(2))
    .sort()
}

test('the declared relay files are the relay folder the repo tracks, its tests left out', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: RELAY_PLUGIN_DIR, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file !== '' && !file.endsWith('.node-test.ts'))
    .sort()
  assert.deepEqual([...relayCopy.RELAY_FILES].sort(), tracked)
})

test('a copy holds the declared files byte for byte, and nothing in it can be written', (t) => {
  const { installed, scratch } = installedRelay(t)
  const plugin_dir = join(scratch, 'copy')
  const copy = relayCopy.copyTheRelay(installed, plugin_dir)
  assert.deepEqual(copy, { made: true, plugin_dir })

  const directories = [...new Set(relayCopy.RELAY_FILES.map((file) => dirname(file)).filter((dir) => dir !== '.'))]
  assert.deepEqual(filesUnder(plugin_dir), [...relayCopy.RELAY_FILES, ...directories].sort())
  for (const file of relayCopy.RELAY_FILES) {
    assert.deepEqual(readFileSync(join(plugin_dir, file)), readFileSync(join(installed, file)), file)
    assert.equal(lstatSync(join(plugin_dir, file)).mode & PERMISSION_BITS, relayCopy.RELAY_COPY_FILE_MODE, file)
  }
  for (const directory of ['.', ...directories]) {
    assert.equal(lstatSync(join(plugin_dir, directory)).mode & PERMISSION_BITS, relayCopy.RELAY_COPY_DIRECTORY_MODE, directory)
    assert.equal(lstatSync(join(plugin_dir, directory)).mode & WRITE_BITS, 0, directory)
  }
  assert.throws(() => writeFileSync(join(plugin_dir, 'tsconfig.json'), '{}'), { code: 'EACCES' })
})

test('a file planted in the installed relay folder is not carried into the copy', (t) => {
  const { installed, scratch } = installedRelay(t)
  writeFileSync(join(installed, 'tsconfig.json'), '{"extends": "./.claude-plugin/types/tsconfig.json"}\n')
  mkdirSync(join(installed, '.claude-plugin', 'types'))
  writeFileSync(join(installed, '.claude-plugin', 'types', 'tsconfig.json'), '{}\n')
  writeFileSync(join(installed, 'hooks', 'planted.ts'), 'export {}\n')

  const plugin_dir = join(scratch, 'copy')
  assert.deepEqual(relayCopy.copyTheRelay(installed, plugin_dir), { made: true, plugin_dir })
  assert.equal(existsSync(join(plugin_dir, 'tsconfig.json')), false)
  assert.equal(existsSync(join(plugin_dir, '.claude-plugin', 'types')), false)
  assert.equal(existsSync(join(plugin_dir, 'hooks', 'planted.ts')), false)
})

test('a declared file that is a link or missing, or a folder on its way that is a link, refuses the copy and leaves nothing', (t) => {
  const cases: ReadonlyArray<readonly [string, (installed: string, scratch: string) => void, string]> = [
    [
      'a declared file is a link',
      (installed, scratch) => {
        writeFileSync(join(scratch, 'elsewhere.ts'), 'export {}\n')
        rmSync(join(installed, 'hooks', 'register.ts'))
        symlinkSync(join(scratch, 'elsewhere.ts'), join(installed, 'hooks', 'register.ts'))
      },
      'hooks/register.ts',
    ],
    [
      'a folder on the way is a link',
      (installed, scratch) => {
        execFileSync('mv', [join(installed, 'hooks'), join(scratch, 'hooks-elsewhere')])
        symlinkSync(join(scratch, 'hooks-elsewhere'), join(installed, 'hooks'))
      },
      'hooks',
    ],
    ['a declared file is missing', (installed) => rmSync(join(installed, 'hooks', 'hooks.json')), 'hooks/hooks.json'],
  ]
  for (const [what, plant, named] of cases) {
    const { installed, scratch } = installedRelay(t)
    plant(installed, scratch)
    const plugin_dir = join(scratch, 'copy')
    const copy = relayCopy.copyTheRelay(installed, plugin_dir)
    assert.equal(copy.made, false, what)
    if (copy.made) continue
    assert.match(copy.refusal, new RegExp(named.replace('.', '\\.')), what)
    assert.equal(existsSync(plugin_dir), false, `${what}: nothing left behind`)
  }
})

test("a launch's relay directory holding a read-only copy is removed whole", (t) => {
  const relay_root = shortRelayRoot(t)
  const made = makeRelayDirectory(join(relay_root, 'one'))
  assert.equal(made.made, true)
  if (!made.made) return
  assert.equal(relayCopy.copyTheRelay(RELAY_PLUGIN_DIR, join(made.directory, relayCopy.RELAY_COPY_NAME)).made, true)
  made.remove()
  assert.equal(existsSync(made.directory), false)
})
