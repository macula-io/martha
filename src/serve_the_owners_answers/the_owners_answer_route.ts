// The route an owner's answer takes to the launch that holds the ask (macula-io/martha#541, package 9a).
//
// This exists so `martha answer`, typed at the owner's terminal, reaches the launcher that holds a Goose member's open
// asks (../hear_an_acp_agents_asks). Nothing new listens on the network: the launch serves a Unix socket, mode 0600,
// in a directory of its own that only the owner's user may enter. The crew's place keeps one small record per member
// that says where that socket is, so `martha answer` finds it from the checkout.
//
// What crosses the socket is one line of JSON each way: a request for the open asks, or one answer (a key, a closed
// verb, and the id of the owner act's record). An answer is never a command: the verb is one of two words, and the key
// only names an ask the launch already holds, so a guessed key answers nothing.
//
// A SPEED BUMP, said plainly (DECIDED 2026-11-18 "Speed bumps, said plainly"). A member runs as the owner's own OS
// user, so it can read the route record and write to the socket itself, skipping `martha answer` and its refusal. The
// mode bits keep out other users only. An answer no `martha answer` recorded is applied and kept as such
// (`owner_act: false`), so it shows; but that catches only an answer sent to the socket without the record. The record,
// owner_answers.jsonl, and the entry that says where an act was typed are the owner's own user's files too, so a member
// that writes the socket can append a matching line first, and then nothing shows.

import { chmodSync, lstatSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createConnection, createServer, type Server } from 'node:net'
import { dirname, join } from 'node:path'
import { getuid } from 'node:process'
import { randomUUID } from 'node:crypto'

import { THE_OWNERS_ANSWERS, whyTheSocketsPlaceIsOpen, type AnAnswerHeard, type AnOpenAsk, type TheOwnersAsks, type WhatAnAnswerDid } from '../hear_an_acp_agents_asks/hear_an_acp_agents_asks.ts'

/** The socket's mode: only the owner's user reads or writes it. */
export const THE_ANSWER_SOCKETS_MODE = 0o600

/** The crew's place the route records are kept in, one per member. */
export const THE_ANSWER_ROUTES_PLACE = 'owner-answers'

/** A route record's name ends with this, after the member's name. */
export const A_ROUTE_RECORDS_ENDING = '.route.json'

/** The longest line either side reads: an answer or a list of asks, never a stream. */
export const THE_LONGEST_LINE = 1024 * 1024

/** How long `martha answer` waits for a launch to answer before it says the launch did not. */
export const THE_ROUTES_WAIT_MS = 5000

const PERMISSION_BITS = 0o777

/** What `martha answer` asks a launch. */
export type AnAskOfTheRoute = { readonly open: 1 } | { readonly answer: AnAnswerHeard }

/** What a launch answers. */
export type TheRoutesReply = { readonly open: readonly AnOpenAsk[] } | { readonly did: WhatAnAnswerDid } | { readonly refused: string }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** One line read as an ask of the route, or why it is not one. */
export function anAskOfTheRouteIn(line: string): AnAskOfTheRoute | { readonly refused: string } {
  let held: unknown
  try {
    held = JSON.parse(line)
  } catch {
    return { refused: 'the line is not JSON' }
  }
  if (!isObject(held)) return { refused: 'the line is not an object' }
  if (held['open'] === 1 && Object.keys(held).length === 1) return { open: 1 }
  const answer = held['answer']
  if (!isObject(answer) || Object.keys(held).length !== 1) return { refused: 'the line asks for neither the open asks nor one answer' }
  return anAnswerIn(answer)
}

/** One answer's fields read, or why they are not one. */
function anAnswerIn(answer: Record<string, unknown>): AnAskOfTheRoute | { readonly refused: string } {
  const { key, answer: verb, act } = answer
  if (typeof key !== 'string' || key === '') return { refused: 'the answer names no key' }
  if (!(THE_OWNERS_ANSWERS as readonly unknown[]).includes(verb)) return { refused: `the answer is not one of ${THE_OWNERS_ANSWERS.join(' or ')}` }
  if (act !== undefined && typeof act !== 'string') return { refused: 'the answer names its owner act by something that is not an id' }
  return { answer: { key, answer: verb as AnAnswerHeard['answer'], ...(act === undefined ? {} : { act }) } }
}

/** The reply a launch gives one line. */
export function theReplyTo(asks: TheOwnersAsks, line: string): TheRoutesReply {
  const asked = anAskOfTheRouteIn(line)
  if ('refused' in asked) return asked
  if ('open' in asked) return { open: asks.open() }
  return { did: asks.answer(asked.answer) }
}

/** The route a launch serves, as it runs. */
export interface TheRouteServed {
  readonly socket_path: string
  close(): Promise<void>
}

/**
 * Serves `asks` on a new socket at `socket_path`, inside a directory the launch made for itself. That directory is judged
 * before anything listens: this user's own, mode 0700, never a link. The socket is made 0600 before the route is handed
 * back, and a path already there is refused, never reused.
 */
export async function serveTheOwnersAnswers(socket_path: string, asks: TheOwnersAsks): Promise<TheRouteServed | { readonly refusal: string }> {
  const place = dirname(socket_path)
  const seen = lstatSync(place, { throwIfNoEntry: false })
  const open = whyTheSocketsPlaceIsOpen(place, seen && { is_directory: seen.isDirectory(), uid: seen.uid, mode: seen.mode }, getuid?.() ?? -1)
  if (open !== undefined) return { refusal: `the answer route is not served: ${open}` }
  if (lstatSync(socket_path, { throwIfNoEntry: false }) !== undefined) return { refusal: `the answer route is not served: ${socket_path} is already there` }
  const server: Server = createServer((socket) => {
    let buffered = ''
    socket.setEncoding('utf8')
    socket.on('error', () => socket.destroy())
    socket.on('data', (chunk: string) => {
      buffered += chunk
      const end = buffered.indexOf('\n')
      if (end === -1 && buffered.length <= THE_LONGEST_LINE) return
      const reply: TheRoutesReply = end === -1 ? { refused: `the line is longer than ${THE_LONGEST_LINE} bytes` } : theReplyTo(asks, buffered.slice(0, end))
      socket.end(`${JSON.stringify(reply)}\n`)
      socket.removeAllListeners('data')
    })
  })
  const listening = await new Promise<Error | undefined>((settle) => {
    server.once('error', settle)
    server.listen(socket_path, () => settle(undefined))
  })
  if (listening !== undefined) return { refusal: `the answer route is not served at ${socket_path}: ${listening.message}` }
  const close = (): Promise<void> => new Promise((settle) => server.close(() => settle()))
  try {
    chmodSync(socket_path, THE_ANSWER_SOCKETS_MODE)
  } catch (error) {
    await close()
    return { refusal: `the answer route is not served: ${socket_path} could not be made ${THE_ANSWER_SOCKETS_MODE.toString(8)} (${(error as Error).message})` }
  }
  if ((lstatSync(socket_path).mode & PERMISSION_BITS) !== THE_ANSWER_SOCKETS_MODE) {
    await close()
    return { refusal: `the answer route is not served: ${socket_path} is not mode ${THE_ANSWER_SOCKETS_MODE.toString(8)}` }
  }
  return { socket_path, close }
}

/** One ask sent to the launch whose socket is `socket_path`, and its reply; or why there is none. */
export function askTheRoute(socket_path: string, asked: AnAskOfTheRoute, wait_ms: number = THE_ROUTES_WAIT_MS): Promise<TheRoutesReply | { readonly unreachable: string }> {
  return new Promise((settle) => {
    let buffered = ''
    let done = false
    const finish = (reply: TheRoutesReply | { readonly unreachable: string }): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      settle(reply)
    }
    const socket = createConnection(socket_path)
    const timer = setTimeout(() => finish({ unreachable: `the launch did not answer within ${wait_ms / 1000}s` }), wait_ms)
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify(asked)}\n`))
    socket.on('error', (error) => finish({ unreachable: error.message }))
    socket.on('data', (chunk: string) => {
      buffered += chunk
      if (buffered.length > THE_LONGEST_LINE) finish({ unreachable: `the launch's reply is longer than ${THE_LONGEST_LINE} bytes` })
    })
    socket.on('end', () => {
      try {
        const reply = JSON.parse(buffered.trim()) as unknown
        finish(isObject(reply) ? (reply as TheRoutesReply) : { unreachable: 'the launch replied with something that is not an object' })
      } catch {
        finish({ unreachable: 'the launch replied with something that is not JSON' })
      }
    })
  })
}

/** Where one member's route is: its socket, and the launcher's pid that serves it. */
export interface ARouteRecord {
  readonly member: string
  readonly socket_path: string
  readonly pid: number
}

/** The record file of `member` in the crew's place `routes`. */
export const theRouteRecordOf = (routes: string, member: string): string => join(routes, `${member}${A_ROUTE_RECORDS_ENDING}`)

/** Keeps where `record.member`'s route is, whole: staged, then renamed into place, mode 0600. */
export function keepTheRoute(routes: string, record: ARouteRecord): void {
  const staged = join(routes, `.staging-${randomUUID()}`)
  writeFileSync(staged, `${JSON.stringify(record)}\n`, { mode: THE_ANSWER_SOCKETS_MODE, flag: 'wx' })
  renameSync(staged, theRouteRecordOf(routes, record.member))
}

/** Forgets `member`'s route, when its launch ends; a record already gone is no error. */
export function forgetTheRoute(routes: string, member: string): void {
  try {
    unlinkSync(theRouteRecordOf(routes, member))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** The route `member`'s record names, or why it cannot be read: a record that is not one is not followed. */
export function theRouteOf(routes: string, member: string): ARouteRecord | { readonly why: string } {
  const at = theRouteRecordOf(routes, member)
  const read = theRecordAt(at, member)
  if ('why' in read) return read
  const { held } = read
  if (!isObject(held) || held['member'] !== member || typeof held['socket_path'] !== 'string' || typeof held['pid'] !== 'number') return { why: `${at} is not a route record` }
  return { member, socket_path: held['socket_path'], pid: held['pid'] }
}

/** What the record file at `at` holds, parsed; or why it is not read: missing, open to others, or not JSON. */
function theRecordAt(at: string, member: string): { readonly held: unknown } | { readonly why: string } {
  try {
    const found = lstatSync(at)
    if (!found.isFile() || (found.mode & PERMISSION_BITS) !== THE_ANSWER_SOCKETS_MODE) return { why: `${at} is not a file only this user reads` }
    return { held: JSON.parse(readFileSync(at, 'utf8')) as unknown }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { why: code === 'ENOENT' ? `${member} serves no answer route: no Goose launch of that member is running` : `${at} cannot be read (${code ?? (error as Error).message})` }
  }
}

/** Every member with a route record in `routes`, by name, sorted; none when the place holds none. */
export function theMembersWithARoute(routes: string): readonly string[] {
  let names: string[]
  try {
    names = readdirSync(routes)
  } catch {
    return []
  }
  return names.filter((name) => name.endsWith(A_ROUTE_RECORDS_ENDING)).map((name) => name.slice(0, -A_ROUTE_RECORDS_ENDING.length)).sort()
}

/** The record `martha answer` keeps of each answer it sends, in the project's state, before it sends it. */
export const THE_OWNERS_ANSWERS_FILE = 'owner_answers.jsonl'

/** One answer the owner typed, as `martha answer` records it. */
export interface AnAnswerTyped {
  readonly act: string
  readonly member: string
  readonly key: string
  readonly answer: AnAnswerHeard['answer']
  readonly at: string
}

/** The line `martha answer` keeps for one answer. */
export const theLineOfAnAnswer = (typed: AnAnswerTyped): string => JSON.stringify(typed)

/**
 * Whether an answer `member`'s launch heard was typed with `martha answer`: a line of the record, `text`, names the
 * same act, member, key and answer. An answer naming no act, or an act the record does not hold, has none behind it.
 */
export function anOwnerActStandsBehind(text: string, member: string, heard: AnAnswerHeard): boolean {
  if (heard.act === undefined) return false
  return text.split('\n').some((line) => {
    try {
      const typed = JSON.parse(line) as Partial<AnAnswerTyped>
      return typed.act === heard.act && typed.member === member && typed.key === heard.key && typed.answer === heard.answer
    } catch {
      return false
    }
  })
}
