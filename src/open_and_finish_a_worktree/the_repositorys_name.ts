// The shape of a repository's name (martha#256): `owner/name`, read wherever a repository is named.
//
// It sits in a file of its own because the finish slice reads the owner's queue (martha#973), and the queue reads the
// tips a removal covers, which reads this: keeping it inside the finish slice would close a loop of value imports.

/** A repository as Martha names one: an owner and a name, each starting with a letter or a digit. */
export const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/
