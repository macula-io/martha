// Records one version of the mesh server: its bins, the tools it registers and
// the whole tree it installs, from its published package, beside every version
// already recorded (martha#49, #65).
//
//   npm pack @macula-io/mcp@<version>
//   npm run record:mesh-tools -- <the .tgz npm pack wrote> <its server bin>
//
// It records the tools the package registers (martha#49) and the whole tree a
// member runs (martha#65): the tarball's integrity, the settings its code
// reads, a lock of that version alone from the recorded registry, and every
// file npm installs from that lock. Both are read from the one tarball, so the
// tools and the tree are of the same bytes. It fails, naming why, when the
// tarball is not what the registry serves for its version, a setting is one
// nobody reviewed, or the lock cannot pin the tree.
//
// The server bin is the one bin of the package that is the MCP server (for
// @macula-io/mcp, macula-mcp); the others are its own tools, which no member
// may start. It is named here by whoever records, never guessed, and shows in
// the reviewed record.
//
// Run it for each version a member may install; the coverage check then names
// any tool a recorded version registers that nobody has decided to allow or
// refuse. A version nobody installs any more is retired by removing both its
// records in a reviewed commit. The package's own code is read as text only
// and never run: npm installs it with scripts off.

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { argv, exit, stderr } from 'node:process'

import { recordMeshTree } from '../install_the_recorded_mesh_server/install_the_recorded_mesh_server.ts'
import { MESH_TREE_RECORDING, withRecordedTree } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { registeredToolsIn, withRecordedVersion, type MeshServerRecording } from '../read_a_room_through_its_gate/mesh_server_tools.ts'

const TOOLS = new URL('../read_a_room_through_its_gate/recorded_mesh_server_tools.json', import.meta.url)
const TREES = new URL('../prove_the_mesh_server_bytes/recorded_mesh_server_trees.json', import.meta.url)
const CODE = '.js'

const [tarballPath, serverBin] = argv.slice(2)
if (tarballPath === undefined || serverBin === undefined) {
  stderr.write('usage: record_mesh_server_tools.ts <the .tgz npm pack wrote> <its server bin>\n')
  exit(2)
}

const scratch = mkdtempSync(join(tmpdir(), 'martha-record-mesh-'))
try {
  const tree = recordMeshTree({ tarball: readFileSync(tarballPath), recording: MESH_TREE_RECORDING, scratch })

  const directory = join(scratch, 'extracted', 'package')
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name: string; version: string; bin?: string | Record<string, string> }
  const files = (readdirSync(directory, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((file) => file.endsWith(CODE))
    .sort()
  const sources = files.map((file) => ({ path: relative(directory, join(directory, file)), text: readFileSync(join(directory, file), 'utf8') }))
  const current = JSON.parse(readFileSync(TOOLS, 'utf8')) as MeshServerRecording
  writeFileSync(TOOLS, `${JSON.stringify(withRecordedVersion(current, manifest, registeredToolsIn(sources), serverBin), null, 2)}\n`)
  writeFileSync(TREES, `${JSON.stringify(withRecordedTree(MESH_TREE_RECORDING, tree), null, 2)}\n`)
} catch (error) {
  stderr.write(`${(error as Error).message}\n`)
  exit(1)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
