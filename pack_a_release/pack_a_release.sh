#!/usr/bin/env bash
# pack_a_release.sh <version> <context-dir>: lay out the build context of the Martha release <version> (martha#21),
# from the committed tree at HEAD and nothing else.
#
# The context holds martha/ (git archive of HEAD: what is committed, minus what .gitattributes marks export-ignore,
# the installer) and a Containerfile that copies it, as one layer, into an image FROM scratch. The release job scans
# the tagged tree for private text before it calls this.
#
# It then pins the installer (martha#84): installer/pin_the_installer/pin_the_installer.mjs writes
# <folder>/installer.json from npm's provenance for the installer version this tree carries, so a release that
# cannot be pinned is never built, and the pin is inside the signed layer. Then declare_the_floor.sh writes the
# version floor the release declares, <folder>/floor.json, from floor.txt (martha#21).
#
# Exit: 0 laid out, 1 refused (a version the tree does not carry, a runtime dependency, a pin that cannot be made,
# a floor above the release or a dead withdrawal), 2 the context could not be made.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
version="${1:-}"
context="${2:-}"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: pack_a_release.sh <X.Y.Z> <context-dir>" >&2; exit 2; }
# A context that already exists could hold another release's tree, which would ship under this version.
[[ -n "${context}" && ! -e "${context}" ]] || { echo "pack_a_release: give a context directory that does not exist yet" >&2; exit 2; }

manifest="$(git -C "${REPO}" show HEAD:package.json)"
got="$(jq -r '.version // empty' <<<"${manifest}")"
[[ "${got}" == "${version}" ]] || { echo "pack_a_release: package.json says '${got}', not ${version}" >&2; exit 1; }
# Nothing is installed beside a release, so a runtime dependency would resolve from whatever node_modules sits above it.
[[ "$(jq -r '.dependencies // {} | length' <<<"${manifest}")" == "0" ]] || { echo "pack_a_release: package.json declares dependencies; a release runs on Node alone" >&2; exit 1; }

# The public names come from one place, the installer's package.json (installer/keep_the_names_in_one_place).
names="$(git -C "${REPO}" show HEAD:installer/package.json)"
source_repository="$(jq -r '.martha.sourceRepository // empty' <<<"${names}")"
command_name="$(jq -r '.martha.command // empty' <<<"${names}")"
folder="$(jq -r '.martha.releaseFolder // empty' <<<"${names}")"
pin_file="$(jq -r '.martha.pinFile // empty' <<<"${names}")"
[[ -n "${source_repository}" && -n "${command_name}" && -n "${folder}" && -n "${pin_file}" ]] || { echo "pack_a_release: installer/package.json names no sourceRepository, command, releaseFolder or pinFile" >&2; exit 2; }

mkdir -p "${context}"
git -C "${REPO}" archive --format=tar --prefix="${folder}/" HEAD | tar -x -C "${context}"
[[ -f "${context}/${folder}/package.json" ]] || { echo "pack_a_release: the packed tree has no package.json" >&2; exit 2; }
[[ ! -e "${context}/${folder}/installer" ]] || { echo "pack_a_release: installer/ was packed; .gitattributes no longer leaves it out" >&2; exit 2; }
# A pin is generated here, from what npm serves, and never packed with the tree (martha#84).
[[ ! -e "${context}/${folder}/${pin_file}" ]] || { echo "pack_a_release: ${pin_file} was packed; a release's pin is generated, never committed" >&2; exit 2; }
node "${REPO}/installer/pin_the_installer/pin_the_installer.mjs" "${context}" || exit 1
# The floor this release declares, from the tree's floor.txt, into the signed layer (martha#21); a floor above this
# release or a dead withdrawal stops the release here, and the dry run, which packs through this script.
"${HERE}/declare_the_floor.sh" "${version}" "${context}/${folder}" || exit 1

cat > "${context}/Containerfile" <<CONTAINERFILE
FROM scratch
COPY ${folder} /${folder}
LABEL org.opencontainers.image.version="${version}" \\
      org.opencontainers.image.source="${source_repository}" \\
      org.opencontainers.image.licenses="Apache-2.0" \\
      org.opencontainers.image.title="${command_name}"
CONTAINERFILE
echo "pack_a_release: ${context} holds ${folder} ${version}"
