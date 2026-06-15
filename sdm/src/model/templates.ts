// -----------------------------------------------------------------------------
// Templates / typicals — reusable parametrized sub-networks (ISA-88 equipment
// modules). A template defines a set of instance nodes (with {param} slots in
// names / labels / property values) plus internal relations. Instantiating it
// with a list of bindings stamps the whole structure out N times — the core
// leverage for engineering large systems.
//
// Templates persist as _SemTemplate data points (one per template, full JSON in
// `defJson`) so they survive restarts and replicate via redundancy.
//
// Edge endpoints reference a node by its `key`, or an EXTERNAL data point via
// "@<param>" (the binding supplies the dp name) — e.g. attach the whole module
// under an existing parent: { rel: 'isa:partOf', src: 'unit', tgt: '@parent' }.
// -----------------------------------------------------------------------------
import { oa, sanitizeName, localName, exists, log } from '../oa';
import { DPT } from '../constants';
import { getClass, effectiveProperties } from './ontology';
import { createInstance, updateInstance } from './instances';
import { assertRelation } from './relations';
import { coerceValue } from './coerce';

export interface TemplateNode {
  key: string;
  classIri: string;
  name: string; // dp-name pattern, supports {param}
  label?: string; // supports {param}
  properties?: { [k: string]: unknown }; // string values support {param}
}
export interface TemplateEdge {
  rel: string;
  src: string; // node key, or "@param" for an external dp
  tgt: string;
}
export interface TemplateDef {
  id: string;
  label?: string;
  params?: string[];
  nodes: TemplateNode[];
  edges?: TemplateEdge[];
}

type Binding = { [k: string]: string };

const TPL_PREFIX = '_tpl_';
const tplDp = (id: string): string => TPL_PREFIX + sanitizeName(id);

function subst(s: string, b: Binding): string {
  return s.replace(/\{(\w+)\}/g, (_m, k: string) => (b[k] !== undefined ? String(b[k]) : `{${k}}`));
}

// ---- CRUD -------------------------------------------------------------------
export async function createTemplate(def: TemplateDef): Promise<TemplateDef> {
  if (!def?.id) throw new Error('template id required');
  if (!Array.isArray(def.nodes) || def.nodes.length === 0) throw new Error('template needs at least one node');
  for (const n of def.nodes) {
    if (!n.key || !n.classIri || !n.name) throw new Error(`template node needs key, classIri and name (got ${JSON.stringify(n)})`);
  }
  const dp = tplDp(def.id);
  if (!(await exists(dp))) await oa().dpCreate(dp, DPT.TEMPLATE);
  await oa().dpSetWait([`${dp}.id`, `${dp}.label`, `${dp}.defJson`], [def.id, def.label || def.id, JSON.stringify(def)]);
  log.info(`saved template ${def.id} (${def.nodes.length} nodes)`);
  return def;
}

export async function listTemplates(): Promise<TemplateDef[]> {
  const dps = oa().dpNames('*', DPT.TEMPLATE).map(localName).sort();
  const out: TemplateDef[] = [];
  for (const dp of dps) {
    try {
      out.push(JSON.parse((await oa().dpGet(`${dp}.defJson`)) as string) as TemplateDef);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export async function getTemplate(id: string): Promise<TemplateDef | null> {
  const dp = tplDp(id);
  if (!(await exists(dp))) return null;
  try {
    return JSON.parse((await oa().dpGet(`${dp}.defJson`)) as string) as TemplateDef;
  } catch {
    return null;
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const dp = tplDp(id);
  if (!(await exists(dp))) return false;
  await oa().dpDelete(dp);
  log.info(`deleted template ${id}`);
  return true;
}

// ---- instantiation ----------------------------------------------------------
export interface PlanInstance {
  key: string;
  dp: string;
  classIri: string;
  label: string;
  properties: { [k: string]: unknown };
  exists: boolean;
}
export interface PlanEdge {
  rel: string;
  src: string;
  tgt: string;
}
export interface PlanRow {
  binding: Binding;
  instances: PlanInstance[];
  edges: PlanEdge[];
  errors: string[];
}
export interface InstantiateResult {
  template: string;
  dryRun: boolean;
  plan: PlanRow[];
  summary: { rows: number; toCreate: number; conflicts: number; edges: number; errors: number };
  applied?: { created: number; updated: number; skipped: number; edges: number; errors: string[] };
}

export interface InstantiateOpts {
  dryRun?: boolean;
  onConflict?: 'skip' | 'update' | 'error';
}

export async function instantiateTemplate(
  id: string,
  bindings: Binding | Binding[],
  opts: InstantiateOpts = {}
): Promise<InstantiateResult> {
  const tpl = await getTemplate(id);
  if (!tpl) throw new Error(`unknown template: ${id}`);
  const rows = Array.isArray(bindings) ? bindings : [bindings];
  const onConflict = opts.onConflict || 'error';

  const plan: PlanRow[] = [];
  for (const b of rows) plan.push(await planRow(tpl, b || {}));

  const summary = {
    rows: rows.length,
    toCreate: plan.reduce((a, p) => a + p.instances.filter((i) => !i.exists).length, 0),
    conflicts: plan.reduce((a, p) => a + p.instances.filter((i) => i.exists).length, 0),
    edges: plan.reduce((a, p) => a + p.edges.length, 0),
    errors: plan.reduce((a, p) => a + p.errors.length, 0)
  };
  const result: InstantiateResult = { template: id, dryRun: !!opts.dryRun, plan, summary };
  if (opts.dryRun) return result;

  result.applied = await applyPlan(plan, onConflict);
  return result;
}

async function planRow(tpl: TemplateDef, b: Binding): Promise<PlanRow> {
  const errors: string[] = [];
  const keyToDp = new Map<string, string>();
  const insts: PlanInstance[] = [];
  for (const n of tpl.nodes) {
    const cls = getClass(n.classIri);
    const dp = sanitizeName(subst(n.name, b));
    keyToDp.set(n.key, dp);
    if (!cls) errors.push(`node ${n.key}: unknown class ${n.classIri}`);
    else if (cls.isAbstract) errors.push(`node ${n.key}: class ${n.classIri} is abstract`);
    const propMap = cls ? new Map(effectiveProperties(n.classIri).map((p) => [p.name, p])) : new Map();
    const properties: { [k: string]: unknown } = {};
    for (const [pk, pv] of Object.entries(n.properties || {})) {
      const ep = propMap.get(pk);
      if (!ep) {
        errors.push(`node ${n.key}: unknown property '${pk}'`);
        continue;
      }
      const sv = typeof pv === 'string' ? subst(pv, b) : pv;
      properties[pk] = coerceValue(ep.type, sv);
    }
    insts.push({ key: n.key, dp, classIri: n.classIri, label: subst(n.label || n.name, b), properties, exists: await exists(dp) });
  }
  const edges: PlanEdge[] = [];
  for (const e of tpl.edges || []) {
    const src = resolveEndpoint(e.src, keyToDp, b, errors);
    const tgt = resolveEndpoint(e.tgt, keyToDp, b, errors);
    if (src && tgt) edges.push({ rel: e.rel, src, tgt });
  }
  return { binding: b, instances: insts, edges, errors };
}

function resolveEndpoint(ref: string, keyToDp: Map<string, string>, b: Binding, errors: string[]): string | null {
  if (ref.startsWith('@')) {
    const param = ref.slice(1);
    const dp = b[param];
    if (!dp) {
      errors.push(`edge endpoint @${param} not provided in binding`);
      return null;
    }
    return sanitizeName(String(dp));
  }
  const dp = keyToDp.get(ref);
  if (!dp) {
    errors.push(`edge endpoint '${ref}' is not a node key`);
    return null;
  }
  return dp;
}

async function applyPlan(plan: PlanRow[], onConflict: 'skip' | 'update' | 'error'): Promise<NonNullable<InstantiateResult['applied']>> {
  const applied = { created: 0, updated: 0, skipped: 0, edges: 0, errors: [] as string[] };
  // pass 1: instances
  for (const p of plan) {
    if (p.errors.length) {
      applied.errors.push(...p.errors);
      continue;
    }
    for (const i of p.instances) {
      try {
        if (i.exists) {
          if (onConflict === 'skip') {
            applied.skipped++;
            continue;
          }
          if (onConflict === 'update') {
            await updateInstance(i.dp, { label: i.label, properties: i.properties });
            applied.updated++;
            continue;
          }
          throw new Error(`instance already exists: ${i.dp}`);
        }
        await createInstance({ classIri: i.classIri, name: i.dp, label: i.label, properties: i.properties });
        applied.created++;
      } catch (err) {
        applied.errors.push(`${i.dp}: ${(err as Error).message}`);
      }
    }
  }
  // pass 2: edges (after every instance exists)
  for (const p of plan) {
    if (p.errors.length) continue;
    for (const e of p.edges) {
      try {
        await assertRelation({ relIri: e.rel, source: e.src, target: e.tgt });
        applied.edges++;
      } catch (err) {
        applied.errors.push(`edge ${e.rel} ${e.src}->${e.tgt}: ${(err as Error).message}`);
      }
    }
  }
  return applied;
}
