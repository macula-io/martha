// The mechanical check step 2 asks for: a path that reaches a shell-holding
// member with no control makes CI fail, naming the path.
//
// This runs in CI (see the `gate coverage` job in .github/workflows/ci.yml) and
// its unit tests plant ungated paths to prove it is not vacuous: a row copied
// from the table without its control, a row whose control field was forgotten, a
// row claiming the shell gate while the gate does not refuse it, and a row
// naming a delivery gate that does not exist.

import { KNOWN_DELIVERY_GATES, type InboundPath } from '../inbound_paths/inbound_paths.ts'

export interface Gap {
  readonly path: string
  readonly why: string
}

/**
 * Every row that reaches a shell-holding member without a control that stands on it.
 *
 * `gateRefuses` is the real shell gate, driven once per row that claims it, so a
 * row cannot claim cover the gate does not give. A row cannot name a delivery
 * gate either: only the gates in KNOWN_DELIVERY_GATES count, because a name is
 * not a control.
 */
export function gapsInGateCoverage(
  paths: readonly InboundPath[],
  gateRefuses: (path: string) => boolean,
): readonly Gap[] {
  const gaps: Gap[] = []

  for (const path of paths) {
    const control: InboundPath['control'] | undefined = path.control

    if (control === undefined) {
      gaps.push({ path: path.id, why: 'no control is declared' })
      continue
    }

    if (control.kind === 'none') {
      gaps.push({ path: path.id, why: 'declared as having no control' })
      continue
    }

    if (control.kind === 'shell-gate' && !gateRefuses(path.id)) {
      gaps.push({ path: path.id, why: 'claims the shell gate, and the shell gate does not refuse it' })
      continue
    }

    if (
      control.kind === 'delivery-gate' &&
      !(KNOWN_DELIVERY_GATES as readonly string[]).includes(control.gate)
    ) {
      gaps.push({ path: path.id, why: `names a delivery gate nobody has built: ${control.gate}` })
      continue
    }

    if (control.kind === 'no-text-reaches-the-model' && control.why.trim() === '') {
      gaps.push({ path: path.id, why: 'claims no text reaches the model and does not say why' })
    }
  }

  return gaps
}
