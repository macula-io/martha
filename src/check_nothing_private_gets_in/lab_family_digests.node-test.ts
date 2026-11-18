// The lab families kept as digests (martha#731): a member's machine judges the
// lab_machine rule without the plain list, by the same rule CI holds to.
//
// Every file these tests make is under a scratch folder they remove: a spawned
// check is handed HOME and XDG_CONFIG_HOME in that folder and nothing of this
// process's own environment but PATH, so no test reads or writes the owner's own
// config folder. Every family is drawn at run time.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, type TestContext } from 'node:test'
import ts from 'typescript'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theEnvironmentOfALaunch } from '../launch_a_goose_member/launch_a_goose_member.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { privateHitsIn, withoutLabNames, type Rules } from './check_nothing_private_gets_in.ts'
import { DECLARED } from './declared.ts'
import { FAMILY_MAX, KEY_BYTES, keptFileText, labFamilyDigestsOf, labNamesIn, type LabFamilyDigests } from './lab_family_digests.ts'
import { keepLabFamilies } from '../keep_the_lab_families/keep_the_lab_families.ts'
import { PUBLIC_TEXT_PATTERNS } from './public_text.ts'
import { labFamiliesFileIn, labFamilyDigestsFrom } from './read_lab_family_digests.ts'

const WITHHELD = 'a lab machine name (value withheld)'
const POSTED_TEXT_CHECK = join(import.meta.dirname, '..', 'check_posted_text_carries_nothing_private', 'main.ts')
const TREE_CHECK = join(import.meta.dirname, 'main.ts')
const KEEP = join(import.meta.dirname, '..', 'keep_the_lab_families', 'main.ts')
const READER = join(import.meta.dirname, 'read_lab_family_digests.ts')

const scratch = (t: TestContext): string => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-731-'))
  t.after(() => removeTheTree(directory))
  return directory
}

/** A family drawn at run time: lowercase letters only, so it is no everyday word and no real family. */
const aFamily = (): string => `q${[...randomBytes(9)].map((byte) => String.fromCharCode(97 + (byte % 26))).join('')}`

const digestsFor = (families: readonly string[]): LabFamilyDigests => labFamilyDigestsOf(keptFileText(families, randomBytes(KEY_BYTES)))

/** A home and a config folder under scratch, with the families kept there by the owner's own act, or none. */
const aMachine = (t: TestContext, families: readonly string[] | undefined) => {
  const root = scratch(t)
  const env = { HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'xdg-config') }
  mkdirSync(env.HOME)
  if (families !== undefined) {
    const kept = keepLabFamilies(env, JSON.stringify(families), randomBytes(KEY_BYTES))
    assert.ok('kept' in kept, JSON.stringify(kept))
  }
  return { root, env }
}

/** A check, run as a member's machine runs it: PATH, and the places this test made. */
const run = (script: string, args: readonly string[], env: Readonly<Record<string, string>>) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', ...env } })

const draftIn = (root: string, text: string): string => {
  const draft = join(root, 'draft.md')
  writeFileSync(draft, text)
  return draft
}

const said = (ran: { stdout: string; stderr: string }) => `${ran.stdout}${ran.stderr}`
const countOf = (text: string, what: string) => text.split(what).length - 1

test('a planted family is refused through the digests, in any case, and never printed (martha#731)', (t) => {
  const family = aFamily()
  const { root, env } = aMachine(t, [aFamily(), family])
  const draft = draftIn(root, [`ran on ${family}07`, `ran on ${family.toUpperCase()}07`, `see docs/${family}07-notes.md`, 'and nothing else'].join('\n'))
  const ran = run(POSTED_TEXT_CHECK, ['--text', draft], env)
  assert.equal(ran.status, 1, said(ran))
  assert.equal(countOf(ran.stdout, WITHHELD), 3, ran.stdout)
  assert.ok(!said(ran).toLowerCase().includes(family), 'the family was printed')
})

const aRepository = (t: TestContext, text: string): string => {
  const repository = scratch(t)
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' })
  git('init', '--quiet')
  writeFileSync(join(repository, 'notes.md'), text)
  git('add', 'notes.md')
  git('commit', '--quiet', '-m', 'notes')
  return repository
}

test('the tree check answers pass or fail on a member\'s machine, and never passes when it could not look (martha#731)', (t) => {
  const family = aFamily()
  const kept = aMachine(t, [family])
  const none = aMachine(t, undefined)
  const planted = aRepository(t, `ran on ${family}07\n`)
  const clean = aRepository(t, 'nothing private here\n')
  // A home path drawn at run time: a hit of another rule, which runs when the families cannot.
  const other = aRepository(t, `${['', 'home', `u${randomBytes(6).toString('hex')}`].join('/')}\n`)

  const refused = run(TREE_CHECK, ['--root', planted], kept.env)
  assert.equal(refused.status, 1, said(refused))
  assert.equal(countOf(refused.stdout, WITHHELD), 1, refused.stdout)
  assert.ok(!said(refused).includes(family), 'the family was printed')
  assert.equal(run(TREE_CHECK, ['--root', clean], kept.env).status, 0)

  const unchecked = run(TREE_CHECK, ['--root', clean], none.env)
  assert.equal(unchecked.status, 2, said(unchecked))
  assert.match(unchecked.stderr, /lab machine families could not be checked/)
  const otherRules = run(TREE_CHECK, ['--root', other], none.env)
  assert.equal(otherRules.status, 2, said(otherRules))
  assert.match(otherRules.stdout, /a home directory/)
})

// A seeded generator, so a failing line is found again by its seed.
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
}

/** The plain rule, as CI runs it, over families in the order given. */
const plainNamesIn = (text: string, families: readonly string[]) =>
  [...text.matchAll(new RegExp(PUBLIC_TEXT_PATTERNS.lab_machine.replace('%s', families.join('|')), 'gi'))].map((found) => ({ value: found[0], at: found.index }))

const longestFirst = (families: readonly string[]) => [...families].sort((one, other) => other.length - one.length)

test('the digests find exactly what the plain rule finds, over generated lines (martha#731)', () => {
  const next = seeded(731)
  const pick = <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)]!
  for (let round = 0; round < 200; round += 1) {
    // Families that share starts, carry hyphens and digits, and end in either; and one
    // that holds another's whole name, digits and all, so both match at one start.
    const stem = `${pick(['a', 'b', 'ab'])}${pick(['', 'c', '-c', '1', 'c-'])}`
    const families = [...new Set([stem, `${stem}${pick(['d', '-d', '2', '0'])}`, `${stem}07-${pick(['c', 'd'])}`, pick(['b', 'cd', 'a-b', 'x9'])])]
    const digests = digestsFor(families)
    const pieces = [...families, ...families.map((family) => family.toUpperCase()), '0', '7', '07', '-', '_', ' ', '.', 'é', 'K', 'x', '9']
    for (let line = 0; line < 25; line += 1) {
      const text = Array.from({ length: 1 + Math.floor(next() * 8) }, () => pick(pieces)).join('')
      const found = labNamesIn(text, digests)
      assert.equal(found.length > 0, plainNamesIn(text, families).length > 0, `round ${round}: ${JSON.stringify({ families, text })}`)
      assert.deepEqual(found, plainNamesIn(text, longestFirst(families)), `round ${round}: ${JSON.stringify({ families, text })}`)
    }
  }
})

test('the digests hold to JavaScript\'s \\b and its case folding, case by case (martha#731)', () => {
  const families = ['fam', 'fam2', 'kam', 'sam']
  const digests = digestsFor(families)
  const cases: readonly [string, boolean][] = [
    ['_fam07', false],
    ['9fam07', false],
    ['éfam07', true],
    ['fam2007', false],
    ['fam07_', false],
    ['FaM07', true],
    // The Kelvin sign and the long s fold onto k and s only with `u`, which the rule does not set.
    ['\u212Aam07', false],
    ['\u017Fam07', false],
    ['KAM07', true],
    ['(fam2-07)', false],
    ['fam-07', false],
  ]
  for (const [text, expected] of cases) {
    assert.equal(plainNamesIn(text, families).length > 0, expected, `the plain rule, ${text}`)
    assert.equal(labNamesIn(text, digests).length > 0, expected, `the digests, ${text}`)
  }
  // Two families at one start: the longer is the name, as the rule finds it with its families longest first.
  const nested = ['ab', 'ab07-c']
  assert.deepEqual(labNamesIn('ab07-c07', digestsFor(nested)), [{ value: 'ab07-c07', at: 0 }])
  assert.deepEqual(plainNamesIn('ab07-c07', longestFirst(nested)), [{ value: 'ab07-c07', at: 0 }])
})

test('a printed location loses the names the digests find, and a shown value naming one is withheld (martha#731)', async () => {
  const family = aFamily()
  const digests = digestsFor([family])
  assert.equal(withoutLabNames(`could not read docs/${family.toUpperCase()}07-notes.md on ci-synthetic.LAB`, [], digests), 'could not read docs/<lab host>-notes.md on <lab host>')
  const rules: Rules = { ...DECLARED, labHosts: [], labDigests: digests, allowSynthetic: false }
  const hits = await privateHitsIn([{ name: 'draft', lines: [{ where: `docs/${family}07.md:1`, text: `mail me at someone@${family}07.example.org` }] }], rules, () => Promise.reject(new Error('no lookup')))
  assert.deepEqual(hits, [
    { where: 'docs/<lab host>.md:1', what: WITHHELD },
    { where: 'docs/<lab host>.md:1', what: 'an email address (value withheld)' },
  ])
})

test('the kept file spells no family, is only its owner\'s, and keeping it again replaces the key (martha#731)', (t) => {
  const families = [aFamily(), aFamily()]
  const { env } = aMachine(t, families)
  const file = labFamiliesFileIn(env)!
  const text = readFileSync(file, 'utf8')
  for (const family of families) assert.ok(!text.toLowerCase().includes(family), 'the file spells a family')
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(statSync(dirname(file)).mode & 0o777, 0o700)
  const before = labFamilyDigestsOf(text)
  assert.ok('kept' in keepLabFamilies(env, JSON.stringify(families), randomBytes(KEY_BYTES)))
  const after = labFamilyDigestsFrom(env)!
  assert.notDeepEqual(after.key, before.key)
  assert.notDeepEqual([...after.digests], [...before.digests])
  assert.equal(labNamesIn(`${families[0]}07`, after).length, 1)
})

test('only plain lowercase families, no longer than a machine name allows, are kept (martha#731)', (t) => {
  const { env } = aMachine(t, undefined)
  for (const raw of ['[]', '["Fam"]', '["a|b"]', '"fam"', 'fam', `["${'a'.repeat(FAMILY_MAX + 1)}"]`]) {
    assert.ok('refusal' in keepLabFamilies(env, raw, randomBytes(KEY_BYTES)), raw)
  }
  assert.equal(existsSync(labFamiliesFileIn(env)!), false)
  assert.ok('kept' in keepLabFamilies(env, `["${'a'.repeat(FAMILY_MAX)}"]`, randomBytes(KEY_BYTES)))
})

test('the reader refuses any file but the exact shape, by name, and never quotes it (martha#731)', (t) => {
  const family = aFamily()
  const hex = randomBytes(KEY_BYTES).toString('hex')
  const shapes: readonly [string, RegExp][] = [
    [JSON.stringify([family]), /exactly the fields digests and key/],
    [JSON.stringify({ key: hex, digests: [hex], families: [family] }), /exactly the fields digests and key/],
    [JSON.stringify({ key: hex, digests: [hex, family] }), /digests are not digests/],
    [JSON.stringify({ key: family, digests: [hex] }), /key is not a key/],
    [JSON.stringify({ key: hex, digests: [] }), /digests are not digests/],
    [`{"key": "${family}"`, /is not JSON/],
  ]
  for (const [text, why] of shapes) {
    assert.throws(() => labFamilyDigestsOf(text), (error: Error) => {
      assert.match(error.message, why, text)
      assert.ok(!error.message.includes(family), text)
      return true
    })
  }
  // A plain list put where the digests belong is refused, and the check exits 2 without matching.
  const { root, env } = aMachine(t, undefined)
  const file = labFamiliesFileIn(env)!
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify([family]))
  const ran = run(POSTED_TEXT_CHECK, ['--text', draftIn(root, `ran on ${family}07`)], env)
  assert.equal(ran.status, 2, said(ran))
  assert.ok(!ran.stdout.includes(WITHHELD), ran.stdout)
  assert.ok(!said(ran).includes(family), 'the family was printed')
})

test('with the file kept, no other source of families is read (martha#731)', (t) => {
  const poison = aFamily()
  const { root, env } = aMachine(t, [aFamily()])
  const poisoned = Object.fromEntries(['LAB_HOSTS', 'MARTHA_LAB_FAMILIES', 'MARTHA_LAB_HOSTS_PLAIN', 'LAB_FAMILIES'].map((name) => [name, JSON.stringify([poison])]))
  const ran = run(POSTED_TEXT_CHECK, ['--text', draftIn(root, `ran on ${poison}07`)], { ...env, ...poisoned })
  assert.equal(ran.status, 0, said(ran))
})

test('the reader resolves from the environment it is handed, never its own process\'s: a Goose launch finds no file (martha#731, design r=3)', (t) => {
  const family = aFamily()
  // This child's own HOME and XDG_CONFIG_HOME hold a kept file; the launch it is handed holds none.
  const planted = aMachine(t, [family])
  const launch = scratch(t)
  const places = { root: join(launch, 'root'), home: join(launch, 'home'), checkout: launch }
  const launched = theEnvironmentOfALaunch(RECORDED_GOOSE_ENGINE, places)
  assert.equal('XDG_CONFIG_HOME' in launched, false)
  assert.equal('MARTHA_LAB_HOSTS' in launched, false)
  const url = (file: string) => JSON.stringify(pathToFileURL(file).href)
  const child = [
    `const { labFamilyDigestsFrom } = await import(${url(READER)})`,
    `const { familiesFrom, privateHitsIn } = await import(${url(join(import.meta.dirname, 'check_nothing_private_gets_in.ts'))})`,
    `const { rulesOf } = await import(${url(join(import.meta.dirname, 'scan_rules_and_visibility.ts'))})`,
    `const launched = ${JSON.stringify(launched)}`,
    `const families = familiesFrom(launched.MARTHA_LAB_HOSTS, false, () => labFamilyDigestsFrom(launched))`,
    `const lines = [{ where: 'range', text: process.argv[1] }]`,
    `const hits = await privateHitsIn([{ name: 'range', lines }], rulesOf(families, true), () => Promise.reject(new Error('no lookup')))`,
    `const own = labFamilyDigestsFrom(process.env) !== undefined`,
    `console.log(JSON.stringify({ kind: families.kind, hits: hits.length, own }))`,
  ].join('\n')
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', child, `ran on ${family}07`], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...planted.env },
  })
  assert.equal(ran.status, 0, ran.stderr)
  // `own` is the control: the file this child's own environment names is there to be found.
  assert.deepEqual(JSON.parse(ran.stdout), { kind: 'unchecked', hits: 0, own: true })
})

/** The module an import or export declaration names. */
const staticSpecifierOf = (node: ts.Node): string | undefined =>
  (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : undefined

/** A way to load a module that no import declaration shows. */
const dynamicRouteOf = (node: ts.Node): string | undefined => {
  if (ts.isImportEqualsDeclaration(node)) return 'import = require'
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return 'import()'
  return ts.isIdentifier(node) && ['require', 'createRequire'].includes(node.text) ? node.text : undefined
}

/** Every module the reader loads from this tree, with what each imports, read by the TypeScript parser. */
const importsFrom = (entry: string) => {
  const seen = new Map<string, { specifiers: string[]; dynamic: string[] }>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const found = { specifiers: [] as string[], dynamic: [] as string[] }
    seen.set(file, found)
    const walk = (node: ts.Node) => {
      const specifier = staticSpecifierOf(node)
      if (specifier !== undefined) found.specifiers.push(specifier)
      const route = dynamicRouteOf(node)
      if (route !== undefined) found.dynamic.push(route)
      ts.forEachChild(node, walk)
    }
    walk(source)
    for (const specifier of found.specifiers) if (specifier.startsWith('.')) visit(resolve(dirname(file), specifier))
  }
  visit(entry)
  return seen
}

test('the reader imports no node:os, by any route: a home it could look up there is not the one it is handed (martha#731, design r=3)', () => {
  const modules = importsFrom(READER)
  assert.ok(modules.size > 1, 'the walk did not follow the reader\'s own imports')
  for (const [file, found] of modules) {
    const name = file.slice(dirname(READER).length + 1)
    for (const specifier of found.specifiers) assert.ok(!['node:os', 'os'].includes(specifier), `${name} imports ${specifier}`)
    assert.deepEqual(found.dynamic, [], `${name} loads a module by a route its imports do not show: ${found.dynamic.join(', ')}`)
  }
})

test('the owner\'s act refuses where there is no terminal, and keeps nothing (martha#731)', (t) => {
  const { env } = aMachine(t, undefined)
  const ran = spawnSync(process.execPath, [KEEP], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...env, MARTHA_LAB_HOSTS: JSON.stringify([aFamily()]) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  assert.equal(ran.status, 1, said(ran))
  assert.match(ran.stderr, /this is no terminal/)
  assert.equal(existsSync(dirname(labFamiliesFileIn(env)!)), false)
})

test('the file is found under XDG_CONFIG_HOME when it is absolute, else under HOME\'s .config, else nowhere (martha#731)', () => {
  const config = join(tmpdir(), 'xdg-config')
  const home = join(tmpdir(), 'home')
  const under = (folder: string) => join(folder, 'martha', 'lab_families.json')
  assert.equal(labFamiliesFileIn({ XDG_CONFIG_HOME: config, HOME: home }), under(config))
  assert.equal(labFamiliesFileIn({ XDG_CONFIG_HOME: 'relative', HOME: home }), under(join(home, '.config')))
  assert.equal(labFamiliesFileIn({ HOME: home }), under(join(home, '.config')))
  assert.equal(labFamiliesFileIn({ HOME: 'relative' }), undefined)
  assert.equal(labFamiliesFileIn({}), undefined)
})
