// A recorded-host run whose host path names nothing runnable stops by name (martha#304).
//
// `environmentOf` links the host it was given into the run's own `bin` and puts that directory first on PATH. A link to
// nothing says nothing: PATH skips it, the next `claude` on the machine answers for the recorded host at whatever
// version it happens to be, and the run reports that host's results as the recorded one's. A path that is there and
// cannot be run falls back the same way, so it is refused the same way, and so is a directory. None of these cases
// needs the recorded host, a terminal or a child process, so they run in every CI run and not only in the relay job.

import assert from 'node:assert/strict'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { driveTheRecordedHost, environmentOf, RECORDED_HOST_VARIABLE, theRecordedHostAt } from './drive_the_recorded_host.ts'
import { removeTheTree } from './relay_copy.ts'

/** The stand-in's address for a run that never reaches it: nothing listens there, and nothing here connects. */
const AN_ADDRESS_NOTHING_ANSWERS = 'http://127.0.0.1:9'

/** A home of this test's own, removed after it. */
function aHome(t: TestContext): string {
  const home = mkdtempSync(join(tmpdir(), 'martha-304-'))
  t.after(() => removeTheTree(home))
  return home
}

/** What refusing `claude` says: the variable the relay job sets, and the path it held. */
const refusal = (claude: string): string =>
  `${RECORDED_HOST_VARIABLE} names ${claude}, which is not an executable file: a run that went on would drive whichever claude PATH finds next, and its results would not be the recorded host's`

/** A file this user can run, which is what a PATH lookup answers with. */
function aRunnableFile(home: string, name: string): string {
  const path = join(home, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

test('a host path that names no file is refused by name, and no link is made for it', (t) => {
  const home = aHome(t)
  const missing = join(home, 'no-such-host')

  assert.throws(() => theRecordedHostAt(missing), { message: refusal(missing) })
  assert.throws(
    () => environmentOf({ claude: missing, home }, AN_ADDRESS_NOTHING_ANSWERS, join(home, 'runtime')),
    { message: refusal(missing) },
  )
  assert.equal(lstatSync(join(home, 'bin', 'claude'), { throwIfNoEntry: false }), undefined, 'a refused run leaves no link behind, not even a dangling one')
})

test('a host path that names something this user cannot run is refused the same way', (t) => {
  const home = aHome(t)
  const notExecutable = join(home, 'claude')
  writeFileSync(notExecutable, '#!/bin/sh\nexit 0\n')
  chmodSync(notExecutable, 0o644)
  const aDirectory = join(home, 'a-directory')
  mkdirSync(aDirectory)

  assert.throws(() => theRecordedHostAt(notExecutable), { message: refusal(notExecutable) })
  assert.throws(() => theRecordedHostAt(aDirectory), { message: refusal(aDirectory) })
})

test('a host path given relative names the file it leads to, and the link to it follows (martha#304 r=1)', (t) => {
  const home = aHome(t)
  const host = aRunnableFile(home, 'the-recorded-host')
  const from = process.cwd()
  process.chdir(home)
  try {
    // The variable holds a path a person types from their own folder; the link is made in the run's bin, where that
    // same relative target would lead somewhere else entirely — to no file at all, so PATH fell through (r=1).
    assert.equal(theRecordedHostAt('the-recorded-host'), join(process.cwd(), 'the-recorded-host'))
    assert.throws(() => theRecordedHostAt('not-a-host'), { message: refusal('not-a-host') })

    const environment = environmentOf({ claude: 'the-recorded-host', home }, AN_ADDRESS_NOTHING_ANSWERS, join(home, 'runtime'))
    const [first] = environment.PATH.split(delimiter)
    assert.equal(realpathSync(join(first ?? '', 'claude')), realpathSync(host))
  } finally {
    process.chdir(from)
  }
})

test('the PATH a run is given finds claude at the link, first, so no later claude can answer for it', (t) => {
  const home = aHome(t)
  const host = aRunnableFile(home, 'the-recorded-host')

  const environment = environmentOf({ claude: host, home }, AN_ADDRESS_NOTHING_ANSWERS, join(home, 'runtime'))

  const [first] = environment.PATH.split(delimiter)
  assert.equal(first, join(home, 'bin'))
  assert.equal(realpathSync(join(first ?? '', 'claude')), realpathSync(host))
})

test('a run whose host names no file refuses before it makes anything', async (t) => {
  const home = aHome(t)
  const missing = join(home, 'no-such-host')

  await assert.rejects(
    driveTheRecordedHost({
      claude: missing,
      home,
      checkout: home,
      member: 'builder',
      owner_turn: 'go',
      script: () => ({ text: 'Done.' }),
      requests: 1,
      silence_ms: 1,
    }),
    { message: refusal(missing) },
  )
})
