// `martha install [<version>] [--downgrade] [--digest sha256:<hex>]`: the installer this release pins, and no other
// (martha#84).
//
// This exists so that a machine already running Martha upgrades only through the installer version its signed
// release pins by npm integrity: taking over the npm account cannot put a new installer in front of an installed
// user. The pin is read from the running release's own tree — never from the network, never from an argument, never
// from `current` — so the act says which installer that release was reviewed with.
//
// What it does not do: it does not install a release, verify a release signature, or decide a downgrade. All three
// stay in the installer; this act's whole job is to run that installer and not another. And it needs no terminal:
// a member with a shell can type the bootstrap line already, so the pin and the signature are what bound an install,
// never who typed it.

import { spawnSync, type StdioOptions } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'

import { runIsolatedNpm } from '../run_the_nodes_own_npm_alone/run_the_nodes_own_npm_alone.ts'

/** The pin a release carries, written by `pack_a_release/pin_the_installer` into the signed layer. */
export const PIN_FILE = 'installer.json'

/** The one registry an install may ask. Given explicitly, so no config of the machine's can name another. */
export const NPM_REGISTRY = 'https://registry.npmjs.org/'

/**
 * Where the published installer's own command sits inside its package: the bin `installer/package.json` publishes,
 * which `installer/keep_the_names_in_one_place` holds this constant to.
 */
export const INSTALLER_ENTRY = 'bin/martha-install.mjs'

/** The name the lock is made under, so every install names the same project. */
const LOCK_PROJECT = 'martha-installer-pin'
/** npm's own home for the run: its empty config files and its cache, in the temporary directory that is removed. */
const NPM_HOME = '.npm'
const NODE_MODULES = 'node_modules'
const PACKAGE_JSON = 'package.json'
const PACKAGE_LOCK = 'package-lock.json'
const INTEGRITY_FAILED = 'EINTEGRITY'
const NOT_SERVED = 'E404'

/** A release's pin: exactly three fields, and nothing else is read from it. */
export interface Pin {
  readonly name: string
  readonly version: string
  readonly integrity: string
}

/** What the act needs: the release it runs from, the words typed after it, and where its output goes. */
export interface InstallRequest {
  /** The words after `install`, passed to the installer unchanged. */
  readonly args: readonly string[]
  /** The root of the running release: its `package.json` and its pin. */
  readonly tree: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly stdio: StdioOptions
  /** The npm to run: the one beside this node, unless a test puts a stand-in in front of it. */
  readonly npm?: string
  /** The registry to ask: NPM_REGISTRY, unless a test serves the pinned bytes itself. */
  readonly registry?: string
}

/** The installer's own exit status, or why nothing was installed. */
export type InstallOutcome = { readonly status: number } | { readonly refusal: string }

const refused = (refusal: string): InstallOutcome => ({ refusal })

/** The pin's text, or why this release cannot be said to carry one. */
function pinText(tree: string): string | InstallOutcome {
  try {
    return readFileSync(join(tree, PIN_FILE), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error)
    return refused(`this release carries no readable installer pin (${PIN_FILE}: ${code}), so Martha cannot tell which installer to run; upgrade with the line in the README.`)
  }
}

/** The pin, when the text holds one; or why it does not. */
function parsePin(text: string): Pin | InstallOutcome {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return refused(`the installer pin in this release is not JSON, so Martha cannot tell which installer to run.`)
  }
  const fields = parsed as Record<string, unknown>
  for (const field of ['name', 'version', 'integrity'] as const) {
    if (typeof fields[field] !== 'string') return refused(`the installer pin in this release carries no ${field}, so Martha cannot tell which installer to run.`)
  }
  return { name: String(fields['name']), version: String(fields['version']), integrity: String(fields['integrity']) }
}

/** The installer package the running tree's own `package.json` names, or why it names none. */
function installerPackage(tree: string): string | InstallOutcome {
  try {
    const manifest = JSON.parse(readFileSync(join(tree, PACKAGE_JSON), 'utf8')) as { martha?: { installerPackage?: unknown } }
    const named = manifest.martha?.installerPackage
    return typeof named === 'string' ? named : refused(`this release's package.json names no installer package, so Martha cannot tell which installer to run.`)
  } catch {
    return refused(`this release's package.json cannot be read, so Martha cannot tell which installer to run.`)
  }
}

/** The pin this release carries, checked against the one installer name the release tree holds. */
function pinnedInstaller(tree: string): Pin | InstallOutcome {
  const text = pinText(tree)
  if (typeof text !== 'string') return text
  const pin = parsePin(text)
  if (!('name' in pin)) return pin
  const expected = installerPackage(tree)
  if (typeof expected !== 'string') return expected
  if (pin.name !== expected) return refused(`this release pins ${pin.name}, and Martha's installer is ${expected}.`)
  return pin
}

/** The tarball npm serves for a version: the name's last path segment, then the version, as npm publishes one. */
const tarballName = (pin: Pin): string => `${pin.name.slice(pin.name.lastIndexOf('/') + 1)}-${pin.version}.tgz`

/** The two files npm needs to install exactly one version, and nothing else: the manifest and the lock. */
function lockFiles(pin: Pin, registry: string): { readonly manifest: string; readonly lock: string } {
  const dependencies = { [pin.name]: pin.version }
  const project = { name: LOCK_PROJECT, version: '1.0.0', dependencies }
  const lock = {
    name: LOCK_PROJECT,
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': project,
      [`${NODE_MODULES}/${pin.name}`]: {
        version: pin.version,
        resolved: `${registry}${pin.name}/-/${tarballName(pin)}`,
        integrity: pin.integrity,
        dependencies: {},
      },
    },
  }
  return { manifest: `${JSON.stringify({ ...project, private: true }, null, 2)}\n`, lock: `${JSON.stringify(lock, null, 2)}\n` }
}

/** Why npm could not install the pinned version, in words that name which of the two cases it was. */
function whyNpmRefused(pin: Pin, why: string): string {
  const named = `${pin.name}@${pin.version}`
  if (why.includes(INTEGRITY_FAILED)) return `npm served bytes for ${named} that are not the ones this release pins; nothing was installed.`
  if (why.includes(NOT_SERVED)) return `npm does not serve ${named}, which this release pins; nothing was installed.`
  return `npm could not install ${named} (${why.split('\n').slice(0, 3).join(' ')}); nothing was installed.`
}

/** The installed installer, run with the words typed after `martha install` unchanged; its exit status. */
function runInstaller(entry: string, request: InstallRequest): InstallOutcome {
  const run = spawnSync(process.execPath, [entry, ...request.args], { stdio: request.stdio, env: request.env })
  return { status: run.status ?? 1 }
}

/** Fetches the pinned installer into `work` and runs it there; `work` is removed by the caller. */
function installingIn(work: string, pin: Pin, request: InstallRequest): InstallOutcome {
  const registry = request.registry ?? NPM_REGISTRY
  const files = lockFiles(pin, registry)
  writeFileSync(join(work, PACKAGE_JSON), files.manifest)
  writeFileSync(join(work, PACKAGE_LOCK), files.lock)
  const ran = runIsolatedNpm(['ci'], work, registry, join(work, NPM_HOME), request.npm)
  if (!ran.ran) return refused(whyNpmRefused(pin, ran.why))
  return runInstaller(join(work, NODE_MODULES, ...pin.name.split('/'), ...INSTALLER_ENTRY.split('/')), request)
}

/**
 * Runs the installer this release pins, with `request.args` unchanged; its exit status, or why nothing was
 * installed. A temporary directory holds the fetch and is removed whatever happens, as is a refusal's reason.
 */
export function installThePinnedInstaller(request: InstallRequest): InstallOutcome {
  const pin = pinnedInstaller(request.tree)
  if (!('name' in pin)) return pin
  const work = mkdtempSync(join(tmpdir(), `martha-install-${basename(request.tree)}-`))
  try {
    return installingIn(work, pin, request)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
