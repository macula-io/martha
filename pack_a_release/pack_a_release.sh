#!/usr/bin/env bash
# pack_a_release.sh <version> <context-dir>: lay out the build context of the Martha release <version> (martha#21),
# from the committed tree at HEAD and nothing else.
#
# The context holds martha/ (git archive of HEAD: what is committed, minus what .gitattributes marks export-ignore,
# the installer) and a Containerfile that copies it, as one layer, into an image FROM scratch. The release job scans
# the tagged tree for private text before it calls this.
#
# Exit: 0 laid out, 1 refused (a version the tree does not carry, a runtime dependency), 2 the context could not be made.
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
[[ -n "${source_repository}" && -n "${command_name}" && -n "${folder}" ]] || { echo "pack_a_release: installer/package.json names no sourceRepository, command or releaseFolder" >&2; exit 2; }

mkdir -p "${context}"
git -C "${REPO}" archive --format=tar --prefix="${folder}/" HEAD | tar -x -C "${context}"
[[ -f "${context}/${folder}/package.json" ]] || { echo "pack_a_release: the packed tree has no package.json" >&2; exit 2; }
[[ ! -e "${context}/${folder}/installer" ]] || { echo "pack_a_release: installer/ was packed; .gitattributes no longer leaves it out" >&2; exit 2; }

cat > "${context}/Containerfile" <<CONTAINERFILE
FROM scratch
COPY ${folder} /${folder}
LABEL org.opencontainers.image.version="${version}" \\
      org.opencontainers.image.source="${source_repository}" \\
      org.opencontainers.image.licenses="Apache-2.0" \\
      org.opencontainers.image.title="${command_name}"
CONTAINERFILE
echo "pack_a_release: ${context} holds ${folder} ${version}"
