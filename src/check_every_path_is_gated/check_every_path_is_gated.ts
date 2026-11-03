// The mechanical check step 2 asks for: a path that reaches a shell-holding
// member with no control makes CI fail, naming the path.
//
// This runs in CI (see the `gate coverage` job in .github/workflows/ci.yml) and
// its unit tests plant ungated paths to prove it is not vacuous: a row copied
// from the table without its control, a row whose control field was forgotten, a
// row claiming the shell gate while the gate does not refuse it, a row naming a
// delivery gate that does not exist, and a delivery gate that admits everyone.
//
// A name is not a control. Every delivery gate a row names is DRIVEN here, both
// ways: it must refuse a sender the roster does not name, and it must admit a
// rostered member, so a gate that refuses everything is caught too.

import { DELIVERY_GATES, type InboundPath } from '../inbound_paths/inbound_paths.ts'
import type { DeliveryGate } from '../admit_a_room_message/admit_a_room_message.ts'

export interface Gap {
  readonly path: string
  readonly why: string
}

// Synthetic node ids, never a real one: this repository is public.
const SELF = '0'.repeat(64)
const MEMBER = '1'.repeat(64)
const STRANGER = '2'.repeat(64)

/**
 * Every row that reaches a shell-holding member without a control that stands on it.
 *
 * `gateRefuses` is the real shell gate, driven once per row that claims it, so a
 * row cannot claim cover the gate does not give. `delivery_gates` is the real map
 * of gates, driven both ways per row that names one.
 */
export function gapsInGateCoverage(
  paths: readonly InboundPath[],
  gateRefuses: (path: string) => boolean,
  delivery_gates: Readonly<Record<string, DeliveryGate>> = DELIVERY_GATES,
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

    if (control.kind === 'delivery-gate') {
      const gate = delivery_gates[control.gate]
      const gap = deliveryGateGap(control.gate, gate)
      if (gap !== undefined) gaps.push({ path: path.id, why: gap })
      continue
    }

    if (control.kind === 'no-text-reaches-the-model' && control.why.trim() === '') {
      gaps.push({ path: path.id, why: 'claims no text reaches the model and does not say why' })
    }
  }

  return gaps
}

function deliveryGateGap(name: string, gate: DeliveryGate | undefined): string | undefined {
  if (gate === undefined) return `names a delivery gate nobody has built: ${name}`

  const admits_stranger = gate({
    message: { attested: true, from_node_id: STRANGER, to_node_ids: [SELF], kind: 'message' },
    roster: { member_node_ids: [SELF, MEMBER] },
    self_node_id: SELF,
  })
  if (admits_stranger) return `the gate ${name} admits a sender the roster does not name`

  const admits_member = gate({
    message: { attested: true, from_node_id: MEMBER, to_node_ids: [SELF], kind: 'message' },
    roster: { member_node_ids: [SELF, MEMBER] },
    self_node_id: SELF,
  })
  if (!admits_member) return `the gate ${name} refuses a member the roster names`

  return undefined
}
