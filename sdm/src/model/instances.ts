// -----------------------------------------------------------------------------
// ABox / instance lifecycle. Each instance is one DP of the class' mapped
// dpType. The DP name is the primary key; its IRI defaults to "System:dpName".
// Property values are plain DPE values and carry the full OA config power
// (archive / alert / address).
// -----------------------------------------------------------------------------
import { oa, qualify, localName, sanitizeName, exists, log } from '../oa';
import { SEM } from '../constants';
import { getClass, getClassByDpType, effectiveProperties, localname } from './ontology';
import { mayWrite } from '../redu';
import { Instance, EdgeRecord, EffProp } from './types';

/** Derive the semantic class IRI of a data point from its dpType. */
export function deriveClassIri(dp: string): string {
  try {
    return getClassByDpType(oa().dpTypeName(dp))?.iri || '';
  } catch {
    return '';
  }
}

export function resolveDp(ref: string): string {
  return localName(ref);
}

export function parseEdges(dynStr: unknown): EdgeRecord[] {
  if (!Array.isArray(dynStr)) return [];
  const out: EdgeRecord[] = [];
  for (const s of dynStr) {
    try {
      out.push(JSON.parse(s as string) as EdgeRecord);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export interface CreateInstanceInput {
  classIri: string;
  name?: string;
  iri?: string;
  label?: string;
  properties?: { [k: string]: unknown };
}

export async function createInstance(def: CreateInstanceInput): Promise<Instance | null> {
  const cls = getClass(def.classIri);
  if (!cls) throw new Error(`unknown class: ${def.classIri}`);
  if (cls.isAbstract) throw new Error(`class is abstract, cannot instantiate: ${def.classIri}`);

  const dp = sanitizeName(def.name || def.iri || `${localname(def.classIri)}_${Date.now()}`);
  if (await exists(dp)) throw new Error(`instance already exists: ${dp}`);

  await oa().dpCreate(dp, cls.mappedDpType);

  const iri = qualify(dp);
  const dpes: string[] = [`${dp}.${SEM.IRI}`, `${dp}.${SEM.CLASS_IRI}`, `${dp}.${SEM.LABEL}`];
  const vals: unknown[] = [iri, def.classIri, def.label || dp];

  const propMap = new Map(effectiveProperties(def.classIri).map((p) => [p.name, p]));
  for (const [k, v] of Object.entries(def.properties || {})) {
    const ep = propMap.get(k);
    if (!ep) throw new Error(`unknown property '${k}' on class ${def.classIri}`);
    dpes.push(`${dp}.${ep.path}`);
    vals.push(v);
  }
  await oa().dpSetWait(dpes, vals);

  try {
    await oa().dpSet(`${dp}.${SEM.CREATED}`, new Date());
  } catch {
    /* createdAt is best-effort */
  }
  log.info(`created instance ${dp} of ${def.classIri}`);
  return getInstance(dp);
}

/**
 * Read an instance's property values resiliently. A single dpGet over all DPEs is
 * the fast path, but an adopted dpType may expose elements that are not directly
 * addressable as a value (e.g. an unexpanded type reference or a container node),
 * which makes the whole batch dpGet reject. In that case fall back to reading each
 * DPE on its own so a couple of bad paths don't blank the entire inspector.
 */
async function readProps(dp: string, propDefs: EffProp[]): Promise<{ [k: string]: unknown }> {
  const properties: { [k: string]: unknown } = {};
  if (!propDefs.length) return properties;
  const names = propDefs.map((p) => `${dp}.${p.path}`);
  try {
    const values = (await oa().dpGet(names)) as unknown[];
    propDefs.forEach((p, i) => (properties[p.name] = values[i]));
  } catch {
    for (const p of propDefs) {
      try {
        properties[p.name] = await oa().dpGet(`${dp}.${p.path}`);
      } catch {
        properties[p.name] = null;
      }
    }
  }
  return properties;
}

export async function getInstance(ref: string): Promise<Instance | null> {
  const dp = resolveDp(ref);
  if (!(await exists(dp))) return null;

  const head = (await oa().dpGet([
    `${dp}.${SEM.IRI}`, `${dp}.${SEM.CLASS_IRI}`, `${dp}.${SEM.LABEL}`,
    `${dp}.${SEM.EDGES_OUT}`, `${dp}.${SEM.EDGES_IN}`, `${dp}.${SEM.CREATED}`
  ])) as unknown[];

  // Reconstruct semantic metadata from the data point itself when the sem.*
  // fields were not populated (e.g. the DP was created externally in PARA / via
  // a raw dpCreate). The dpType is the ground truth for the class.
  const iri = (head[0] as string) || qualify(dp);
  const classIri = (head[1] as string) || deriveClassIri(dp);
  const label = (head[2] as string) || dp;
  await healSem(dp, head, iri, classIri, label);

  const properties = await readProps(dp, effectiveProperties(classIri));

  return {
    dp,
    iri,
    classIri,
    label,
    createdAt: head[5],
    properties,
    edgesOut: parseEdges(head[3]),
    edgesIn: parseEdges(head[4])
  };
}

/** Persist derived semantic fields that were missing, so the DP becomes a full
 *  semantic citizen. No-op on the standby peer or when nothing is missing. */
async function healSem(dp: string, head: unknown[], iri: string, classIri: string, label: string): Promise<void> {
  if (!mayWrite()) return;
  const dpes: string[] = [];
  const vals: unknown[] = [];
  if (!head[0] && iri) {
    dpes.push(`${dp}.${SEM.IRI}`);
    vals.push(iri);
  }
  if (!head[1] && classIri) {
    dpes.push(`${dp}.${SEM.CLASS_IRI}`);
    vals.push(classIri);
  }
  if (!head[2] && label) {
    dpes.push(`${dp}.${SEM.LABEL}`);
    vals.push(label);
  }
  if (dpes.length) {
    try {
      await oa().dpSetWait(dpes, vals);
      log.info(`reconciled semantic fields of external instance ${dp}`);
    } catch {
      /* best-effort */
    }
  }
}

export async function setProperties(ref: string, properties: { [k: string]: unknown }): Promise<Instance | null> {
  const dp = resolveDp(ref);
  if (!(await exists(dp))) throw new Error(`instance not found: ${dp}`);
  const classIri = (await oa().dpGet(`${dp}.${SEM.CLASS_IRI}`)) as string;
  const propMap = new Map(effectiveProperties(classIri).map((p) => [p.name, p]));
  const dpes: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(properties || {})) {
    const ep = propMap.get(k);
    if (!ep) throw new Error(`unknown property '${k}' on class ${classIri}`);
    dpes.push(`${dp}.${ep.path}`);
    vals.push(v);
  }
  if (dpes.length) await oa().dpSetWait(dpes, vals);
  return getInstance(dp);
}

export interface UpdateInstanceInput {
  label?: string;
  properties?: { [k: string]: unknown };
}

/** Edit an existing instance: its display label and/or data properties. */
export async function updateInstance(ref: string, def: UpdateInstanceInput): Promise<Instance | null> {
  const dp = resolveDp(ref);
  if (!(await exists(dp))) throw new Error(`instance not found: ${dp}`);
  const classIri = ((await oa().dpGet(`${dp}.${SEM.CLASS_IRI}`)) as string) || deriveClassIri(dp);
  const propMap = new Map(effectiveProperties(classIri).map((p) => [p.name, p]));
  const dpes: string[] = [];
  const vals: unknown[] = [];
  if (typeof def.label === 'string') {
    dpes.push(`${dp}.${SEM.LABEL}`);
    vals.push(def.label);
  }
  for (const [k, v] of Object.entries(def.properties || {})) {
    const ep = propMap.get(k);
    if (!ep) throw new Error(`unknown property '${k}' on class ${classIri}`);
    dpes.push(`${dp}.${ep.path}`);
    vals.push(v);
  }
  if (dpes.length) await oa().dpSetWait(dpes, vals);
  log.info(`updated instance ${dp}`);
  return getInstance(dp);
}

export interface InstanceListResult {
  total: number;
  items: { dp: string; iri: string; classIri: string; label: string }[];
}

export async function listInstances(
  classIri: string,
  opts: { limit?: number; offset?: number; search?: string } = {}
): Promise<InstanceListResult> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const cls = getClass(classIri);
  if (!cls) throw new Error(`unknown class: ${classIri}`);
  if (!cls.mappedDpType) return { total: 0, items: [] };
  // OA already indexes DPs by type -> no custom instance index needed.
  // Server-side name filter via the dpNames pattern (indexed) keeps large
  // classes from ever materializing in full on the client.
  const search = (opts.search || '').trim();
  const pattern = search ? `*${search}*` : '*';
  const all = oa().dpNames(pattern, cls.mappedDpType).map(localName).sort();
  const slice = all.slice(offset, offset + limit);
  const items = [];
  for (const dp of slice) {
    const v = (await oa().dpGet([`${dp}.${SEM.IRI}`, `${dp}.${SEM.LABEL}`])) as unknown[];
    items.push({ dp, iri: (v[0] as string) || qualify(dp), classIri, label: (v[1] as string) || dp });
  }
  return { total: all.length, items };
}

/** Raw delete of the instance DP. Edge cleanup is done by the relations layer. */
export async function deleteInstanceRaw(ref: string): Promise<boolean> {
  const dp = resolveDp(ref);
  if (!(await exists(dp))) return false;
  await oa().dpDelete(dp);
  log.info(`deleted instance ${dp}`);
  return true;
}
