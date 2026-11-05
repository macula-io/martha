# Martha's architecture

This page shows, in two pictures, what Martha talks to and what it is made of,
so that a reader can check the design against the code once the code moves in.

> **Status: design.** These diagrams draw the design that is open in
> [issue #1](https://github.com/macula-io/martha/issues/1). They show what
> Martha will be. Most of the boxes are still to be built; the order is in
> [the port map](../docs/port-map.md).

## Context: who uses Martha, and what it reaches

![Martha system context](../assets/c4-context.svg)

| | Solo mode | Team mode |
|---|---|---|
| People | the owner | the owner and teammates, under the roles the team names |
| Coding tools | Claude Code or OpenCode, with Martha as a plugin | the same |
| Also needs | GitHub and a terminal | the same, plus the Macula mesh and realm |
| Who says yes to a push or a release | the owner | the people the team names |

Solo mode needs no mesh, no account and no service. Team mode adds people and
the mesh, and changes nothing else.

## Containers: what Martha is made of

![Martha containers](../assets/c4-container.svg)

| Container | What it does | Mode |
|---|---|---|
| **crew declaration** | Files in the project's `.crew/` directory: who is on the crew, the mode's table of who may do what, and the house rules as switches. Read once, into typed settings. | both |
| **launcher** | Starts and stops members: one coding-tool session and one terminal tab each. | both |
| **crew core** | The protocol, one folder per capability. Each folder holds its hooks, tools, timer, store keys, prompt text and test. No code in it calls a coding tool's API. | both; two slices are team mode only |
| **Claude Code adapter** | The host contract over Claude Code's plugin API, plus the dashboard pane. | both |
| **OpenCode adapter** | The host contract over OpenCode's plugin API. | both |
| **realm admission** | Joins a crew by invite, and refuses a seat that holds no credential. | team only |
| **release** | Packs what is committed, refuses private text, and signs the package in CI. | both |

### The host contract

An adapter gives the core only what a coding tool physically has: a clock,
stores, running a process, delivery in and out (a turn handed to the model, and
where that turn came from as far as the tool itself can say), and registering a
tool. Nothing that decides anything lives in an adapter. A behaviour that one
host needs and another does not is a slice, never a branch in an adapter.

### One code path for two modes

The mode is data in the declaration: a table of who may assign work, approve a
push or a release, and resume parked work. Solo is a table with one person who
may do everything. Team is a table with roles. In solo mode no team-mode
container or slice is loaded, and no mesh call is made.

## Keeping the pictures true

Both SVGs are drawn by [`c4_diagrams.ts`](c4_diagrams.ts), and a test fails when
an SVG in `assets/` is not what that file draws. After changing a box:

```sh
node architecture/c4_diagrams.ts
npm test
```

Then look at the result, and keep the tables on this page in step.
