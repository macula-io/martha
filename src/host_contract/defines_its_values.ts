// The marker a record carries when its keys and values are values the tree shares (martha#289).
//
// `check:restated-values` reads a top-level `export const NAME = '<text>'` as a
// defined value. A record is read the same way only when its definition says so:
//
//   export const RECORD = Object.freeze({ Write: 'file_path' }) satisfies DefinesItsValues
//
// Then every string key and every string value of RECORD is a defined value, and a
// literal elsewhere that equals one restates it. A record that is not marked is
// never read, because a record's keys are as often field names (`path`, `text`) as
// values, and only its author knows which.
//
// What the marker claims, and the check holds it to:
//   - BOTH sides: every key and every value is a shared value. A record where only
//     one side is shared is not marked; lift that side into constants instead.
//   - every entry is readable: a plain key (an identifier or a string) and a string
//     value. A spread, a computed key, a method, a shorthand, a nested object or a
//     value that is not a string is an error naming the record, not a skip.
//   - it is the outermost wrapper of the initializer of a top-level exported const.
//     Inside the call (`Object.freeze({ … } satisfies DefinesItsValues)`), on a
//     value that is not an object literal, or anywhere else, it is an error.
//   - it is written by this name. An aliased import (`DefinesItsValues as D`) or a
//     type that renames it (`type D = DefinesItsValues`) is an error, so a marker
//     cannot escape the check by a second name.
//
// A type only: it costs nothing at run time, and the type checker keeps the record
// a record of strings. It lives in host_contract, beside core_source.ts, because a
// host adapter marks its records with it, and an adapter may import neither a
// program nor a test: the check's own slice holds its program.

/** A record whose string keys and string values are values the tree shares: the restated-values check reads each as a constant. */
export type DefinesItsValues = Readonly<Record<string, string>>
