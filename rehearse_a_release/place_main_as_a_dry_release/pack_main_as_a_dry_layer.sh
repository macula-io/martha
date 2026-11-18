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
# Before anything is installed or packed, the tree's installer/ is held to the tag its own version was published at
# (installerRef of the version installer/package.json declares, as the release's pin reads it). A tree whose
# installer/ has moved past that tag can't be packed as a release, because the pin refuses it. That is said as its own
# line and its own exit, never as a plain refusal: the nightly run reports it as "not packable", never as a pass, and
# the pin is never skipped (martha#639, ruling (b)). A tree with no such tag here is left to the pin, which refuses it
# by name.
#
# Nothing is signed and nothing is pushed: this layer is placed by the dry harness, never installed as a release.
# Exit: 0 packed, 1 the packer refused, 2 it could not run, 3 not packable: installer/ is ahead of its tag.
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

INSTALLER_VERSION="$(jq -r '.version // empty' "${TREE}/installer/package.json")"
[[ -n "${INSTALLER_VERSION}" ]] || { echo "dry: the tree at ${SHA} names no installer version" >&2; exit 2; }
# The tag's ref as the tree's own names say it (installerRef), never spelled here.
INSTALLER_TAG="$(node --input-type=module -e 'const { installerRef } = await import(process.argv[1]); console.log(installerRef(process.argv[2]))' \
  "${TREE}/installer/keep_the_names_in_one_place/names.mjs" "${INSTALLER_VERSION}")" \
  || { echo "dry: the tree at ${SHA} could not name its installer tag" >&2; exit 2; }
if git -C "${TREE}" rev-parse --verify --quiet "${INSTALLER_TAG}^{commit}" > /dev/null; then
  DRIFT="$(git -C "${TREE}" diff --name-only "${INSTALLER_TAG}" HEAD -- installer)" \
    || { echo "dry: git could not compare installer/ at ${SHA} with ${INSTALLER_TAG}" >&2; exit 2; }
  if [[ -n "${DRIFT}" ]]; then
    echo "dry: not packable: installer ahead of its tag: installer/ at ${SHA} is not what ${INSTALLER_TAG} published ($(wc -l <<< "${DRIFT}") file(s)); nothing was packed" >&2
    exit 3
  fi
fi

(cd "${TREE}/installer" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund > /dev/null) \
  || { echo "dry: the installer's own dependencies could not be installed" >&2; exit 2; }
"${TREE}/pack_a_release/pack_a_release.sh" "${VERSION}" "${WORK}/context" || exit 1

tar -C "${WORK}/context" --owner=0 --group=0 --numeric-owner --sort=name -czf "${OUT}" "${FOLDER}"
echo "dry: packed ${FOLDER} ${VERSION} from main at ${SHA}: ${OUT} ($(stat -c %s "${OUT}") bytes)"
