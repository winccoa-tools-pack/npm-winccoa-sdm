// -----------------------------------------------------------------------------
// TBox / ontology management: classes, relation types, aspects.
//
// Storage: each entry is one DP of the corresponding meta dpType. The ontology
// is small (hundreds–thousands, never millions) and fully cached in memory; the
// cache is a pure performance mirror, rebuildable from the meta DPs, hence
// redundancy-safe.
//
// Inheritance is realised with WinCC OA "type in type" (DPT references /
// Typeref): every class is a real dpType; a class embeds its (single, abstract)
// super class and its aspects via typeref elements. Changing a base dpType then
// propagates to all subclasses and their instances. Constraint: single
// inheritance and super classes must be ABSTRACT (concrete classes are leaves);
// use aspects for mixins. Inherited DPEs are namespaced under the reference
// element (e.g. `super.location`); the model maps flat names <-> paths.
// -----------------------------------------------------------------------------
import { WinccoaDpTypeNode, WinccoaElementType as ET } from 'winccoa-manager';
import { oa, sanitizeName, localName, exists, log } from '../oa';
import { DPT, SEM_NODE, mapType } from '../constants';
import { ClassDef, RelationTypeDef, AspectDef, PropertyDef, EffProp } from './types';

/**
 * WinCC OA element-type → friendly SDM type string (covers scalars, their
 * `*Struct` leaf variants, and the dynamic-array forms). `Struct` (container) and
 * `Typeref` are handled by recursion in flattenElements, not here.
 */
const ET_TO_FRIENDLY: { [code: number]: string } = {
  [ET.Bool]: 'bool', [ET.BoolStruct]: 'bool',
  [ET.Char]: 'int', [ET.CharStruct]: 'int',
  [ET.Int]: 'int', [ET.IntStruct]: 'int',
  [ET.UInt]: 'uint', [ET.UIntStruct]: 'uint',
  [ET.Long]: 'long', [ET.LongStruct]: 'long',
  [ET.ULong]: 'long', [ET.ULongStruct]: 'long',
  [ET.Float]: 'float', [ET.FloatStruct]: 'float',
  [ET.String]: 'string', [ET.StringStruct]: 'string',
  [ET.Time]: 'time', [ET.TimeStruct]: 'time',
  [ET.LangString]: 'langString', [ET.LangStringStruct]: 'langString',
  [ET.Blob]: 'blob', [ET.BlobStruct]: 'blob',
  [ET.Bit32]: 'uint', [ET.Bit32Struct]: 'uint',
  [ET.Bit64]: 'long', [ET.Bit64Struct]: 'long',
  [ET.Dpid]: 'string', [ET.DpidStruct]: 'string',
  [ET.DynBool]: 'dyn_bool', [ET.DynBoolStruct]: 'dyn_bool',
  [ET.DynChar]: 'dyn_int', [ET.DynCharStruct]: 'dyn_int',
  [ET.DynInt]: 'dyn_int', [ET.DynIntStruct]: 'dyn_int',
  [ET.DynUInt]: 'dyn_int', [ET.DynUIntStruct]: 'dyn_int',
  [ET.DynLong]: 'dyn_int', [ET.DynLongStruct]: 'dyn_int',
  [ET.DynULong]: 'dyn_int', [ET.DynULongStruct]: 'dyn_int',
  [ET.DynBit32]: 'dyn_int', [ET.DynBit32Struct]: 'dyn_int',
  [ET.DynBit64]: 'dyn_int', [ET.DynBit64Struct]: 'dyn_int',
  [ET.DynFloat]: 'dyn_float', [ET.DynFloatStruct]: 'dyn_float',
  [ET.DynString]: 'dyn_string', [ET.DynStringStruct]: 'dyn_string',
  [ET.DynTime]: 'dyn_string', [ET.DynTimeStruct]: 'dyn_string',
  [ET.DynLangString]: 'dyn_string', [ET.DynLangStringStruct]: 'dyn_string',
  [ET.DynBlob]: 'dyn_string', [ET.DynBlobStruct]: 'dyn_string',
  [ET.DynDpid]: 'dyn_string', [ET.DynDpidStruct]: 'dyn_string'
};

/**
 * Flatten a dpType's element tree into SDM properties. Nested structs (and
 * resolved type references) are flattened with dotted paths so the full DPE
 * structure is preserved (e.g. `state.value`). The embedded `sem` struct is
 * skipped. Used when adopting an existing dpType as a class.
 */
function flattenElements(node: WinccoaDpTypeNode, prefix: string, out: PropertyDef[]): void {
  for (const ch of node.children || []) {
    if (ch.name === SEM_NODE) continue;
    const t = ch.type as number;
    // A node with children is a container (Struct / resolved Typeref / nested
    // struct) — recurse so only addressable leaves become properties. Without
    // this, a container would be emitted as a leaf and dpGet on it would reject.
    if ((ch.children?.length ?? 0) > 0) {
      flattenElements(ch, `${prefix}${ch.name}.`, out);
    } else {
      out.push({ name: `${prefix}${ch.name}`, type: ET_TO_FRIENDLY[t] || 'string', label: ch.name, unit: '' });
    }
  }
}

const META_PREFIX = { class: 'cls_', rel: 'rel_', aspect: 'asp_' };

const classes = new Map<string, ClassDef>();
const relations = new Map<string, RelationTypeDef>();
const aspects = new Map<string, AspectDef>();

export function localname(iri: string): string {
  const m = String(iri).match(/[^#/:]+$/);
  return m ? m[0] : String(iri);
}

function metaDp(kind: keyof typeof META_PREFIX, iri: string): string {
  return META_PREFIX[kind] + sanitizeName(iri);
}

function buildSemStruct(): WinccoaDpTypeNode {
  return new WinccoaDpTypeNode(SEM_NODE, ET.Struct, '', [
    new WinccoaDpTypeNode('iri', ET.String),
    new WinccoaDpTypeNode('classIri', ET.String),
    new WinccoaDpTypeNode('label', ET.String),
    new WinccoaDpTypeNode('edgesOut', ET.DynString),
    new WinccoaDpTypeNode('edgesIn', ET.DynString),
    new WinccoaDpTypeNode('createdAt', ET.Time)
  ]);
}

/** Reference element name for an aspect typeref (also the DPE path prefix). */
function aspectRefName(asp: AspectDef): string {
  return sanitizeName(localname(asp.iri));
}

/**
 * Build a class dpType with type-in-type: own props inline, the (single,
 * abstract) super class embedded via a `super` typeref, each aspect via its own
 * typeref, and — for concrete classes — the embedded `sem` struct. Referenced
 * super/aspect dpTypes must already exist.
 */
function buildClassDpt(c: ClassDef): WinccoaDpTypeNode {
  const children: WinccoaDpTypeNode[] = c.ownProps.map((p) => new WinccoaDpTypeNode(p.name, mapType(p.type).et));
  for (const aIri of c.aspects) {
    const asp = aspects.get(aIri);
    if (asp?.mappedDpType) children.push(new WinccoaDpTypeNode(aspectRefName(asp), ET.Typeref, asp.mappedDpType));
  }
  for (const sIri of c.superClasses) {
    const sc = classes.get(sIri);
    if (sc?.mappedDpType) children.push(new WinccoaDpTypeNode('super', ET.Typeref, sc.mappedDpType));
  }
  if (!c.isAbstract) children.push(buildSemStruct());
  return new WinccoaDpTypeNode(c.mappedDpType, ET.Struct, '', children);
}

/** Build an aspect dpType (a flat struct of its own properties). */
function buildAspectDpt(dptName: string, props: PropertyDef[]): WinccoaDpTypeNode {
  return new WinccoaDpTypeNode(dptName, ET.Struct, '', props.map((p) => new WinccoaDpTypeNode(p.name, mapType(p.type).et)));
}

function parseJson<T>(str: unknown, fallback: T): T {
  try {
    return str ? (JSON.parse(str as string) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function readStruct(dpName: string, fields: string[]): Promise<{ [k: string]: unknown }> {
  const dpes = fields.map((f) => `${dpName}.${f}`);
  const values = (await oa().dpGet(dpes)) as unknown[];
  const out: { [k: string]: unknown } = {};
  fields.forEach((f, i) => (out[f] = values[i]));
  return out;
}

// ---- cache loading --------------------------------------------------------
export async function loadTBox(): Promise<void> {
  classes.clear();
  relations.clear();
  aspects.clear();

  for (const dp of oa().dpNames('*', DPT.ASPECT)) {
    const v = await readStruct(dp, ['iri', 'label', 'mappedDpType', 'propsJson']);
    aspects.set(v.iri as string, {
      iri: v.iri as string,
      label: v.label as string,
      mappedDpType: v.mappedDpType as string,
      ownProps: parseJson<PropertyDef[]>(v.propsJson, [])
    });
  }
  for (const dp of oa().dpNames('*', DPT.CLASS)) {
    const v = await readStruct(dp, [
      'iri', 'label', 'comment', 'superClasses', 'aspects', 'mappedDpType', 'isAbstract', 'propsJson'
    ]);
    classes.set(v.iri as string, {
      iri: v.iri as string,
      label: v.label as string,
      comment: v.comment as string,
      superClasses: (v.superClasses as string[]) || [],
      aspects: (v.aspects as string[]) || [],
      mappedDpType: v.mappedDpType as string,
      isAbstract: !!v.isAbstract,
      ownProps: parseJson<PropertyDef[]>(v.propsJson, [])
    });
  }
  for (const dp of oa().dpNames('*', DPT.RELATION)) {
    const v = await readStruct(dp, [
      'iri', 'label', 'inverseIri', 'domain', 'range', 'cardinality',
      'symmetric', 'transitive', 'functional', 'realization'
    ]);
    relations.set(v.iri as string, {
      iri: v.iri as string,
      label: v.label as string,
      inverseIri: v.inverseIri as string,
      domain: (v.domain as string[]) || [],
      range: (v.range as string[]) || [],
      cardinality: (v.cardinality as string) || '0..*',
      symmetric: !!v.symmetric,
      transitive: !!v.transitive,
      functional: !!v.functional,
      realization: (v.realization as string) || 'inline'
    });
  }
  log.info(`TBox loaded: ${classes.size} classes, ${relations.size} relations, ${aspects.size} aspects`);
}

// ---- reads ----------------------------------------------------------------
export const getClass = (iri: string): ClassDef | null => classes.get(iri) || null;
export const getRelationType = (iri: string): RelationTypeDef | null => relations.get(iri) || null;

/** Find the class whose instances use the given dpType (reverse lookup). */
export function getClassByDpType(dpType: string): ClassDef | null {
  if (!dpType) return null;
  for (const c of classes.values()) if (c.mappedDpType === dpType) return c;
  return null;
}
export const getAspect = (iri: string): AspectDef | null => aspects.get(iri) || null;
export const listClasses = (): ClassDef[] => [...classes.values()];
export const listRelationTypes = (): RelationTypeDef[] => [...relations.values()];
export const listAspects = (): AspectDef[] => [...aspects.values()];

/** All ancestor class IRIs (transitive closure of superClasses). */
export function ancestorsOf(iri: string, seen: Set<string> = new Set()): Set<string> {
  const c = classes.get(iri);
  if (!c) return seen;
  for (const sup of c.superClasses) {
    if (!seen.has(sup)) {
      seen.add(sup);
      ancestorsOf(sup, seen);
    }
  }
  return seen;
}

export function isSubClassOf(child: string, ancestor: string): boolean {
  if (child === ancestor) return true;
  return ancestorsOf(child).has(ancestor);
}

/**
 * Effective properties of a class with their DPE paths (own/closest wins on
 * name). Own props sit at top level; aspect props under the aspect ref element;
 * super props under `super.` (recursively).
 */
export function effectiveProperties(iri: string, seen: Set<string> = new Set()): EffProp[] {
  const c = classes.get(iri);
  if (!c || seen.has(iri)) return [];
  seen.add(iri);
  const byName = new Map<string, EffProp>();
  const add = (p: EffProp) => {
    if (!byName.has(p.name)) byName.set(p.name, p);
  };
  for (const p of c.ownProps) add({ ...p, path: p.name });
  for (const aIri of c.aspects) {
    const asp = aspects.get(aIri);
    if (!asp) continue;
    const ref = aspectRefName(asp);
    for (const p of asp.ownProps) add({ ...p, path: `${ref}.${p.name}` });
  }
  for (const sIri of c.superClasses) {
    for (const sp of effectiveProperties(sIri, seen)) add({ ...sp, path: `super.${sp.path}` });
  }
  return [...byName.values()];
}

function normalizeProp(p: PropertyDef): PropertyDef {
  if (!p?.name || !p?.type) throw new Error('property requires { name, type }');
  mapType(p.type); // validates
  return { name: p.name, type: p.type, label: p.label || p.name, unit: p.unit || '' };
}

// ---- writes ---------------------------------------------------------------
export interface CreateClassInput {
  iri: string;
  label?: string;
  comment?: string;
  superClasses?: string[];
  aspects?: string[];
  properties?: PropertyDef[];
  isAbstract?: boolean;
  dpType?: string;
}

export async function createClass(def: CreateClassInput): Promise<ClassDef> {
  if (!def?.iri) throw new Error('class.iri is required');
  if (classes.has(def.iri)) throw new Error(`class already exists: ${def.iri}`);

  const superClasses = def.superClasses || [];
  if (superClasses.length > 1)
    throw new Error('only single inheritance is supported — use aspects for additional mixins');
  for (const s of superClasses) {
    const sc = classes.get(s);
    if (!sc) throw new Error(`unknown superClass: ${s}`);
    if (!sc.isAbstract)
      throw new Error(`superClass must be abstract: '${s}'. Concrete classes are leaves; use an abstract base class or an aspect.`);
  }
  for (const a of def.aspects || [])
    if (!aspects.has(a)) throw new Error(`unknown aspect: ${a}`);

  const ownProps = (def.properties || []).map(normalizeProp);
  const mappedDpType = def.dpType || `C_${sanitizeName(localname(def.iri))}`;
  const types = oa().dpTypes(mappedDpType);
  if (types && types.includes(mappedDpType))
    throw new Error(`dpType '${mappedDpType}' already exists; pass a different dpType`);

  const classDef: ClassDef = {
    iri: def.iri,
    label: def.label || localname(def.iri),
    comment: def.comment || '',
    superClasses,
    aspects: def.aspects || [],
    mappedDpType, // every class (abstract too) is a real dpType, referenceable
    isAbstract: !!def.isAbstract,
    ownProps
  };

  await oa().dpTypeCreate(buildClassDpt(classDef));
  log.info(`created class dpType ${mappedDpType} (type-in-type; super=${superClasses[0] || '-'}, aspects=${classDef.aspects.length})`);

  const dp = metaDp('class', def.iri);
  if (!(await exists(dp))) await oa().dpCreate(dp, DPT.CLASS);
  await oa().dpSetWait(
    [
      `${dp}.iri`, `${dp}.label`, `${dp}.comment`, `${dp}.superClasses`,
      `${dp}.aspects`, `${dp}.mappedDpType`, `${dp}.isAbstract`, `${dp}.propsJson`
    ],
    [
      classDef.iri, classDef.label, classDef.comment, classDef.superClasses,
      classDef.aspects, classDef.mappedDpType, classDef.isAbstract, JSON.stringify(ownProps)
    ]
  );
  classes.set(def.iri, classDef);
  return classDef;
}

/**
 * Delete a class: its instances (only with deleteInstances=true), its dpType and
 * its meta DP. Fails if the dpType is still referenced by a subclass (delete
 * leaves first). Edge cleanup of instances is done by the service layer.
 */
export async function deleteClass(iri: string, deleteInstances = false): Promise<boolean> {
  const c = classes.get(iri);
  if (!c) return false;
  if (c.mappedDpType) {
    const insts = oa().dpNames('*', c.mappedDpType).map(localName);
    if (insts.length && !deleteInstances)
      throw new Error(`class '${iri}' has ${insts.length} instance(s); pass deleteInstances=true`);
    for (const dp of insts) await oa().dpDelete(dp);
    const types = oa().dpTypes(c.mappedDpType);
    if (types && types.includes(c.mappedDpType)) await oa().dpTypeDelete(c.mappedDpType);
  }
  const dp = metaDp('class', iri);
  if (await exists(dp)) await oa().dpDelete(dp);
  classes.delete(iri);
  log.info(`deleted class ${iri}`);
  return true;
}

/**
 * Add a data property to a class. The class dpType is changed in place; WinCC OA
 * propagates the change through every typeref that references it — i.e. to all
 * subclasses and their EXISTING instances (the whole point of type-in-type).
 */
export async function addClassProperty(iri: string, prop: PropertyDef): Promise<ClassDef> {
  const c = classes.get(iri);
  if (!c) throw new Error(`unknown class: ${iri}`);
  if (!c.mappedDpType) throw new Error(`class '${iri}' has no dpType`);
  const np = normalizeProp(prop);
  if (c.ownProps.some((p) => p.name === np.name)) throw new Error(`property '${np.name}' already exists on ${iri}`);

  const tree = oa().dpTypeGet(c.mappedDpType);
  if (!tree.children) tree.children = [];
  tree.children.push(new WinccoaDpTypeNode(np.name, mapType(np.type).et));
  await oa().dpTypeChange(tree);

  c.ownProps.push(np);
  const dp = metaDp('class', iri);
  await oa().dpSetWait([`${dp}.propsJson`], [JSON.stringify(c.ownProps)]);
  log.info(`added property '${np.name}' to ${iri} -> propagates via type-in-type`);
  return c;
}

/**
 * Adopt an EXISTING WinCC OA dpType as an SDM class: register a class meta whose
 * `mappedDpType` IS that type (so its existing data points become first-class
 * instances — getClassByDpType / listInstances recognise them), and augment the
 * type in place with the embedded `sem` struct so those data points can carry
 * identity + graph edges. Idempotent: returns the existing class if the type is
 * already mapped, and skips the `sem` augmentation if already present.
 *
 * Used by the WinCC OA → SDM migration: a dpType is a class, its DPs the instances.
 */
export async function adoptDpTypeAsClass(dpType: string, iri?: string, label?: string): Promise<ClassDef> {
  const existing = getClassByDpType(dpType);
  if (existing) {
    // Self-heal: refresh the property list from the current type structure (so an
    // earlier adoption that recorded no/partial properties gets corrected on re-run).
    const t0 = oa().dpTypeGet(existing.mappedDpType);
    const props: PropertyDef[] = [];
    flattenElements(t0, '', props);
    if (JSON.stringify(props) !== JSON.stringify(existing.ownProps)) {
      existing.ownProps = props;
      await oa().dpSetWait([`${metaDp('class', existing.iri)}.propsJson`], [JSON.stringify(props)]);
      log.info(`refreshed adopted class ${existing.iri}: ${props.length} properties`);
    }
    return existing;
  }

  const types = oa().dpTypes(dpType);
  if (!types || !types.includes(dpType)) throw new Error(`dpType '${dpType}' does not exist`);

  const classIri = iri || `oa:${dpType}`;
  if (classes.has(classIri)) throw new Error(`class iri '${classIri}' already exists with a different dpType`);

  // Augment the existing type with the embedded sem struct (additive dpTypeChange).
  const tree = oa().dpTypeGet(dpType);
  if (!tree.children) tree.children = [];
  if (!tree.children.some((ch) => ch.name === SEM_NODE)) {
    tree.children.push(buildSemStruct());
    await oa().dpTypeChange(tree);
    log.info(`adopted dpType ${dpType}: added embedded sem struct`);
  }

  // Expose ALL data point elements of the type as SDM properties (flattened,
  // dotted paths preserve the DPE structure; the sem struct is skipped).
  const ownProps: PropertyDef[] = [];
  flattenElements(tree, '', ownProps);

  const classDef: ClassDef = {
    iri: classIri,
    label: label || dpType,
    comment: `Adopted from WinCC OA dpType ${dpType}`,
    superClasses: [],
    aspects: [],
    mappedDpType: dpType,
    isAbstract: false,
    ownProps
  };
  const dp = metaDp('class', classIri);
  if (!(await exists(dp))) await oa().dpCreate(dp, DPT.CLASS);
  await oa().dpSetWait(
    [`${dp}.iri`, `${dp}.label`, `${dp}.comment`, `${dp}.superClasses`, `${dp}.aspects`, `${dp}.mappedDpType`, `${dp}.isAbstract`, `${dp}.propsJson`],
    [classDef.iri, classDef.label, classDef.comment, [], [], classDef.mappedDpType, false, JSON.stringify(ownProps)]
  );
  classes.set(classIri, classDef);
  log.info(`registered adopted class ${classIri} -> dpType ${dpType}`);
  return classDef;
}

export interface CreateRelationInput {
  iri: string;
  label?: string;
  inverseIri?: string;
  domain?: string[];
  range?: string[];
  cardinality?: string;
  symmetric?: boolean;
  transitive?: boolean;
  functional?: boolean;
  realization?: string;
}

export async function createRelationType(def: CreateRelationInput): Promise<RelationTypeDef> {
  if (!def?.iri) throw new Error('relationType.iri is required');
  if (relations.has(def.iri)) throw new Error(`relationType already exists: ${def.iri}`);
  const rel: RelationTypeDef = {
    iri: def.iri,
    label: def.label || localname(def.iri),
    inverseIri: def.inverseIri || '',
    domain: def.domain || [],
    range: def.range || [],
    cardinality: def.cardinality || '0..*',
    symmetric: !!def.symmetric,
    transitive: !!def.transitive,
    functional: !!def.functional,
    realization: def.realization || 'inline'
  };
  const dp = metaDp('rel', def.iri);
  if (!(await exists(dp))) await oa().dpCreate(dp, DPT.RELATION);
  await oa().dpSetWait(
    [
      `${dp}.iri`, `${dp}.label`, `${dp}.inverseIri`, `${dp}.domain`, `${dp}.range`,
      `${dp}.cardinality`, `${dp}.symmetric`, `${dp}.transitive`, `${dp}.functional`, `${dp}.realization`
    ],
    [
      rel.iri, rel.label, rel.inverseIri, rel.domain, rel.range,
      rel.cardinality, rel.symmetric, rel.transitive, rel.functional, rel.realization
    ]
  );
  relations.set(def.iri, rel);
  return rel;
}

export interface CreateAspectInput {
  iri: string;
  label?: string;
  properties?: PropertyDef[];
}

export async function createAspect(def: CreateAspectInput): Promise<AspectDef> {
  if (!def?.iri) throw new Error('aspect.iri is required');
  if (aspects.has(def.iri)) throw new Error(`aspect already exists: ${def.iri}`);
  const ownProps = (def.properties || []).map(normalizeProp);
  const mappedDpType = `A_${sanitizeName(localname(def.iri))}`;
  const types = oa().dpTypes(mappedDpType);
  if (types && types.includes(mappedDpType)) throw new Error(`aspect dpType '${mappedDpType}' already exists`);
  await oa().dpTypeCreate(buildAspectDpt(mappedDpType, ownProps));
  const asp: AspectDef = { iri: def.iri, label: def.label || localname(def.iri), mappedDpType, ownProps };
  const dp = metaDp('aspect', def.iri);
  if (!(await exists(dp))) await oa().dpCreate(dp, DPT.ASPECT);
  await oa().dpSetWait(
    [`${dp}.iri`, `${dp}.label`, `${dp}.mappedDpType`, `${dp}.propsJson`],
    [asp.iri, asp.label, asp.mappedDpType, JSON.stringify(ownProps)]
  );
  aspects.set(def.iri, asp);
  return asp;
}
