#!/usr/bin/env bash
# install_from_the_ubuntu_archive.sh: a package that must come from the archive, installed in a way that survives
# a runner whose resolver blinks, and a red that says whose failure it was (martha#271).
#
# bubblewrap is the one package left here. It is the distro's sandbox binary, built against the runner's kernel and
# its AppArmor policy, so it has no release to fetch instead -- unlike direnv, which now comes from github.com.
#
# On 2026-11-11 a hosted runner could not resolve archive.ubuntu.com for an hour. `sudo apt-get install` ended the
# job with exit 100 and every line of the red came from apt: nothing said the runner's network had gone, and the
# only way to tell it from a failure of ours was to open the job and read the resolver line. The archive answers
# again as soon as its resolver recovers, so this tries three times, 5 s and 15 s apart, counting them out. A
# failure that is not the network is not retried: apt's own words are the red, at once.
#
# Usage: install_from_the_ubuntu_archive.sh <package>...
#        install_from_the_ubuntu_archive.sh --self-test
# Exit: 0 installed, 1 not installed (the reason printed last).
#
# The self-test runs this script again with stand-ins for sudo and apt-get (MARTHA_SUDO, MARTHA_APT_GET) and no
# waiting (MARTHA_APT_WAITS), and proves all four: a blink that recovers installs on the third attempt, a network
# that never comes back ends with the one line naming it, a package apt refuses outright is not retried, and a
# stale index answering 404 is not retried either -- apt prints "Unable to fetch some archives" for that too, with
# the archive answering, so that line is not one of the network's: a resolver failure always prints its own.
set -euo pipefail

ATTEMPTS=3
DEFAULT_WAITS='5 15'
NETWORK_SIGNS='Temporary failure resolving|Temporary failure in name resolution|Could not resolve|Could not connect|Connection failed'
NETWORK_LINE='the hosted runner could not reach the Ubuntu archive (DNS); nothing in this repository was run'

SUDO="${MARTHA_SUDO:-sudo}"
APT_GET="${MARTHA_APT_GET:-apt-get}"
read -r -a WAITS <<<"${MARTHA_APT_WAITS:-${DEFAULT_WAITS}}"

say() { echo "install_from_the_ubuntu_archive: $*" >&2; }

# theNetwork <apt output>: whether that failure is the runner's resolver rather than apt's opinion of a package.
theNetwork() { grep -Eq "$NETWORK_SIGNS" <<<"$1"; }

installWithRetries() {
  local attempt=1 output
  while true; do
    if output="$("$SUDO" "$APT_GET" install -y --no-install-recommends "$@" 2>&1)"; then
      printf '%s\n' "$output" >&2
      say "installed $* on attempt ${attempt} of ${ATTEMPTS}"
      return 0
    fi
    printf '%s\n' "$output" >&2
    if ! theNetwork "$output"; then
      say "apt refused $*: the reason is apt's own, above, and the runner's network was not it"
      return 1
    fi
    if ((attempt >= ATTEMPTS)); then
      say "$NETWORK_LINE"
      return 1
    fi
    say "attempt ${attempt} of ${ATTEMPTS}: the archive did not answer; waiting ${WAITS[$((attempt - 1))]}s"
    sleep "${WAITS[$((attempt - 1))]}"
    attempt=$((attempt + 1))
  done
}

# standIn <dir> <name> <body>: an executable the self-test puts where sudo or apt-get would be.
standIn() {
  local dir="$1" name="$2" body="$3"
  printf '#!/usr/bin/env bash\n%s\n' "$body" >"${dir}/${name}"
  chmod +x "${dir}/${name}"
}

# runWith <apt-get stand-in>: this script again, on the stand-ins, with no waiting. Sets CASE_STATUS and CASE_OUTPUT.
runWith() {
  CASE_STATUS=0
  CASE_OUTPUT="$(MARTHA_SUDO="${scratch}/sudo" MARTHA_APT_GET="$1" MARTHA_APT_WAITS='0 0' "${SELF}" a-package 2>&1)" || CASE_STATUS=$?
}

mustExit() {
  [[ "${CASE_STATUS}" -eq "$2" ]] || {
    say "self-test '$1': exit ${CASE_STATUS}, expected $2"
    printf '%s\n' "${CASE_OUTPUT}" >&2
    return 1
  }
}

mustSay() {
  grep -Fq -- "$2" <<<"${CASE_OUTPUT}" || {
    say "self-test '$1': never said '$2'"
    printf '%s\n' "${CASE_OUTPUT}" >&2
    return 1
  }
}

mustNotSay() {
  ! grep -Fq -- "$2" <<<"${CASE_OUTPUT}" || {
    say "self-test '$1': said '$2', which it must not"
    printf '%s\n' "${CASE_OUTPUT}" >&2
    return 1
  }
}

mustRunAptTimes() {
  [[ "$(wc -l <"$2")" -eq "$3" ]] || {
    say "self-test '$1': apt was run $(wc -l <"$2") time(s), expected $3"
    return 1
  }
}

selfTest() {
  scratch="$(mktemp -d)"
  trap 'rm -rf "${scratch}"' EXIT
  standIn "${scratch}" sudo 'exec "$@"'
  local count="${scratch}/apt-calls"
  # A resolver that blinks twice, then answers.
  standIn "${scratch}" apt-blinking "echo x >>'${count}'
[[ \$(wc -l <'${count}') -lt 3 ]] && { echo \"Temporary failure resolving 'archive.ubuntu.com'\" >&2; exit 100; }
echo 'bubblewrap installed'"
  # A resolver that never comes back.
  standIn "${scratch}" apt-gone "echo x >>'${count}'
echo \"Temporary failure resolving 'archive.ubuntu.com'\" >&2
exit 100"
  # A package apt refuses, with the archive answering.
  standIn "${scratch}" apt-refusing "echo x >>'${count}'
echo 'E: Unable to locate package a-package' >&2
exit 100"
  # A stale index: the archive answers 404, and apt says it could not fetch the archives -- its own words for a
  # package that is not there, with the runner's resolver answering all along.
  standIn "${scratch}" apt-404 "echo x >>'${count}'
echo 'Err:1 http://archive.ubuntu.com/ubuntu noble/main amd64 a-package amd64 1.0' >&2
echo '  404  Not Found [IP: 185.125.190.36 80]' >&2
echo 'E: Failed to fetch http://archive.ubuntu.com/ubuntu/pool/main/a/a-package/a-package_1.0_amd64.deb  404  Not Found [IP: 185.125.190.36 80]' >&2
echo 'E: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?' >&2
exit 100"

  : >"${count}"
  runWith "${scratch}/apt-blinking"
  mustExit 'a blink that recovers' 0 &&
    mustSay 'a blink that recovers' 'on attempt 3 of 3' &&
    mustRunAptTimes 'a blink that recovers' "${count}" 3 &&
    say 'self-test "a blink that recovers": installed on the third attempt' || return 1

  : >"${count}"
  runWith "${scratch}/apt-gone"
  mustExit 'a network that never comes back' 1 &&
    mustSay 'a network that never comes back' "${NETWORK_LINE}" &&
    mustRunAptTimes 'a network that never comes back' "${count}" 3 &&
    say 'self-test "a network that never comes back": red, and it names the runner' || return 1

  : >"${count}"
  runWith "${scratch}/apt-refusing"
  mustExit 'a package apt refuses' 1 &&
    mustSay 'a package apt refuses' 'Unable to locate package' &&
    mustNotSay 'a package apt refuses' "${NETWORK_LINE}" &&
    mustRunAptTimes 'a package apt refuses' "${count}" 1 &&
    say 'self-test "a package apt refuses": red on apt words, not retried' || return 1

  : >"${count}"
  runWith "${scratch}/apt-404"
  mustExit 'a stale index answers 404' 1 &&
    mustSay 'a stale index answers 404' 'Unable to fetch some archives' &&
    mustNotSay 'a stale index answers 404' "${NETWORK_LINE}" &&
    mustRunAptTimes 'a stale index answers 404' "${count}" 1 &&
    say 'self-test "a stale index answers 404": red on apt words, not retried, and the runner is not blamed' || return 1
}

if [[ "${1:-}" == '--self-test' ]]; then
  SELF="$(readlink -f "$0")"
  selfTest
  exit 0
fi

[[ $# -gt 0 ]] || {
  say 'nothing was named to install'
  exit 1
}
installWithRetries "$@"
