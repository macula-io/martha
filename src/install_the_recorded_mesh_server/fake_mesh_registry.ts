// Test fixtures only: an npm registry on the loopback that serves a stand-in
// mesh server and one dependency (martha#65).
//
// A test cannot reach the real registry, and must not: what it proves is which
// bytes npm takes, so it needs a registry it can make lie. This one serves the
// packuments and tarballs npm asks for, counts every request, and can swap the
// bytes of one tarball for others under the same name and version, which is
// what a substituted registry or a poisoned mirror does. The tarballs are
// built with tar from files the test writes, so nothing here runs package
// code. No shipped code imports it.
//
// It serves from a process of its own: the code under test runs npm with
// spawnSync, which holds this process's event loop until npm ends, so a server
// in it could never answer.

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** One package the registry serves: its manifest and its files, by path inside the package. */
export interface FakePackage {
  readonly name: string
  readonly version: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly bin?: Readonly<Record<string, string>>
  readonly files: Readonly<Record<string, string>>
}

export interface FakeRegistry {
  /** The registry's URL, ending in a slash as npm writes it. */
  readonly registry: string
  /** The tarball the registry serves for one package, as `npm pack` would hand it over. */
  tarballOf(name: string): Uint8Array
  /** Serve other bytes for this package from now on, under the same name and version. */
  swap(other: FakePackage): void
  /** How many requests reached this registry. */
  requests(): number
  stop(): Promise<void>
}

/** The SRI string npm writes for a tarball. */
export const sha512Of = (bytes: Uint8Array): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

/** The file a package's packument is served from, inside its directory. */
const PACKUMENT = 'packument.json'

const tarballName = (pkg: FakePackage): string => `${pkg.name.replace(/^@[^/]+\//, '')}-${pkg.version}.tgz`

/** A tarball with every file under `package/`, as npm packs one. */
function pack(pkg: FakePackage): Uint8Array {
  const work = mkdtempSync(join(tmpdir(), 'martha-fake-pkg-'))
  try {
    const root = join(work, 'package')
    const manifest = { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies ?? {}, bin: pkg.bin }
    const files = { ...pkg.files, 'package.json': JSON.stringify(manifest, null, 2) }
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    const out = join(work, 'out.tgz')
    execFileSync('tar', ['-czf', out, '-C', work, 'package'])
    return readFileSync(out)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// The server, run by `node -e`: it serves the directory given, a path as a file
// or as that directory's packument, logs one line per request, and prints its
// port once it listens.
const SERVE = `
const { createServer } = require('node:http')
const { appendFileSync, existsSync, readFileSync, statSync } = require('node:fs')
const { join } = require('node:path')
const [root, log] = process.argv.slice(1)
const fileOf = (path) => {
  const asFile = join(root, path)
  if (existsSync(asFile) && statSync(asFile).isFile()) return asFile
  const asPackument = join(asFile, '${PACKUMENT}')
  return existsSync(asPackument) ? asPackument : undefined
}
const server = createServer((request, response) => {
  appendFileSync(log, request.url + '\\n')
  const file = fileOf(decodeURIComponent((request.url || '/').slice(1)))
  if (file === undefined) { response.writeHead(404); response.end(); return }
  response.writeHead(200)
  response.end(readFileSync(file))
})
server.listen(0, '127.0.0.1', () => console.log(server.address().port))
`

/** Starts a registry serving these packages on 127.0.0.1, from a process of its own. */
export async function fakeMeshRegistry(packages: readonly FakePackage[]): Promise<FakeRegistry> {
  const dir = mkdtempSync(join(tmpdir(), 'martha-fake-registry-'))
  const root = join(dir, 'served')
  const log = join(dir, 'requests')
  writeFileSync(log, '')
  const child = spawn(process.execPath, ['-e', SERVE, root, log], { stdio: ['ignore', 'pipe', 'inherit'] })
  const [port] = await new Promise<string[]>((resolve, reject) => {
    child.once('error', reject)
    createInterface({ input: child.stdout }).once('line', (line) => resolve([line]))
  })
  const base = `http://127.0.0.1:${String(port)}/`

  const tarballs = new Map<string, Uint8Array>()
  const serve = (pkg: FakePackage): void => {
    const tarball = pack(pkg)
    tarballs.set(pkg.name, tarball)
    const at = join(root, pkg.name)
    mkdirSync(join(at, '-'), { recursive: true })
    writeFileSync(join(at, '-', tarballName(pkg)), tarball)
    const packument = {
      name: pkg.name,
      'dist-tags': { latest: pkg.version },
      versions: {
        [pkg.version]: {
          name: pkg.name,
          version: pkg.version,
          dependencies: pkg.dependencies ?? {},
          bin: pkg.bin,
          dist: { tarball: `${base}${pkg.name}/-/${tarballName(pkg)}`, integrity: sha512Of(tarball) },
        },
      },
    }
    writeFileSync(join(at, PACKUMENT), JSON.stringify(packument))
  }
  for (const pkg of packages) serve(pkg)

  return {
    registry: base,
    tarballOf: (name) => {
      const found = tarballs.get(name)
      if (found === undefined) throw new Error(`the fake registry serves no ${name}`)
      return found
    },
    swap: serve,
    requests: () => readFileSync(log, 'utf8').split('\n').filter((line) => line !== '').length,
    stop: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGKILL')
        await exited
      }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
