"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAspects = exports.listRelationTypes = exports.listClasses = exports.getAspect = exports.getRelationType = exports.getClass = void 0;
exports.localname = localname;
exports.loadTBox = loadTBox;
exports.getClassByDpType = getClassByDpType;
exports.ancestorsOf = ancestorsOf;
exports.isSubClassOf = isSubClassOf;
exports.effectiveProperties = effectiveProperties;
exports.createClass = createClass;
exports.deleteClass = deleteClass;
exports.addClassProperty = addClassProperty;
exports.adoptDpTypeAsClass = adoptDpTypeAsClass;
exports.createRelationType = createRelationType;
exports.createAspect = createAspect;
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
const winccoa_manager_1 = require("winccoa-manager");
const oa_1 = require("../oa");
const constants_1 = require("../constants");
/**
 * WinCC OA element-type → friendly SDM type string (covers scalars, their
 * `*Struct` leaf variants, and the dynamic-array forms). `Struct` (container) and
 * `Typeref` are handled by recursion in flattenElements, not here.
 */
const ET_TO_FRIENDLY = {
    [winccoa_manager_1.WinccoaElementType.Bool]: 'bool', [winccoa_manager_1.WinccoaElementType.BoolStruct]: 'bool',
    [winccoa_manager_1.WinccoaElementType.Char]: 'int', [winccoa_manager_1.WinccoaElementType.CharStruct]: 'int',
    [winccoa_manager_1.WinccoaElementType.Int]: 'int', [winccoa_manager_1.WinccoaElementType.IntStruct]: 'int',
    [winccoa_manager_1.WinccoaElementType.UInt]: 'uint', [winccoa_manager_1.WinccoaElementType.UIntStruct]: 'uint',
    [winccoa_manager_1.WinccoaElementType.Long]: 'long', [winccoa_manager_1.WinccoaElementType.LongStruct]: 'long',
    [winccoa_manager_1.WinccoaElementType.ULong]: 'long', [winccoa_manager_1.WinccoaElementType.ULongStruct]: 'long',
    [winccoa_manager_1.WinccoaElementType.Float]: 'float', [winccoa_manager_1.WinccoaElementType.FloatStruct]: 'float',
    [winccoa_manager_1.WinccoaElementType.String]: 'string', [winccoa_manager_1.WinccoaElementType.StringStruct]: 'string',
    [winccoa_manager_1.WinccoaElementType.Time]: 'time', [winccoa_manager_1.WinccoaElementType.TimeStruct]: 'time',
    [winccoa_manager_1.WinccoaElementType.LangString]: 'langString', [winccoa_manager_1.WinccoaElementType.LangStringStruct]: 'langString',
    [winccoa_manager_1.WinccoaElementType.Blob]: 'blob', [winccoa_manager_1.WinccoaElementType.BlobStruct]: 'blob',
    [winccoa_manager_1.WinccoaElementType.Bit32]: 'uint', [winccoa_manager_1.WinccoaElementType.Bit32Struct]: 'uint',
    [winccoa_manager_1.WinccoaElementType.Bit64]: 'long', [winccoa_manager_1.WinccoaElementType.Bit64Struct]: 'long',
    [winccoa_manager_1.WinccoaElementType.Dpid]: 'string', [winccoa_manager_1.WinccoaElementType.DpidStruct]: 'string',
    [winccoa_manager_1.WinccoaElementType.DynBool]: 'dyn_bool', [winccoa_manager_1.WinccoaElementType.DynBoolStruct]: 'dyn_bool',
    [winccoa_manager_1.WinccoaElementType.DynChar]: 'dyn_int', [winccoa_manager_1.WinccoaElementType.DynCharStruct]: 'dyn_int',
    [winccoa_manager_1.WinccoaElementType.DynInt]: 'dyn_int', [winccoa_manager_1.WinccoaElementType.DynIntStruct]: 'dyn_int',
    [winccoa_manager_1.WinccoaElementType.DynUInt]: 'dyn_int', [winccoa_manager_1.WinccoaElementType.DynUIntStruct]: 'dyn_int',
    [winccoa_manager_1.WinccoaElementType.DynLong]: 'dyn_int', [winccoa_manager_1.WinccoaElementType.DynLongStruct]: 'dyn_int',
    [winccoa_manager_1.WinccoaElementType.DynULong]: 'dyn_int', [winccoa_manager_1.WinccoaElementType.DynULongStruct]: 'dyn_int',
    [winccoa_manager_1.WinccoaElementType.DynBit32]: 'dyn_int', [winccoa_manager_1.WinccoaElementType.DynBit32Struct]: 'dyn_int',
    [winccoa_manager_1.WinccoaElementType.DynBit64]: 'dyn_int', [winccoa_manager_1.WinccoaElementType.DynBit64Struct]: 'dyn_int',
    [winccoa_manager_1.WinccoaElementType.DynFloat]: 'dyn_float', [winccoa_manager_1.WinccoaElementType.DynFloatStruct]: 'dyn_float',
    [winccoa_manager_1.WinccoaElementType.DynString]: 'dyn_string', [winccoa_manager_1.WinccoaElementType.DynStringStruct]: 'dyn_string',
    [winccoa_manager_1.WinccoaElementType.DynTime]: 'dyn_string', [winccoa_manager_1.WinccoaElementType.DynTimeStruct]: 'dyn_string',
    [winccoa_manager_1.WinccoaElementType.DynLangString]: 'dyn_string', [winccoa_manager_1.WinccoaElementType.DynLangStringStruct]: 'dyn_string',
    [winccoa_manager_1.WinccoaElementType.DynBlob]: 'dyn_string', [winccoa_manager_1.WinccoaElementType.DynBlobStruct]: 'dyn_string',
    [winccoa_manager_1.WinccoaElementType.DynDpid]: 'dyn_string', [winccoa_manager_1.WinccoaElementType.DynDpidStruct]: 'dyn_string'
};
/**
 * Flatten a dpType's element tree into SDM properties. Nested structs (and
 * resolved type references) are flattened with dotted paths so the full DPE
 * structure is preserved (e.g. `state.value`). The embedded `sem` struct is
 * skipped. Used when adopting an existing dpType as a class.
 */
function flattenElements(node, prefix, out) {
    for (const ch of node.children || []) {
        if (ch.name === constants_1.SEM_NODE)
            continue;
        const t = ch.type;
        // A node with children is a container (Struct / resolved Typeref / nested
        // struct) — recurse so only addressable leaves become properties. Without
        // this, a container would be emitted as a leaf and dpGet on it would reject.
        if ((ch.children?.length ?? 0) > 0) {
            flattenElements(ch, `${prefix}${ch.name}.`, out);
        }
        else {
            out.push({ name: `${prefix}${ch.name}`, type: ET_TO_FRIENDLY[t] || 'string', label: ch.name, unit: '' });
        }
    }
}
const META_PREFIX = { class: 'cls_', rel: 'rel_', aspect: 'asp_' };
const classes = new Map();
const relations = new Map();
const aspects = new Map();
function localname(iri) {
    const m = String(iri).match(/[^#/:]+$/);
    return m ? m[0] : String(iri);
}
function metaDp(kind, iri) {
    return META_PREFIX[kind] + (0, oa_1.sanitizeName)(iri);
}
function buildSemStruct() {
    return new winccoa_manager_1.WinccoaDpTypeNode(constants_1.SEM_NODE, winccoa_manager_1.WinccoaElementType.Struct, '', [
        new winccoa_manager_1.WinccoaDpTypeNode('iri', winccoa_manager_1.WinccoaElementType.String),
        new winccoa_manager_1.WinccoaDpTypeNode('classIri', winccoa_manager_1.WinccoaElementType.String),
        new winccoa_manager_1.WinccoaDpTypeNode('label', winccoa_manager_1.WinccoaElementType.String),
        new winccoa_manager_1.WinccoaDpTypeNode('edgesOut', winccoa_manager_1.WinccoaElementType.DynString),
        new winccoa_manager_1.WinccoaDpTypeNode('edgesIn', winccoa_manager_1.WinccoaElementType.DynString),
        new winccoa_manager_1.WinccoaDpTypeNode('createdAt', winccoa_manager_1.WinccoaElementType.Time)
    ]);
}
/** Reference element name for an aspect typeref (also the DPE path prefix). */
function aspectRefName(asp) {
    return (0, oa_1.sanitizeName)(localname(asp.iri));
}
/**
 * Build a class dpType with type-in-type: own props inline, the (single,
 * abstract) super class embedded via a `super` typeref, each aspect via its own
 * typeref, and — for concrete classes — the embedded `sem` struct. Referenced
 * super/aspect dpTypes must already exist.
 */
function buildClassDpt(c) {
    const children = c.ownProps.map((p) => new winccoa_manager_1.WinccoaDpTypeNode(p.name, (0, constants_1.mapType)(p.type).et));
    for (const aIri of c.aspects) {
        const asp = aspects.get(aIri);
        if (asp?.mappedDpType)
            children.push(new winccoa_manager_1.WinccoaDpTypeNode(aspectRefName(asp), winccoa_manager_1.WinccoaElementType.Typeref, asp.mappedDpType));
    }
    for (const sIri of c.superClasses) {
        const sc = classes.get(sIri);
        if (sc?.mappedDpType)
            children.push(new winccoa_manager_1.WinccoaDpTypeNode('super', winccoa_manager_1.WinccoaElementType.Typeref, sc.mappedDpType));
    }
    if (!c.isAbstract)
        children.push(buildSemStruct());
    return new winccoa_manager_1.WinccoaDpTypeNode(c.mappedDpType, winccoa_manager_1.WinccoaElementType.Struct, '', children);
}
/** Build an aspect dpType (a flat struct of its own properties). */
function buildAspectDpt(dptName, props) {
    return new winccoa_manager_1.WinccoaDpTypeNode(dptName, winccoa_manager_1.WinccoaElementType.Struct, '', props.map((p) => new winccoa_manager_1.WinccoaDpTypeNode(p.name, (0, constants_1.mapType)(p.type).et)));
}
function parseJson(str, fallback) {
    try {
        return str ? JSON.parse(str) : fallback;
    }
    catch {
        return fallback;
    }
}
async function readStruct(dpName, fields) {
    const dpes = fields.map((f) => `${dpName}.${f}`);
    const values = (await (0, oa_1.oa)().dpGet(dpes));
    const out = {};
    fields.forEach((f, i) => (out[f] = values[i]));
    return out;
}
// ---- cache loading --------------------------------------------------------
async function loadTBox() {
    classes.clear();
    relations.clear();
    aspects.clear();
    for (const dp of (0, oa_1.oa)().dpNames('*', constants_1.DPT.ASPECT)) {
        const v = await readStruct(dp, ['iri', 'label', 'mappedDpType', 'propsJson']);
        aspects.set(v.iri, {
            iri: v.iri,
            label: v.label,
            mappedDpType: v.mappedDpType,
            ownProps: parseJson(v.propsJson, [])
        });
    }
    for (const dp of (0, oa_1.oa)().dpNames('*', constants_1.DPT.CLASS)) {
        const v = await readStruct(dp, [
            'iri', 'label', 'comment', 'superClasses', 'aspects', 'mappedDpType', 'isAbstract', 'propsJson'
        ]);
        classes.set(v.iri, {
            iri: v.iri,
            label: v.label,
            comment: v.comment,
            superClasses: v.superClasses || [],
            aspects: v.aspects || [],
            mappedDpType: v.mappedDpType,
            isAbstract: !!v.isAbstract,
            ownProps: parseJson(v.propsJson, [])
        });
    }
    for (const dp of (0, oa_1.oa)().dpNames('*', constants_1.DPT.RELATION)) {
        const v = await readStruct(dp, [
            'iri', 'label', 'inverseIri', 'domain', 'range', 'cardinality',
            'symmetric', 'transitive', 'functional', 'realization'
        ]);
        relations.set(v.iri, {
            iri: v.iri,
            label: v.label,
            inverseIri: v.inverseIri,
            domain: v.domain || [],
            range: v.range || [],
            cardinality: v.cardinality || '0..*',
            symmetric: !!v.symmetric,
            transitive: !!v.transitive,
            functional: !!v.functional,
            realization: v.realization || 'inline'
        });
    }
    oa_1.log.info(`TBox loaded: ${classes.size} classes, ${relations.size} relations, ${aspects.size} aspects`);
}
// ---- reads ----------------------------------------------------------------
const getClass = (iri) => classes.get(iri) || null;
exports.getClass = getClass;
const getRelationType = (iri) => relations.get(iri) || null;
exports.getRelationType = getRelationType;
/** Find the class whose instances use the given dpType (reverse lookup). */
function getClassByDpType(dpType) {
    if (!dpType)
        return null;
    for (const c of classes.values())
        if (c.mappedDpType === dpType)
            return c;
    return null;
}
const getAspect = (iri) => aspects.get(iri) || null;
exports.getAspect = getAspect;
const listClasses = () => [...classes.values()];
exports.listClasses = listClasses;
const listRelationTypes = () => [...relations.values()];
exports.listRelationTypes = listRelationTypes;
const listAspects = () => [...aspects.values()];
exports.listAspects = listAspects;
/** All ancestor class IRIs (transitive closure of superClasses). */
function ancestorsOf(iri, seen = new Set()) {
    const c = classes.get(iri);
    if (!c)
        return seen;
    for (const sup of c.superClasses) {
        if (!seen.has(sup)) {
            seen.add(sup);
            ancestorsOf(sup, seen);
        }
    }
    return seen;
}
function isSubClassOf(child, ancestor) {
    if (child === ancestor)
        return true;
    return ancestorsOf(child).has(ancestor);
}
/**
 * Effective properties of a class with their DPE paths (own/closest wins on
 * name). Own props sit at top level; aspect props under the aspect ref element;
 * super props under `super.` (recursively).
 */
function effectiveProperties(iri, seen = new Set()) {
    const c = classes.get(iri);
    if (!c || seen.has(iri))
        return [];
    seen.add(iri);
    const byName = new Map();
    const add = (p) => {
        if (!byName.has(p.name))
            byName.set(p.name, p);
    };
    for (const p of c.ownProps)
        add({ ...p, path: p.name });
    for (const aIri of c.aspects) {
        const asp = aspects.get(aIri);
        if (!asp)
            continue;
        const ref = aspectRefName(asp);
        for (const p of asp.ownProps)
            add({ ...p, path: `${ref}.${p.name}` });
    }
    for (const sIri of c.superClasses) {
        for (const sp of effectiveProperties(sIri, seen))
            add({ ...sp, path: `super.${sp.path}` });
    }
    return [...byName.values()];
}
function normalizeProp(p) {
    if (!p?.name || !p?.type)
        throw new Error('property requires { name, type }');
    (0, constants_1.mapType)(p.type); // validates
    return { name: p.name, type: p.type, label: p.label || p.name, unit: p.unit || '' };
}
async function createClass(def) {
    if (!def?.iri)
        throw new Error('class.iri is required');
    if (classes.has(def.iri))
        throw new Error(`class already exists: ${def.iri}`);
    const superClasses = def.superClasses || [];
    if (superClasses.length > 1)
        throw new Error('only single inheritance is supported — use aspects for additional mixins');
    for (const s of superClasses) {
        const sc = classes.get(s);
        if (!sc)
            throw new Error(`unknown superClass: ${s}`);
        if (!sc.isAbstract)
            throw new Error(`superClass must be abstract: '${s}'. Concrete classes are leaves; use an abstract base class or an aspect.`);
    }
    for (const a of def.aspects || [])
        if (!aspects.has(a))
            throw new Error(`unknown aspect: ${a}`);
    const ownProps = (def.properties || []).map(normalizeProp);
    const mappedDpType = def.dpType || `C_${(0, oa_1.sanitizeName)(localname(def.iri))}`;
    const types = (0, oa_1.oa)().dpTypes(mappedDpType);
    if (types && types.includes(mappedDpType))
        throw new Error(`dpType '${mappedDpType}' already exists; pass a different dpType`);
    const classDef = {
        iri: def.iri,
        label: def.label || localname(def.iri),
        comment: def.comment || '',
        superClasses,
        aspects: def.aspects || [],
        mappedDpType, // every class (abstract too) is a real dpType, referenceable
        isAbstract: !!def.isAbstract,
        ownProps
    };
    await (0, oa_1.oa)().dpTypeCreate(buildClassDpt(classDef));
    oa_1.log.info(`created class dpType ${mappedDpType} (type-in-type; super=${superClasses[0] || '-'}, aspects=${classDef.aspects.length})`);
    const dp = metaDp('class', def.iri);
    if (!(await (0, oa_1.exists)(dp)))
        await (0, oa_1.oa)().dpCreate(dp, constants_1.DPT.CLASS);
    await (0, oa_1.oa)().dpSetWait([
        `${dp}.iri`, `${dp}.label`, `${dp}.comment`, `${dp}.superClasses`,
        `${dp}.aspects`, `${dp}.mappedDpType`, `${dp}.isAbstract`, `${dp}.propsJson`
    ], [
        classDef.iri, classDef.label, classDef.comment, classDef.superClasses,
        classDef.aspects, classDef.mappedDpType, classDef.isAbstract, JSON.stringify(ownProps)
    ]);
    classes.set(def.iri, classDef);
    return classDef;
}
/**
 * Delete a class: its instances (only with deleteInstances=true), its dpType and
 * its meta DP. Fails if the dpType is still referenced by a subclass (delete
 * leaves first). Edge cleanup of instances is done by the service layer.
 */
async function deleteClass(iri, deleteInstances = false) {
    const c = classes.get(iri);
    if (!c)
        return false;
    if (c.mappedDpType) {
        const insts = (0, oa_1.oa)().dpNames('*', c.mappedDpType).map(oa_1.localName);
        if (insts.length && !deleteInstances)
            throw new Error(`class '${iri}' has ${insts.length} instance(s); pass deleteInstances=true`);
        for (const dp of insts)
            await (0, oa_1.oa)().dpDelete(dp);
        const types = (0, oa_1.oa)().dpTypes(c.mappedDpType);
        if (types && types.includes(c.mappedDpType))
            await (0, oa_1.oa)().dpTypeDelete(c.mappedDpType);
    }
    const dp = metaDp('class', iri);
    if (await (0, oa_1.exists)(dp))
        await (0, oa_1.oa)().dpDelete(dp);
    classes.delete(iri);
    oa_1.log.info(`deleted class ${iri}`);
    return true;
}
/**
 * Add a data property to a class. The class dpType is changed in place; WinCC OA
 * propagates the change through every typeref that references it — i.e. to all
 * subclasses and their EXISTING instances (the whole point of type-in-type).
 */
async function addClassProperty(iri, prop) {
    const c = classes.get(iri);
    if (!c)
        throw new Error(`unknown class: ${iri}`);
    if (!c.mappedDpType)
        throw new Error(`class '${iri}' has no dpType`);
    const np = normalizeProp(prop);
    if (c.ownProps.some((p) => p.name === np.name))
        throw new Error(`property '${np.name}' already exists on ${iri}`);
    const tree = (0, oa_1.oa)().dpTypeGet(c.mappedDpType);
    if (!tree.children)
        tree.children = [];
    tree.children.push(new winccoa_manager_1.WinccoaDpTypeNode(np.name, (0, constants_1.mapType)(np.type).et));
    await (0, oa_1.oa)().dpTypeChange(tree);
    c.ownProps.push(np);
    const dp = metaDp('class', iri);
    await (0, oa_1.oa)().dpSetWait([`${dp}.propsJson`], [JSON.stringify(c.ownProps)]);
    oa_1.log.info(`added property '${np.name}' to ${iri} -> propagates via type-in-type`);
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
async function adoptDpTypeAsClass(dpType, iri, label) {
    const existing = getClassByDpType(dpType);
    if (existing) {
        // Self-heal: refresh the property list from the current type structure (so an
        // earlier adoption that recorded no/partial properties gets corrected on re-run).
        const t0 = (0, oa_1.oa)().dpTypeGet(existing.mappedDpType);
        const props = [];
        flattenElements(t0, '', props);
        if (JSON.stringify(props) !== JSON.stringify(existing.ownProps)) {
            existing.ownProps = props;
            await (0, oa_1.oa)().dpSetWait([`${metaDp('class', existing.iri)}.propsJson`], [JSON.stringify(props)]);
            oa_1.log.info(`refreshed adopted class ${existing.iri}: ${props.length} properties`);
        }
        return existing;
    }
    const types = (0, oa_1.oa)().dpTypes(dpType);
    if (!types || !types.includes(dpType))
        throw new Error(`dpType '${dpType}' does not exist`);
    const classIri = iri || `oa:${dpType}`;
    if (classes.has(classIri))
        throw new Error(`class iri '${classIri}' already exists with a different dpType`);
    // Augment the existing type with the embedded sem struct (additive dpTypeChange).
    const tree = (0, oa_1.oa)().dpTypeGet(dpType);
    if (!tree.children)
        tree.children = [];
    if (!tree.children.some((ch) => ch.name === constants_1.SEM_NODE)) {
        tree.children.push(buildSemStruct());
        await (0, oa_1.oa)().dpTypeChange(tree);
        oa_1.log.info(`adopted dpType ${dpType}: added embedded sem struct`);
    }
    // Expose ALL data point elements of the type as SDM properties (flattened,
    // dotted paths preserve the DPE structure; the sem struct is skipped).
    const ownProps = [];
    flattenElements(tree, '', ownProps);
    const classDef = {
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
    if (!(await (0, oa_1.exists)(dp)))
        await (0, oa_1.oa)().dpCreate(dp, constants_1.DPT.CLASS);
    await (0, oa_1.oa)().dpSetWait([`${dp}.iri`, `${dp}.label`, `${dp}.comment`, `${dp}.superClasses`, `${dp}.aspects`, `${dp}.mappedDpType`, `${dp}.isAbstract`, `${dp}.propsJson`], [classDef.iri, classDef.label, classDef.comment, [], [], classDef.mappedDpType, false, JSON.stringify(ownProps)]);
    classes.set(classIri, classDef);
    oa_1.log.info(`registered adopted class ${classIri} -> dpType ${dpType}`);
    return classDef;
}
async function createRelationType(def) {
    if (!def?.iri)
        throw new Error('relationType.iri is required');
    if (relations.has(def.iri))
        throw new Error(`relationType already exists: ${def.iri}`);
    const rel = {
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
    if (!(await (0, oa_1.exists)(dp)))
        await (0, oa_1.oa)().dpCreate(dp, constants_1.DPT.RELATION);
    await (0, oa_1.oa)().dpSetWait([
        `${dp}.iri`, `${dp}.label`, `${dp}.inverseIri`, `${dp}.domain`, `${dp}.range`,
        `${dp}.cardinality`, `${dp}.symmetric`, `${dp}.transitive`, `${dp}.functional`, `${dp}.realization`
    ], [
        rel.iri, rel.label, rel.inverseIri, rel.domain, rel.range,
        rel.cardinality, rel.symmetric, rel.transitive, rel.functional, rel.realization
    ]);
    relations.set(def.iri, rel);
    return rel;
}
async function createAspect(def) {
    if (!def?.iri)
        throw new Error('aspect.iri is required');
    if (aspects.has(def.iri))
        throw new Error(`aspect already exists: ${def.iri}`);
    const ownProps = (def.properties || []).map(normalizeProp);
    const mappedDpType = `A_${(0, oa_1.sanitizeName)(localname(def.iri))}`;
    const types = (0, oa_1.oa)().dpTypes(mappedDpType);
    if (types && types.includes(mappedDpType))
        throw new Error(`aspect dpType '${mappedDpType}' already exists`);
    await (0, oa_1.oa)().dpTypeCreate(buildAspectDpt(mappedDpType, ownProps));
    const asp = { iri: def.iri, label: def.label || localname(def.iri), mappedDpType, ownProps };
    const dp = metaDp('aspect', def.iri);
    if (!(await (0, oa_1.exists)(dp)))
        await (0, oa_1.oa)().dpCreate(dp, constants_1.DPT.ASPECT);
    await (0, oa_1.oa)().dpSetWait([`${dp}.iri`, `${dp}.label`, `${dp}.mappedDpType`, `${dp}.propsJson`], [asp.iri, asp.label, asp.mappedDpType, JSON.stringify(ownProps)]);
    aspects.set(def.iri, asp);
    return asp;
}
//# sourceMappingURL=ontology.js.map