// A refusal is the installer saying no, in words (martha#21). Anything else that ends an install is a fault, and
// the bin says so. A check that could not be made at all (the Sigstore trust root did not arrive, the registry did
// not answer) is its own kind of refusal: it never reads as "unsigned", and never as "fine".

export class Refused extends Error {
  /** @param {string} message */
  constructor (message) {
    super(message)
    this.name = 'Refused'
  }
}

export class CouldNotCheck extends Refused {
  /** @param {string} message */
  constructor (message) {
    super(`could not check: ${message}`)
    this.name = 'CouldNotCheck'
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
export const refuse = (message) => { throw new Refused(message) }

/**
 * @param {string} message
 * @returns {never}
 */
export const couldNotCheck = (message) => { throw new CouldNotCheck(message) }
