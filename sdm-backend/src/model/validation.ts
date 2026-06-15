// -----------------------------------------------------------------------------
// Governance: validate mutations against the meta-model (domain / range /
// cardinality). Pure functions over the in-memory TBox.
// -----------------------------------------------------------------------------
import { getRelationType, isSubClassOf } from './ontology';

export function parseCardinality(card: string): { min: number; max: number } {
  const c = (card || '0..*').trim();
  if (c === '*') return { min: 0, max: Infinity };
  if (!c.includes('..')) {
    const n = c === '*' ? Infinity : Number(c);
    return { min: n, max: n };
  }
  const [lo, hi] = c.split('..');
  return { min: Number(lo), max: hi === '*' ? Infinity : Number(hi) };
}

export interface ValidateInput {
  relIri: string;
  sourceClass: string | null;
  targetClass: string | null;
  currentOutCount?: number;
}

/** @returns list of violation messages (empty = valid). */
export function validateRelation({ relIri, sourceClass, targetClass, currentOutCount = 0 }: ValidateInput): string[] {
  const errors: string[] = [];
  const rel = getRelationType(relIri);
  if (!rel) return [`unknown relationType: ${relIri}`];

  if (rel.domain?.length && sourceClass) {
    const ok = rel.domain.some((d) => isSubClassOf(sourceClass, d));
    if (!ok) errors.push(`domain violation: ${sourceClass} not in domain [${rel.domain.join(', ')}]`);
  }
  if (rel.range?.length && targetClass) {
    const ok = rel.range.some((r) => isSubClassOf(targetClass, r));
    if (!ok) errors.push(`range violation: ${targetClass} not in range [${rel.range.join(', ')}]`);
  }
  const { max } = parseCardinality(rel.cardinality);
  const limit = rel.functional ? Math.min(max, 1) : max;
  if (currentOutCount >= limit)
    errors.push(`cardinality violation: ${relIri} allows at most ${limit} target(s), already ${currentOutCount}`);

  return errors;
}
