// -----------------------------------------------------------------------------
// Model validator / linter — scans the whole ABox for consistency problems that
// are infeasible to spot by hand at scale. One sweep over the adjacency lists +
// class map (three dpQueries), then in-memory checks:
//
//   • unknownClass    – instance whose sem.classIri is not a known class
//   • orphanEdge      – edge endpoint data point does not exist
//   • adjacency       – out-edge without the matching in-edge on the target (or
//                       vice versa) — the bidirectional lists are out of sync
//   • cardinality     – functional / 0..1 / 1 relation with >1 outgoing edge
//   • domain / range  – edge endpoint's class violates the relation's domain/range
// -----------------------------------------------------------------------------
import { oa, localName } from '../oa';
import { SEM } from '../constants';
import { parseEdges } from './instances';
import { getClass, getRelationType, ancestorsOf } from './ontology';
import { EdgeRecord } from './types';

export type Severity = 'error' | 'warning' | 'info';
export interface Finding {
  severity: Severity;
  kind: string;
  subject: string;
  message: string;
}
export interface ValidationReport {
  findings: Finding[];
  truncated: boolean;
  summary: { instances: number; edges: number; errors: number; warnings: number; info: number; checks: string[] };
}

const MAX_FINDINGS = 1000;

async function dpStringMap(elem: string): Promise<Map<string, string>> {
  const tab = (await oa().dpQuery(`SELECT '_online.._value' FROM '*.${elem}'`)) as unknown[][];
  const map = new Map<string, string>();
  for (let i = 1; i < tab.length; i++) {
    const dpe = tab[i]?.[0];
    if (typeof dpe !== 'string') continue;
    map.set(localName(dpe).replace(/\.sem\..*$/, ''), tab[i]?.[1] == null ? '' : String(tab[i][1]));
  }
  return map;
}

async function dpEdgeMap(elem: string): Promise<Map<string, EdgeRecord[]>> {
  const tab = (await oa().dpQuery(`SELECT '_online.._value' FROM '*.${elem}'`)) as unknown[][];
  const map = new Map<string, EdgeRecord[]>();
  for (let i = 1; i < tab.length; i++) {
    const dpe = tab[i]?.[0];
    if (typeof dpe !== 'string') continue;
    map.set(localName(dpe).replace(/\.sem\..*$/, ''), parseEdges(tab[i]?.[1]));
  }
  return map;
}

/** A class satisfies a domain/range list if the list is empty or the class (or
 *  any ancestor) is named in it. */
function classMatches(cls: string | undefined, list: string[]): boolean {
  if (!list || list.length === 0) return true;
  if (!cls) return false;
  if (list.includes(cls)) return true;
  for (const a of ancestorsOf(cls)) if (list.includes(a)) return true;
  return false;
}

const edgeKey = (e: { rel: string; src: string; tgt: string }): string => `${e.rel}|${localName(e.src)}|${localName(e.tgt)}`;

export async function validateModel(): Promise<ValidationReport> {
  const classIri = await dpStringMap(SEM.CLASS_IRI);
  const outMap = await dpEdgeMap(SEM.EDGES_OUT);
  const inMap = await dpEdgeMap(SEM.EDGES_IN);
  const dps = new Set(classIri.keys());

  const findings: Finding[] = [];
  let edges = 0;
  let truncated = false;
  const add = (severity: Severity, kind: string, subject: string, message: string): void => {
    if (findings.length >= MAX_FINDINGS) {
      truncated = true;
      return;
    }
    findings.push({ severity, kind, subject, message });
  };

  // 1) unknown class on an instance
  for (const [dp, iri] of classIri) {
    if (iri && !getClass(iri)) add('error', 'unknownClass', dp, `instance class is not in the model: ${iri}`);
  }

  // index incoming edges by key for the adjacency check
  const inKeys = new Set<string>();
  for (const list of inMap.values()) for (const e of list) inKeys.add(edgeKey(e));
  const outKeys = new Set<string>();
  for (const list of outMap.values()) for (const e of list) outKeys.add(edgeKey(e));

  // 2) per outgoing edge: orphan / adjacency / cardinality / domain+range
  for (const [dp, list] of outMap) {
    const perRel = new Map<string, number>();
    for (const e of list) {
      edges++;
      const tgtDp = localName(e.tgt);
      const rel = getRelationType(e.rel);
      perRel.set(e.rel, (perRel.get(e.rel) || 0) + 1);

      if (!dps.has(tgtDp)) add('error', 'orphanEdge', dp, `${e.rel} → missing data point '${tgtDp}'`);
      if (!inKeys.has(edgeKey(e))) add('warning', 'adjacency', dp, `${e.rel} → ${tgtDp}: no matching incoming edge on target`);

      if (rel) {
        if (!classMatches(classIri.get(dp), rel.domain))
          add('error', 'domain', dp, `${e.rel}: source class ${classIri.get(dp) || '∅'} not in domain [${rel.domain.join(', ')}]`);
        if (!classMatches(classIri.get(tgtDp), rel.range))
          add('error', 'range', dp, `${e.rel} → ${tgtDp}: target class ${classIri.get(tgtDp) || '∅'} not in range [${rel.range.join(', ')}]`);
      } else {
        add('error', 'unknownRelation', dp, `edge uses unknown relation type: ${e.rel}`);
      }
    }
    for (const [relIri, n] of perRel) {
      const rel = getRelationType(relIri);
      const maxOne = rel && (rel.functional || rel.cardinality === '0..1' || rel.cardinality === '1');
      if (maxOne && n > 1) add('error', 'cardinality', dp, `${relIri}: ${n} outgoing edges but relation is single-valued (${rel?.cardinality}${rel?.functional ? ', functional' : ''})`);
    }
  }

  // 3) per incoming edge: orphan source / adjacency (missing out-edge)
  for (const [dp, list] of inMap) {
    for (const e of list) {
      const srcDp = localName(e.src);
      if (!dps.has(srcDp)) add('error', 'orphanEdge', dp, `incoming ${e.rel} ← missing data point '${srcDp}'`);
      if (!outKeys.has(edgeKey(e))) add('warning', 'adjacency', dp, `incoming ${e.rel} ← ${srcDp}: no matching outgoing edge on source`);
    }
  }

  const summary = {
    instances: dps.size,
    edges,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
    checks: ['unknownClass', 'orphanEdge', 'adjacency', 'cardinality', 'domain', 'range']
  };
  return { findings, truncated, summary };
}
