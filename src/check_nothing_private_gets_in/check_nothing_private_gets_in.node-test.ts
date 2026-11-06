import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  familiesFrom,
  privateHitsIn,
  SYNTHETIC,
  type Resolve,
  type Rules,
  type Source,
  withoutLabNames,
} from './check_nothing_private_gets_in.ts'
import { HEX_SLOT, PUBLIC_DIGEST_FORMS } from './public_digest.ts'
import { ID_HEX_DIGITS } from './public_text.ts'
import { commitSources, commitsOf, treeSources } from './read_sources.ts'

// Every value planted here is a synthetic form, because this file is in the
// public tree the check reads. The class tests switch the synthetic allowance
// off, so each class is shown to refuse that very value on its own.
const strict: Rules = {
  labHosts: ['synth'],
  publicEmails: ['macula.io'],
  publicAddresses: ['ada@synthetic.invalid'],
  owners: ['synthetic-owner'],
  ownRepo: 'martha',
  allowSynthetic: false,
}
const scanning: Rules = { ...strict, allowSynthetic: true }

// A fixed answer per repository, so no unit test touches the network.
const PRIVATE = 'synthetic-owner/private-thing'
const PUBLIC = 'synthetic-owner/open-thing'
const resolveFixed: Resolve = async (owner, repo) => {
  const key = `${owner}/${repo}`
  if (key === PRIVATE) return 'not_public'
  if (key === PUBLIC) return 'public'
  throw new Error(`the test asked about ${key}`)
}
const unreachable: Resolve = async () => {
  throw new Error('GitHub answered 503')
}

const one = (text: string): Source[] => [{ name: 'note.md', lines: [{ where: 'note.md:1', text }] }]
const hitsOf = async (text: string, rules: Rules = strict, resolve: Resolve = resolveFixed) =>
  (await privateHitsIn(one(text), rules, resolve)).map((hit) => hit.what)

test('a clean line passes', async () => {
  assert.deepEqual(await hitsOf('Nothing private here; see martha#14 and crew@macula.io.'), [])
})

// One planted leak of each kind the issue names.

test('a link to a private issue is refused, in each form it is written', async () => {
  for (const text of [
    `as decided in ${PRIVATE}#123`,
    `https://github.com/${PRIVATE}/issues/123`,
    `https://github.com/${PRIVATE}/pull/7#discussion_r1`,
  ]) {
    assert.deepEqual(await hitsOf(text), [`a repository that is not public (${PRIVATE})`], text)
  }
})

test('a shorthand reference to another repository is refused, this repository\'s own passes', async () => {
  assert.deepEqual(await hitsOf('see synthetic-repo#12'), [
    'a shorthand reference to another repository (synthetic-repo#...): write owner/repo#n so it can be checked',
  ])
  assert.deepEqual(await hitsOf('see martha#14 and #2'), [])
})

test('a private remote is refused, over ssh, https and as a bare slug', async () => {
  for (const text of [
    `git@github.com:${PRIVATE}.git`,
    `MOD_REMOTE_FALLBACK="https://github.com/${PRIVATE}.git"`,
    `const FALLBACK = '${PRIVATE}'`,
  ]) {
    assert.deepEqual(await hitsOf(text), [`a repository that is not public (${PRIVATE})`], text)
  }
})

test('a public repository passes, in every form', async () => {
  for (const text of [`${PUBLIC}#3`, `https://github.com/${PUBLIC}`, `git@github.com:${PUBLIC}.git`, `'${PUBLIC}'`]) {
    assert.deepEqual(await hitsOf(text), [], text)
  }
})

test('an internal host name is refused, and its value is never printed', async () => {
  const fqdn = await hitsOf('ssh to ci-synthetic.lab')
  assert.deepEqual(fqdn, ['a lab hostname (value withheld)'])
  const machine = await hitsOf('it ran on synth03')
  assert.deepEqual(machine, ['a lab machine name (value withheld)'])
  assert.ok([...fqdn, ...machine].every((what) => !what.includes('synth')))
})

test('a host name inside another class\'s value is withheld there too', async () => {
  const hits = await hitsOf('ssh ops@ci-synthetic.lab')
  assert.deepEqual(hits, ['a lab hostname (value withheld)', 'an email address (value withheld)'])
  assert.deepEqual(await hitsOf('ssh ops@ci-synthetic.lab', scanning), [])
})

test('a GitHub host in any case is looked up', async () => {
  for (const text of [
    `https://GitHub.com/${PRIVATE}/issues/3`,
    `https://GITHUB.COM/${PRIVATE}`,
    `git@GitHub.Com:${PRIVATE}.git`,
    `https://Raw.GitHubUserContent.com/${PRIVATE}/main/x`,
  ]) {
    assert.deepEqual(await hitsOf(text), [`a repository that is not public (${PRIVATE})`], text)
  }
})

test('a lab name is never printed: not in a shorthand, a repository, or the path a hit is at', async () => {
  const resolveAny: Resolve = async () => 'not_public'
  const at = (where: string, text: string): Source[] => [{ name: where, lines: [{ where, text }] }]
  const printed = async (where: string, text: string) =>
    (await privateHitsIn(at(where, text), strict, resolveAny)).map((hit) => `${hit.where} ${hit.what}`)
  const shorthand = await printed('note.md:1', 'see synthetic-synth04#3')
  assert.ok(shorthand.some((line) => line.includes('a shorthand reference to another repository (synthetic-<lab host>#...)')), shorthand.join('|'))
  const repo = await printed('note.md:1', 'see synthetic-owner/synth04-config#2')
  assert.ok(repo.some((line) => line.includes('a repository that is not public (synthetic-owner/<lab host>-config)')), repo.join('|'))
  const path = await printed('path docs/synth04-notes.md', 'docs/synth04-notes.md')
  assert.deepEqual(path, ['path docs/<lab host>-notes.md a lab machine name (value withheld)'])
  for (const line of [...shorthand, ...repo, ...path]) assert.ok(!line.includes('synth0'), line)
})

test('a lab host is refused in lower, upper and mixed case, and never printed', async () => {
  for (const text of ['ran on synth04', 'ran on SYNTH04', 'ran on Synth04']) {
    assert.deepEqual(await hitsOf(text), ['a lab machine name (value withheld)'], text)
  }
  for (const text of ['ssh to ci-synthetic.lab', 'ssh to CI-SYNTHETIC.LAB', 'ssh to Ci-Synthetic.Lab']) {
    assert.deepEqual(await hitsOf(text), ['a lab hostname (value withheld)'], text)
  }
  const resolveAny: Resolve = async () => 'not_public'
  const where = 'path docs/SYNTH04-notes.md'
  const hits = await privateHitsIn([{ name: where, lines: [{ where, text: 'docs/SYNTH04-notes.md' }] }], strict, resolveAny)
  assert.deepEqual(hits, [{ where: 'path docs/<lab host>-notes.md', what: 'a lab machine name (value withheld)' }])
})

test('a machine family is only refused when it is declared', async () => {
  assert.deepEqual(await hitsOf('it ran on synth03', { ...strict, labHosts: [] }), [])
})

test('the crew\'s other private-text classes are refused', async () => {
  assert.deepEqual(await hitsOf('see /home/synthetic/notes'), ['a home directory (/home/synthetic)'])
  assert.deepEqual(await hitsOf('dial 192.168.255.7'), ['a private address (192.168.255.7)'])
  assert.deepEqual(await hitsOf('mail bob@synthetic.invalid'), ['an email address (bob@synthetic.invalid)'])
  const id = 'a'.repeat(ID_HEX_DIGITS)
  assert.deepEqual(await hitsOf(`node ${id}`), [hexHit(id)])
})

test('each synthetic form passes a real scan, so the tests that state them can be public', async () => {
  for (const text of [
    'ssh ops@ci-synthetic.lab',
    'it ran on synth97',
    'see /home/synthetic/notes',
    'dial 192.168.255.7',
    'mail ada@synthetic.invalid',
    `node ${'a'.repeat(ID_HEX_DIGITS)}`,
    'see synthetic-repo#12',
    `as decided in ${PRIVATE}#123`,
  ]) {
    assert.deepEqual(await hitsOf(text, scanning, unreachable), [], text)
  }
})

test('the synthetic allowance is the whole value, never a part of it', async () => {
  for (const [name, pattern] of Object.entries(SYNTHETIC)) {
    assert.ok(pattern.startsWith('^') && pattern.endsWith('$'), name)
  }
  // A real machine number beside the synthetic one is still refused.
  assert.deepEqual(await hitsOf('synth97 then synth03', scanning), ['a lab machine name (value withheld)'])
  // A 64-hex id is synthetic only when it is one digit repeated.
  assert.deepEqual((await hitsOf(`${'a'.repeat(ID_HEX_DIGITS - 1)}b`, scanning)).length, 1)
})

test('a lookup that cannot answer stops the check rather than passing it', async () => {
  await assert.rejects(hitsOf(`see ${PUBLIC}#3`, strict, unreachable), /503/)
})

test('a lookup that fails on a lab-named repository stops the check without printing the name', async () => {
  const failing: Resolve = async (owner, repo) => {
    throw new Error(`GitHub answered 401 for ${owner}/${repo}`)
  }
  await assert.rejects(hitsOf('see synthetic-owner/synth07-config#2', strict, failing), (error: Error) => {
    assert.equal(error.message, 'GitHub answered 401 for synthetic-owner/<lab host>-config')
    return true
  })
})

test('printed text loses its lab names in any case', () => {
  assert.equal(withoutLabNames('could not read docs/Synth07-notes.md on ci-synthetic.LAB', ['synth']), 'could not read docs/<lab host>-notes.md on <lab host>')
})

test('a github.com page that is not a repository is not looked up', async () => {
  assert.deepEqual(await hitsOf('https://github.com/sponsors/synthetic-person', strict, unreachable), [])
})

test('the lab families come from the environment, and a missing list stops the check outside a fork', () => {
  assert.deepEqual(familiesFrom('["synth"]', false), { kind: 'declared', labHosts: ['synth'] })
  assert.throws(() => familiesFrom(undefined, false), /MARTHA_LAB_HOSTS is not set/)
  assert.throws(() => familiesFrom('', false), /MARTHA_LAB_HOSTS is not set/)
  assert.equal(familiesFrom(undefined, true).kind, 'skipped')
  assert.throws(() => familiesFrom('["a|b"]', false), /plain lowercase names/)
  assert.throws(() => familiesFrom('"synth"', false), /plain lowercase names/)
})

test('a malformed secret is refused without its text in the message', () => {
  for (const raw of ['[synth, other]', "['synth']", '["synth",]', '{"synth"']) {
    assert.throws(() => familiesFrom(raw, false), (error: Error) => {
      assert.equal(error.message, 'MARTHA_LAB_HOSTS must be a JSON array of plain lowercase names', raw)
      assert.ok(!error.message.includes('synth'), raw)
      return true
    })
  }
})

const gitIn = (root: string, ...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim()

test('a leak in a commit that a later commit removes is still found, and so is one in a message', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nothing-private-'))
  try {
    gitIn(root, 'init', '-q', '-b', 'main')
    writeFileSync(join(root, 'README.md'), 'clean\n')
    gitIn(root, 'add', '.')
    gitIn(root, 'commit', '-q', '-m', 'start')
    const base = gitIn(root, 'rev-parse', 'HEAD')
    writeFileSync(join(root, 'README.md'), 'clean\ndial 192.168.255.7\n')
    gitIn(root, 'commit', '-q', '-am', `as decided in ${PRIVATE}#9`)
    writeFileSync(join(root, 'README.md'), 'clean\n')
    gitIn(root, 'commit', '-q', '-am', 'tidy')
    const head = gitIn(root, 'rev-parse', 'HEAD')

    assert.deepEqual(await privateHitsIn(treeSources(root), strict, resolveFixed), [])
    const commits = commitsOf(root, `${base}..${head}`)
    assert.equal(commits.length, 2)
    const hits = await privateHitsIn(commits.flatMap((sha) => commitSources(root, sha)), strict, resolveFixed)
    const short = commits[0]?.slice(0, 12) ?? ''
    // Text classes are reported line by line, then the repositories that are not public.
    assert.deepEqual(hits, [
      { where: `commit ${short} README.md:2`, what: 'a private address (192.168.255.7)' },
      { where: `commit ${short} message:1`, what: `a repository that is not public (${PRIVATE})` },
    ])
    assert.deepEqual(commitsOf(root, `${'0'.repeat(40)}..${head}`), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a path is read as well as its text, in the tree and in every commit, empty and binary files too', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nothing-private-'))
  try {
    gitIn(root, 'init', '-q', '-b', 'main')
    writeFileSync(join(root, 'README.md'), 'clean\n')
    gitIn(root, 'add', '.')
    gitIn(root, 'commit', '-q', '-m', 'start')
    const base = gitIn(root, 'rev-parse', 'HEAD')
    writeFileSync(join(root, 'synth05-empty.md'), '')
    writeFileSync(join(root, 'synth06.bin'), Buffer.from([0, 1, 2]))
    gitIn(root, 'add', '.')
    gitIn(root, 'commit', '-q', '-m', 'files whose names are the leak')
    const head = gitIn(root, 'rev-parse', 'HEAD')

    const inTree = (await privateHitsIn(treeSources(root), strict, resolveFixed)).map((hit) => `${hit.where} ${hit.what}`)
    assert.deepEqual(inTree.sort(), [
      'path <lab host>-empty.md a lab machine name (value withheld)',
      'path <lab host>.bin a lab machine name (value withheld)',
    ])
    const commits = commitsOf(root, `${base}..${head}`)
    const inRange = await privateHitsIn(commits.flatMap((sha) => commitSources(root, sha)), strict, resolveFixed)
    assert.equal(inRange.filter((hit) => hit.where.includes(' path <lab host>')).length, 2)
    assert.ok(inRange.every((hit) => !`${hit.where} ${hit.what}`.includes('synth0')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a declared public address passes as that exact string, and its domain does not', async () => {
  assert.deepEqual(await hitsOf('the key type ada@synthetic.invalid'), [])
  assert.deepEqual(await hitsOf('the key type xada@synthetic.invalid'), ['an email address (xada@synthetic.invalid)'])
  assert.deepEqual(await hitsOf('mail bob@synthetic.invalid'), ['an email address (bob@synthetic.invalid)'])
})

// A public digest (martha#61). Real-shaped values are drawn at run time, so the
// tree this file is in never holds one; the forms come from their one definition.
const realShaped = () => randomBytes(ID_HEX_DIGITS / 2).toString('hex')
const writtenDigests = Object.entries(PUBLIC_DIGEST_FORMS).flatMap(([name, form]) =>
  form.written.map((written) => ({ name, written })),
)
const filled = (written: string, hex: string) => written.replaceAll(HEX_SLOT, hex)
const hexHit = (hex: string) => `a ${ID_HEX_DIGITS}-hex id (${hex})`

test('every declared form holds at least one written example', () => {
  for (const [name, form] of Object.entries(PUBLIC_DIGEST_FORMS)) {
    assert.ok(form.written.length > 0, name)
    for (const written of form.written) assert.ok(written.includes(HEX_SLOT), `${name}: ${written}`)
  }
})

test('a real digest passes in every declared form, with no synthetic allowance', async () => {
  for (const { name, written } of writtenDigests) {
    assert.deepEqual(await hitsOf(filled(written, realShaped())), [], `${name}: ${written}`)
  }
})

test('a real-shaped node id or key beside an accepted digest is still refused', async () => {
  for (const { name, written } of writtenDigests) {
    const digest = filled(written, realShaped())
    for (const label of ['node', 'key']) {
      const id = realShaped()
      for (const text of [`${digest} ${label} ${id}`, `${digest}\t${id}`]) {
        assert.deepEqual(await hitsOf(text), [hexHit(id)], `${name}: ${text}`)
      }
      // Before it, the id is refused; a sha256sum line then no longer opens the
      // line, so its digest may be refused too, which errs on the closed side.
      const before = `${label} ${id} ${digest}`
      assert.ok((await hitsOf(before)).includes(hexHit(id)), `${name}: ${before}`)
    }
  }
})

test('a 64-hex string outside a declared form is refused', async () => {
  const id = realShaped()
  for (const text of [
    id,
    `node ${id}`,
    `sha256 ${id}`,
    `sha512:${id}`,
    `node_sha256: ${id}`,
    `sha256sum ${id}`,
    `${id} release.tar.gz`,
    `${id}  direnv`,
    `${id}   .`,
    `node ${id}  release.tar.gz`,
    `key=${id}  release.tar.gz`,
    // A listing of ids beside a host, an address, a version or a file, with no
    // checksum check on the line, indented or in a table cell.
    `${id}  station.example.org`,
    `${id}  203.0.113.7`,
    `${id}  0.51.0`,
    `    ${id}  peer.example.org`,
    `| ${id}  peer.json |`,
    `{"node": "${id}  x.y"}`,
    `${id} *keys.json`,
    `${id}  direnv.linux-amd64`,
    `echo "${id}  direnv.linux-amd64"`,
    `echo "${id}  direnv.linux-amd64" | sha256sum`,
    `echo "${id}  direnv.linux-amd64" | tee sums -c`,
    `echo "${id} release.tar.gz" | sha256sum -c`,
    `echo "${id}  release.tar.gz" | shasum -c`,
    `echo "${id}  release.tar.gz' | sha256sum -c`,
    `echo ${id}  release.tar.gz | sha256sum -c`,
    // A label that does not stand alone.
    `node-sha256: ${id}`,
    `peer.sha256: ${id}`,
    `NODE_SHA256=${id}`,
    `https://example.org/?sha256=${id}`,
    `https://example.org/?a=1&sha256=${id}`,
  ]) {
    assert.ok((await hitsOf(text)).includes(hexHit(id)), text)
  }
})

test('a declared form vouches only for the digest it holds, never a second id on the line', async () => {
  const [first, second] = [realShaped(), realShaped()]
  assert.deepEqual(await hitsOf(`sha256: ${first} ${second}`), [hexHit(second)])
  assert.deepEqual(await hitsOf(`echo "${first}  release.tar.gz" | sha256sum -c ${second}`), [hexHit(second)])
})

// An id not standing alone (martha#64): glued to a word character, or inside a
// longer hex run. Each is refused, and the hit names the whole hex run it sits in.
test('a real-shaped id glued to a word character is refused, by the hex run it is in', async () => {
  const id = realShaped()
  const cases: [string, string][] = [
    [`x${id}`, id],
    [`${id}x`, id],
    [`id_${id}`, id],
    [`${id}_key`, id],
    [`9${id}`, `9${id}`],
    [`node${id}`, `de${id}`],
    [`x${id}  release.tar.gz`, id],
  ]
  for (const [text, run] of cases) {
    assert.deepEqual(await hitsOf(text), [hexHit(run)], text)
  }
})

test('a real-shaped id inside a longer hex run is refused, the run whole', async () => {
  const [first, second] = [realShaped(), realShaped()]
  const tail = realShaped().slice(1)
  for (const run of [`${first}${second}`, `${first}${tail}`, `${tail}${first}`, `${first}0`]) {
    assert.deepEqual(await hitsOf(`key ${run}`), [hexHit(run)], run)
  }
})

test('a declared digest form never vouches for a longer hex run', async () => {
  const run = `${realShaped()}${realShaped().slice(1)}`
  for (const { name, written } of writtenDigests) {
    assert.deepEqual(await hitsOf(filled(written, run)), [hexHit(run)], `${name}: ${written}`)
  }
})

test('a synthetic id passes only as a whole run, never glued to more hex', async () => {
  const synthetic = 'a'.repeat(ID_HEX_DIGITS)
  assert.deepEqual(await hitsOf(`node-${synthetic}x`, scanning), [])
  assert.deepEqual(await hitsOf(`${synthetic}b`, scanning), [hexHit(`${synthetic}b`)])
})

// A git commit sha (sha1) is shorter than an id, so it stays outside this class.
const SHA1_HEX_DIGITS = 40
test('a hex run shorter than an id passes, a commit sha and a range of them included', async () => {
  const sha = realShaped().slice(0, SHA1_HEX_DIGITS)
  assert.deepEqual(await hitsOf(`${sha}..${realShaped().slice(0, SHA1_HEX_DIGITS)} at x${sha}`), [])
})
