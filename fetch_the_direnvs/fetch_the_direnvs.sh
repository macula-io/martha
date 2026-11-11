#!/usr/bin/env bash
# fetch_the_direnvs.sh: the direnvs the gate proves the .envrc door with, taken from their GitHub releases
# (martha#271).
#
# `sudo apt-get install direnv` took one of them from the Ubuntu archive. On 2026-11-11 a hosted runner could not
# resolve archive.ubuntu.com for an hour: the install ended with exit 100, the job went red, and not one line of
# this repository had run. github.com answers on these runners -- the checkout itself comes from it -- so each
# direnv comes from its own release tag instead, held to the sha256 named for it.
#
# Each digest is written once, in .github/workflows/ci.yml, and never restated here: this script is given it.
# The two versions are deliberate (src/launch_a_claude_code_member/direnvs_under_test.ts): 2.38 and later stop on
# DIRENV_DISABLE, and an older direnv has only the DIRENV_CONFIG fallback, so both doors are proven.
#
# Usage: fetch_the_direnvs.sh --to <dir> (--version <tag> --sha256 <sha256:hex>)+
#        fetch_the_direnvs.sh --self-test
#
# Prints the installed direnvs' paths, joined by the PATH delimiter, on ONE line, and nothing else on stdout: that
# line is a value the caller puts in MARTHA_TESTS_DIRENV, never a log. What it did while fetching goes to stderr.
#
# Exit: 0 every direnv was fetched, held to its digest and ran; 1 otherwise, naming the version that failed.
#
# The self-test runs this script again on a curl stand-in (MARTHA_CURL), and proves the digest check is a check:
# the bytes served under a version, held to that version's digest, run; bytes another release serves, held to the
# wrong digest, end the run with exit 1 naming the version, and are never run. CI runs it before the real fetch --
# a run that only ever sees the right bytes proves nothing about the wrong ones.
set -euo pipefail

RELEASE_ASSET='direnv.linux-amd64'
RELEASE_URL='https://github.com/direnv/direnv/releases/download'
DIGEST_SHAPE='^sha256:[0-9a-f]{64}$'
FETCH_ATTEMPTS=3
FETCH_WAITS=(3 6)

CURL="${MARTHA_CURL:-curl}"

say() { echo "fetch_the_direnvs: $*" >&2; }
die() {
  say "$*"
  exit 1
}

# the bytes a release serves, held to the digest named for it, then run; or why not.
selfTest() {
  scratch="$(mktemp -d)"
  trap 'rm -rf "${scratch}"' EXIT
  local version='v0.0.0-self-test'

  # standInCurl <name> <bytes>: a curl that answers with <bytes>, wherever it was asked to write them.
  standInCurl() {
    cat >"${scratch}/${1}" <<EOF
#!/usr/bin/env bash
out=''
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat '${2}' >"\$out"
EOF
    chmod +x "${scratch}/${1}"
  }

  # The bytes this release serves: a direnv that marks where it ran.
  {
    echo '#!/usr/bin/env bash'
    echo "printf x >>'${scratch}/ran-this-release'"
    echo "echo '${version}'"
  } >"${scratch}/this-release"
  # The bytes another release serves: a direnv that marks where it ran, and is not to run here at all.
  {
    echo '#!/usr/bin/env bash'
    echo "printf x >>'${scratch}/ran-another-release'"
    echo "echo 'v0.0.0-another-release'"
  } >"${scratch}/another-release"
  standInCurl curl-this "${scratch}/this-release"
  standInCurl curl-another "${scratch}/another-release"

  local digest
  digest="sha256:$(sha256sum "${scratch}/this-release" | cut -d' ' -f1)"

  # fetchAs <curl> <dir> <digest>: this script again, on that curl, into that directory.
  fetchAs() {
    CASE_STATUS=0
    CASE_OUT="$(MARTHA_CURL="$1" "${SELF}" --to "$2" --version "${version}" --sha256 "$3" 2>"${scratch}/stderr")" || CASE_STATUS=$?
    CASE_ERR="$(<"${scratch}/stderr")"
  }
  mustExit() {
    [[ "${CASE_STATUS}" -eq "$2" ]] || {
      say "self-test '$1': exit ${CASE_STATUS}, expected $2"
      printf '%s\n' "${CASE_OUT}" "${CASE_ERR}" >&2
      return 1
    }
  }
  mustPrint() {
    [[ "${CASE_OUT}" == "$2" ]] || {
      say "self-test '$1': printed '${CASE_OUT}', expected '$2'"
      return 1
    }
  }
  mustSay() {
    grep -Fq -- "$2" <<<"${CASE_ERR}" || {
      say "self-test '$1': never said '$2'"
      printf '%s\n' "${CASE_ERR}" >&2
      return 1
    }
  }
  mustNotHaveRun() {
    [[ ! -e "$2" ]] || {
      say "self-test '$1': $2 is there, so what the release served was run"
      return 1
    }
  }

  fetchAs "${scratch}/curl-this" "${scratch}/right" "${digest}"
  mustExit 'the bytes the digest names' 0 &&
    mustPrint 'the bytes the digest names' "${scratch}/right/${version}/direnv" &&
    [[ -e "${scratch}/ran-this-release" ]] &&
    say 'self-test "the bytes the digest names": held to its digest and run' || return 1

  fetchAs "${scratch}/curl-another" "${scratch}/wrong" "${digest}"
  mustExit 'bytes that are not the ones the digest names' 1 &&
    mustSay 'bytes that are not the ones the digest names' "${version}: the ${RELEASE_ASSET} fetched is not the one ${digest}" &&
    mustNotHaveRun 'bytes that are not the ones the digest names' "${scratch}/ran-another-release" &&
    say 'self-test "bytes that are not the ones the digest names": red, naming the version, and never run' || return 1
}

if [[ "${1:-}" == '--self-test' ]]; then
  SELF="$(readlink -f "$0")"
  selfTest
  exit 0
fi

to=''
versions=()
digests=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)
      to="${2:-}"
      shift 2
      ;;
    --version)
      versions+=("${2:-}")
      shift 2
      ;;
    --sha256)
      digests+=("${2:-}")
      shift 2
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$to" ]] || die '--to names the directory to install into'
[[ ${#versions[@]} -gt 0 ]] || die 'no --version/--sha256 pair was named'
[[ ${#versions[@]} -eq ${#digests[@]} ]] || die 'every --version needs its --sha256'

# fetchTo <url> <file>: the download, retried while the archive-of-releases blinks. Returns non-zero when it never
# came, so the caller names the version.
fetchTo() {
  local url="$1" file="$2" attempt=1
  while ! "$CURL" -fsSL -o "$file" "$url"; do
    if [[ "$attempt" -ge "$FETCH_ATTEMPTS" ]]; then
      return 1
    fi
    say "attempt ${attempt} of ${FETCH_ATTEMPTS} did not answer; waiting ${FETCH_WAITS[$((attempt - 1))]}s"
    sleep "${FETCH_WAITS[$((attempt - 1))]}"
    attempt=$((attempt + 1))
  done
}

mkdir -p "$to"
paths=()
for index in "${!versions[@]}"; do
  version="${versions[$index]}"
  digest="${digests[$index]}"
  [[ "$digest" =~ $DIGEST_SHAPE ]] || die "${version}: '${digest}' is not sha256:<64 lowercase hex>, so nothing can be trusted for it"
  target="${to}/${version}"
  mkdir -p "$target"
  say "${version}: fetching ${RELEASE_ASSET} from ${RELEASE_URL}/${version}"
  fetchTo "${RELEASE_URL}/${version}/${RELEASE_ASSET}" "${target}/direnv" ||
    die "${version}: the release could not be fetched from github.com, so this run proves nothing"
  printf '%s  %s\n' "${digest#sha256:}" "${target}/direnv" | sha256sum --strict --check --status - ||
    die "${version}: the ${RELEASE_ASSET} fetched is not the one ${digest} names, so it is not run"
  chmod +x "${target}/direnv"
  answers="$("${target}/direnv" version)" || die "${version}: the fetched direnv does not run"
  say "${version}: held to ${digest} and answers ${answers}"
  paths+=("${target}/direnv")
done

joined="${paths[0]}"
for path in "${paths[@]:1}"; do
  joined="${joined}:${path}"
done
printf '%s\n' "$joined"
