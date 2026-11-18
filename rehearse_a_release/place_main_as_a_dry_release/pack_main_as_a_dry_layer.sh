#!/usr/bin/env bash
# pack_main_as_a_dry_layer.sh <sha> <out .tar.gz>: main's tree at <sha>, packed the way a release is packed, as the one
# gzipped layer the installer's unpackLayer reads, and main's own installer packed beside it as a dry artifact
# (martha#639, the dry step; martha#695 option A; see ./dry_release.mjs).
#
# It clones this repository at <sha> into a folder of its own, installs the installer's own dependencies there as
# release.yml does (the pin step checks npm's provenance with them), and runs the release's own packer,
# pack_a_release/pack_a_release.sh, with the version that tree carries. So the tree, the export-ignored folders, the
# installer pin and the declared floor are the release's, never a copy made here. It then gzips the packed release
# folder, the one top-level folder unpackLayer accepts, into <out>, and removes its own folder whatever happened.
#
# When the tree's installer/ is exactly the tag its own version was published at (installerRef, as the release's pin
# reads it), nothing else happens: the published installer is what a dry run exercises, and it is the same bytes.
#
# When installer/ has moved past that tag, the pin refuses to pack, so this restores it -- in the clone, in one commit
# whose subject is DRY_RESTORE_SUBJECT (./dry_restore.mjs), with `git rm` before the checkout because a checkout alone
# would keep every file main added. Before that commit it refuses, by name and as not packable, a tree whose
# installer/package.json martha names differ from the tag's, because those are the names the release packer reads.
# The restore commit never reaches a release: pack_a_release/refuse_a_dry_restore_tag.sh refuses a release tag whose
# history holds the subject, and prove_the_core/no_restore_reaches_the_release.node-test.ts refuses the release path any
# restore at all.
#
# The order is the release's own: main's installer packed by `git archive` from the sha, then the restore commit, then
# `npm ci` on the restored installer/, then pack_a_release/pack_a_release.sh. So the installer the pin runs is the
# published one -- its lockfile and its pin_the_installer.mjs, never main's -- and a pin change on main is proven by
# main's own tests and never by this night's run.
#
# And main's installer is packed as an artifact of its own, from the sha itself by `git archive`, BEFORE that restore,
# so the tarball can only ever hold main's bytes: `npm pack --ignore-scripts` of it, renamed main-installer-<sha7>.tgz
# and written beside <out>, with its sha256 on this script's own line. A dry run installs that tarball by that digest;
# the published installer is still what the layer's pin names.
#
# Nothing is signed and nothing is pushed: this layer is placed by the dry harness, never installed as a release, and
# the clone this script makes is of the local repository, so nothing it commits can be pushed anywhere.
# Exit: 0 packed, 1 the packer refused, 2 it could not run, NOT_PACKABLE (below) not packable: installer/ names differ
# from its tag's. NOT_PACKABLE is one line of its own, read by the nightly driver beside this script and by this
# script's tests, so no reader spells the number (martha#696).
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
SHA="${1:-}"
OUT="${2:-}"
[[ "${SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "dry: usage: pack_main_as_a_dry_layer.sh <40-character sha> <out .tar.gz>" >&2; exit 2; }
[[ -n "${OUT}" && ! -e "${OUT}" ]] || { echo "dry: give an out file that does not exist yet" >&2; exit 2; }
NOT_PACKABLE=3
OUT_DIR="$(dirname "${OUT}")"

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
# The dry commit's subject, as the module beside this script says it, never spelled here.
SUBJECT="$(node --input-type=module -e 'const { DRY_RESTORE_SUBJECT } = await import(process.argv[1]); console.log(DRY_RESTORE_SUBJECT)' \
  "${HERE}/dry_restore.mjs")" \
  || { echo "dry: ${HERE}/dry_restore.mjs names no DRY_RESTORE_SUBJECT" >&2; exit 2; }

# Main's own installer, packed from the sha itself and before anything is restored, so it can only ever hold main's
# bytes. It is packed only for a tree whose installer/ has moved past its tag: a tree that is its tag's has the same
# bytes published, and a dry run of it exercises the published installer as it always did (martha#695, T6).
packMainInstaller() {
  MAIN_TARBALL="${OUT_DIR}/main-installer-${SHA:0:7}.tgz"
  mkdir -p "${WORK}/main-installer/installer" "${WORK}/main-installer/tarball"
  # `installer/` is export-ignore in this repository's .gitattributes, so `git archive <sha> installer` is an empty
  # archive and the cd below would fail on exactly the tree this exists for. The tree object `<sha>:installer` is what
  # carries the files, and an archive of it holds them with no `installer/` above them (martha#695, Venus r=1 R1).
  git -C "${REPO}" archive "${SHA}:installer" | tar -x -C "${WORK}/main-installer/installer" \
    || { echo "dry: main's installer/ at ${SHA} could not be taken from the repository" >&2; exit 2; }
  (cd "${WORK}/main-installer/installer" && npm pack --ignore-scripts --pack-destination "${WORK}/main-installer/tarball" > /dev/null) \
    || { echo "dry: main's installer/ at ${SHA} could not be packed" >&2; exit 2; }
  mv "${WORK}"/main-installer/tarball/*.tgz "${MAIN_TARBALL}" \
    || { echo "dry: npm packed no tarball for main's installer/ at ${SHA}" >&2; exit 2; }
  MAIN_DIGEST="$(node --input-type=module -e 'const { createHash } = await import("node:crypto"); const { readFileSync } = await import("node:fs"); console.log(`sha256:${createHash("sha256").update(readFileSync(process.argv[1])).digest("hex")}`)' "${MAIN_TARBALL}")" \
    || { echo "dry: ${MAIN_TARBALL} could not be read for its digest" >&2; exit 2; }
  echo "dry: main's installer at ${SHA} packed as ${MAIN_TARBALL} (${MAIN_DIGEST})"
}

# The names the release packer reads, which the restore cannot change: `pack_a_release.sh` reads them from the tree it
# is about to pack, and the restored installer/ brings the tag's. A tree whose names differ cannot be packed at all,
# and it is refused here, before anything has been packed or committed.
checkTheNames() {
  local name main_said tag_said
  for name in $(node --input-type=module -e 'const { NAMES_A_RELEASE_READS } = await import(process.argv[1]); console.log(NAMES_A_RELEASE_READS.join(" "))' "${HERE}/dry_restore.mjs"); do
    main_said="$(git -C "${TREE}" show "${SHA}:installer/package.json" | jq -r ".martha.${name} // empty")"
    tag_said="$(git -C "${TREE}" show "${INSTALLER_TAG}:installer/package.json" | jq -r ".martha.${name} // empty")"
    if [[ "${main_said}" != "${tag_said}" ]]; then
      echo "dry: not packable: installer/ at ${SHA} names a different martha.${name} than ${INSTALLER_TAG} published (${main_said:-none} against ${tag_said:-none}); nothing was packed" >&2
      exit "${NOT_PACKABLE}"
    fi
  done
}

# main's installer/ restored from its tag, in the clone, as one commit whose subject is DRY_RESTORE_SUBJECT. `git rm`
# comes first: a checkout alone keeps every file main added under installer/ since the tag, and then the pin's own tag
# diff is not empty and it refuses the very tree this restore exists for. The diff is taken again after the commit, so
# a restore that left a file behind says so here rather than at the pin.
restoreTheInstallersTag() {
  git -C "${TREE}" rm -r -q --ignore-unmatch -- installer
  git -C "${TREE}" checkout --quiet "${INSTALLER_TAG}" -- installer \
    || { echo "dry: installer/ at ${SHA} could not be restored from ${INSTALLER_TAG}" >&2; exit 2; }
  git -C "${TREE}" -c user.name='Martha dry run' -c user.email='dry-run@example.invalid' -c commit.gpgsign=false \
    commit --quiet -m "${SUBJECT}" \
    || { echo "dry: the restore commit could not be made at ${SHA}" >&2; exit 2; }
  local left
  left="$(git -C "${TREE}" diff --name-only "${INSTALLER_TAG}" HEAD -- installer)" \
    || { echo "dry: git could not compare the restored installer/ at ${SHA} with ${INSTALLER_TAG}" >&2; exit 2; }
  if [[ -n "${left}" ]]; then
    echo "dry: the restore left installer/ differing from ${INSTALLER_TAG} ($(wc -l <<< "${left}") file(s)); nothing was packed" >&2
    exit 2
  fi
  echo "dry: installer/ as ${INSTALLER_TAG} published it, restored in a commit of the clone's own ($(git -C "${TREE}" rev-parse HEAD))"
}

if git -C "${TREE}" rev-parse --verify --quiet "${INSTALLER_TAG}^{commit}" > /dev/null; then
  DRIFT="$(git -C "${TREE}" diff --name-only "${INSTALLER_TAG}" HEAD -- installer)" \
    || { echo "dry: git could not compare installer/ at ${SHA} with ${INSTALLER_TAG}" >&2; exit 2; }
  if [[ -n "${DRIFT}" ]]; then
    checkTheNames
    packMainInstaller
    restoreTheInstallersTag
  fi
fi

(cd "${TREE}/installer" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund > /dev/null) \
  || { echo "dry: the installer's own dependencies could not be installed" >&2; exit 2; }
"${TREE}/pack_a_release/pack_a_release.sh" "${VERSION}" "${WORK}/context" || exit 1

tar -C "${WORK}/context" --owner=0 --group=0 --numeric-owner --sort=name -czf "${OUT}" "${FOLDER}"
echo "dry: packed ${FOLDER} ${VERSION} from main at ${SHA}: ${OUT} ($(stat -c %s "${OUT}") bytes)"
