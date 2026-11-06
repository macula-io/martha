// The release layer, unpacked (martha#21). The gzip tar is read whole and EVERY entry is checked before a single
// byte is written. First the caps, each a refusal by name:
//   unpacked size   at most 256 MiB, as gunzip's own maxOutputLength: a larger stream is refused, never truncated;
//   entries         at most 4096 headers, pax and GNU long-name records included;
//   names           a path of at most 1024 bytes and each part of at most 255, measured after pax and GNU long names
//                   are applied; a pax record or long name over 1024 bytes is refused before it is parsed.
// Then the entries: only regular files, directories and symlinks; no absolute path, no '..' (refused, never
// stripped), no whiteout, one top-level martha/; a symlink's target relative and, followed part by part through every
// link in the package, never leaving martha/ even for a step, in at most 40 links (as the kernel allows); no entry
// under a symlink, no entry twice. Directories are made first, then files, then symlinks, so nothing is ever written
// through a link. Modes are 0644 and 0755 (an executable bit in the header), and the tree is made read-only once it
// is whole.
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { refuse } from '../refuse_in_words/refuse_in_words.mjs'

export const UNPACK_LIMITS = Object.freeze({
  unpackedBytes: 256 * 1024 * 1024,
  entries: 4096,
  pathBytes: 1024,
  partBytes: 255,
  linkHops: 40
})

const BLOCK = 512
export const TOP = NAMES.releaseFolder
/** @type {Record<string, 'file' | 'dir' | 'symlink'>} */
const KINDS = { 0: 'file', '': 'file', 5: 'dir', 2: 'symlink' }

/**
 * @typedef {{ path: string, kind: 'file' | 'dir' | 'symlink', mode: number, target: string, body: Buffer }} Entry
 * @typedef {{ path?: string, linkpath?: string }} Pending
 */

/** @param {Buffer} block @param {number} at @param {number} length */
const text = (block, at, length) => {
  const raw = block.subarray(at, at + length)
  const end = raw.indexOf(0)
  return raw.subarray(0, end < 0 ? raw.length : end).toString('utf8')
}

/** @param {Buffer} block @param {number} at @param {number} length @param {string} what */
const octal = (block, at, length, what) => {
  if ((block[at] ?? 0) & 0x80) refuse(`the package uses a binary ${what}; refused`)
  const digits = text(block, at, length).trim()
  if (!/^[0-7]*$/.test(digits)) refuse(`the package has a malformed ${what} (${digits}); refused`)
  return digits === '' ? 0 : parseInt(digits, 8)
}

/** @param {Buffer} block */
function checksumHolds (block) {
  const stored = octal(block, 148, 8, 'checksum')
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0)
  return sum === stored
}

/**
 * A long name (a pax record or a GNU L/K body) over the path cap is refused before it is parsed.
 * @param {Buffer} body
 * @param {string} what
 */
const withinNameCap = (body, what) => {
  if (body.length > UNPACK_LIMITS.pathBytes) refuse(`the package carries a ${what} of ${body.length} bytes, over the ${UNPACK_LIMITS.pathBytes} a name may have; refused`)
  return body
}

/**
 * pax records, "<len> <key>=<value>\n" each: only path and linkpath matter, the rest (times, owners) is dropped.
 * @param {Buffer} body
 * @returns {Record<string, string>}
 */
function paxRecords (body) {
  /** @type {Record<string, string>} */
  const found = {}
  let at = 0
  while (at < body.length) {
    const space = body.indexOf(0x20, at)
    const length = parseInt(body.subarray(at, space).toString('ascii'), 10)
    if (space < 0 || !(length > 0) || at + length > body.length) refuse('the package has a malformed pax header; refused')
    const record = body.subarray(space + 1, at + length - 1).toString('utf8')
    const eq = record.indexOf('=')
    found[record.slice(0, eq)] = record.slice(eq + 1)
    at += length
  }
  return found
}

/** @param {Record<string, string>} records @returns {Pending} */
const pick = ({ path, linkpath }) => ({ ...(path !== undefined && { path }), ...(linkpath !== undefined && { linkpath }) })

/**
 * One header: a name-carrying header (pax x, GNU L/K) feeds the next entry; any other is an entry itself.
 * @param {{ block: Buffer, body: Buffer, pending: Pending, entries: Entry[] }} header
 * @returns {Pending}
 */
function headerEntry ({ block, body, pending, entries }) {
  const flag = String.fromCharCode(block[156] ?? 0).replace('\0', '')
  if (flag === 'x') return { ...pending, ...pick(paxRecords(withinNameCap(body, 'pax header'))) }
  if (flag === 'L') return { ...pending, path: text(withinNameCap(body, 'long name'), 0, body.length) }
  if (flag === 'K') return { ...pending, linkpath: text(withinNameCap(body, 'long link name'), 0, body.length) }
  const kind = KINDS[flag]
  if (!kind) refuse(`the package holds an entry of tar type '${flag}', which is neither a file, a directory nor a link; refused`)
  const prefix = text(block, 345, 155)
  const name = pending.path ?? (prefix ? `${prefix}/${text(block, 0, 100)}` : text(block, 0, 100))
  const target = pending.linkpath ?? text(block, 157, 100)
  entries.push({ path: name, kind, mode: octal(block, 100, 8, 'mode'), target, body })
  return {}
}

/**
 * Every entry of the tar, names resolved; refused past UNPACK_LIMITS.entries headers.
 * @param {Buffer} tar
 * @returns {Entry[]}
 */
export function readEntries (tar) {
  /** @type {Entry[]} */
  const entries = []
  /** @type {Pending} */
  let pending = {}
  let headers = 0
  let at = 0
  while (at + BLOCK <= tar.length) {
    const block = tar.subarray(at, at + BLOCK)
    if (block.every((b) => b === 0)) return entries
    headers += 1
    if (headers > UNPACK_LIMITS.entries) refuse(`the package holds more than ${UNPACK_LIMITS.entries} tar headers; refused`)
    if (!checksumHolds(block)) refuse('the package has a tar header whose checksum does not hold; refused')
    const size = octal(block, 124, 12, 'size')
    const body = tar.subarray(at + BLOCK, at + BLOCK + size)
    if (body.length !== size) refuse('the package is a truncated tar; refused')
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK
    pending = headerEntry({ block, body, pending, entries })
  }
  return refuse('the package tar has no end; refused')
}

/**
 * A name as written: './' and empty parts dropped. Absolute names and '..' are refused, never stripped; a name past
 * the path or part cap is refused.
 * @param {string} name
 */
export function cleanPath (name) {
  if (Buffer.byteLength(name) > UNPACK_LIMITS.pathBytes) refuse(`the package names a path of ${Buffer.byteLength(name)} bytes, over the ${UNPACK_LIMITS.pathBytes} a path may have; refused`)
  if (name.startsWith('/')) refuse(`the package names an absolute path (${name}); refused`)
  const parts = name.split('/').filter((p) => p !== '' && p !== '.')
  const long = parts.find((p) => Buffer.byteLength(p) > UNPACK_LIMITS.partBytes)
  if (long !== undefined) refuse(`the package names a path part of ${Buffer.byteLength(long)} bytes, over the ${UNPACK_LIMITS.partBytes} a part may have; refused`)
  if (parts.includes('..')) refuse(`the package names a path through '..' (${name}); refused`)
  if (parts.length === 0) return ''
  if (parts[0] !== TOP) refuse(`the package holds ${name}, outside ${TOP}/; refused`)
  if (parts.some((p) => p.startsWith('.wh.'))) refuse(`the package holds a whiteout (${name}); refused`)
  return parts.join('/')
}

/** @param {string} path */
const ancestors = (path) => path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))

/** @param {string} path @param {string} target */
function checkLink (path, target) {
  if (target === '' || target.startsWith('/')) refuse(`the package links ${path} to ${target || 'nothing'}, not a relative path; refused`)
}

/**
 * A link's target walked as the kernel walks it: part by part from the link's folder, following every link of the
 * plan it passes through. A '..' that would leave martha/ is refused at that step, so no detour outside counts as
 * inside; more than UNPACK_LIMITS.linkHops links followed, this one counted, is refused as the kernel refuses it
 * (ELOOP), which also ends any cycle.
 * @param {Map<string, Entry>} plan
 * @param {Entry} link
 */
function walkLink (plan, link) {
  const outside = () => refuse(`the package links ${link.path} outside ${TOP}/ (${link.target}); refused`)
  let at = posix.dirname(link.path).split('/')
  const rest = link.target.split('/')
  // The link being walked is the first the kernel follows.
  let hops = 1
  for (let part = rest.shift(); part !== undefined; part = rest.shift()) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (at.length === 1) outside()
      at = at.slice(0, -1)
      continue
    }
    at = [...at, part]
    const through = plan.get(at.join('/'))
    if (through?.kind !== 'symlink') continue
    hops += 1
    if (hops > UNPACK_LIMITS.linkHops) refuse(`the package links ${link.path} through more than ${UNPACK_LIMITS.linkHops} links; refused`)
    at = at.slice(0, -1)
    rest.unshift(...through.target.split('/'))
  }
}

/**
 * The entries to write, every one checked: the plan, before anything touches the disk.
 * @param {Entry[]} entries
 */
export function planEntries (entries) {
  /** @type {Map<string, Entry>} */
  const plan = new Map()
  for (const entry of entries) {
    const path = cleanPath(entry.path)
    if (path === '') continue
    if (plan.has(path)) refuse(`the package holds ${path} twice; refused`)
    if (entry.kind === 'symlink') checkLink(path, entry.target)
    plan.set(path, { ...entry, path })
  }
  if (plan.get(TOP)?.kind === 'symlink') refuse(`the package's ${TOP} is a link; refused`)
  for (const link of plan.values()) if (link.kind === 'symlink') walkLink(plan, link)
  for (const path of plan.keys()) {
    const under = ancestors(path).find((a) => plan.get(a)?.kind === 'symlink')
    if (under) refuse(`the package writes ${path} under the link ${under}; refused`)
  }
  if (plan.size === 0) refuse(`the package holds no ${TOP}/; refused`)
  return [...plan.values()]
}

/**
 * The gzip stream unpacked, refused (never truncated) past UNPACK_LIMITS.unpackedBytes.
 * @param {Buffer} gzipped
 */
export function gunzipCapped (gzipped) {
  try {
    return gunzipSync(gzipped, { maxOutputLength: UNPACK_LIMITS.unpackedBytes })
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code
    if (code === 'ERR_BUFFER_TOO_LARGE') refuse(`the package unpacks to more than ${UNPACK_LIMITS.unpackedBytes} bytes; refused`)
    return refuse('the package is not a gzip stream; refused')
  }
}

/**
 * Files 0444/0555, then directories 0555 deepest first, so the release cannot be changed by accident.
 * @param {string} stage
 * @param {Entry[]} plan
 */
async function readOnly (stage, plan) {
  for (const file of plan.filter((e) => e.kind === 'file')) await chmod(join(stage, file.path), file.mode & 0o111 ? 0o555 : 0o444)
  const dirs = new Set([TOP, ...plan.flatMap((e) => ancestors(e.path)), ...plan.filter((e) => e.kind === 'dir').map((e) => e.path)])
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) await chmod(join(stage, dir), 0o555)
}

/**
 * The layer unpacked into `stage` (an empty directory), checked first, then made read-only.
 * @param {Buffer} gzipped
 * @param {string} stage
 */
export async function unpackLayer (gzipped, stage) {
  const plan = planEntries(readEntries(gunzipCapped(gzipped)))
  /** @param {Entry['kind']} kind */
  const of = (kind) => plan.filter((e) => e.kind === kind)
  await mkdir(join(stage, TOP), { recursive: true })
  for (const dir of of('dir')) await mkdir(join(stage, dir.path), { recursive: true })
  for (const file of of('file')) {
    await mkdir(join(stage, posix.dirname(file.path)), { recursive: true })
    await writeFile(join(stage, file.path), file.body, { flag: 'wx', mode: file.mode & 0o111 ? 0o755 : 0o644 })
  }
  for (const link of of('symlink')) {
    await mkdir(join(stage, posix.dirname(link.path)), { recursive: true })
    await symlink(link.target, join(stage, link.path))
  }
  await readOnly(stage, plan)
}
