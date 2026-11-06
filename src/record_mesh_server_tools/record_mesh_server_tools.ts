// Records one version of the mesh server: its bins and the tools it registers,
// from its published package, beside every version already recorded (martha#49).
//
//   npm pack @macula-io/mcp@<version>; tar -xzf <the .tgz>
//   npm run record:mesh-tools -- <the extracted package directory> <its server bin>
//
// The server bin is the one bin of the package that is the MCP server (for
// @macula-io/mcp, macula-mcp); the others are its own tools, which no member
// may start. It is named here by whoever records, never guessed, and shows in
// the reviewed record.
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

const [directory, serverBin] = argv.slice(2)
if (directory === undefined || serverBin === undefined) {
  stderr.write('usage: record_mesh_server_tools.ts <extracted package directory> <its server bin>\n')
  exit(2)
}

const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name: string; version: string; bin?: string | Record<string, string> }
const files = (readdirSync(directory, { recursive: true, encoding: 'utf8' }) as string[])
  .filter((file) => file.endsWith(CODE))
  .sort()
const sources = files.map((file) => ({ path: relative(directory, join(directory, file)), text: readFileSync(join(directory, file), 'utf8') }))

const current = JSON.parse(readFileSync(RECORDING, 'utf8')) as MeshServerRecording
writeFileSync(RECORDING, `${JSON.stringify(withRecordedVersion(current, manifest, registeredToolsIn(sources), serverBin), null, 2)}\n`)
