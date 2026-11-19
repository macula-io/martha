// Every file a hint pulls into the prompt, in the engine's order (martha#801).
//
// A Goose engine reads its hint files again on every model request, and each hint's own text can name further files with
// `@references`: `read_referenced_files` (import_files.rs:533 at the pin eff9a75e) scans a hint, follows the references
// it may follow, and splices those files' text into the hint's. C3 records the hint files themselves; this slice answers
// what each one pulls in, so the record can name those files too, with the digest of what was read.
//
// The slice is in four parts, each its own file because each is a rule with its own table:
//
//   - `the_references_a_hint_names` — the engine's scanner, with Rust's whitespace and the 128 KiB cap;
//   - `the_gitignore_chain` — the one matcher `build_gitignore` makes from the git root down, and the walk that finds
//     the git root (`find_git_root`: `.git` EXISTS, a link pointing nowhere is not one);
//   - `a_gitignore_pattern` — one line of a `.gitignore` compiled as globset compiles it, over bytes;
//   - `the_boundary_of_an_import` and `the_expansion_of_a_hint` — the reach a reference may not leave, and the walk that
//     reads what it may.
//
// A `.gitignore` line globset cannot compile is dropped, as the engine's own builder drops it; a line this port cannot
// reproduce faithfully — one naming a non-ASCII character, whose bytes globset matches as bytes — is refused by name,
// because a record that guessed would claim text it cannot point at. The caller turns that refusal into a launch that
// does not start.

export { type AFileAHintNames, type TheFilesAHintNames, theExpansionOfAHint } from './the_expansion_of_a_hint.ts'
export { type TheGitignoreChain, type TheGitignoreChainRead, NO_GITIGNORE, theGitignoreChainOf, theGitRootOf } from './the_gitignore_chain.ts'
export { isUnderThe } from './the_boundary_of_an_import.ts'
export { type TheFiles } from './the_files_a_hint_is_read_through.ts'
