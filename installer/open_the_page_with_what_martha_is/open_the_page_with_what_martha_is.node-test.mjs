// The npm page opens with what Martha is (martha#204). A person who finds @macula-io/martha on npm meets this
// package's README, not the repository's, so it must say what Martha is and how to install it before any
// maintainer's release notes. The logo, the goal line and the repository link are read from the repository's own
// README and package.json: the page states them, so a drifted copy fails here by name instead of shipping.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { NAMES } from '../keep_the_names_in_one_place/names.mjs'

const INSTALLER = dirname(dirname(fileURLToPath(import.meta.url)))
const ROOT = dirname(INSTALLER)
const RELEASE_PAGE = 'docs/how-a-release-is-made.md'
const read = (/** @type {string} */ path) => readFileSync(join(ROOT, path), 'utf8')
const page = readFileSync(join(INSTALLER, 'README.md'), 'utf8')

/** Where this repository serves a file it holds, as npm must be given it: absolute, since npm resolves nothing. */
const RAW = `${NAMES.sourceRepository.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/`

/**
 * A document as one line: markdown wraps paragraphs, the page and its source say the same thing.
 * @param {string} text
 */
const oneLine = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * What a README says Martha is: the text after its **Goal:** marker, up to the end of that paragraph.
 * @param {string} markdown
 */
function goalOf (markdown) {
  const at = markdown.indexOf('**Goal:**')
  assert.ok(at >= 0, 'the document states its goal')
  const from = markdown.slice(at + '**Goal:**'.length)
  const end = from.search(/\n\s*\n/)
  return oneLine(end < 0 ? from : from.slice(0, end))
}

/**
 * Every image URL a markdown document renders: `![](url)`, `<img src>` and `<source srcset>`.
 * @param {string} markdown
 */
function imageUrls (markdown) {
  const written = [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((match) => match[1] ?? '')
  const tagged = [...markdown.matchAll(/<(?:img|source)\b[^>]*?\b(?:src|srcset)="([^"]+)"/g)].map((match) => match[1] ?? '')
  return [...written, ...tagged]
}

/**
 * Why an image URL cannot render on npm, or '' when it can: absolute, from this repository, and an asset it holds.
 * @param {string} url
 */
function assetProblem (url) {
  if (!url.startsWith(RAW)) return `${url} is not an absolute link to this repository's raw files`
  const asset = url.split('/assets/')[1]
  if (!asset) return `${url} names no asset under assets/`
  if (!existsSync(join(ROOT, 'assets', asset))) return `${url} names an asset this repository does not hold`
  return ''
}

test('the npm page states the repository README\'s goal line, word for word', () => {
  const goal = goalOf(read('README.md'))
  assert.ok(goal.length > 20, 'the repository README has a goal line')
  assert.equal(goalOf(page), goal, 'the npm page states another goal than the repository README')
  assert.notEqual(goalOf(page.replace('one developer', 'one team')), goal, 'the comparison bites on one changed word')
})

test('every image on the npm page is absolute and is an asset this repository holds', () => {
  const urls = imageUrls(page)
  assert.ok(urls.length > 0, 'the npm page shows the logo')
  assert.deepEqual(urls.map(assetProblem).filter(Boolean), [], 'an image npm cannot show')
  assert.notEqual(assetProblem('assets/martha-full-light.svg'), '', 'a relative path is refused, because npm cannot resolve one')
  assert.notEqual(assetProblem(`${RAW}assets/not-there.svg`), '', 'an asset the repository does not hold is refused')
})

test('the npm page links to the repository the installer publishes from', () => {
  assert.ok(page.includes(`](${NAMES.sourceRepository})`), `the npm page does not link to ${NAMES.sourceRepository}`)
})

test('the page opens with the logo and the goal, and the install line follows them', () => {
  const logo = page.search(/<(?:img|source)\b/)
  const goal = page.indexOf('**Goal:**')
  const install = page.search(/\bnpx\b/)
  assert.ok(logo >= 0 && logo < goal && goal < install, `the page orders logo ${logo}, goal ${goal}, install ${install}`)
})

test('what the installer checks stays on the npm page', () => {
  assert.ok(page.includes('## What it checks, before anything is written'), 'the npm page drops what the installer checks')
  assert.ok(page.includes('npm audit signatures'), 'the npm page drops how to check the installer itself')
})

test('the release notes moved to the docs, and the npm page names the file it moved to', () => {
  assert.ok(!page.includes(NAMES.dryRunTagPrefix), 'the npm page still carries the release notes')
  assert.ok(page.includes(`\`${RELEASE_PAGE.split('/').at(-1)}\``), `the npm page does not name ${RELEASE_PAGE}`)
  assert.ok(existsSync(join(ROOT, RELEASE_PAGE)), `${RELEASE_PAGE} is not a file of this repository`)
  assert.ok(read(RELEASE_PAGE).includes(NAMES.dryRunTagPrefix), `${RELEASE_PAGE} does not hold the release notes`)
})
