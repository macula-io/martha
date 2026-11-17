// Run: node carry_marthas_own_node/record_the_node_runtime.ts <X.Y.Z>
//
// Writes the_node_runtime.json for Node <X.Y.Z>: nodejs.org's own sha256 of each platform's archive, read from that
// release's SHASUMS256.txt. The pin is changed by running this with the new version and committing the result, so
// no hash is ever typed in. Exit 0 written, 1 a platform's archive is not in that release, 2 the list could not be
// fetched or the version is not X.Y.Z.

import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { archiveOf, NODE_SHASUMS, PLATFORMS, THE_NODE_RUNTIME_FILE, urlOf, VERSION, type NodeRuntime, type Platform } from './the_node_runtime.ts'

/** Each platform's sha256 from a SHASUMS256.txt of `version`, or the platforms it has no line for. */
export function hashesFrom(shasums: string, version: string): Pick<NodeRuntime, 'archives'> | { readonly missing: readonly Platform[] } {
  const byFile = new Map(shasums.split('\n').map((line) => line.trim().split(/\s+/)).filter((words) => words.length === 2).map(([hash, file]) => [file, hash]))
  const missing = PLATFORMS.filter((platform) => !byFile.has(archiveOf(version, platform).file))
  if (missing.length > 0) return { missing }
  return { archives: Object.fromEntries(PLATFORMS.map((platform) => [platform, { sha256: byFile.get(archiveOf(version, platform).file) as string }])) as NodeRuntime['archives'] }
}

async function main(version: string | undefined): Promise<number> {
  if (version === undefined || !VERSION.test(version)) {
    console.error('usage: node carry_marthas_own_node/record_the_node_runtime.ts <X.Y.Z>')
    return 2
  }
  const answer = await fetch(urlOf(version, NODE_SHASUMS))
  if (!answer.ok) {
    console.error(`record_the_node_runtime: ${urlOf(version, NODE_SHASUMS)} answered ${answer.status}`)
    return 2
  }
  const hashes = hashesFrom(await answer.text(), version)
  if ('missing' in hashes) {
    console.error(`record_the_node_runtime: Node ${version} has no archive for ${hashes.missing.join(', ')}`)
    return 1
  }
  writeFileSync(THE_NODE_RUNTIME_FILE, `${JSON.stringify({ version, archives: hashes.archives }, null, 2)}\n`)
  console.log(`record_the_node_runtime: ${fileURLToPath(THE_NODE_RUNTIME_FILE)} pins Node ${version}`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv[2])
