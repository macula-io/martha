#!/usr/bin/env bash
# prove_a_standalone_martha.sh <tarball>: proves a standalone Martha (martha#547, package S3) runs from its download
# alone, on the machine it is run on.
#
# The tarball is unpacked into a fresh directory and its command linked from a bin directory of its own, as an install
# links it. Every step runs with `env -i`, HOME a fresh directory, and PATH that bin directory, a decoy directory, then
# /usr/bin and /bin. The decoy holds a node, npm and npx that record that they were run and fail: a hosted runner, like
# many machines, has a node in /usr/bin, and a step that reached any node by PATH instead of the release's own would
# otherwise pass on it. After every step the record must be empty:
#   1. `<command> --version` prints the version of the release's own package.json;
#   2. `<command> init` declares a solo crew in a fresh git checkout, through Martha's own file writes;
#   3. the release's Node runs checks_martha_relies_on.ts from the release's own tree.
#
# Exit 0 proved, 1 a step fails, 2 the tarball could not be read.
set -euo pipefail

tarball="${1:-}"
[[ -f "${tarball}" && "${tarball}" == *.tar.gz ]] || { echo "usage: prove_a_standalone_martha.sh <release>.tar.gz" >&2; exit 2; }
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
tar -xzf "${tarball}" -C "${work}"
release="${work}/$(basename "${tarball}" .tar.gz)"
[[ -d "${release}" ]] || { echo "prove_a_standalone_martha: ${tarball} holds no $(basename "${release}")/" >&2; exit 2; }

# The release holds bin/, node/ and its tree; the command is the one file in bin/.
commands=("${release}"/bin/*)
[[ "${#commands[@]}" -eq 1 && -x "${commands[0]}" ]] || { echo "prove_a_standalone_martha: bin/ holds ${#commands[@]} files, not one command" >&2; exit 2; }
command_name="$(basename "${commands[0]}")"
folders=()
for entry in "${release}"/*/; do
  name="$(basename "${entry}")"
  [[ "${name}" == bin || "${name}" == node ]] || folders+=("${name}")
done
[[ "${#folders[@]}" -eq 1 ]] || { echo "prove_a_standalone_martha: the release holds ${#folders[@]} trees beside bin/ and node/, not one" >&2; exit 2; }
tree="${release}/${folders[0]}"

mkdir -p "${work}/bin" "${work}/decoy" "${work}/home" "${work}/project"
ln -s "${commands[0]}" "${work}/bin/${command_name}"
used="${work}/decoy-used"
for decoy in node npm npx; do
  printf '#!/bin/sh\necho "%s $*" >> "%s"\nexit 97\n' "${decoy}" "${used}" > "${work}/decoy/${decoy}"
  chmod +x "${work}/decoy/${decoy}"
done
path="${work}/bin:${work}/decoy:/usr/bin:/bin"
alone=(env -i "HOME=${work}/home" "PATH=${path}")

fail() { echo "FAILS $1" >&2; exit 1; }
# A step passes only if nothing ran a node, npm or npx found by PATH.
no_decoy() { [[ ! -e "${used}" ]] || fail "$1 ran a node found by PATH, not the release's own: $(cat "${used}")"; }

# The decoy bites: a node found by PATH is the decoy, and using it is recorded.
"${alone[@]}" node --version >/dev/null 2>&1 && fail "the decoy node did not fail"
[[ -s "${used}" ]] || fail "the decoy node ran and recorded nothing"
rm "${used}"
echo "ok a node found by PATH is the decoy"

want="$("${release}/node/bin/node" -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).version" "${tree}/package.json")"
got="$("${alone[@]}" "${command_name}" --version)" || fail "${command_name} --version ended $?"
[[ "${got}" == "${want}" ]] || fail "${command_name} --version printed '${got}', not ${want}"
no_decoy "${command_name} --version"
echo "ok ${command_name} --version is ${want}"

git -C "${work}/project" init -q
# Martha names the crew's owner from git; a fresh checkout is given one, as an owner's machine has.
git -C "${work}/project" config user.name "A Standalone Owner"
(cd "${work}/project" && "${alone[@]}" "${command_name}" init) || fail "${command_name} init ended $?"
no_decoy "${command_name} init"
echo "ok ${command_name} init declared a crew"

"${alone[@]}" "${release}/node/bin/node" "${tree}/carry_marthas_own_node/checks_martha_relies_on.ts" || fail "a check Martha relies on does not hold"
no_decoy "checks_martha_relies_on.ts"
echo "prove_a_standalone_martha: $(basename "${release}") runs alone"
