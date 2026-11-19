# shellcheck shell=bash
# the_night_in_the_container.sh: sourced by prove_a_clean_install_in_a_throwaway_container.sh, never run alone.
#
# The container side of the nightly live run (martha#639 phase 2, sections 2, 4 and 5), taken when the proof is given
# `--night <run folder>`. The proof's own steps run as they do without it; these steps go around and after them:
#
# - before the image: the night's throwaway repository made on the crew host by keep_a_throwaway_repository.sh, with
#   the bot's token alone, and the pinned tools fetched there: tmux and the one library it needs that the image lacks,
#   as Debian's own .deb files, and one gh release tarball, each held to the sha256 written here, never to a checksum
#   fetched beside it;
# - after Claude Code: the tools passed into the container on standard input (ssh's, then `podman exec -i`'s), so the
#   container reaches nothing new on the network. The two .deb files are installed with dpkg in an exec of their own as
#   root; that exec is the only one that is, the container itself still runs as the image's own non-root user, and the
#   gh tarball is unpacked under that user's home;
# - after the checkout: the repository's first commit passed in as a git bundle on standard input and cloned at
#   <home>/<clones>/<owner>/<name>, origin `https://github.com/<owner>/<name>.git` with no token in it, and the crew
#   declared there by `martha init`, which reads the workspace layout from that path (martha#611). What the clone
#   holds then is what the run put there, listed for the clean-start check;
# - the owner's sign-in approves both crew places, the checkout and then the clone, in one command line;
# - after every member is proven in the checkout: every member stopped, and none of their processes left; then the
#   clean start judged on the container's own listing (src/land_a_package_on_a_throwaway_repository, clean-start): the
#   clone holds only what the run put there, its parents only the next folder, and the home and its config folder
#   nothing the recorded host loads by itself. A hit fails by name and no token is placed. Then each member started
#   again by its own command, in the clone, in a tmux session of its own name, so the owner can attach to the
#   builder's terminal for the landing's yes;
# - then the token: read from its 0600 file on the crew host and passed on standard input at every hop (ssh, then
#   `podman exec -i`) into a 0600 file in the node user's home, read by `gh auth login --with-token`, and removed. It
#   is never an argument at any hop. gh in the container must then answer as the bot recorded at setup;
# - then the package (section 1) typed into the builder's session as the owner's turn; the night waits, within its work
#   window counted on the clock, for the builder to queue the landing's ask (a verify_range answer's question, queued
#   word for word; any other ask is not it) in the clone's crew rows, then reads the pull request's head from GitHub
#   (the throwaway script's read-back), prints the owner's second command (attach to the builder's session, say yes to
#   the landing's menu, detach), and waits, within its yes window, for the landing to show in the crew's rows with the
#   yes settled after that command was printed. A container that goes away while it waits fails the night by name;
# - in the finish, before the container goes and whatever happened after the night got ready: the clone's transcripts
#   (exactly two launches, one holding the package's opening), rows and screens kept in the run folder, every byte
#   through the token's redactor, and section 6's claims read from that kept record and from a second read-back of
#   GitHub, made after the landing, whose pull request's head must still be the one the yes was for. On a night every line the run says goes through the redactor too; a
#   token found anywhere fails the night by name (section 5, R4);
# - at the end, whatever happened, after the container is gone: the repository deleted by keep_a_throwaway_repository.sh,
#   which only takes GitHub's 404 as gone.

# The script that makes and deletes the night's repository: this folder's own, or the stand-in a self-test names.
NIGHT_THROWAWAY="${MARTHA_CLEAN_INSTALL_THROWAWAY:-${HERE}/keep_a_throwaway_repository.sh}"
# The setup files the throwaway script reads too: the token, mode 0600, and the bot's numeric id.
NIGHT_LIVE_DIR="${MARTHA_LIVE_DIR:-${HOME}/.config/martha-live}"
NIGHT_TOKEN_FILE="${NIGHT_LIVE_DIR}/token"
NIGHT_OWNER_FILE="${NIGHT_LIVE_DIR}/owner.json"
# What the throwaway script writes in the run folder for the night to read: the repository it made, and the folder
# holding its first commit.
NIGHT_REPOSITORY_PART='repository.env'
NIGHT_FIRST_PART='first'
# The pinned downloads, one a line: the file's name, its sha256, and where it is fetched from. The two .deb files are
# Debian bookworm's own (the image is bookworm), their sha256 as Debian's signed index gives it; the gh tarball's is
# the one its release's checksums file gives. The digest is written labelled, the one shape a 64-hex string passes in
# (src/check_nothing_private_gets_in). A self-test names a file of its own pins instead.
NIGHT_PINS="${MARTHA_CLEAN_INSTALL_NIGHT_PINS:-}"
NIGHT_DEB_PINS=(
  'libutempter0_1.2.1-3_amd64.deb sha256:e2bf3c7fb0ebd7d7966166d98320767adcd35a6d1eabc32220d8219c9efb1c0f https://deb.debian.org/debian/pool/main/libu/libutempter/libutempter0_1.2.1-3_amd64.deb'
  'tmux_3.3a-3_amd64.deb sha256:6bd1558face5e145d66d72c9557cbc7ff5ad66701e94dcd568e6daf081269018 https://deb.debian.org/debian/pool/main/t/tmux/tmux_3.3a-3_amd64.deb'
)
NIGHT_GH_PIN='gh_2.104.0_linux_amd64.tar.gz sha256:98cb101ad87dbbd3f6b2f2bfcbd43197ccd07643140121d8a9cfaa91eadbc24e https://github.com/cli/cli/releases/download/v2.104.0/gh_2.104.0_linux_amd64.tar.gz'
# Where the night's tools go in the container: the .deb files in a folder of root's own for the one exec that installs
# them, and gh under the node user's home, on the PATH the proof's scripts already put first.
NIGHT_DEB_DROP='/root/night-debs'
NIGHT_GH_HOME='.local/gh'
# The crew's clones place under the container's home, as `martha init` reads a layout from a checkout's path
# (<clones>/<org>/<name>): the worktrees place beside it is made by the members later, so it is not there to judge.
NIGHT_CLONES='work/clones'
# The token's one stop in the container: a 0600 file in the node user's home, read by gh and removed.
NIGHT_TOKEN_DROP="${CONTAINER_HOME}/.night-token"
# The tmux server the members run on, its own socket name so nothing else's is reached, and what each member's
# session runs after its command ends, so its last screen stays readable.
NIGHT_TMUX_SOCKET='night'
NIGHT_PANE_HOLD='exec sleep infinity'
# The night server's bounds on what a member's pane can send to the owner's terminal (martha#843), set once as the
# server starts, before any member's pane exists: a member's notification may pass through to a client attached to
# its pane (allow-passthrough, a pane option, set for every pane to come), and no pane may set the owner's clipboard
# (set-clipboard off, which its default `external` already refuses, said here so no tmux.conf can open it). Before the
# owner attaches writable for the yes, the builder's pane is shut again (NIGHT_PASSTHROUGH_OFF), and until then the
# owner watches read-only (NIGHT_WATCH_ATTACH), so nothing a client types reaches a pane.
# These are speed bumps, not walls, until #847: the server runs as the members' own user, so a member's code can run
# `tmux -L night` itself and undo each of them, or type into its own pane. They stop a stray escape, not a member set
# on undoing them.
NIGHT_TMUX_BOUNDS=(set-option -g allow-passthrough on ';' set-option -s set-clipboard off)
# The option and its value only: tmux reads a target before them, so it is set as `set-option -p -t <pane> ...`.
NIGHT_PASSTHROUGH_OFF=(allow-passthrough off)
# The read-only flag is a word of its own, so the owner's follow script reads it as it reads the socket's name.
NIGHT_WATCH_FLAG='-r'
NIGHT_WATCH_ATTACH=(attach "${NIGHT_WATCH_FLAG}")
# The night's crew rings the owner's bells (martha#843): `martha init` declares none, as every switch is off unasked, so
# the clone's declaration is given `house_rules.owner_bell` before any member starts there.
NIGHT_BELLS_ON='const fs = require("node:fs"); const [file] = process.argv.slice(1); const d = JSON.parse(fs.readFileSync(file, "utf8")); d.house_rules = { ...d.house_rules, owner_bell: true }; fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n")'
NIGHT_DECLARATION='.martha/martha.json'
# Where each member's session keeps every byte it draws (tmux pipe-pane), and the gate its member waits on until that
# keeping has begun. Made after the clean start has been judged, so it is not a stranger to it.
NIGHT_SCREENS="${CONTAINER_HOME}/.night-screens"
# The proof's own read-only client on the builder's session (martha#843): every byte tmux sends it is recorded at
# <watched>.rec, and the pid of its tmux client at <watched>.pid, so the session's listing tells it from the owner's. It
# records under a terminal type every image's ncurses knows. Only what the watch guard says of it is kept: its bytes are
# the builder's screen, which the kept record never holds once the token is placed.
NIGHT_WATCHED="${NIGHT_SCREENS}/watched"
NIGHT_WATCH_TERM='xterm-256color'
NIGHT_WATCH_PART='watch.json'
# The container's own process list after the stop: pid, state, command line. Only the container's idle process (its
# pid 1) and this listing itself may be there; any other process, a member's or a host's it started, is left over. A
# zombie (state Z) has ended and holds nothing open: the idle process does not reap, so it is not counted.
NIGHT_IDLE_PID=1
NIGHT_PROCESS_LIST='ps -eo pid=,stat=,args='

NIGHT_DIR=''
NIGHT_CLONE=''
NIGHT_FULL_NAME=''
NIGHT_BRANCH=''
NIGHT_OPENED=''
NIGHT_READY=''

# Whether this run is a night.
a_night() { [ -n "${NIGHT_DIR}" ]; }

# The open step: the night's repository made on the crew host, its lines in the run's log, and what it made read.
night_open_step() {
  local said status=0 line
  NIGHT_OPENED=1
  said="$("${NIGHT_THROWAWAY}" open "${NIGHT_DIR}" 2>&1)" || status=$?
  while IFS= read -r line; do [ -z "${line}" ] || log "  ${line}"; done <<< "${said}"
  if [ "${status}" -ne 0 ]; then failed 'night open' "the throwaway repository was not made (exit ${status})"; return 1; fi
  NIGHT_FULL_NAME="$(sed -n 's/^FULL_NAME=//p' "${NIGHT_DIR}/${NIGHT_REPOSITORY_PART}")"
  NIGHT_BRANCH="$(sed -n 's/^BRANCH=//p' "${NIGHT_DIR}/${NIGHT_REPOSITORY_PART}")"
  [[ "${NIGHT_FULL_NAME}" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] && [ -n "${NIGHT_BRANCH}" ] \
    || { failed 'night open' "${NIGHT_DIR}/${NIGHT_REPOSITORY_PART} names no repository and branch"; return 1; }
  NIGHT_CLONE="${CONTAINER_HOME}/${NIGHT_CLONES}/${NIGHT_FULL_NAME}"
  ok 'night open' "${NIGHT_FULL_NAME} made by the bot, ${NIGHT_BRANCH} holding its first commit"
}

# The pins, one a line: the self-test's file, or the ones written here.
night_pins() {
  if [ -n "${NIGHT_PINS}" ]; then cat "${NIGHT_PINS}"; return; fi
  printf '%s\n' "${NIGHT_DEB_PINS[@]}" "${NIGHT_GH_PIN}"
}

# The fetch step: every pinned file fetched into the run folder on the crew host, and held to its sha256.
night_fetch_step() {
  local name digest url got
  mkdir -p "${NIGHT_DIR}/downloads"
  while read -r name digest url; do
    curl -fsSL -o "${NIGHT_DIR}/downloads/${name}" "${url}" || { failed 'night fetch' "${name} could not be fetched from ${url}"; return 1; }
    got="sha256:$(sha256sum "${NIGHT_DIR}/downloads/${name}" | cut -d' ' -f1)"
    if [ "${got}" != "${digest}" ]; then
      failed 'night fetch' "${name} is ${got}, not the pinned ${digest}"
      return 1
    fi
  done < <(night_pins)
  ok 'night fetch' "$(night_pins | wc -l | tr -d ' ') pinned files fetched, each its pinned sha256"
}

# One command in the container with a file of the crew host on its standard input, never in its arguments.
in_the_container_from() {
  local file="$1"
  shift
  ssh "${HOST}" "$(remote_words podman exec -i "$@")" < "${file}"
}

# The tools step: the two .deb files in as root and installed with dpkg, then gh unpacked under the node user's home,
# and each answering its version as the node user.
night_tools_step() {
  local name digest url debs=() said
  while read -r name digest url; do
    case "${name}" in
      *.deb)
        in_the_container_from "${NIGHT_DIR}/downloads/${name}" --user root "${CONTAINER}" sh -c "mkdir -p ${NIGHT_DEB_DROP}; cat > ${NIGHT_DEB_DROP}/${name}" \
          || { failed 'night tools' "${name} could not be passed in"; return 1; }
        debs+=("${NIGHT_DEB_DROP}/${name}")
        ;;
      *.tar.gz)
        in_the_container_from "${NIGHT_DIR}/downloads/${name}" "${CONTAINER}" sh -c "set -eu; mkdir -p ${CONTAINER_HOME}/${NIGHT_GH_HOME} ${CONTAINER_HOME}/.local/bin; tar -xzf - -C ${CONTAINER_HOME}/${NIGHT_GH_HOME} --strip-components=1; ln -sf ${CONTAINER_HOME}/${NIGHT_GH_HOME}/bin/gh ${CONTAINER_HOME}/.local/bin/gh" \
          || { failed 'night tools' "${name} could not be unpacked under ${CONTAINER_HOME}"; return 1; }
        ;;
    esac
  done < <(night_pins)
  said="$(on_the_host podman exec --user root "${CONTAINER}" sh -c "dpkg -i ${debs[*]} && rm -rf ${NIGHT_DEB_DROP}" 2>&1)" \
    || { failed 'night tools' "dpkg would not install ${debs[*]}: $(one_line "${said}")"; return 1; }
  said="$(in_the_container 'tmux -V && gh --version' 2>&1)" || { failed 'night tools' "tmux or gh does not answer as ${CONTAINER_USER}: $(one_line "${said}")"; return 1; }
  ok 'night tools' "$(one_line "$(head -2 <<< "${said}")"), passed in on standard input; dpkg ran as root in one exec, the container runs as ${CONTAINER_USER}"
}

# The script that makes the clone from the bundle on its standard input, then declares the crew there.
night_clone_script() {
  printf 'set -eu; export HOME=%s; export PATH="$HOME/.local/bin:$PATH"; mkdir -p %s; cat > %s.bundle; git clone -q -b %s %s.bundle %s; rm %s.bundle; cd %s; git remote set-url origin %s; git config user.name %s; git config user.email %s; martha init; node -e %s %s; git remote get-url origin' \
    "${CONTAINER_HOME}" "$(dirname "${NIGHT_CLONE}")" "${NIGHT_CLONE}" "$(remote_word "${NIGHT_BRANCH}")" "${NIGHT_CLONE}" "${NIGHT_CLONE}" \
    "${NIGHT_CLONE}" "${NIGHT_CLONE}" "$(remote_word "$(night_origin)")" "$(remote_word "${CHECKOUT_AUTHOR}")" "$(remote_word "${CHECKOUT_AUTHOR_EMAIL}")" \
    "$(remote_word "${NIGHT_BELLS_ON}")" "$(remote_word "${NIGHT_DECLARATION}")"
}

# The clone's origin: the repository by its https address, with no token in it.
night_origin() { printf 'https://github.com/%s.git' "${NIGHT_FULL_NAME}"; }

# The clone step: the first commit in as a bundle on standard input, cloned at the crew's clones place, its origin the
# repository's address, the crew declared there; then what it holds listed, as what the run put there.
night_clone_step() {
  local said made
  git -C "${NIGHT_DIR}/${NIGHT_FIRST_PART}" bundle create -q "${NIGHT_DIR}/first.bundle" "${NIGHT_BRANCH}" 2> /dev/null \
    || { failed 'night clone' "the first commit could not be bundled from ${NIGHT_DIR}/${NIGHT_FIRST_PART}"; return 1; }
  said="$(in_the_container_from "${NIGHT_DIR}/first.bundle" "${CONTAINER}" sh -c "$(night_clone_script)" 2>&1)" \
    || { failed 'night clone' "the clone could not be made at ${NIGHT_CLONE}: $(one_line "${said}")"; return 1; }
  if [ "$(tail -1 <<< "${said}")" != "$(night_origin)" ]; then
    failed 'night clone' "the clone's origin is '$(tail -1 <<< "${said}")', not $(night_origin)"
    return 1
  fi
  made="$(on_the_host podman exec "${CONTAINER}" sh -c "cd ${NIGHT_CLONE} && find . -mindepth 1 -path ./.git -prune -o -print" 2>&1)" \
    || { failed 'night clone' "the clone could not be listed: $(one_line "${made}")"; return 1; }
  sed 's#^\./##' <<< "${made}" | grep -vx '.git' > "${NIGHT_DIR}/made.list" || true
  ok 'night clone' "${NIGHT_CLONE} from the first commit, origin $(night_origin) with no token, the crew declared in it"
}

# What the owner's command approves: the checkout alone, or on a night the checkout and then the clone, and it comes
# back to the checkout for the sign-in.
approve_command() {
  if a_night; then
    printf 'martha approve && cd %s && martha approve && cd %s' "${NIGHT_CLONE}" "${CHECKOUT}"
  else
    printf 'martha approve'
  fi
}

# The owner's step that approves, in the words of the list: once, or on a night once for each crew place. The words
# follow approve's own output and promise no yes: a crew place with no config that starts code asks nothing, as both
# places did on night 1 (martha#639), and as a fresh checkout does too; approve asks only on a terminal, so the run
# cannot learn which ahead of time.
approve_step_words() {
  local places='the checkout'
  if a_night; then places='the checkout, then the throwaway clone'; fi
  printf '  2. approve %s: type yes where martha approve asks, nothing where it asks nothing' "${places}"
}

# What still runs in the container, one command line a line: every process but the idle one, this listing and the
# zombies. Exit 2 with the reason when the container cannot list its processes.
night_left_processes() {
  local listed
  # shellcheck disable=SC2086 # the listing is a command and its words
  listed="$(on_the_host podman exec "${CONTAINER}" ${NIGHT_PROCESS_LIST} 2>&1)" \
    || { printf 'the container could not list its processes: %s' "$(one_line "${listed}")"; return 2; }
  awk -v idle="${NIGHT_IDLE_PID}" -v self="${NIGHT_PROCESS_LIST}" '
    $1 != idle && $2 !~ /^Z/ { $1 = $1; line = $0; sub(/^[^ ]+ [^ ]+ /, "", line); if (line != self) print line }' <<< "${listed}"
}

# The members stopped: every terminal of the proof closed, and nothing left running in the container but its idle
# process, so no member and no host session a member started outlives the stop.
night_stop_step() {
  local waited=0 left
  close_every_terminal
  while :; do
    left="$(night_left_processes)" || { failed 'night stop' "${left}"; return 1; }
    if [ -z "${left}" ]; then break; fi
    if [ "${waited}" -ge "${TURN_WINDOW_S}" ]; then
      failed 'night stop' "still running in the container after the stop: $(one_line "${left}")"
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  ok 'night stop' 'every member stopped: nothing runs in the container but its idle process'
}

# The clean-start step: the container's own listing of the home judged before any member starts in the clone, and
# before the token moves (R3). A hit fails by name.
night_clean_start_step() {
  local said
  node -e 'const [home, clone, list] = process.argv.slice(1); const made = require("node:fs").readFileSync(list, "utf8").split("\n").filter((l) => l !== ""); process.stdout.write(JSON.stringify({ home, clone, made }))' \
    "${CONTAINER_HOME}" "${NIGHT_CLONE}" "${NIGHT_DIR}/made.list" > "${NIGHT_DIR}/start.json"
  on_the_host podman exec "${CONTAINER}" find "${CONTAINER_HOME}" -xdev > "${NIGHT_DIR}/home.list" 2> /dev/null \
    || { failed 'night clean start' "the container could not list ${CONTAINER_HOME}"; return 1; }
  said="$(node --no-warnings "${REPO}/src/land_a_package_on_a_throwaway_repository/main.ts" clean-start "${NIGHT_DIR}/start.json" < "${NIGHT_DIR}/home.list" 2>&1)" \
    || { failed 'night clean start' "$(one_line "${said}"); no token is placed"; return 1; }
  ok 'night clean start' "the clone holds what the run put there, and nothing the host loads by itself is in its path or the home"
}

# One tmux command in the container, on the night's own server.
night_tmux() { on_the_host podman exec "${CONTAINER}" tmux -L "${NIGHT_TMUX_SOCKET}" "$@"; }

# What the member named `name`'s session shows now: only what is on its pane. A host that draws full-screen replaces
# what was there before it, so a line printed before the host started is gone from here (#639 night 1). Used only to
# say what the member was showing when a step fails.
night_screen() { night_tmux capture-pane -p -J -S - -t "$1" 2> /dev/null || true; }

# Every byte the session of `name` drew since it started, as tmux's pipe-pane kept it in the container.
night_kept() { on_the_host podman exec "${CONTAINER}" cat "${NIGHT_SCREENS}/$1.log" 2> /dev/null || true; }

# Drawn text matched plain: terminal sequences, control characters and every whitespace removed, so a line the host
# drew in pieces, moved the cursor through, or wrapped still reads as its words.
night_plain() {
  LC_ALL=C sed -E $'s/\x1b\\[[0-9;?<>=!]*[ -/]*[@-~]//g; s/\x1b\\][^\x07\x1b]*(\x07|\x1b\\\\)//g; s/\x1b.//g' | LC_ALL=C tr -d '[:space:][:cntrl:]'
}

# Whether the session of `name` drew `pattern` (an extended pattern, matched against the plain bytes it drew since it
# started, with the pattern's own whitespace removed) within `seconds`; read at least once, so 0 asks once.
night_drew() {
  local waited=0 plain_pattern
  plain_pattern="$(printf '%s' "$2" | tr -d '[:space:]')"
  while :; do
    if night_kept "$1" | night_plain | grep -qE -- "${plain_pattern}"; then return 0; fi
    if [ "${waited}" -ge "$3" ]; then return 1; fi
    sleep 1
    waited=$((waited + 1))
  done
}

# The script a member's session runs: it waits until the run keeps its bytes, then its own command in the clone, then
# the run's line saying it ended, then held. Without the wait, what the member prints first could go before the run
# starts keeping it.
night_member_script() {
  printf 'while [ ! -e %s ]; do sleep 0.1; done; export HOME=%s; export PATH="$HOME/.local/bin:$PATH"; cd %s; martha start %s; echo %s %s "$?"; %s' \
    "$(night_gate "$1")" "${CONTAINER_HOME}" "${NIGHT_CLONE}" "$(remote_word "$1")" "$(remote_word "$1")" "$(remote_word "${ENDED_WORDS}")" "${NIGHT_PANE_HOLD}"
}

# The file whose presence lets the session of `name` start its member.
night_gate() { printf '%s/%s.go' "${NIGHT_SCREENS}" "$1"; }

# The session of `name` started, held at its gate; its bytes kept from then on; then its gate opened.
night_start_session() {
  local name="$1"
  on_the_host podman exec "${CONTAINER}" mkdir -p "${NIGHT_SCREENS}" > /dev/null 2>&1 \
    && night_tmux start-server ';' "${NIGHT_TMUX_BOUNDS[@]}" ';' new-session -d -s "${name}" -x "${TERMINAL_COLUMNS}" -y "${TERMINAL_ROWS}" "$(night_member_script "${name}")" > /dev/null 2>&1 \
    && night_tmux pipe-pane -o -t "${name}" "cat >> ${NIGHT_SCREENS}/${name}.log" > /dev/null 2>&1 \
    && on_the_host podman exec "${CONTAINER}" touch "$(night_gate "${name}")" > /dev/null 2>&1
}

# The restart step: each member started again by its own command, in the clone, in a tmux session of its own name, in
# the release's order, every byte it draws kept; its first-run folder question answered; and each earlier one still up
# once a later one starts.
night_restart_step() {
  local name earlier
  for name in "${MEMBERS[@]}"; do
    night_start_session "${name}" || { failed 'night restart' "tmux would not start ${name}'s session and keep what it draws"; return 1; }
    if ! night_drew "${name}" "${name} ${STARTED_WORDS}" "${STARTED_WINDOW_S}"; then
      failed 'night restart' "${name} never said '${name} ${STARTED_WORDS}' in the clone: $(night_screen "${name}" | tail -c 300 | tr '\n' ' ')"
      return 1
    fi
    if night_drew "${name}" "${TRUST_WORDS}" "${TURN_WINDOW_S}"; then
      night_tmux send-keys -t "${name}" Down > /dev/null 2>&1 && sleep "${KEY_PAUSE_S}" && night_tmux send-keys -t "${name}" Enter > /dev/null 2>&1 \
        || { failed 'night restart' "${name}'s folder question could not be answered"; return 1; }
    fi
    for earlier in "${MEMBERS[@]}"; do
      if [ "${earlier}" = "${name}" ]; then break; fi
      if night_drew "${earlier}" "${earlier} ${ENDED_WORDS}" 0; then
        failed 'night restart' "${earlier} ended in the clone while ${name} started"
        return 1
      fi
    done
  done
  ok 'night restart' "${MEMBERS[*]} started again by their own commands in ${NIGHT_CLONE}, each in a tmux session of its name"
}

# The script that takes the token on its standard input into a 0600 file, logs gh in from it, removes it, sets gh as
# git's credential helper, and says who gh answers as. The file goes on every way out: a failed login ends the
# script under `set -e`, and its EXIT trap still removes the file.
night_token_script() {
  printf 'set -eu; umask 077; export HOME=%s; export PATH="$HOME/.local/bin:$PATH"; trap "rm -f %s" EXIT; cat > %s; gh auth login --with-token --insecure-storage < %s; rm -f %s; gh auth setup-git; gh api user --jq .id' \
    "${CONTAINER_HOME}" "${NIGHT_TOKEN_DROP}" "${NIGHT_TOKEN_DROP}" "${NIGHT_TOKEN_DROP}" "${NIGHT_TOKEN_DROP}"
}

# The token step: the token on standard input at every hop, gh logged in from it in the container, and gh there
# answering as the bot recorded at setup (R4, R1).
night_token_step() {
  local said owner
  owner="$(json_field "${NIGHT_OWNER_FILE}" 'id')" || { failed 'night token' "${NIGHT_OWNER_FILE} names no id"; return 1; }
  said="$(in_the_container_from "${NIGHT_TOKEN_FILE}" "${CONTAINER}" sh -c "$(night_token_script)" 2> /dev/null)" \
    || { failed 'night token' 'gh in the container would not log in from the token on standard input, or once logged in would not set itself up for git or say who it is'; return 1; }
  if [ "$(tail -1 <<< "${said}")" != "${owner}" ]; then
    failed 'night token' "gh in the container answers as '$(tail -1 <<< "${said}")', not the bot (${owner})"
    return 1
  fi
  ok 'night token' "gh in the container answers as the bot (${owner}); the token came on standard input at every hop, and its file is removed"
}

# --- The night's package, its landing and its kept record (martha#639 sections 1, 2 steps 4 to 9, 3 and 6) ---------

# The guards' program, which the record's every write and every claim goes through.
NIGHT_GUARDS="${REPO}/src/land_a_package_on_a_throwaway_repository/main.ts"
# The name the guards' program opens each line it says with, which a failure here leaves off: the line names its step.
NIGHT_GUARDS_SAY="$(basename "$(dirname "${NIGHT_GUARDS}")"): "
# How long the crew has from the package typed to the landing's ask queued (a build, a review, a landing's checks),
# and how long the owner has from their second command printed to the landing. Each is the environment's when it names
# one, so the self-test runs in moments. A night's container idles for these on top of the proof's own idle.
NIGHT_WORK_WINDOW_S="${MARTHA_CLEAN_INSTALL_NIGHT_WORK_WINDOW_S:-3600}"
NIGHT_YES_WINDOW_S="${MARTHA_CLEAN_INSTALL_NIGHT_YES_WINDOW_S:-1200}"
# How often the crew's rows are read while the night waits: a copy out of the container each time, so slower than the
# proof's own poll.
NIGHT_ROWS_POLL_S="${MARTHA_CLEAN_INSTALL_NIGHT_ROWS_POLL_S:-15}"
# Martha's state in the container (src/find_a_homes_state_root): a checkout's launches under the sha256 of its real
# path, and a crew's rows under crews/<the sha256 of its git common directory>/rows
# (src/keep_martha_state_outside_the_checkout). The host's transcripts sit in each launch's snapshot as the proof's
# own TRANSCRIPTS glob reads them.
NIGHT_STATE="${CONTAINER_HOME}/.local/state/martha"
NIGHT_LAUNCH_TRANSCRIPTS='the-members-own-config/projects/*/*.jsonl'
# Where the run folder keeps the night's record, and the night file the claims read.
NIGHT_KEPT_PART='kept'
NIGHT_FILE_PART='night.json'
# The mark a line the token had reached leaves in the run folder.
NIGHT_TOKEN_IN_LOG_PART='token-in-log'
# What the throwaway script's read-back writes in the run folder: GitHub's record of the pull request and of main.
NIGHT_LANDED_PART='landed.json'
# Where a step that reads the container leaves the reason it gives up, for the line that names it.
NIGHT_WHY_PART='why'
# The package's issue, the one the throwaway script opens; the round and CI words the night's lines carry come from
# the crew's own shapes in the claims reader, never from here.
NIGHT_PACKAGE=''
NIGHT_BASE=''
NIGHT_TIP=''
NIGHT_ATTACH_AT=''
NIGHT_RECORD_KEPT=''
NIGHT_LANDED=''
NIGHT_CLAIMED=''

# How long a night's container stays up by itself: the proof's own idle, with the night's two windows on top, so a
# night is never cut off at the hour a plain run idles for (martha#639, Mars on PR 717).
container_idles() {
  if a_night; then printf 'sleep %s' "$((CONTAINER_IDLE_S + NIGHT_WORK_WINDOW_S + NIGHT_YES_WINDOW_S))"; else printf '%s' "${CONTAINER_IDLES}"; fi
}

# The member that builds: the role whose proof runs the README's command. The one that reviews: every other member.
night_builder() { local name; for name in "${MEMBERS[@]}"; do if [ -n "${ROLE_RUNS_THE_COMMAND[${name}]+given}" ]; then printf '%s' "${name}"; return 0; fi; done; return 1; }
night_reviewer() { local name; for name in "${MEMBERS[@]}"; do if [ -z "${ROLE_RUNS_THE_COMMAND[${name}]+given}" ]; then printf '%s' "${name}"; return 0; fi; done; return 1; }

# The owner's turn that gives the builder the package (section 1): typed as the owner, the way the checkout's turns
# were. Its opening words are the builder's alone, so the builder's transcript is the one that holds them.
night_package_opening() { printf 'Take the package %s.' "${NIGHT_PACKAGE}"; }
night_package_turn() {
  printf '%s Issue #%s of %s says what to build. Build it in a worktree of your own, run npm test, push the branch and open a pull request, then hand it off to %s. On its PASS, land it: land_batch with check 1, then for real, then verify_range, then ask me the question verify_range gives you.' \
    "$(night_package_opening)" "${NIGHT_PACKAGE##*#}" "${NIGHT_FULL_NAME}" "$(night_reviewer)"
}

# The package step: the package typed into the builder's session as the owner's turn, and its Enter.
night_package_step() {
  local builder
  NIGHT_PACKAGE="$(sed -n 's/^PACKAGE=//p' "${NIGHT_DIR}/${NIGHT_REPOSITORY_PART}")"
  NIGHT_BASE="$(sed -n 's/^BASE=//p' "${NIGHT_DIR}/${NIGHT_REPOSITORY_PART}")"
  [ -n "${NIGHT_PACKAGE}" ] && [ -n "${NIGHT_BASE}" ] || { failed 'night package' "${NIGHT_DIR}/${NIGHT_REPOSITORY_PART} names no package and base"; return 1; }
  builder="$(night_builder)" && night_reviewer > /dev/null || { failed 'night package' "the crew ${MEMBERS[*]} has no builder and reviewer"; return 1; }
  night_tmux send-keys -t "${builder}" -l "$(night_package_turn)" > /dev/null 2>&1 && sleep "${KEY_PAUSE_S}" \
    && night_tmux send-keys -t "${builder}" Enter > /dev/null 2>&1 \
    || { failed 'night package' "the package could not be typed into ${builder}'s session"; return 1; }
  ok 'night package' "${NIGHT_PACKAGE} typed into ${builder}'s session as the owner's turn"
}

# One script the container's shell runs on the night's record, its first line marking it as the record's.
night_record_script() { on_the_host podman exec "${CONTAINER}" sh -c ": night-record; $1"; }

# The two places of the clone's crew, by Martha's own keys: the state root of its launches, then its rows folder.
night_places() {
  night_record_script "set -eu; cd $(remote_word "${NIGHT_CLONE}"); c=\$(realpath .); g=\$(realpath \"\$(git rev-parse --path-format=absolute --git-common-dir)\"); \
printf '%s/%s\n' $(remote_word "${NIGHT_STATE}") \"\$(printf %s \"\$c\" | sha256sum | cut -c1-64)\"; \
printf '%s/crews/%s/rows\n' $(remote_word "${NIGHT_STATE}") \"\$(printf %s \"\$g\" | sha256sum | cut -c1-64)\""
}

# What the command after `to` prints, kept at `to` on the crew host through the token's redactor, mode 0600: the run
# never writes what it has not looked through. Exit 1 when the token had reached it, 2 when the command failed.
night_redacted_into() {
  local to="$1" old statuses
  shift
  old="$(umask)"
  umask 077
  "$@" | node --no-warnings "${NIGHT_GUARDS}" redact "${NIGHT_TOKEN_FILE}" > "${to}" 2> /dev/null
  statuses=("${PIPESTATUS[@]}")
  umask "${old}"
  [ "${statuses[0]}" = 0 ] || return 2
  return "${statuses[1]}"
}

# One file of the container's, kept at `to` through the redactor.
night_keep_a_file() { night_redacted_into "$2" on_the_host podman exec "${CONTAINER}" cat "$1"; }

# The crew's rows kept: every row file of the clone's crew, each through the redactor, in folders of mode 0700 as the
# store reads them. Echoes `reached` when the token was in one.
night_keep_rows() {
  local rows="$1" kept="$2" file reached='' status
  mkdir -m 700 -p "${kept}"
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    mkdir -m 700 -p "${kept}/$(dirname "${file}")"
    status=0
    night_keep_a_file "${rows}/${file}" "${kept}/${file}" || status=$?
    case "${status}" in 0) : ;; 1) reached=1 ;; *) return 2 ;; esac
  done < <(night_record_script "cd $(remote_word "${rows}") 2> /dev/null && find . -type f ! -name '.staging-*' | sed 's#^\./##' || true")
  [ -z "${reached}" ] || printf 'reached'
}

# Each launch of the clone's crew kept as one transcript, its request blobs left out as the proof's own reads leave
# them, each through the redactor; then named by whose it is: the one holding the package's opening is the builder's,
# the other the reviewer's. Echoes `reached` when the token was in one. The night starts two launches in the clone, so
# more than two, or more than one holding the opening, cannot be told apart and is refused by name, exit 3, the reason on
# standard error (Saturnus, #639 PR 821 r=2); with `whole`, the record's own read, fewer is refused too.
night_keep_transcripts() {
  local root="$1" kept="$2" whole="${3:-}" launch file reached='' status launches=0 holders=0 others=0
  mkdir -m 700 -p "${kept}/launches"
  while IFS= read -r launch; do
    [ -n "${launch}" ] || continue
    launches=$((launches + 1))
    status=0
    night_redacted_into "${kept}/launches/${launch}.jsonl" night_record_script \
      "cat ${root}/snapshots/$(remote_word "${launch}")/${NIGHT_LAUNCH_TRANSCRIPTS} 2> /dev/null | grep -vF -- $(remote_word "${REQUEST_BLOB}") || true" || status=$?
    case "${status}" in 0) : ;; 1) reached=1 ;; *) return 2 ;; esac
  done < <(night_record_script "ls $(remote_word "${root}/snapshots") 2> /dev/null || true")
  if [ "${launches}" -gt 2 ] || { [ -n "${whole}" ] && [ "${launches}" -ne 2 ]; }; then
    printf '%s launches in the clone'"'"'s state, expected 2: whose transcript is whose cannot be told\n' "${launches}" >&2
    return 3
  fi
  for file in "${kept}/launches/"*.jsonl; do
    [ -s "${file}" ] || continue
    if grep -qF -- "$(night_package_opening)" "${file}"; then holders=$((holders + 1)); else others=$((others + 1)); fi
  done
  if [ "${holders}" -gt 1 ] || [ "${others}" -gt 1 ] || { [ -n "${whole}" ] && [ "${holders}" -ne 1 ]; }; then
    printf '%s launches in the clone'"'"'s state hold the package'"'"'s opening and %s do not, expected 1 and 1\n' "${holders}" "${others}" >&2
    return 3
  fi
  for file in "${kept}/launches/"*.jsonl; do
    [ -s "${file}" ] || continue
    if grep -qF -- "$(night_package_opening)" "${file}"; then cp "${file}" "${kept}/$(night_builder).jsonl"; else cp "${file}" "${kept}/$(night_reviewer).jsonl"; fi
  done
  [ -z "${reached}" ] || printf 'reached'
}

# Each member's screen kept, as `screen placed` keeps one: the token was placed before these sessions drew.
night_keep_screens() {
  local kept="$1" name
  for name in "${MEMBERS[@]}"; do
    ( umask 077; set -o pipefail; night_kept "${name}" | node --no-warnings "${NIGHT_GUARDS}" screen placed > "${kept}/${name}.screen" 2> /dev/null ) || return 2
  done
}

# Whether the run's lines go through the redactor: on a night, whose token file is on this host from the start.
night_redacts() { a_night && [ -r "${NIGHT_TOKEN_FILE}" ]; }

# One line, through the redactor. A line the token had reached is said redacted, and the run notes it in the run
# folder, since a line can be said from inside a command substitution, whose variables the run never sees.
night_redacted_line() {
  local said status=0
  said="$(printf '%s' "$1" | node --no-warnings "${NIGHT_GUARDS}" redact "${NIGHT_TOKEN_FILE}" 2> /dev/null)" || status=$?
  case "${status}" in
    0) printf '%s' "${said}" ;;
    1) : > "${NIGHT_DIR}/${NIGHT_TOKEN_IN_LOG_PART}"; printf '%s' "${said}" ;;
    *) printf '%s' '(a line the redactor could not read was left out)' ;;
  esac
}

# The run's lines checked once more at its end: a line the token had reached fails the night by name.
night_log_held_no_token() {
  if ! a_night || [ ! -e "${NIGHT_DIR}/${NIGHT_TOKEN_IN_LOG_PART}" ]; then return 0; fi
  rm -f "${NIGHT_DIR}/${NIGHT_TOKEN_IN_LOG_PART}"
  failed 'night log' "$(night_token_reached_words)"
  return 1
}

# The kept record's own words for a token found in it.
night_token_reached_words() {
  node --no-warnings -e 'import(process.argv[1]).then((m) => process.stdout.write(m.THE_TOKEN_REACHED_THE_RECORD))' "${REPO}/src/land_a_package_on_a_throwaway_repository/the_kept_record.ts"
}

# The record step: the clone's transcripts, rows and screens copied out of the container while the members still run
# (a launch's snapshot goes with it), every byte through the redactor first. A token found in any of it is redacted
# there and fails the night by name.
night_record_step() {
  local places root rows kept="${NIGHT_DIR}/${NIGHT_KEPT_PART}" reached='' status
  NIGHT_RECORD_KEPT=1
  places="$(night_places 2> /dev/null)" || { failed 'night record' "the clone's state could not be found in the container"; return 1; }
  root="$(sed -n 1p <<< "${places}")"
  rows="$(sed -n 2p <<< "${places}")"
  mkdir -m 700 -p "${kept}"
  status=0
  reached="$(night_keep_transcripts "${root}" "${kept}" whole 2> "${NIGHT_DIR}/${NIGHT_WHY_PART}")" || status=$?
  case "${status}" in
    0) : ;;
    3) failed 'night record' "$(one_line "$(cat "${NIGHT_DIR}/${NIGHT_WHY_PART}")")"; return 1 ;;
    *) failed 'night record' "the transcripts under ${root} could not be kept"; return 1 ;;
  esac
  reached="${reached}$(night_keep_rows "${rows}" "${kept}/rows")" || { failed 'night record' "the crew's rows at ${rows} could not be kept"; return 1; }
  night_keep_screens "${kept}" || { failed 'night record' 'a member'"'"'s screen could not be kept'; return 1; }
  if [ -n "${reached}" ]; then
    failed 'night record' "$(night_token_reached_words)"
    return 1
  fi
  ok 'night record' "every launch's transcript, the crew's rows and each member's screen kept in ${kept}, through the redactor"
}

# The crew's rows as they stand, copied out to a fresh folder of the run's, for the night to read while it waits.
night_rows_now() {
  local places rows now="${NIGHT_DIR}/rows-now"
  places="$(night_places 2> /dev/null)" || return 2
  rows="$(sed -n 2p <<< "${places}")"
  rm -rf "${now}"
  night_keep_rows "${rows}" "${now}" > /dev/null || return 2
  printf '%s' "${now}"
}

# Whether the builder has queued the landing's ask, read from the builder's transcript and the crew's rows copied out
# now: any other ask is not it (Saturnus, #639 PR 821 r=2). Exit 0 asked, 1 not yet, 2 the container could not be
# read, 3 the launches cannot be told apart (the reason on standard error).
night_asked() {
  local now kept="${NIGHT_DIR}/${NIGHT_KEPT_PART}-now" status=0
  now="$(night_rows_now)" || return 2
  rm -rf "${kept}"
  night_keep_transcripts "$(sed -n 1p <<< "$(night_places)")" "${kept}" > /dev/null || status=$?
  [ "${status}" -eq 0 ] || return "$((status == 3 ? 3 : 2))"
  night_write_the_night "${kept}" "${now}"
  node --no-warnings "${NIGHT_GUARDS}" asked "${NIGHT_DIR}/${NIGHT_FILE_PART}" < /dev/null > /dev/null 2>&1
}

# The window's end, HH:MM, `seconds` from now.
night_closing_at() { date -d "+$1 seconds" '+%H:%M'; }

# Whether the container is gone, by podman's own answer that it is absent. A host that did not answer, or a container
# still there, is not gone: the night goes on waiting, and a window that ends on a read that failed says so rather than
# that nothing was queued (Pluto's timings, #639 PR 821).
NIGHT_CONTAINER_WENT='the container went away while the night waited'
night_container_went() { [ "$(container_state)" = absent ]; }

# The seconds since `started`, a value of SECONDS: each pass costs its copy out of the container as well as its sleep,
# so a window is counted on the clock, never as the sum of the sleeps.
night_elapsed() { printf '%s' "$((SECONDS - $1))"; }

# The ask step: the night waits, within its work window, for the builder to have queued the landing's ask.
night_ask_step() {
  local started="${SECONDS}" status why
  while :; do
    status=0
    why="$(night_asked 2>&1)" || status=$?
    [ "${status}" -ne 0 ] || break
    if [ "${status}" -eq 3 ]; then failed 'night ask' "$(one_line "${why}")"; return 1; fi
    if [ "${status}" -ge 2 ] && night_container_went; then failed 'night ask' "${NIGHT_CONTAINER_WENT}"; return 1; fi
    if [ "$(night_elapsed "${started}")" -ge "${NIGHT_WORK_WINDOW_S}" ]; then
      if [ "${status}" -ge 2 ]; then
        failed 'night ask' "the crew's rows could not be read when the work window of ${NIGHT_WORK_WINDOW_S}s ended"
      else
        failed 'night ask' "the crew queued no ask of the owner for the landing within ${NIGHT_WORK_WINDOW_S}s of the package"
      fi
      return 1
    fi
    sleep "${NIGHT_ROWS_POLL_S}"
  done
  ok 'night ask' "$(night_builder) queued the landing's ask"
}

# The owner's second command: their terminal attached to the builder's session in the container, where the landing's
# menu is.
night_attach_command() {
  printf 'ssh -t %s %s' "$(remote_word "${HOST}")" "$(remote_word "$(remote_words podman exec -it "${CONTAINER}" tmux -L "${NIGHT_TMUX_SOCKET}" attach -t "$(night_builder)")")"
}

# The owner's second act, printed as the first one is: a numbered list, the command on its own line under step 1, and
# the window's end on the step the run waits for (section 3).
night_the_owners_second_steps() {
  log "the owner's second act, in a terminal of your own, in this order:"
  log "  1. run this command, which attaches to $(night_builder)'s terminal in the container:"
  owner_command "$(night_attach_command)"
  # The yes is the owner's only from here: the landing reader holds the settle to after this time (Saturnus, r=2).
  NIGHT_ATTACH_AT="$(date +%s%3N)"
  log "  2. answer the landing's menu yes"
  log "  3. detach: Ctrl-b, then d — the run waits for the landing; the window closes $(night_closing_at "${NIGHT_YES_WINDOW_S}")"
}

# The owner's watch command: their terminal attached read-only to the builder's session, before the package is typed,
# so every ring of the builder's is sent while they watch (martha#843: a client that attaches later is sent nothing).
night_watch_command() {
  printf 'ssh -t %s %s' "$(remote_word "${HOST}")" "$(remote_word "$(remote_words podman exec -it "${CONTAINER}" tmux -L "${NIGHT_TMUX_SOCKET}" "${NIGHT_WATCH_ATTACH[@]}" -t "$(night_builder)")")"
}

# What the proof's own client runs: its pid noted, then that very process becomes the read-only tmux client.
night_watch_script() {
  printf 'echo $$ > %s.pid; exec tmux -L %s %s -t %s' "${NIGHT_WATCHED}" "${NIGHT_TMUX_SOCKET}" "${NIGHT_WATCH_ATTACH[*]}" "$(remote_word "$(night_builder)")"
}

# The proof's own client started, detached in the container, recording every byte it is sent; its keyboard a pipe that
# never writes, so it types nothing and never ends on its own. It goes with the container.
night_watcher_start() {
  on_the_host podman exec -d "${CONTAINER}" sh -c "sleep infinity | TERM=${NIGHT_WATCH_TERM} script -qfc $(remote_word "$(night_watch_script)") ${NIGHT_WATCHED}.rec" > /dev/null 2>&1
}

# The builder's session's clients now: pid, terminal and flags, one a line.
night_watch_clients() { night_tmux list-clients -t "$(night_builder)" -F '#{client_pid} #{client_tty} #{client_flags}' 2> /dev/null; }

# The pid of the proof's own client, once it has noted it.
night_watcher_pid() { on_the_host podman exec "${CONTAINER}" cat "${NIGHT_WATCHED}.pid" 2> /dev/null | tr -d '[:space:]'; }

# Whether a client other than the proof's own watches the builder's session read-only.
night_owner_watching() {
  local pid
  pid="$(night_watcher_pid)"
  [ -n "${pid}" ] && night_watch_clients | awk -v pid="${pid}" '$1 != pid && $3 ~ /(^|,)read-only(,|$)/ { found = 1 } END { exit found ? 0 : 1 }'
}

# The watch step: the proof's own client attached, the owner's watch printed, and the night waiting, within the owner's
# window, for the owner's read-only client, before the package is typed.
night_watch_step() {
  local waited=0
  night_watcher_start || { failed 'night watch' "the proof's own read-only client could not be started on $(night_builder)'s session"; return 1; }
  log "the owner's watch, in a terminal of your own, before the package is typed:"
  log "  1. run this command, which shows $(night_builder)'s terminal read-only; keep it open until the run ends:"
  owner_command "$(night_watch_command)"
  log "  2. nothing to type there: the run types the package once you watch; the window closes $(night_closing_at "${NIGHT_YES_WINDOW_S}")"
  until night_owner_watching; do
    if [ "${waited}" -ge "${NIGHT_YES_WINDOW_S}" ]; then
      failed owner "not watching $(night_builder)'s terminal read-only within ${NIGHT_YES_WINDOW_S}s"
      return 1
    fi
    sleep "${NIGHT_ROWS_POLL_S}"
    waited=$((waited + NIGHT_ROWS_POLL_S))
  done
  ok 'night watch' "the owner watches $(night_builder)'s terminal read-only"
}

# The watch file the watch guard reads: the package, the builder, the session's clients now, and the proof's own pid.
night_write_the_watch() {
  node -e 'const [file, p, b, clients, recorder] = process.argv.slice(1); require("node:fs").writeFileSync(file, JSON.stringify({ package: p, builder: b, clients, recorder }) + "\n")' \
    "${NIGHT_DIR}/${NIGHT_WATCH_PART}" "${NIGHT_PACKAGE}" "$(night_builder)" "$(night_watch_clients)" "$(night_watcher_pid)"
}

# The watch rows now: the bytes the proof's own client was sent, read straight from the container into the guard and
# never written on this host, and the watch file of this moment.
night_watch_now() {
  night_write_the_watch
  on_the_host podman exec "${CONTAINER}" cat "${NIGHT_WATCHED}.rec" 2> /dev/null | node --no-warnings "${NIGHT_GUARDS}" watch "${NIGHT_DIR}/${NIGHT_WATCH_PART}"
}

# The ring step (martha#843): once the landing is asked, the night waits, within the work window, for the builder's
# ring and the VERDICT line to be on the screen the owner watches, the owner's client listed; the watch file of that
# moment is kept. Then the builder's pane is shut, before the owner is asked to attach writable for the yes: from here
# no escape of the builder's reaches a client, so nothing it sends the owner's terminal is answered as typed keys.
night_ring_step() {
  local waited=0 why
  while ! why="$(night_watch_now 2>&1)"; do
    if [ "${waited}" -ge "${NIGHT_WORK_WINDOW_S}" ]; then
      failed 'night ring' "$(one_line "${why#"${NIGHT_GUARDS_SAY}"}")"
      return 1
    fi
    sleep "${NIGHT_ROWS_POLL_S}"
    waited=$((waited + NIGHT_ROWS_POLL_S))
  done
  ok 'night ring' "$(night_builder)'s ring and the VERDICT reached the screen the owner watches read-only"
  night_tmux set-option -p -t "$(night_builder)" "${NIGHT_PASSTHROUGH_OFF[@]}" > /dev/null 2>&1 \
    || { failed 'night shut' "$(night_builder)'s pane could not be shut before the owner attaches writable"; return 1; }
  ok 'night shut' "$(night_builder)'s pane passes nothing through to a client from here on"
}

# The night file the claims read: the package, its range (the base the night started on, the tip the pull request's
# head as GitHub reads it, empty before it is read), both members, their kept transcripts, the crew's kept rows, and
# when the owner's attach command was printed (empty before it is), which the owner's yes must follow.
night_write_the_night() {
  local kept="$1" rows="$2"
  node -e 'const [file, p, range, b, r, bt, rt, rows, at] = process.argv.slice(1); require("node:fs").writeFileSync(file, JSON.stringify({ package: p, range, builder: b, reviewer: r, builder_transcript: bt, reviewer_transcript: rt, rows_folder: rows, attach_printed_at: at }) + "\n")' \
    "${NIGHT_DIR}/${NIGHT_FILE_PART}" "${NIGHT_PACKAGE}" "${NIGHT_BASE}..${NIGHT_TIP}" "$(night_builder)" "$(night_reviewer)" \
    "${kept}/$(night_builder).jsonl" "${kept}/$(night_reviewer).jsonl" "${rows}" "${NIGHT_ATTACH_AT}"
}

# The landing as the crew's rows and the builder's transcript show it, read from a fresh copy: exit 0 when all three
# landing rows hold, the first that does not on standard error otherwise.
night_landing_now() {
  local now kept="${NIGHT_DIR}/${NIGHT_KEPT_PART}-now" status
  now="$(night_rows_now)" || return 2
  rm -rf "${kept}"
  status=0
  night_keep_transcripts "$(sed -n 1p <<< "$(night_places)")" "${kept}" > /dev/null || status=$?
  [ "${status}" -eq 0 ] || return "$((status == 3 ? 3 : 2))"
  night_write_the_night "${kept}" "${now}"
  node --no-warnings "${NIGHT_GUARDS}" landing "${NIGHT_DIR}/${NIGHT_FILE_PART}" < /dev/null
}

# GitHub's own record of the landing, read with the bot's login by the throwaway script: the pull request's head is
# the night's tip.
night_read_back() {
  local said status=0
  said="$("${NIGHT_THROWAWAY}" read-back "${NIGHT_DIR}" 2>&1)" || status=$?
  if [ "${status}" -ne 0 ]; then failed 'night read back' "GitHub's record of the landing could not be read: $(one_line "${said}")"; return 1; fi
  NIGHT_TIP="$(json_field "${NIGHT_DIR}/${NIGHT_LANDED_PART}" 'pull.head')" || { failed 'night read back' 'the pull request names no head'; return 1; }
}

# The yes step: the owner's second command printed, and the night waiting, within its window, for the landing to show
# in the crew's own rows. The tip is the pull request's head, read from GitHub first. A window that ends without it
# fails by the landing row that is still short, as `FAIL owner: no yes` when the yes never came.
night_yes_step() {
  local started why status
  night_read_back || return 1
  night_the_owners_second_steps
  started="${SECONDS}"
  while :; do
    status=0
    why="$(night_landing_now 2>&1)" || status=$?
    [ "${status}" -ne 0 ] || break
    why="${why#"${NIGHT_GUARDS_SAY}"}"
    if [ "${status}" -eq 3 ]; then failed 'night landing' "$(one_line "${why}")"; return 1; fi
    if [ "${status}" -ge 2 ] && night_container_went; then failed 'night landing' "${NIGHT_CONTAINER_WENT}"; return 1; fi
    if [ "$(night_elapsed "${started}")" -ge "${NIGHT_YES_WINDOW_S}" ]; then
      case "${why}" in
        *"$(night_landing_row OWNER_SAID_YES)"*) failed owner "no yes within ${NIGHT_YES_WINDOW_S}s: $(one_line "${why}")" ;;
        *) failed 'night landing' "$(one_line "${why}")" ;;
      esac
      return 1
    fi
    sleep "${NIGHT_ROWS_POLL_S}"
  done
  ok 'night landing' "the owner's yes landed ${NIGHT_PACKAGE}: the ask, its yes and the landing are in the crew's rows"
}

# A landing row's name, as the landing reader reports it.
night_landing_row() {
  node --no-warnings -e 'import(process.argv[1]).then((m) => process.stdout.write(m[process.argv[2]]))' "${REPO}/src/land_a_package_on_a_throwaway_repository/the_nights_landing.ts" "$1"
}

# The night's landing steps, after it is ready, in order; the first failure ends them. The record is kept in the
# finish, whatever happened, before the container goes.
night_landing_steps() {
  night_watch_step || return 1
  night_package_step || return 1
  night_ask_step || return 1
  night_ring_step || return 1
  night_yes_step || return 1
  NIGHT_LANDED=1
}

# The claims step, on the kept record: the night file written from the kept transcripts and rows, section 6's four crew
# rows and three landing rows read from them, and GitHub's half of row 7 read from a read-back made after the landing.
night_claims_step() {
  local kept="${NIGHT_DIR}/${NIGHT_KEPT_PART}" said first="${NIGHT_TIP}"
  # GitHub read again after the landing: the read the yes step made came before the owner's yes, when the pull request
  # was open and main did not hold its head yet (Saturnus, #639 PR 821 r=2). Its head must be the one the yes was for.
  night_read_back || return 1
  if [ -n "${first}" ] && [ "${NIGHT_TIP}" != "${first}" ]; then
    failed 'night claims' "it landed: the pull request's head moved from ${first} to ${NIGHT_TIP} after the owner's attach"
    return 1
  fi
  night_write_the_night "${kept}" "${kept}/rows"
  said="$(node --no-warnings "${NIGHT_GUARDS}" claims "${NIGHT_DIR}/${NIGHT_FILE_PART}" < /dev/null 2>&1)" || { failed 'night claims' "$(one_line "${said#"${NIGHT_GUARDS_SAY}"}")"; return 1; }
  said="$(node --no-warnings "${NIGHT_GUARDS}" landing "${NIGHT_DIR}/${NIGHT_FILE_PART}" < /dev/null 2>&1)" || { failed 'night claims' "$(one_line "${said#"${NIGHT_GUARDS_SAY}"}")"; return 1; }
  night_github_landed || return 1
  NIGHT_CLAIMED=1
  ok 'night claims' "section 6 holds for ${NIGHT_PACKAGE} ${NIGHT_BASE}..${NIGHT_TIP}: handed off, reviewed, asked, said yes to, landed"
}

# GitHub's half of row 7: main holds the tip, the merge's message names the package, and the pull request is merged,
# or closed with its head on main.
night_github_landed() {
  local landed="${NIGHT_DIR}/${NIGHT_LANDED_PART}" on_main message merged state
  on_main="$(json_field "${landed}" 'tip_on_main')" || on_main=''
  message="$(json_field "${landed}" 'main.message')" || message=''
  merged="$(json_field "${landed}" 'pull.merged')" || merged=''
  state="$(json_field "${landed}" 'pull.state')" || state=''
  [ "${on_main}" = true ] || { failed 'night claims' "it landed: GitHub's main does not hold ${NIGHT_TIP}"; return 1; }
  grep -qF -- "${NIGHT_PACKAGE}" <<< "${message}" || { failed 'night claims' "it landed: main's commit message does not name ${NIGHT_PACKAGE}"; return 1; }
  [ "${merged}" = true ] || [ "${state}" = closed ] || { failed 'night claims' "it landed: the pull request reads ${state}, neither merged nor closed"; return 1; }
}

# The record kept, in the finish, before the container goes, on a night that got ready whatever happened after; then
# the claims read from it, on a night whose landing showed.
night_keep_and_claim() {
  if ! a_night || [ -z "${NIGHT_READY}" ]; then return 0; fi
  night_record_step || return 1
  if [ -n "${NIGHT_LANDED}" ]; then night_claims_step; fi
}

# The night's steps after every member is proven in the checkout, in order; the first failure ends them.
night_steps() {
  night_stop_step || return 1
  night_clean_start_step || return 1
  night_restart_step || return 1
  night_token_step || return 1
  NIGHT_READY=1
  log "the night is ready: ${MEMBERS[*]} are up in ${NIGHT_CLONE} with the bot's login"
}

# The close: the night's repository deleted, whatever happened, once the container is gone. Its lines go in the log.
night_close() {
  local said status=0 line
  if [ -z "${NIGHT_OPENED}" ]; then return 0; fi
  said="$("${NIGHT_THROWAWAY}" close "${NIGHT_DIR}" 2>&1)" || status=$?
  while IFS= read -r line; do [ -z "${line}" ] || log "  ${line}"; done <<< "${said}"
  if [ "${status}" -ne 0 ]; then failed 'night close' "the throwaway repository was not proven gone (exit ${status}); see the lines above"; return 1; fi
  ok 'night close' 'the throwaway repository is gone'
}

# The night's stand-ins, beside the proof's own in `dir`: the throwaway script, curl, martha's `init`, and the podman
# answers for the night's own execs (night-podman, which the stand-in podman asks first and which answers 99 for an
# exec that is not the night's). Each answers from the case's folder; nothing here is shipped.
write_night_stand_ins() {
  local dir="$1"
  cat > "${dir}/throwaway" << 'THROWAWAY'
#!/usr/bin/env bash
# keep_a_throwaway_repository.sh, as far as the proof can tell: open makes the run folder with a first commit and the
# record the night reads; close says the repository is gone. Each is noted in the calls, in order.
set -u
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
printf 'throwaway %s\n' "$1" >> "${standin}/calls"
case "$1" in
  open)
    if [ -f "${standin}/night.open-fails" ]; then echo 'FAIL who: the calls answer as another account' >&2; exit 1; fi
    # A case whose night.open-says-token exists stands for a line of the open's that carries the token.
    if [ -f "${standin}/night.open-says-token" ]; then echo "a line with $(cat "${standin}/live/token") in it"; fi
    mkdir -p "$2/first"
    git -C "$2/first" init -q -b main
    printf '# A throwaway repository\n' > "$2/first/README.md"
    git -C "$2/first" add README.md
    git -C "$2/first" -c user.name=x -c user.email=x@example.invalid commit -qm first
    printf 'FULL_NAME=synthetic-bot/martha-live-x\nID=77\nBASE=%s\nBRANCH=main\nPACKAGE=synthetic-bot/martha-live-x#1\n' \
      "$(git -C "$2/first" rev-parse HEAD)" > "$2/repository.env"
    echo 'ok make: synthetic-bot/martha-live-x (id 77), private'
    ;;
  read-back)
    # GitHub's record of the landing: the pull request's head is the tip the crew's stand-in worked on. The first read
    # is the yes step's, before the owner's yes: the pull request is open and main does not hold its head. Every read
    # after it is after the landing. A case's night.not-on-main stands for a main that never holds it, and its
    # night.head-moves for a head that moved after the first read.
    echo read >> "${standin}/night.read-backs"
    tip="$(cat "$(dirname "$0")/night.tip")"
    head="${tip}" held=true merged=true state=closed
    if [ "$(wc -l < "${standin}/night.read-backs")" -eq 1 ]; then
      held=false merged=false state=open
    elif [ -f "${standin}/night.head-moves" ]; then
      head="$(printf 'e%.0s' {1..40})"
    fi
    if [ -f "${standin}/night.not-on-main" ]; then held=false; fi
    printf '{"pull":{"number":2,"head":"%s","merged":%s,"state":"%s"},"main":{"sha":"%s","message":"synthetic-bot/martha-live-x#1 landed"},"tip_on_main":%s}\n' \
      "${head}" "${merged}" "${state}" "${tip}" "${held}" > "$2/landed.json"
    echo 'ok read back: the pull request and main read'
    ;;
  close) echo 'ok close: synthetic-bot/martha-live-x deleted, and its id answers 404' ;;
esac
THROWAWAY
  cat > "${dir}/curl" << 'CURL'
#!/usr/bin/env bash
# curl, as far as the night's fetch can tell: the file it is asked to write holds words naming the address.
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
out='' url=''
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
printf 'curl %s\n' "${url}" >> "${standin}/calls"
printf 'the bytes of %s\n' "${url}" > "${out}"
CURL
  cat > "${dir}/martha" << 'MARTHA'
#!/usr/bin/env bash
# martha init, as far as the night's clone can tell: the crew declared in the folder it runs in.
if [ "${1:-}" = init ]; then : > the-stand-in-init-ran; mkdir -p .martha; printf '{"house_rules":{}}\n' > .martha/martha.json; fi
MARTHA
  cat > "${dir}/night-podman" << 'NIGHTPODMAN'
#!/usr/bin/env bash
# The stand-in podman's answers for the night's own execs, from the case's folder as the container's home; 99 for
# anything else, which the stand-in podman then answers itself. Every tmux session starts the stand-in member on a
# pipe of its own, its screen kept in the case's folder, and every process started here is noted so `rm` ends it.
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
here="$(dirname "$0")"
. "${here}/member.facts"
in_home() { sed "s#${home}#${standin}/home#g"; }
words="$*"
if [ "${1:-}" = rm ]; then
  while read -r pid; do kill "${pid}" 2> /dev/null || true; done < "${standin}/night.pids" 2> /dev/null
  exit 99
fi
[ "${1:-}" = exec ] || exit 99
# A case whose night.container-goes exists stands for a container that ends once the package is typed: podman has no
# such container from then on, and the night's first read of the crew's record after it fails as podman's own does.
if [ -f "${standin}/night.container-goes" ] && [ -f "${standin}/night.package-typed" ] && [[ "${words}" == *': night-record;'* ]]; then
  rm -f "${standin}/container.present"
  exit 125
fi
shift
user=node
input=''
while [ $# -gt 0 ]; do
  case "$1" in
    -i) input=1; shift ;;
    --user) user="$2"; shift 2 ;;
    -*) shift ;;
    *) shift; break ;;
  esac
done
# The container's process list: its idle process, a zombie, what the case's night.left holds, and the listing itself.
if [ "${1:-}" = ps ]; then
  printf '    1 Ss   the-idle-process\n   88 Z    [claude] <defunct>\n'
  cat "${standin}/night.left" 2> /dev/null || true
  printf '   99 R    %s\n' "$*"
  exit 0
fi
case "${words}" in
  *'cat > /root/night-debs/'*)
    [ "${user}" = root ] || exit 1
    cat > "${standin}/root.${words##*/}"
    ;;
  *'dpkg -i'*)
    [ "${user}" = root ] || exit 1
    for deb in ${words#*dpkg -i }; do
      case "${deb}" in /root/night-debs/*) [ -f "${standin}/root.${deb##*/}" ] || exit 1 ;; '&&') break ;; esac
    done
    : > "${standin}/tmux.installed"
    ;;
  *'tar -xzf -'*) cat > "${standin}/gh.tarball" ;;
  *'tmux -V && gh --version'*)
    [ -f "${standin}/tmux.installed" ] && [ -f "${standin}/gh.tarball" ] || exit 127
    printf 'tmux 3.3a\ngh version 2.104.0 (2026-11-12)\n'
    ;;
  *'git clone'*)
    [ -n "${input}" ] || exit 1
    PATH="${here}:${PATH}" sh -c "$(printf '%s' "${@: -1}" | in_home)"
    ;;
  *'find . -mindepth 1'*) sh -c "$(printf '%s' "${@: -1}" | in_home)" ;;
  *' find '*' -xdev'*)
    # A case whose night.plants-in-clone exists stands for a file in the clone the run did not put there; the file
    # names the clone, in the case's folder.
    if [ -f "${standin}/night.plants-in-clone" ]; then : > "$(cat "${standin}/night.plants-in-clone")/CLAUDE.md"; fi
    find "${standin}/home" -xdev | sed "s#^${standin}/home#${home}#"
    ;;
  *'tmux -L night start-server ; '*' new-session '*)
    # The session's command waits on its gate, as the run's does: the stand-in member starts only once the gate the
    # command names is there. Then it draws as the host does: its started line, and then a full-screen draw (the
    # alternate screen) that leaves that line off the pane, where the folder question's words are placed by moving the
    # cursor rather than by spaces.
    name=''
    while [ $# -gt 0 ]; do if [ "$1" = -s ]; then name="$2"; fi; command="$1"; shift; done
    gate="$(printf '%s' "${command}" | sed -n 's/^while \[ ! -e \([^ ]*\) \].*/\1/p' | in_home)"
    mkfifo "${standin}/tmux.${name}.keys"
    sleep 600 > "${standin}/tmux.${name}.keys" &
    printf '%s\n' "$!" >> "${standin}/night.pids"
    : > "${standin}/tmux.${name}.screen"
    (
      if [ -n "${gate}" ]; then until [ -e "${gate}" ]; do sleep 0.1; done; fi
      "${here}/member" "martha start ${name}" < "${standin}/tmux.${name}.keys" 2>&1 \
        | sed -u -e "s/\(${started} [0-9]*\)/\1"$'\033[?1049h\033[2J'"/" -e "/Quick safety check/s/ /"$'\033[1C'"/g"
    ) >> "${standin}/tmux.${name}.screen" &
    printf '%s\n' "$!" >> "${standin}/night.pids"
    ;;
  *'tmux -L night pipe-pane'*)
    # Kept from now on, as tmux keeps it: what the pane drew before the pipe began is not in it.
    name=''
    while [ $# -gt 0 ]; do if [ "$1" = -t ]; then name="$2"; fi; command="$1"; shift; done
    kept="$(printf '%s' "${command#cat >> }" | in_home)"
    tail -c 0 -F "${standin}/tmux.${name}.screen" >> "${kept}" 2> /dev/null &
    printf '%s\n' "$!" >> "${standin}/night.pids"
    ;;
  *'tmux -L night capture-pane'*)
    # Only what is on the pane: what the full-screen draw left there, never what it replaced.
    drawn="$(tr -d '\r' < "${standin}/tmux.${@: -1}.screen")"
    printf '%s\n' "${drawn##*$'\033[?1049h'}"
    ;;
  *'script -qfc'*'attach -r -t'*)
    # The proof's own read-only client (martha#843): its pid noted, and from now on every byte the session it watches
    # draws, as tmux sends a client of it.
    name="$(printf '%s' "${words}" | sed -n 's/.*attach -r -t \([^ ;]*\).*/\1/p' | tr -d "'\\\\\"")"
    mkdir -p "${standin}/home/.night-screens"
    printf '4101\n' > "${standin}/home/.night-screens/watched.pid"
    tail -c 0 -F "${standin}/tmux.${name}.screen" >> "${standin}/home/.night-screens/watched.rec" 2> /dev/null &
    printf '%s\n' "$!" >> "${standin}/night.pids"
    ;;
  *'tmux -L night list-clients'*)
    # The proof's own client once it has noted its pid, and the owner's read-only one unless the case's night.no-watch.
    pid="$(cat "${standin}/home/.night-screens/watched.pid" 2> /dev/null)"
    if [ -n "${pid}" ]; then printf '%s /dev/pts/1 attached,ignore-size,read-only\n' "${pid}"; fi
    if [ -n "${pid}" ] && [ ! -f "${standin}/night.no-watch" ]; then printf '4202 /dev/pts/2 attached,focused,ignore-size,read-only\n'; fi
    ;;
  *'tmux -L night set-option -p'*) printf '%s\n' "$*" > "${standin}/night.shut" ;;
  *'.night-screens'*)
    # The run's own execs on the folder that keeps the sessions' bytes: made, a gate touched, a kept file read.
    mapped=()
    for word in "$@"; do mapped+=("$(printf '%s' "${word}" | in_home)"); done
    "${mapped[@]}"
    ;;
  *'tmux -L night send-keys'*)
    name=''
    keys=()
    while [ $# -gt 0 ]; do
      case "$1" in -t) name="$2"; shift 2 ;; send-keys | -L | night | tmux | -l) shift ;; *) keys+=("$1"); shift ;; esac
    done
    for key in "${keys[@]}"; do
      case "${key}" in Down) printf '\033[B' ;; Enter) printf '\r' ;; *) printf '%s' "${key}" ;; esac
    done > "${standin}/tmux.${name}.keys"
    # The package typed into the builder: the crew's stand-in leaves what a worked night leaves.
    for key in "${keys[@]}"; do
      case "${key}" in
        'Take the package '*)
          printf '%s' "${key}" > "${standin}/night.package-typed"
          node --no-warnings "${here}/night-crew.mjs" "$(cat "${here}/repo.path")" "${standin}" "${standin}/home" \
            "${standin}/home/${clones}/synthetic-bot/martha-live-x" synthetic-bot/martha-live-x#1 \
            "$(sed -n 's/^BASE=//p' "${standin}/run/repository.env")" "$(cat "${here}/night.tip")" "${name}" \
            "$(printf '%s' "${key}" | sed 's/.*hand it off to \([^.]*\)\..*/\1/')" || exit 1
          # The VERDICT arriving on the builder's screen, and the builder's ring as tmux hands it on (martha#843),
          # unless the case's night.no-ring.
          if [ ! -f "${standin}/night.no-ring" ]; then
            node --no-warnings --input-type=module -e 'const [repo, member, p] = process.argv.slice(1); const r = await import(`${repo}/src/ring_the_owner/ring_the_owner.ts`); const c = await import(`${repo}/src/land_a_package_on_a_throwaway_repository/the_nights_claims.ts`); process.stdout.write(`\nVERDICT ${p} ${c.THE_VERDICT}\n${r.notificationOf(r.notificationIdOf(member), "landing", "yes")}`)' \
              "$(cat "${here}/repo.path")" "${name}" synthetic-bot/martha-live-x#1 >> "${standin}/tmux.${name}.screen" || exit 1
          fi
          ;;
      esac
    done
    ;;
  *': night-record;'*)
    # The run's own scripts on the night's record, in the case's home, their paths said back as the container's. A case
    # whose night.slow-rows exists stands for a host where each listing of the crew's rows takes NIGHT_SLOW_ROWS_S, and
    # counts the listings in night.rows-reads.
    if [ -f "${standin}/night.slow-rows" ] && [[ "${words}" == *'find . -type f'* ]]; then
      sleep "$(cat "${standin}/night.slow-rows")"
      echo read >> "${standin}/night.rows-reads"
    fi
    sh -c "$(printf '%s' "${@: -1}" | in_home)" | sed "s#${standin}/home#${home}#g"
    ;;
  *"${home}/.local/state/martha/"*)
    # One file of Martha's state read out: a row of the crew's. Anything else is the stand-in podman's own to answer.
    [ "${1:-}" = cat ] || exit 99
    cat "$(printf '%s' "$2" | in_home)"
    ;;
  *'.night-token'*)
    # The token script itself, in the case's home, with the stand-in gh first on its PATH.
    [ -n "${input}" ] || exit 1
    PATH="${here}/night-bin:${PATH}" sh -c "$(printf '%s' "${@: -1}" | in_home)"
    ;;
  *) exit 99 ;;
esac
NIGHTPODMAN
  cat > "${dir}/night-crew.mjs" << 'NIGHTCREW'
// The crew's night, as far as the run can tell: what a builder and a reviewer leave in the container once the package
// is typed. Each member's transcript in its own launch's snapshot, in the host's own record shapes (a string prompt for a
// handed turn, a tool_use block for a call, the tool names as the host spells them), and the crew's rows through the
// rows store itself. The lines are written out here, never built with the readers' functions. The case's flags take
// one thing away: night.no-handoff the builder's handoff call, night.no-ask every row, night.no-yes the owner's yes and
// the landing, night.token-in-transcript puts the token the builder could read into its transcript. night.only-other-ask
// queues an ask that is not the landing's in place of it, night.three-launches leaves a third launch in the clone, and
// night.yes-before-attach settles the yes before the owner's attach command could be printed. The owner's yes is
// otherwise settled a minute after the package is typed, after the attach command, as a real owner's comes.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [repo, standin, home, clone, pkg, base, tip, builder, reviewer] = process.argv.slice(2)
const flag = (name) => existsSync(join(standin, name))
const { OWNERS_QUESTION_LEAD_IN } = await import(join(repo, 'src/check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'))
const { rowStreamsDirectory } = await import(join(repo, 'src/row_streams_directory/row_streams_directory.ts'))
const sha = (text) => createHash('sha256').update(text).digest('hex')
const state = join(home, '.local/state/martha')
const range = `${base}..${tip}`
const handoff = `HANDOFF ${pkg} ${range} r=1 ci=none:paths`
const verdict = `VERDICT ${pkg} PASS ${range} r=1 ci=none:paths req=0`
const question = `Land ${pkg} on ${pkg.split('#')[0]} main at ${tip}?`
const at = (minute) => `2026-11-19T01:${String(minute).padStart(2, '0')}:00.000Z`
const call = (minute, name, input) => JSON.stringify({ parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: 'u', timestamp: at(minute), message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'tool_use', id: `toolu_${minute}`, name, input }] } })
const turn = (minute, content) => JSON.stringify({ parentUuid: 'p', isSidechain: false, type: 'user', uuid: 'u', timestamp: at(minute), message: { role: 'user', content } })
const result = (minute, text) => turn(minute, [{ type: 'tool_result', tool_use_id: `toolu_${minute - 1}`, content: [{ type: 'text', text }] }])
const typed = readFileSync(join(standin, 'night.package-typed'), 'utf8')
const token = readFileSync(join(standin, 'live/token'), 'utf8').trim()

const builderLines = [turn(1, typed)]
if (flag('night.token-in-transcript')) builderLines.push(result(2, `Logged in to github.com account synthetic-bot\nToken: ${token}`))
if (!flag('night.no-handoff')) builderLines.push(call(3, 'mcp__martha__say_to_the_crew', { to: [reviewer], text: `${handoff}\nthe package is ready` }))
builderLines.push(
  turn(6, `[crew #2] ${reviewer}: ${verdict}\nall good`),
  call(7, 'mcp__martha__verify_range', { path: clone, base, tip, packages: [pkg] }),
  result(8, ['one commit', ' greet.js | 3 +', '', OWNERS_QUESTION_LEAD_IN, question, '', 'the range'].join('\n')),
  call(9, 'mcp__martha__ask_the_owner', { ask: question }),
)
const reviewerLines = [turn(4, `[crew #1] ${builder}: ${handoff}\nthe package is ready`), call(5, 'mcp__martha__say_to_the_crew', { to: [builder], text: `${verdict}\nall good` })]
const launches = join(state, sha(realpathSync(clone)), 'snapshots')
for (const [launch, lines] of [['launch-b', builderLines], ['launch-r', reviewerLines]]) {
  const folder = join(launches, launch, 'the-members-own-config/projects/-clone')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'session.jsonl'), lines.join('\n') + '\n')
}

if (flag('night.three-launches')) {
  const folder = join(launches, 'launch-x', 'the-members-own-config/projects/-clone')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'session.jsonl'), reviewerLines.join('\n') + '\n')
}

if (!flag('night.no-ask')) {
  const rows = join(state, 'crews', sha(realpathSync(join(clone, '.git'))), 'rows')
  mkdirSync(rows, { recursive: true, mode: 0o700 })
  const store = rowStreamsDirectory(rows)
  const settled = Date.now() + (flag('night.yes-before-attach') ? -60_000 : 60_000)
  const asking = flag('night.only-other-ask') ? 'Which name should the greeting use?' : question
  await store.append('owner_asks', { kind: 'ask_queued', question: asking, asked_by: builder, since: settled - 60_000 })
  if (!flag('night.no-yes') && !flag('night.only-other-ask')) {
    await store.append('owner_asks', { kind: 'asks_taken', asks: [0], at: settled - 1_000, by: 'owner', session: 's' })
    await store.append('owner_asks', { kind: 'asks_settled', batch: 1, yes: [0], at: settled, by: 'owner' })
    await store.append(`ledger/${pkg}`, { kind: 'act_announced', package: pkg, member: builder, at: settled + 5_000, act: { kind: 'push', what: `the default branch of ${clone} fast-forwarded to ${tip}` } })
    await store.append(`ledger/${pkg}`, { kind: 'package_landed', package: pkg, member: builder, at: settled + 5_001, note: `${range} on the owner's yes to ask 0` })
  }
}
NIGHTCREW
  printf '%s\n' "${REPO}" > "${dir}/repo.path"
  printf 'd%.0s' {1..40} > "${dir}/night.tip"
  mkdir -p "${dir}/night-bin"
  cat > "${dir}/night-bin/gh" << 'GH'
#!/usr/bin/env bash
# gh in the container, as far as the token script can tell: the login keeps what it reads (or fails, when the case's
# night.gh-login-fails exists), and `api user` answers the case's id.
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
case "${1:-} ${2:-}" in
  'auth login') [ ! -f "${standin}/night.gh-login-fails" ] || exit 1; cat > "${standin}/container.token" ;;
  'auth setup-git') ;;
  'api user') cat "${standin}/night.gh.id" 2> /dev/null || printf '4242\n' ;;
  *) exit 1 ;;
esac
GH
  chmod +x "${dir}/throwaway" "${dir}/curl" "${dir}/martha" "${dir}/night-podman" "${dir}/night-bin/gh"
}

# A night case: the proof's own case, its setup files (a bot with id 4242, a token nobody else holds) and its pins
# for the stand-in curl's words, each the sha256 of what it writes. `flag`, when given, is one more file of the case's.
night_case() {
  local standin="$1" flag="${2:-}" name digest url
  a_case "${standin}"
  printf '%s\n' "$(json_field "${RELEASE_PACKAGE}" 'version')" > "${standin}/version.words"
  mkdir -p "${standin}/live"
  printf '%s\n' "${NIGHT_SELF_TEST_TOKEN}" > "${standin}/live/token"
  chmod 600 "${standin}/live/token"
  printf '{"login":"synthetic-bot","id":4242}\n' > "${standin}/live/owner.json"
  while read -r name digest url; do
    printf '%s sha256:%s %s\n' "${name}" "$(printf 'the bytes of %s\n' "${url}" | sha256sum | cut -d' ' -f1)" "${url}"
  done < <(printf '%s\n' "${NIGHT_DEB_PINS[@]}" "${NIGHT_GH_PIN}") > "${standin}/pins"
  if [ -n "${flag}" ]; then : > "${standin}/${flag}"; fi
}

# A night case run with --night, its setup and stand-ins named, that must exit `expected`.
night_expect() {
  local expected="$1" standin="$2"
  MARTHA_LIVE_DIR="${standin}/live" MARTHA_CLEAN_INSTALL_THROWAWAY="${STAND_INS}/throwaway" \
    MARTHA_CLEAN_INSTALL_NIGHT_PINS="${standin}/pins" expect_status "${expected}" "${standin}" 'a-host' --night "${standin}/run" \
    --owner-commands "${standin}/owner_commands"
}

# Whether the owner's commands file holds the night's three commands and nothing else, each byte for byte the line
# printed under its step: the follow script runs only what is in that file (the threat model on #639). The watch
# (martha#843) comes between the first act and the second.
night_owner_commands_kept() {
  local out="$1" commands="$2" printed
  printed="$(grep -A1 -xF -e '  1. run this command, which approves the crew and opens Claude Code in the checkout:' \
    -e "  1. run this command, which shows builder's terminal read-only; keep it open until the run ends:" \
    -e "  1. run this command, which attaches to builder's terminal in the container:" "${out}" | grep '^  ssh -t ' | sed 's/^  //')"
  [ "$(wc -l < "${commands}")" -eq 3 ] || { echo "the self-test: the owner's commands file does not hold the night's three commands: $(wc -l < "${commands}") line(s)" >&2; return 1; }
  [ "$(cat "${commands}")" = "${printed}" ] || { echo "the self-test: the owner's commands file is not the commands printed under their steps" >&2; return 1; }
}

# Whether the owner's second act was printed as the list they follow: the heading, step 1 with the command attaching to
# the builder's session on its own line under it, the yes, and the marker with the time its window closes. Read line
# by line and compared whole, as the first act's list is.
night_second_steps_printed() {
  local out="$1" at line expected
  at="$(grep -nxF -- "the owner's second act, in a terminal of your own, in this order:" "${out}" | head -1 | cut -d: -f1)"
  [ -n "${at}" ] || { echo "the self-test: the owner's second act was not printed as a list (no heading)" >&2; return 1; }
  expected="  1. run this command, which attaches to builder's terminal in the container:"
  line="$(sed -n "$((at + 1))p" "${out}")"
  [ "${line}" = "${expected}" ] || { echo "the self-test: the owner's second act's first step is not the numbered one: ${line}" >&2; return 1; }
  line="$(sed -n "$((at + 2))p" "${out}")"
  case "${line}" in
    "  ssh -t 'a-host' "*"tmux"*"'-L'"*"'night'"*"'attach'"*"'-t'"*"'builder'"*) : ;;
    *) echo "the self-test: the owner's second command does not attach to the builder's session: ${line}" >&2; return 1 ;;
  esac
  line="$(sed -n "$((at + 3))p" "${out}")"
  [ "${line}" = "  2. answer the landing's menu yes" ] || { echo "the self-test: the owner's second act's step 2 is not the yes: ${line}" >&2; return 1; }
  line="$(sed -n "$((at + 4))p" "${out}")"
  case "${line}" in
    '  3. detach: Ctrl-b, then d — the run waits for the landing; the window closes '[0-2][0-9]:[0-5][0-9]) : ;;
    *) echo "the self-test: the owner's second act does not end on the marker with its window: ${line}" >&2; return 1 ;;
  esac
}

# Whether the first line `first` matches comes before the first line `then` matches, in `out`.
night_in_order() {
  local first then
  first="$(grep -n -- "$2" "$1" | head -1 | cut -d: -f1)"
  then="$(grep -n -- "$3" "$1" | head -1 | cut -d: -f1)"
  [ -n "${first}" ] && [ -n "${then}" ] && [ "${first}" -lt "${then}" ]
}

# Whether the owner's watch was printed as the list they follow: the heading, step 1 with the read-only attach to the
# builder's session on its own line under it, exactly the night's read-only words, and the window on step 2.
night_watch_printed() {
  local out="$1" at line
  at="$(grep -nxF -- "the owner's watch, in a terminal of your own, before the package is typed:" "${out}" | head -1 | cut -d: -f1)"
  [ -n "${at}" ] || { echo "the self-test: the owner's watch was not printed as a list (no heading)" >&2; return 1; }
  line="$(sed -n "$((at + 1))p" "${out}")"
  [ "${line}" = "  1. run this command, which shows builder's terminal read-only; keep it open until the run ends:" ] \
    || { echo "the self-test: the owner's watch's first step is not the numbered one: ${line}" >&2; return 1; }
  line="$(sed -n "$((at + 2))p" "${out}")"
  case "${line}" in
    "  ssh -t 'a-host' "*"'\''tmux'\'' '\''-L'\'' '\''night'\'' '\''attach'\'' '\''-r'\'' '\''-t'\'' '\''builder'\''"*) : ;;
    *) echo "the self-test: the owner's watch is not the read-only attach to the builder's session: ${line}" >&2; return 1 ;;
  esac
  line="$(sed -n "$((at + 3))p" "${out}")"
  case "${line}" in
    '  2. nothing to type there: the run types the package once you watch; the window closes '[0-2][0-9]:[0-5][0-9]) : ;;
    *) echo "the self-test: the owner's watch does not end on its window: ${line}" >&2; return 1 ;;
  esac
}

# Whether the night's repository was closed after the container went: the run's close line after its tear-down.
night_closed_after_tear_down() {
  local out="$1/out" torn closed
  torn="$(grep -n '^ok tear down: ' "${out}" | head -1 | cut -d: -f1 || true)"
  closed="$(grep -n '^ok night close: ' "${out}" | head -1 | cut -d: -f1 || true)"
  [ -n "${closed}" ] && { [ -z "${torn}" ] || [ "${torn}" -lt "${closed}" ]; } \
    || { echo "the self-test: ${1##*/} did not delete the night's repository after the container went" >&2; return 1; }
}

# The night's cases: one that gets ready, and one for each guard that must stop it by name.
night_self_test() {
  local root="$1" standin failures=0 deb night_ask_passes
  local NIGHT_SLOW_ROWS_S=2
  NIGHT_SELF_TEST_TOKEN='github_pat_a-word-only-the-night-cases-hold'
  write_night_stand_ins "${STAND_INS}"
  sed -i 's#^case "${1:-}" in$#if [ -x "$(dirname "$0")/night-podman" ]; then "$(dirname "$0")/night-podman" "$@"; s=$?; [ "${s}" -eq 99 ] || exit "${s}"; fi\ncase "${1:-}" in#' "${STAND_INS}/podman"
  grep -q 'night-podman' "${STAND_INS}/podman" || { echo 'the self-test: the stand-in podman does not ask the night first' >&2; return 1; }
  nfail() { echo "the self-test: $1" >&2; failures=$((failures + 1)); }

  # A night that gets ready: the tools in on standard input, dpkg as root, the clone from the bundle with a plain
  # origin, both places approved, the members stopped and started again in tmux in the clone, the token on standard
  # input only, gh there answering as the bot, and the repository deleted after the container.
  standin="${root}/night-ready"; night_case "${standin}" member.trust
  night_expect 0 "${standin}" || failures=$((failures + 1))
  asked_for '^the night is ready: ' "${standin}/out" || nfail 'a night that got ready did not say so'
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))
  head -1 "${standin}/calls" | grep -qx 'throwaway open' || nfail 'the night did not make its repository first'
  for deb in "${NIGHT_DEB_PINS[@]}"; do [ -f "${standin}/root.${deb%% *}" ] || nfail "${deb%% *} was not passed in to root"; done
  [ -f "${standin}/gh.tarball" ] || nfail 'gh was not passed in'
  asked_for '^exec --user root .* dpkg -i ' "${standin}/calls" || nfail 'dpkg did not run as root'
  [ "$(git -C "${standin}/home/${NIGHT_CLONES}/synthetic-bot/martha-live-x" remote get-url origin 2> /dev/null)" = 'https://github.com/synthetic-bot/martha-live-x.git' ] \
    || nfail "the clone's origin is not the repository's plain address"
  asked_for 'martha approve && cd .*martha-live-x && martha approve && cd ' "${standin}/out" || nfail 'the owner'"'"'s command does not approve both places'
  asked_for '^  2. approve the checkout, then the throwaway clone: type yes where martha approve asks, nothing where it asks nothing$' "${standin}/out" \
    || nfail 'the owner'"'"'s steps do not follow approve in both places'
  for name in "${SELF_TEST_MEMBERS[@]}"; do
    asked_for "tmux -L night start-server ; .* ; new-session -d -s ${name} .*cd ${CONTAINER_HOME}/${NIGHT_CLONES}/synthetic-bot/martha-live-x; martha start " "${standin}/calls" \
      || nfail "${name} was not started again by its own command, in the clone, in tmux"
  done
  # The night server's bounds (martha#843), set as each session starts: what they do is the real-tmux cases' (the ring
  # on the night's tmux); that the night sets them is this.
  asked_for "tmux -L night start-server ; $(printf '%s ' "${NIGHT_TMUX_BOUNDS[@]}"); new-session " "${standin}/calls" || nfail 'the night server was started without its bounds'
  [ "$(json_field "${standin}/home/${NIGHT_CLONES}/synthetic-bot/martha-live-x/${NIGHT_DECLARATION}" 'house_rules.owner_bell')" = true ] \
    || nfail "the clone's crew does not ring the owner's bells"
  # The watch before the package, the ring on the watched screen, and the builder's pane shut before the owner's
  # writable attach is printed (martha#843 R1).
  night_watch_printed "${standin}/out" || failures=$((failures + 1))
  asked_for '^ok night ring: builder' "${standin}/out" || nfail "the builder's ring was not found on the watched screen"
  [ "$(cat "${standin}/night.shut" 2> /dev/null)" = "tmux -L night set-option -p -t builder ${NIGHT_PASSTHROUGH_OFF[*]}" ] || nfail "the builder's pane was not shut"
  night_in_order "${standin}/out" '^ok night watch: ' '^Take the package\|^ok night ask: ' || nfail 'the package went before the owner watched'
  night_in_order "${standin}/out" '^ok night shut: ' "^the owner's second act" || nfail "the owner was asked to attach writable before the builder's pane was shut"
  [ -f "${standin}/run/${NIGHT_WATCH_PART}" ] || nfail 'the watch file of the ring was not kept'
  # Each member's folder question answered twice: in the checkout, then again in the clone.
  [ "$(grep -c $'\033\[B' "${standin}/typed" 2> /dev/null)" = "$((2 * ${#SELF_TEST_MEMBERS[@]}))" ] \
    || nfail "the folder question was not answered for each member in the clone"
  [ "$(cat "${standin}/container.token" 2> /dev/null)" = "${NIGHT_SELF_TEST_TOKEN}" ] || nfail 'the token did not reach the container on standard input'
  [ ! -e "${standin}/home/${NIGHT_TOKEN_DROP#"${CONTAINER_HOME}/"}" ] || nfail "the token's file was left in the home"
  if grep -qF -- "${NIGHT_SELF_TEST_TOKEN}" "${standin}/calls" "${standin}/out" "${standin}/err"; then nfail 'the token was an argument, or reached the log'; fi
  # The package typed into the builder, the owner's second act printed as a list, the record kept through the redactor,
  # and section 6 read from it on the real readers: the night lands.
  grep -qx 'Take the package synthetic-bot/martha-live-x#1\. Issue #1 of synthetic-bot/martha-live-x says what to build\..*hand it off to reviewer\..*' "${standin}/night.package-typed" 2> /dev/null \
    || nfail 'the package was not typed into the builder as the owner'"'"'s turn'
  asked_for 'tmux -L night send-keys -t builder -l Take the package ' "${standin}/calls" || nfail 'the package was not typed into the builder'"'"'s own session'
  night_second_steps_printed "${standin}/out" || failures=$((failures + 1))
  night_owner_commands_kept "${standin}/out" "${standin}/owner_commands" || failures=$((failures + 1))
  asked_for "^ok night claims: section 6 holds for synthetic-bot/martha-live-x#1 [0-9a-f]\{40\}\.\.d\{40\}: " "${standin}/out" || nfail 'a night that landed did not say section 6 holds'
  # GitHub read twice: before the owner's yes for the head, and after the landing for the claims (Saturnus, r=2).
  [ "$(wc -l < "${standin}/night.read-backs")" -eq 2 ] || nfail "GitHub was not read again after the landing: $(wc -l < "${standin}/night.read-backs") read(s)"
  for kept in builder.jsonl reviewer.jsonl builder.screen reviewer.screen; do
    [ -f "${standin}/run/${NIGHT_KEPT_PART}/${kept}" ] || nfail "the kept record has no ${kept}"
  done
  [ "$(stat -c '%a' "${standin}/run/${NIGHT_KEPT_PART}/builder.jsonl" 2> /dev/null)" = 600 ] || nfail 'a kept transcript is not mode 0600'
  grep -q '"name":"mcp__martha__say_to_the_crew"' "${standin}/run/${NIGHT_KEPT_PART}/builder.jsonl" 2> /dev/null || nfail "the builder's kept transcript is not the builder's"
  if grep -q 'Take the package' "${standin}/run/${NIGHT_KEPT_PART}/reviewer.jsonl" 2> /dev/null; then nfail "the reviewer's kept transcript holds the builder's turn"; fi
  [ "$(json_field "${standin}/run/${NIGHT_FILE_PART}" rows_folder)" = "${standin}/run/${NIGHT_KEPT_PART}/rows" ] || nfail 'the night file does not read the kept rows'
  asked_for "^create .* sleep $((CONTAINER_IDLE_S + MARTHA_CLEAN_INSTALL_NIGHT_WORK_WINDOW_S + MARTHA_CLEAN_INSTALL_NIGHT_YES_WINDOW_S))$" "${standin}/calls" \
    || nfail "a night's container does not idle for the night's windows on top of the proof's"

  # The owner never says yes: the landing's row named as the owner's, the record still kept, the repository still goes.
  standin="${root}/night-no-yes"; night_case "${standin}" night.no-yes
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL owner: no yes within ${MARTHA_CLEAN_INSTALL_NIGHT_YES_WINDOW_S}s: the owner said yes: " "${standin}/out" || nfail 'a night with no yes was not named as the owner'"'"'s'
  [ -f "${standin}/run/${NIGHT_KEPT_PART}/builder.jsonl" ] || nfail 'a night with no yes kept no record'
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # The owner never watches (martha#843): named as the owner's, and the package never typed.
  standin="${root}/night-no-watch"; night_case "${standin}" night.no-watch
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL owner: not watching builder's terminal read-only within " "${standin}/out" || nfail 'a night the owner never watched was not named as the owner'"'"'s'
  [ ! -e "${standin}/night.package-typed" ] || nfail 'the package was typed with nobody watching'

  # The builder's ring never reaches the watched screen (martha#843): named by its row, the pane not shut, and the
  # owner never asked to attach writable.
  standin="${root}/night-no-ring"; night_case "${standin}" night.no-ring
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night ring: the builder's ring was sent to the owner's screen: " "${standin}/out" || nfail 'a ring that never reached the watched screen was not named by its row'
  if grep -q "^the owner's second act" "${standin}/out"; then nfail 'the owner'"'"'s second command was printed with no ring seen'; fi

  # The crew queues no ask: named, and the owner's second command never printed.
  standin="${root}/night-no-ask"; night_case "${standin}" night.no-ask
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night ask: the crew queued no ask of the owner for the landing within ' "${standin}/out" || nfail 'a night with no ask was not named'
  if grep -q "^the owner's second act" "${standin}/out"; then nfail 'the owner'"'"'s second command was printed with no ask queued'; fi

  # The container ends while the night waits for the ask: named as gone, never as a crew that queued nothing (Pluto's
  # timings, #639 PR 821).
  standin="${root}/night-container-goes"; night_case "${standin}" night.container-goes
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night ask: ${NIGHT_CONTAINER_WENT}$" "${standin}/out" || nfail 'a container that went away while the night waited was not named'
  if grep -q '^FAIL night ask: the crew queued no ask' "${standin}/out"; then nfail 'a container that went away was read as a crew that queued no ask'; fi

  # Each listing of the rows takes longer than a poll: the work window is counted on the clock, so the night gives up
  # after the passes that fit in it, not after one pass per poll interval. One listing of NIGHT_SLOW_ROWS_S, and the
  # window MARTHA_CLEAN_INSTALL_NIGHT_WORK_WINDOW_S: the clock passes the window by the second pass at the latest,
  # where counting the sleeps alone takes one pass per second of the window and one more.
  standin="${root}/night-slow-rows"; night_case "${standin}" night.no-ask
  printf '%s\n' "${NIGHT_SLOW_ROWS_S}" > "${standin}/night.slow-rows"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night ask: the crew queued no ask of the owner for the landing within ' "${standin}/out" || nfail 'a night with slow rows and no ask was not named'
  night_ask_passes="$({ wc -l < "${standin}/night.rows-reads"; } 2> /dev/null || echo 0)"
  # Two passes in the window and the record's one read after it; counting the sleeps took five passes.
  [ "${night_ask_passes}" -le 3 ] || nfail "the work window was counted as its sleeps: ${night_ask_passes} reads of the crew's rows"

  # An ask that is not the landing's: the night waits on, and never prints the owner's attach for it (Saturnus, #639 PR 821
  # r=2).
  standin="${root}/night-other-ask"; night_case "${standin}" night.only-other-ask
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night ask: the crew queued no ask of the owner for the landing within ' "${standin}/out" || nfail 'an ask that is not the landing'"'"'s was taken for it'
  if grep -q "^the owner's second act" "${standin}/out"; then nfail 'the owner'"'"'s second command was printed for an ask that is not the landing'"'"'s'; fi

  # A third launch in the clone: whose transcript is whose cannot be told, and the night says so (Saturnus, r=2).
  standin="${root}/night-three-launches"; night_case "${standin}" night.three-launches
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night ask: 3 launches in the clone's state, expected 2" "${standin}/out" || nfail 'a third launch in the clone was not named'

  # A yes settled before the owner's attach command was printed is not the owner's (Saturnus, r=2).
  standin="${root}/night-yes-before-attach"; night_case "${standin}" night.yes-before-attach
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL owner: no yes within ${MARTHA_CLEAN_INSTALL_NIGHT_YES_WINDOW_S}s: the owner said yes: .* not after the owner's attach command was printed" "${standin}/out" \
    || nfail 'a yes settled before the attach command was printed was taken'

  # The pull request's head moved after the owner's yes: the landing is not the one the yes was for (Saturnus, r=2).
  standin="${root}/night-head-moves"; night_case "${standin}" night.head-moves
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night claims: it landed: the pull request's head moved from d\{40\} to e\{40\}" "${standin}/out" || nfail 'a head that moved after the yes was not named'

  # R4: the token reaches a transcript: the kept record holds it redacted, and the night fails by name.
  standin="${root}/night-token-kept"; night_case "${standin}" night.token-in-transcript
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night record: the token reached the kept record$' "${standin}/out" || nfail 'a token in a transcript was not named'
  if grep -rqF -- "${NIGHT_SELF_TEST_TOKEN}" "${standin}/run" "${standin}/out" "${standin}/err"; then nfail 'the token reached the kept record or the log'; fi
  [ -f "${standin}/run/${NIGHT_KEPT_PART}/builder.jsonl" ] || nfail 'a transcript with the token in it was not kept redacted'

  # R4 in the log: a line the run says carries the token: said redacted, and the night fails by name.
  standin="${root}/night-token-in-log"; night_case "${standin}" night.open-says-token
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night log: the token reached the kept record$' "${standin}/out" || nfail 'a token in a line of the run was not named'
  if grep -qF -- "${NIGHT_SELF_TEST_TOKEN}" "${standin}/out" "${standin}/err"; then nfail 'the token reached the run'"'"'s lines'; fi
  asked_for '^  a line with .* in it$' "${standin}/out" || nfail 'the line that carried the token was not said, redacted'

  # Row 1: the builder never hands off: the claims fail by the row's name.
  standin="${root}/night-no-handoff"; night_case "${standin}" night.no-handoff
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night claims: the builder handed off: ' "${standin}/out" || nfail 'a night with no handoff was not named by its row'

  # Row 7, GitHub's half: main does not hold the pull request's head.
  standin="${root}/night-not-on-main"; night_case "${standin}" night.not-on-main
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night claims: it landed: GitHub's main does not hold d\{40\}$" "${standin}/out" || nfail 'a tip main does not hold was not named'

  # gh in the container will not log in: named, and the token's file still goes from the home.
  standin="${root}/night-login-fails"; night_case "${standin}" night.gh-login-fails
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night token: gh in the container would not log in' "${standin}/out" || nfail 'a failed gh login was not named'
  [ ! -e "${standin}/home/${NIGHT_TOKEN_DROP#"${CONTAINER_HOME}/"}" ] || nfail "a failed gh login left the token's file in the home"
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # A pinned file whose bytes are not its pin: refused by name before any container is made, and the repository goes.
  standin="${root}/night-bad-bytes"; night_case "${standin}"
  sed -i '1s/sha256:[0-9a-f]*/sha256:0000000000000000000000000000000000000000000000000000000000000000/' "${standin}/pins"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night fetch: .* not the pinned sha256:0000' "${standin}/out" || nfail 'bytes that are not their pin were not refused by name'
  if grep -q '^create ' "${standin}/calls"; then nfail 'a container was made after a pin was refused'; fi
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # R3: the clone holds a file the run did not put there: named, no token placed, no member started there.
  standin="${root}/night-unclean-start"; night_case "${standin}" night.plants-in-clone
  printf '%s\n' "${standin}/home/${NIGHT_CLONES}/synthetic-bot/martha-live-x" > "${standin}/night.plants-in-clone"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night clean start: .*martha-live-x/CLAUDE.md: in the clone, and the run did not put it there" "${standin}/out" \
    || nfail 'a stranger file in the clone was not named'
  [ ! -e "${standin}/container.token" ] || nfail 'a token was placed after an unclean start'
  if grep -q 'new-session' "${standin}/calls"; then nfail 'a member was started in an unclean clone'; fi
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # A member's own process left after the stop, and apart from it a host session alone (a claude a member started,
  # outliving its martha): each named by its command line, and no token placed.
  standin="${root}/night-member-left"; night_case "${standin}"
  printf '   57 Sl   node %s/.local/bin/martha start builder\n' "${CONTAINER_HOME}" > "${standin}/night.left"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night stop: still running in the container after the stop: .*martha start builder" "${standin}/out" || nfail 'a member left running was not named'
  [ ! -e "${standin}/container.token" ] || nfail 'a token was placed with a member left running'
  standin="${root}/night-host-left"; night_case "${standin}"
  printf '   58 Sl   claude\n' > "${standin}/night.left"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night stop: still running in the container after the stop: claude$" "${standin}/out" || nfail 'a host session left running was not named'
  [ ! -e "${standin}/container.token" ] || nfail 'a token was placed with a host session left running'

  # R1 in the container: gh there answers as another account.
  standin="${root}/night-other-account"; night_case "${standin}"
  printf '99\n' > "${standin}/night.gh.id"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night token: gh in the container answers as '99', not the bot (4242)" "${standin}/out" || nfail 'gh answering as another account was not named'
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # The repository could not be made: nothing is pulled or made, and the close still runs.
  standin="${root}/night-open-fails"; night_case "${standin}" night.open-fails
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night open: ' "${standin}/out" || nfail 'a failed open was not named'
  if grep -q '^pull ' "${standin}/calls"; then nfail 'an image was pulled after the open failed'; fi
  grep -qx 'throwaway close' "${standin}/calls" || nfail 'the close did not run after a failed open'

  # The owner never signs in: exit 4, and the repository still goes.
  standin="${root}/night-no-sign-in"; night_case "${standin}"
  rm -f "${standin}/home/${OWNER_SESSION_ENDED#"${CONTAINER_HOME}/"}"
  night_expect 4 "${standin}" || failures=$((failures + 1))
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # --night with no run folder is refused with the arguments.
  expect_status 2 "${root}" 'a-host' --night || failures=$((failures + 1))

  for standin in night-ready night-no-watch night-no-ring night-no-yes night-no-ask night-container-goes night-slow-rows night-other-ask night-three-launches night-yes-before-attach night-head-moves night-token-kept night-token-in-log night-no-handoff night-not-on-main night-login-fails night-bad-bytes night-unclean-start night-member-left night-host-left night-other-account night-no-sign-in; do
    if [ -e "${root}/${standin}/container.present" ]; then nfail "the ${standin} run left its container behind"; fi
  done
  return $((failures > 0))
}
