#!/usr/bin/env bash
# fetch_the_kitty.sh: the kitty the gate job runs K1 and K2 with, taken from its upstream release and held to the digest
# pinned for it (macula-io/martha#547 S6, PR 890 r=1 R2). No sudo: the release unpacks into a directory of the runner's.
#
# The version is Martha's KITTY_FLOOR, read by the caller from src/open_the_crew_in_kitty/the_session_kitty_reads.ts and
# never typed here; the digest is the one line of fetch_the_kitty/kitty_release.sha256, checked by the owner against
# kitty's signature (raf_kitty_digest.sh). A floor raised without a new pin fails here, naming the version.
#
# Usage: fetch_the_kitty.sh --to <dir> --version <x.y.z> --sha256 <sha256:hex>
#        fetch_the_kitty.sh --self-test
#
# Prints the directory holding kitty and kitten, on ONE line, and nothing else on stdout: the caller adds it to the PATH.
# Exit: 0 fetched, held to its digest, and kitty answers its version; 1 otherwise, naming the version.
#
# The self-test runs this script again on a curl stand-in (MARTHA_CURL): bytes held to their digest are unpacked; bytes
# another release serves, held to the wrong digest, end the run with exit 1 naming the version, and are never unpacked.
set -euo pipefail

RELEASE_URL='https://github.com/kovidgoyal/kitty/releases/download'
DIGEST_SHAPE='^sha256:[0-9a-f]{64}$'
VERSION_SHAPE='^[0-9]+\.[0-9]+\.[0-9]+$'
FETCH_ATTEMPTS=3
FETCH_WAITS=(3 6)

CURL="${MARTHA_CURL:-curl}"

say() { echo "fetch_the_kitty: $*" >&2; }
die() {
  say "$*"
  exit 1
}

assetOf() { echo "kitty-${1}-x86_64.txz"; }

selfTest() {
  scratch="$(mktemp -d)"
  trap 'rm -rf "${scratch}"' EXIT
  local version='0.0.0'
  # standInCurl <name> <bytes>: a curl that answers with <bytes>, wherever it was asked to write them.
  standInCurl() {
    cat >"${scratch}/${1}" <<STANDIN
#!/usr/bin/env bash
out=''
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat '${2}' >"\$out"
STANDIN
    chmod +x "${scratch}/${1}"
  }
  # releaseOf <name> <marker>: a .txz whose bin/kitty answers the version and marks that it ran.
  releaseOf() {
    mkdir -p "${scratch}/${1}/bin"
    printf '#!/usr/bin/env bash\nprintf x >>%q\necho "kitty %s created by a stand-in"\n' "${scratch}/${2}" "${version}" >"${scratch}/${1}/bin/kitty"
    printf '#!/usr/bin/env bash\necho "kitten %s"\n' "${version}" >"${scratch}/${1}/bin/kitten"
    chmod +x "${scratch}/${1}/bin/kitty" "${scratch}/${1}/bin/kitten"
    tar -cJf "${scratch}/${1}.txz" -C "${scratch}/${1}" bin
  }
  releaseOf this ran-this-release
  releaseOf another ran-another-release
  standInCurl curl-this "${scratch}/this.txz"
  standInCurl curl-another "${scratch}/another.txz"
  local digest
  digest="sha256:$(sha256sum "${scratch}/this.txz" | cut -d' ' -f1)"

  fetchAs() {
    CASE_STATUS=0
    CASE_OUT="$(MARTHA_CURL="$1" "${SELF}" --to "$2" --version "${version}" --sha256 "$3" 2>"${scratch}/stderr")" || CASE_STATUS=$?
    CASE_ERR="$(<"${scratch}/stderr")"
  }

  fetchAs "${scratch}/curl-this" "${scratch}/right" "${digest}"
  [[ "${CASE_STATUS}" -eq 0 && "${CASE_OUT}" == "${scratch}/right/bin" && -e "${scratch}/ran-this-release" ]] || {
    say "self-test 'the bytes the digest names': exit ${CASE_STATUS}, printed '${CASE_OUT}'"
    printf '%s\n' "${CASE_ERR}" >&2
    return 1
  }
  say 'self-test "the bytes the digest names": held to its digest, unpacked and run'

  fetchAs "${scratch}/curl-another" "${scratch}/wrong" "${digest}"
  [[ "${CASE_STATUS}" -eq 1 ]] && grep -Fq -- "${version}: the $(assetOf "${version}") fetched is not the one ${digest} names" <<<"${CASE_ERR}" \
    && [[ ! -e "${scratch}/ran-another-release" && ! -e "${scratch}/wrong/bin" ]] || {
    say "self-test 'bytes that are not the ones the digest names': exit ${CASE_STATUS}"
    printf '%s\n' "${CASE_ERR}" >&2
    return 1
  }
  say 'self-test "bytes that are not the ones the digest names": red, naming the version, never unpacked or run'
}

if [[ "${1:-}" == '--self-test' ]]; then
  SELF="$(readlink -f "$0")"
  selfTest
  exit 0
fi

to='' version='' digest=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) to="${2:-}"; shift 2 ;;
    --version) version="${2:-}"; shift 2 ;;
    --sha256) digest="${2:-}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "$to" ]] || die '--to names the directory to unpack into'
[[ "$version" =~ $VERSION_SHAPE ]] || die "'${version}' is not a kitty version x.y.z"
[[ "$digest" =~ $DIGEST_SHAPE ]] || die "${version}: '${digest}' is not sha256:<64 lowercase hex>, so nothing can be trusted for it"

asset="$(assetOf "$version")"
mkdir -p "$to"
download="${to}/${asset}"
attempt=1
say "${version}: fetching ${asset} from ${RELEASE_URL}/v${version}"
while ! "$CURL" -fsSL -o "$download" "${RELEASE_URL}/v${version}/${asset}"; do
  [[ "$attempt" -lt "$FETCH_ATTEMPTS" ]] || die "${version}: the release could not be fetched from github.com, so K1 and K2 cannot run"
  say "attempt ${attempt} of ${FETCH_ATTEMPTS} did not answer; waiting ${FETCH_WAITS[$((attempt - 1))]}s"
  sleep "${FETCH_WAITS[$((attempt - 1))]}"
  attempt=$((attempt + 1))
done
printf '%s  %s\n' "${digest#sha256:}" "$download" | sha256sum --strict --check --status - ||
  die "${version}: the ${asset} fetched is not the one ${digest} names, so it is not unpacked (a raised KITTY_FLOOR needs a new pin)"
tar -xJf "$download" -C "$to"
rm -f "$download"
answers="$("${to}/bin/kitty" --version)" || die "${version}: the fetched kitty does not run"
[[ "$answers" == "kitty ${version} "* ]] || die "${version}: the fetched kitty says '${answers}'"
say "${version}: held to ${digest} and answers ${answers}"
printf '%s\n' "${to}/bin"
