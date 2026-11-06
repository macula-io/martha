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

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
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

/** Starts a registry serving these packages on 127.0.0.1. */
export async function fakeMeshRegistry(packages: readonly FakePackage[]): Promise<FakeRegistry> {
  const served = new Map<string, { pkg: FakePackage; tarball: Uint8Array }>()
  for (const pkg of packages) served.set(pkg.name, { pkg, tarball: pack(pkg) })
  let count = 0
  let base = ''

  const packument = (pkg: FakePackage, tarball: Uint8Array) => ({
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
  })

  const server: Server = createServer((request, response) => {
    count++
    const path = decodeURIComponent((request.url ?? '/').slice(1))
    const asTarball = [...served.values()].find(({ pkg }) => path === `${pkg.name}/-/${tarballName(pkg)}`)
    if (asTarball !== undefined) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(asTarball.tarball)
      return
    }
    const asPackument = served.get(path)
    if (asPackument !== undefined) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(packument(asPackument.pkg, asPackument.tarball)))
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`

  return {
    registry: base,
    tarballOf: (name) => {
      const found = served.get(name)
      if (found === undefined) throw new Error(`the fake registry serves no ${name}`)
      return found.tarball
    },
    swap: (other) => void served.set(other.name, { pkg: other, tarball: pack(other) }),
    requests: () => count,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
