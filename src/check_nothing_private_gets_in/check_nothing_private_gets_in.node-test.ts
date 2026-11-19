import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  privateHitsIn,
  refusedValuesIn,
  SYNTHETIC,
  type Resolve,
  type Rules,
  type Source,
  withoutLabNames,
} from './check_nothing_private_gets_in.ts'
import { HEX_SLOT, PUBLIC_DIGEST_FORMS } from './public_digest.ts'
import { GITHUB_TOKEN_PREFIXES, TOKEN_BODY } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { ID_HEX_DIGITS } from './public_text.ts'
import { commitSources, commitsOf, treeSources } from './read_sources.ts'

// Every value planted here is a synthetic form, because this file is in the
// public tree the check reads. The class tests switch the synthetic allowance
// off, so each class is shown to refuse that very value on its own.
const strict: Rules = {
  publicEmails: ['macula.io'],
  publicAddresses: ['ada@synthetic.invalid'],
  owners: ['synthetic-owner'],
  ownRepo: 'martha',
  allowSynthetic: false,
}
const scanning: Rules = { ...strict, allowSynthetic: true }
// A lab hostname put together at run time: where a test needs one the real scan
// refuses (a shorthand, a name that is not synthetic), the source must not hold it.
const labHost = (name: string) => [name, 'lab'].join('.')

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

// Where the one-line source's line is, as a hit or a lookup's error names it.
const HERE = 'note.md:1'
const one = (text: string): Source[] => [{ name: 'note.md', lines: [{ where: HERE, text }] }]
const hitsOf = async (text: string, rules: Rules = strict, resolve: Resolve = resolveFixed) =>
  (await privateHitsIn(one(text), rules, resolve)).map((hit) => hit.what)
// What each class refuses in a line, value and all: the printed hits withhold every value
// (martha#855), so a test that pins which value a class refuses reads it here.
const refusedIn = async (text: string, rules: Rules = strict) =>
  refusedValuesIn(text, rules).map((refused) => `${refused.what} (${refused.value})`)

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
    assert.deepEqual(await hitsOf(text), [`a repository that is not public (value withheld)`], text)
  }
})

test('a shorthand reference to another repository is refused, this repository\'s own passes', async () => {
  assert.deepEqual(await hitsOf('see synthetic-repo#12'), [
    'a shorthand reference to another repository (value withheld): write owner/repo#n so it can be checked',
  ])
  assert.deepEqual(await hitsOf('see martha#14 and #2'), [])
})

// A hyphen between a word and a reference is punctuation, not part of a
// repository's name: the daily run flagged "the pre-#189 original" as a
// reference to a repository called `pre-`, and the first live run's 64 hits
// held two of this class (martha#287). The guard closes the trailing hyphen
// and nothing else, so the values below are the ones that must still refuse.
test('a hyphen separating a word from its reference is not a repository name', async () => {
  assert.deepEqual(await hitsOf('MC, the pre-#189 original that #137 quotes'), [])
  assert.deepEqual(await hitsOf('the post-#12 cleanup'), [])
  assert.deepEqual(await hitsOf('synthetic-repo#112'), [
    'a shorthand reference to another repository (value withheld): write owner/repo#n so it can be checked',
  ])
  assert.deepEqual(await hitsOf(`${PRIVATE}#464`), [`a repository that is not public (value withheld)`])
  // Only the hyphen is refused: a repository may end in a dot or an underscore,
  // and a reference to one must still be read. The name is built from a
  // constant, as `${PRIVATE}` is above, because the tree scan reads this file
  // too and its synthetic allowance stops at `synthetic-[a-z0-9-]+`.
  const endsInAnUnderscore = 'synthetic-repo_'
  assert.deepEqual(await hitsOf(`${endsInAnUnderscore}#13`), [
    `a shorthand reference to another repository (value withheld): write owner/repo#n so it can be checked`,
  ])
  // A one-letter name is a repository too: the guard makes the rest of the name
  // optional, and a rule that required it would read this reference as nothing
  // (Mercurius's r=1 on this change, mutant M4). Built from a constant like the
  // values around it, so the tree scan does not read this line as a reference.
  const oneLetter = 'q'
  assert.deepEqual(await hitsOf(`${oneLetter}#12`), [
    `a shorthand reference to another repository (value withheld): write owner/repo#n so it can be checked`,
  ])
})

test('a private remote is refused, over ssh, https and as a bare slug', async () => {
  for (const text of [
    `git@github.com:${PRIVATE}.git`,
    `MOD_REMOTE_FALLBACK="https://github.com/${PRIVATE}.git"`,
    `const FALLBACK = '${PRIVATE}'`,
  ]) {
    assert.deepEqual(await hitsOf(text), [`a repository that is not public (value withheld)`], text)
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
  assert.ok(fqdn.every((what) => !what.includes('synth')))
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
    assert.deepEqual(await hitsOf(text), [`a repository that is not public (value withheld)`], text)
  }
})

test('a lab name is never printed: not in a shorthand, a repository, or the path a hit is at', async () => {
  const resolveAny: Resolve = async () => 'not_public'
  const at = (where: string, text: string): Source[] => [{ name: where, lines: [{ where, text }] }]
  const printed = async (where: string, text: string) =>
    (await privateHitsIn(at(where, text), strict, resolveAny)).map((hit) => `${hit.where} ${hit.what}`)
  const shorthand = await printed('note.md:1', `see ${labHost('ci-synthetic')}#3`)
  assert.ok(shorthand.some((line) => line.includes('a shorthand reference to another repository (value withheld)')), shorthand.join('|'))
  const repo = await printed('note.md:1', 'see synthetic-owner/ci-synthetic.lab-config#2')
  assert.ok(repo.some((line) => line.includes('a repository that is not public (value withheld)')), repo.join('|'))
  const path = await printed('path docs/ci-synthetic.lab-notes.md', 'docs/ci-synthetic.lab-notes.md')
  assert.deepEqual(path, ['path docs/<lab host>-notes.md a lab hostname (value withheld)'])
  for (const line of [...shorthand, ...repo, ...path]) assert.ok(!line.includes('ci-synthetic'), line)
})

test('a lab host is refused in lower, upper and mixed case, and never printed', async () => {
  for (const text of ['ssh to ci-synthetic.lab', 'ssh to CI-SYNTHETIC.LAB', 'ssh to Ci-Synthetic.Lab']) {
    assert.deepEqual(await hitsOf(text), ['a lab hostname (value withheld)'], text)
  }
  const resolveAny: Resolve = async () => 'not_public'
  const where = 'path docs/CI-SYNTHETIC.LAB-notes.md'
  const hits = await privateHitsIn([{ name: where, lines: [{ where, text: 'docs/CI-SYNTHETIC.LAB-notes.md' }] }], strict, resolveAny)
  assert.deepEqual(hits, [{ where: 'path docs/<lab host>-notes.md', what: 'a lab hostname (value withheld)' }])
})

test('a home directory is refused and never printed: a CI log of a public repository is public (martha#846)', async () => {
  // A user name nobody declared, drawn here so this file carries no such value.
  const user = `u${randomBytes(4).toString('hex')}`
  const hits = await hitsOf(`see /home/${user}/notes`)
  assert.deepEqual(hits, ['a home directory (value withheld)'])
  assert.ok(!hits.join('\n').includes(user), `the hit printed the user name: ${hits.join('\n')}`)
})

// Every other class withholds its value too (martha#855): the reason is the log's, not the class's. Each value is
// drawn here, so this file carries none, and each is one the strict rules refuse.
const drawnOctet = () => String(1 + (randomBytes(1)[0] ?? 0) % 254)
const WITHHELD_CLASSES: readonly { readonly what: string; readonly drawn: () => string }[] = [
  { what: 'a private address', drawn: () => ['10', drawnOctet(), drawnOctet(), drawnOctet()].join('.') },
  { what: 'an email address', drawn: () => `u${randomBytes(4).toString('hex')}@d${randomBytes(4).toString('hex')}.test` },
  { what: `a ${ID_HEX_DIGITS}-hex id`, drawn: () => randomBytes(ID_HEX_DIGITS / 2).toString('hex') },
]
for (const { what, drawn } of WITHHELD_CLASSES) {
  test(`${what} is refused and never printed: a CI log of a public repository is public (martha#855)`, async () => {
    const value = drawn()
    const hits = await hitsOf(`see ${value} here`)
    assert.deepEqual(hits, [`${what} (value withheld)`])
    assert.ok(!hits.join('\n').includes(value), `the hit printed the value: ${hits.join('\n')}`)
  })
}

// A GitHub token, classic or fine-grained, is refused by the scan a post goes through, and never printed (martha#904).
// Each token is drawn here, so this file carries none: its body is hex, which every prefix's body may hold, and twice
// the length a token needs, so the class cannot pass it for being short.
const TOKEN_CLASS = 'a GitHub token'
const drawnToken = (prefix: string) => `${prefix}${randomBytes(TOKEN_BODY).toString('hex')}`
for (const prefix of GITHUB_TOKEN_PREFIXES) {
  test(`a GitHub token with the prefix ${prefix} is refused and never printed (martha#904)`, async () => {
    const token = drawnToken(prefix)
    for (const text of [`token: ${token}`, `https://x-access-token:${token}@example.invalid/acme/widget.git`, `"oauth_token":"${token}"`]) {
      const hits = await hitsOf(text)
      assert.deepEqual(hits, [`${TOKEN_CLASS} (value withheld)`], text)
      assert.ok(!hits.join('\n').includes(token), `the hit printed the token: ${hits.join('\n')}`)
    }
    assert.deepEqual(await refusedIn(`see ${token} here`), [`${TOKEN_CLASS} (${token})`])
  })
}

// GitHub's own token kinds, as its documentation names them, stated here rather than read from the class's list, so
// a prefix dropped from that list fails by the kind it leaves out instead of taking its own test with it.
const GITHUBS_TOKEN_KINDS: readonly { readonly kind: string; readonly prefix: string }[] = [
  { kind: 'a personal access token (classic)', prefix: 'ghp_' },
  { kind: 'an OAuth access token', prefix: 'gho_' },
  { kind: 'a user-to-server token', prefix: 'ghu_' },
  { kind: 'a server-to-server token', prefix: 'ghs_' },
  { kind: 'a refresh token', prefix: 'ghr_' },
  { kind: 'a fine-grained personal access token', prefix: 'github_pat_' },
]
test('every kind of GitHub token is refused by the scan (martha#904)', async () => {
  for (const { kind, prefix } of GITHUBS_TOKEN_KINDS) {
    assert.deepEqual(await hitsOf(`token: ${drawnToken(prefix)}`), [`${TOKEN_CLASS} (value withheld)`], kind)
  }
})

test('a word that only starts like a GitHub token is not one: its body is shorter than a token\'s (martha#904)', async () => {
  for (const prefix of GITHUB_TOKEN_PREFIXES) {
    const body = randomBytes(TOKEN_BODY).toString('hex').slice(0, TOKEN_BODY - 1)
    assert.deepEqual(await hitsOf(`a variable named ${prefix}${body} is no token`), [], prefix)
    assert.deepEqual(await hitsOf(`the next character makes it one: ${prefix}${body}0`), [`${TOKEN_CLASS} (value withheld)`], prefix)
  }
})

// A reference hit withholds the name it found, for the same reason (martha#855): a repository that is not public
// is not seen by the public, and a shorthand may name one. Each name is drawn here, so this file carries none.
const drawnName = (first: string) => `${first}${randomBytes(4).toString('hex')}`
test('a repository that is not public is refused and its name never printed (martha#855)', async () => {
  const repo = drawnName('r')
  const notPublic: Resolve = async () => 'not_public'
  const hits = await hitsOf(`see ${strict.owners[0] ?? ''}/${repo}#5`, strict, notPublic)
  assert.deepEqual(hits, ['a repository that is not public (value withheld)'])
  assert.ok(!hits.join('\n').includes(repo), `the hit printed the name: ${hits.join('\n')}`)
})
test('a shorthand reference is refused and its name never printed (martha#855)', async () => {
  const name = drawnName('s')
  const hits = await hitsOf(`see ${name}#5`)
  assert.deepEqual(hits, ['a shorthand reference to another repository (value withheld): write owner/repo#n so it can be checked'])
  assert.ok(!hits.join('\n').includes(name), `the hit printed the name: ${hits.join('\n')}`)
})

test('a lab machine name is not a private class: the owner dropped it (martha#773)', async () => {
  for (const text of ['it ran on synth03', 'it ran on SYNTH03', 'docs/synth04-notes.md', 'see synthetic-owner/open-thing and synth07']) {
    assert.deepEqual(await hitsOf(text), [], text)
  }
})

test('the crew\'s other private-text classes are refused', async () => {
  assert.deepEqual(await hitsOf('see /home/synthetic/notes'), ['a home directory (value withheld)'])
  assert.deepEqual(await hitsOf('dial 192.168.255.7'), ['a private address (value withheld)'])
  assert.deepEqual(await hitsOf('mail bob@synthetic.invalid'), ['an email address (value withheld)'])
  assert.deepEqual(await hitsOf(`node ${'a'.repeat(ID_HEX_DIGITS)}`), [`a ${ID_HEX_DIGITS}-hex id (value withheld)`])
})

test('each synthetic form passes a real scan, so the tests that state them can be public', async () => {
  for (const text of [
    'ssh ops@ci-synthetic.lab',
    'see /home/synthetic/notes',
    'dial 192.168.255.7',
    'mail ada@synthetic.invalid',
    `node ${'a'.repeat(ID_HEX_DIGITS)}`,
    ...GITHUB_TOKEN_PREFIXES.map((prefix) => `token: ${prefix}synthetic${'a'.repeat(TOKEN_BODY)}`),
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
  // A real lab hostname beside the synthetic one is still refused.
  assert.deepEqual(await hitsOf(`ci-synthetic.lab then ${labHost('ci-other')}`, scanning), ['a lab hostname (value withheld)'])
  // A GitHub token is synthetic only when its body starts with the word, and a real one beside it is still refused.
  for (const prefix of GITHUB_TOKEN_PREFIXES) {
    const synthetic = `${prefix}synthetic${'a'.repeat(TOKEN_BODY)}`
    assert.deepEqual(await hitsOf(synthetic, strict), [`${TOKEN_CLASS} (value withheld)`], `${prefix}: refused with no allowance`)
    assert.deepEqual(await hitsOf(`${synthetic} then ${drawnToken(prefix)}`, scanning), [`${TOKEN_CLASS} (value withheld)`], prefix)
    assert.deepEqual(await hitsOf(`${prefix}${'a'.repeat(TOKEN_BODY)}synthetic`, scanning), [`${TOKEN_CLASS} (value withheld)`], prefix)
  }
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
  await assert.rejects(hitsOf('see synthetic-owner/ci-synthetic.lab-config#2', strict, failing), (error: Error) => {
    assert.equal(error.message, `GitHub answered 401 for (value withheld) (the repository named at ${HERE})`)
    return true
  })
})

test('a lookup GitHub cannot answer (a rate limit, a 5xx) stops the check without printing the repository it asked about (martha#855)', async () => {
  const owner = `o${randomBytes(4).toString('hex')}`
  const repo = `r${randomBytes(4).toString('hex')}`
  const failing: Resolve = async (asked, named) => {
    throw new Error(`GitHub answered 503 for ${asked}/${named}`)
  }
  await assert.rejects(hitsOf(`see ${owner}/${repo}#2`, strict, failing), (error: Error) => {
    assert.equal(error.message, `GitHub answered 503 for (value withheld) (the repository named at ${HERE})`)
    assert.ok(!error.message.includes(owner) && !error.message.includes(repo), error.message)
    return true
  })
})

test('printed text loses its lab names in any case', () => {
  assert.equal(withoutLabNames('could not read docs/Ci-Synthetic.Lab-notes.md on ci-synthetic.LAB'), 'could not read docs/<lab host>-notes.md on <lab host>')
})

test('a github.com page that is not a repository is not looked up', async () => {
  assert.deepEqual(await hitsOf('https://github.com/sponsors/synthetic-person', strict, unreachable), [])
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
      { where: `commit ${short} README.md:2`, what: 'a private address (value withheld)' },
      { where: `commit ${short} message:1`, what: `a repository that is not public (value withheld)` },
    ])
    assert.deepEqual(commitsOf(root, `${'0'.repeat(40)}..${head}`), [])
  } finally {
    removeTheTree(root)
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
    writeFileSync(join(root, 'ci-synthetic.lab-empty.md'), '')
    writeFileSync(join(root, 'ci-synthetic.lab.bin'), Buffer.from([0, 1, 2]))
    gitIn(root, 'add', '.')
    gitIn(root, 'commit', '-q', '-m', 'files whose names are the leak')
    const head = gitIn(root, 'rev-parse', 'HEAD')

    const inTree = (await privateHitsIn(treeSources(root), strict, resolveFixed)).map((hit) => `${hit.where} ${hit.what}`)
    assert.deepEqual(inTree.sort(), [
      'path <lab host>-empty.md a lab hostname (value withheld)',
      'path <lab host>.bin a lab hostname (value withheld)',
    ])
    const commits = commitsOf(root, `${base}..${head}`)
    const inRange = await privateHitsIn(commits.flatMap((sha) => commitSources(root, sha)), strict, resolveFixed)
    assert.equal(inRange.filter((hit) => hit.where.includes(' path <lab host>')).length, 2)
    assert.ok(inRange.every((hit) => !`${hit.where} ${hit.what}`.includes('ci-synthetic')))
  } finally {
    removeTheTree(root)
  }
})

test('a declared public address passes as that exact string, and its domain does not', async () => {
  assert.deepEqual(await hitsOf('the key type ada@synthetic.invalid'), [])
  assert.deepEqual(await refusedIn('the key type xada@synthetic.invalid'), ['an email address (xada@synthetic.invalid)'])
  assert.deepEqual(await refusedIn('mail bob@synthetic.invalid'), ['an email address (bob@synthetic.invalid)'])
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

// A fresh real-shaped id under one label, after and before one accepted digest.
const assertRefusedBeside = async (name: string, digest: string, label: string) => {
  const id = realShaped()
  for (const text of [`${digest} ${label} ${id}`, `${digest}\t${id}`]) {
    assert.deepEqual(await refusedIn(text), [hexHit(id)], `${name}: ${text}`)
  }
  // Before it, the id is refused; a sha256sum line then no longer opens the
  // line, so its digest may be refused too, which errs on the closed side.
  const before = `${label} ${id} ${digest}`
  assert.ok((await refusedIn(before)).includes(hexHit(id)), `${name}: ${before}`)
}

test('a real-shaped node id or key beside an accepted digest is still refused', async () => {
  for (const { name, written } of writtenDigests) {
    const digest = filled(written, realShaped())
    for (const label of ['node', 'key']) await assertRefusedBeside(name, digest, label)
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
    assert.ok((await refusedIn(text)).includes(hexHit(id)), text)
  }
})

test('a declared form vouches only for the digest it holds, never a second id on the line', async () => {
  const [first, second] = [realShaped(), realShaped()]
  assert.deepEqual(await refusedIn(`sha256: ${first} ${second}`), [hexHit(second)])
  assert.deepEqual(await refusedIn(`echo "${first}  release.tar.gz" | sha256sum -c ${second}`), [hexHit(second)])
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
    assert.deepEqual(await refusedIn(text), [hexHit(run)], text)
  }
})

test('a real-shaped id inside a longer hex run is refused, the run whole', async () => {
  const [first, second] = [realShaped(), realShaped()]
  const tail = realShaped().slice(1)
  for (const run of [`${first}${second}`, `${first}${tail}`, `${tail}${first}`, `${first}0`]) {
    assert.deepEqual(await refusedIn(`key ${run}`), [hexHit(run)], run)
  }
})

test('a declared digest form never vouches for a longer hex run', async () => {
  const run = `${realShaped()}${realShaped().slice(1)}`
  for (const { name, written } of writtenDigests) {
    assert.deepEqual(await refusedIn(filled(written, run)), [hexHit(run)], `${name}: ${written}`)
  }
})

test('a synthetic id passes only as a whole run, never glued to more hex', async () => {
  const synthetic = 'a'.repeat(ID_HEX_DIGITS)
  assert.deepEqual(await hitsOf(`node-${synthetic}x`, scanning), [])
  assert.deepEqual(await refusedIn(`${synthetic}b`, scanning), [hexHit(`${synthetic}b`)])
})

// A git commit sha (sha1) is shorter than an id, so it stays outside this class.
const SHA1_HEX_DIGITS = 40
test('a hex run shorter than an id passes, a commit sha and a range of them included', async () => {
  const sha = realShaped().slice(0, SHA1_HEX_DIGITS)
  assert.deepEqual(await hitsOf(`${sha}..${realShaped().slice(0, SHA1_HEX_DIGITS)} at x${sha}`), [])
})
