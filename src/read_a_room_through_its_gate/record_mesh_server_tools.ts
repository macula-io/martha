// Re-records the tools the mesh server registers, from its published package.
//
//   npm pack @macula-io/mcp@<version>; tar -xzf <the .tgz>
//   node src/read_a_room_through_its_gate/record_mesh_server_tools.ts <the extracted package directory>
//
// Run it when the server is upgraded; the coverage check then names any tool the
// new server registers that nobody has decided to allow or refuse. The package
// is read as text only: nothing in it runs.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { argv, exit, stderr } from 'node:process'

import { registeredToolsIn, type RecordedMeshServer } from './mesh_server_tools.ts'

const RECORDING = new URL('./recorded_mesh_server_tools.json', import.meta.url)
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

const previous = JSON.parse(readFileSync(RECORDING, 'utf8')) as { _why: string }
const recorded: RecordedMeshServer & { _why: string } = {
  _why: previous._why,
  server: manifest.name,
  server_version: manifest.version,
  tools: registeredToolsIn(sources),
}
writeFileSync(RECORDING, `${JSON.stringify(recorded, null, 2)}\n`)
