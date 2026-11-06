// Records the tools one version of the mesh server registers, from its
// published package, beside every version already recorded (martha#49).
//
//   npm pack @macula-io/mcp@<version>; tar -xzf <the .tgz>
//   npm run record:mesh-tools -- <the extracted package directory>
//
// Run it for each version a member may install; the coverage check then names
// any tool a recorded version registers that nobody has decided to allow or
// refuse. A version nobody installs any more is retired by removing its record
// from the recording in a reviewed commit. The package is read as text only:
// nothing in it runs.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { argv, exit, stderr } from 'node:process'

import { registeredToolsIn, withRecordedVersion, type MeshServerRecording } from '../read_a_room_through_its_gate/mesh_server_tools.ts'

const RECORDING = new URL('../read_a_room_through_its_gate/recorded_mesh_server_tools.json', import.meta.url)
const CODE = '.js'

const [directory] = argv.slice(2)
if (directory === undefined) {
  stderr.write('usage: record_mesh_server_tools.ts <extracted package directory>\n')
  exit(2)
}

const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name: string; version: string }
const files = (readdirSync(directory, { recursive: true, encoding: 'utf8' }) as string[])
  .filter((file) => file.endsWith(CODE))
  .sort()
const sources = files.map((file) => ({ path: relative(directory, join(directory, file)), text: readFileSync(join(directory, file), 'utf8') }))

const current = JSON.parse(readFileSync(RECORDING, 'utf8')) as MeshServerRecording
writeFileSync(RECORDING, `${JSON.stringify(withRecordedVersion(current, manifest, registeredToolsIn(sources)), null, 2)}\n`)
