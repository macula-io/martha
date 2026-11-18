#!/usr/bin/env bash
# pack_main_as_a_dry_layer.sh <sha> <out .tar.gz>: main's tree at <sha>, packed the way a release is packed, as the one
# gzipped layer the installer's unpackLayer reads (martha#639, the dry step; see ./dry_release.mjs).
#
# It clones this repository at <sha> into a folder of its own, installs the installer's own dependencies there as
# release.yml does (the pin step checks npm's provenance with them), and runs the release's own packer,
# pack_a_release/pack_a_release.sh, with the version that tree carries. So the tree, the export-ignored folders, the
# installer pin and the declared floor are the release's, never a copy made here. It then gzips the packed release
# folder, the one top-level folder unpackLayer accepts, into <out>, and removes its own folder whatever happened.
#
# Nothing is signed and nothing is pushed: this layer is placed by the dry harness, never installed as a release.
# Exit: 0 packed, 1 the packer refused, 2 it could not run.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
SHA="${1:-}"
OUT="${2:-}"
[[ "${SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "dry: usage: pack_main_as_a_dry_layer.sh <40-character sha> <out .tar.gz>" >&2; exit 2; }
[[ -n "${OUT}" && ! -e "${OUT}" ]] || { echo "dry: give an out file that does not exist yet" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
git clone --quiet --no-checkout "${REPO}" "${WORK}/tree"
git -C "${WORK}/tree" checkout --quiet --detach "${SHA}" || { echo "dry: ${SHA} is not in ${REPO}" >&2; exit 2; }

TREE="${WORK}/tree"
VERSION="$(jq -r '.version // empty' "${TREE}/package.json")"
FOLDER="$(jq -r '.martha.releaseFolder // empty' "${TREE}/installer/package.json")"
[[ -n "${VERSION}" && -n "${FOLDER}" ]] || { echo "dry: the tree at ${SHA} names no version or release folder" >&2; exit 2; }

(cd "${TREE}/installer" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund > /dev/null) \
  || { echo "dry: the installer's own dependencies could not be installed" >&2; exit 2; }
"${TREE}/pack_a_release/pack_a_release.sh" "${VERSION}" "${WORK}/context" || exit 1

tar -C "${WORK}/context" --owner=0 --group=0 --numeric-owner --sort=name -czf "${OUT}" "${FOLDER}"
echo "dry: packed ${FOLDER} ${VERSION} from main at ${SHA}: ${OUT} ($(stat -c %s "${OUT}") bytes)"
