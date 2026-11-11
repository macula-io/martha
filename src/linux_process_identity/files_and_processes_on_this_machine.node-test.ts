import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  environmentWith,
  filesOnThisMachine as files,
  runNowOnThisMachine as runNow,
  scratchOnThisMachine as scratch,
} from './files_and_processes_on_this_machine.ts'

function place(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-machine-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// --- files ----------------------------------------------------------------------

test('a path reads as absent, a file, a directory, a link (never followed) or other', (t) => {
  const dir = place(t)
  writeFileSync(join(dir, 'a-file'), 'bytes')
  mkdirSync(join(dir, 'a-dir'))
  symlinkSync('a-file', join(dir, 'a-link'))

  assert.deepEqual(files.kindOf(join(dir, 'nothing')), { kind: 'absent' })
  assert.deepEqual(files.kindOf(join(dir, 'a-file')), { kind: 'file', ownerExecutes: false })
  assert.deepEqual(files.kindOf(join(dir, 'a-dir')), { kind: 'directory' })
  assert.deepEqual(files.kindOf(join(dir, 'a-link')), { kind: 'symlink', target: 'a-file' })
  assert.deepEqual(files.kindOf('/dev/null'), { kind: 'other' })
})

test('a file says whether its owner may execute it: the bit git reads for mode 100755 (martha#158)', (t) => {
  const dir = place(t)
  writeFileSync(join(dir, 'plain'), 'bytes', { mode: 0o644 })
  writeFileSync(join(dir, 'runnable'), 'bytes', { mode: 0o755 })
  // Executable by the group alone: git writes 100644, because the owner's own bit is what it reads.
  writeFileSync(join(dir, 'group-only'), 'bytes', { mode: 0o654 })

  assert.deepEqual(files.kindOf(join(dir, 'plain')), { kind: 'file', ownerExecutes: false })
  assert.deepEqual(files.kindOf(join(dir, 'runnable')), { kind: 'file', ownerExecutes: true })
  assert.deepEqual(files.kindOf(join(dir, 'group-only')), { kind: 'file', ownerExecutes: false })
})

test('a failure other than absence throws with its own code', (t) => {
  const dir = place(t)
  writeFileSync(join(dir, 'a-file'), 'bytes')
  assert.throws(() => files.kindOf(join(dir, 'a-file', 'below')), { code: 'ENOTDIR' })
  assert.throws(() => files.childrenOf(join(dir, 'nothing')), { code: 'ENOENT' })
})

test('bytes, children and the real path are read as they are', (t) => {
  const dir = place(t)
  writeFileSync(join(dir, 'a-file'), 'bytes')
  symlinkSync(dir, join(dir, 'self'))

  assert.equal(Buffer.from(files.bytesOf(join(dir, 'a-file'))).toString(), 'bytes')
  assert.deepEqual([...files.childrenOf(dir)].sort(), ['a-file', 'self'])
  assert.equal(files.realPathOf(join(dir, 'self', 'a-file')), files.realPathOf(join(dir, 'a-file')))
  assert.equal(files.realPathOf(join(dir, 'nothing')), null)
})

// --- scratch --------------------------------------------------------------------

test('a scratch directory is made under its root, written inside, and removed', (t) => {
  const root = join(place(t), 'not-yet')
  const made = scratch.make(root, 'launch-')
  assert.ok(made.path.startsWith(join(root, 'launch-')), made.path)

  const written = made.write(join('.claude', 'settings.json'), Buffer.from('{}'))
  assert.equal(written, join(made.path, '.claude', 'settings.json'))
  assert.equal(readFileSync(written, 'utf8'), '{}')

  made.remove()
  made.remove()
  assert.equal(existsSync(made.path), false)
})

test('a name that would leave the scratch directory is refused, and nothing is written', (t) => {
  const root = place(t)
  const made = scratch.make(root, 'launch-')
  for (const name of ['../escaped', join('a', '..', '..', 'escaped'), join(root, 'escaped'), '', '.']) {
    assert.throws(() => made.write(name, Buffer.from('x')), { code: 'EINVAL' }, JSON.stringify(name))
  }
  assert.equal(existsSync(join(root, 'escaped')), false)
})

test('a prefix that is not one name inside the root is refused, and nothing is made', (t) => {
  const parent = place(t)
  const root = join(parent, 'root')
  mkdirSync(root)
  for (const prefix of ['../x-', join('a', 'b-'), '/x-', join(root, 'x-'), '..', '.', '']) {
    assert.throws(() => scratch.make(root, prefix), { code: 'EINVAL' }, JSON.stringify(prefix))
  }
  assert.deepEqual(readdirSync(parent), ['root'])
  assert.deepEqual(readdirSync(root), [])
})

test('with no root, scratch goes where the machine keeps temporary files', () => {
  const made = scratch.make(null, 'martha-scratch-')
  try {
    assert.ok(made.path.startsWith(join(tmpdir(), 'martha-scratch-')), made.path)
  } finally {
    made.remove()
  }
})

// --- processes run now ------------------------------------------------------------

test('a process runs in its directory and its output and exit code come back', (t) => {
  const dir = place(t)
  const outcome = runNow({ command: 'sh', args: ['-c', 'pwd; echo oops >&2; exit 3'], cwd: dir })
  assert.equal(outcome.exit_code, 3)
  assert.equal(outcome.stdout.trim(), files.realPathOf(dir))
  assert.equal(outcome.stderr.trim(), 'oops')
})

test('a command that cannot be started ends with exit code null', (t) => {
  assert.equal(runNow({ command: 'martha-no-such-command', args: [], cwd: place(t) }).exit_code, null)
})

test('the text given to a process is what it reads, and its input ends after it', (t) => {
  const dir = place(t)
  const outcome = runNow({ command: 'sh', args: ['-c', 'cat; echo end'], cwd: dir, input: 'one\ntwo\n' })
  assert.equal(outcome.stdout, 'one\ntwo\nend\n')
  assert.equal(runNow({ command: 'sh', args: ['-c', 'cat; echo end'], cwd: dir }).stdout, 'end\n', 'a process given no text reads an input that ends at once')
})

test('the environment drops every variable with a named prefix, then sets what is asked', (t) => {
  const inherited = 'MARTHA_TEST_INHERITED'
  process.env[inherited] = 'kept'
  process.env[`${inherited}_DROPPED`] = 'gone'
  t.after(() => {
    delete process.env[inherited]
    delete process.env[`${inherited}_DROPPED`]
  })

  const env = environmentWith({ drop_prefixes: [`${inherited}_`], set: { MARTHA_TEST_SET: 'set' } })
  assert.equal(env[inherited], 'kept')
  assert.equal(env[`${inherited}_DROPPED`], undefined)
  assert.equal(env['MARTHA_TEST_SET'], 'set')
  assert.equal(environmentWith(undefined)[`${inherited}_DROPPED`], 'gone')

  const outcome = runNow({
    command: 'sh',
    args: ['-c', `echo "\${${inherited}_DROPPED:-unset} \${MARTHA_TEST_SET}"`],
    cwd: place(t),
    environment: { drop_prefixes: [`${inherited}_`], set: { MARTHA_TEST_SET: 'set' } },
  })
  assert.equal(outcome.stdout.trim(), 'unset set')
})
