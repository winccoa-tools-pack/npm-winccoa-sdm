"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapSdm = bootstrapSdm;
// -----------------------------------------------------------------------------
// Idempotent creation of the meta data point types (ontology storage) and the
// default CNS backbone view. Runs only on the active peer (see redu.ts); the
// result replicates to the standby via OA redundancy.
// -----------------------------------------------------------------------------
const winccoa_manager_1 = require("winccoa-manager");
const oa_1 = require("./oa");
const constants_1 = require("./constants");
const redu_1 = require("./redu");
function node(name, type, ref = '', children = []) {
    return new winccoa_manager_1.WinccoaDpTypeNode(name, type, ref, children);
}
const s = (n) => node(n, winccoa_manager_1.WinccoaElementType.String);
const ds = (n) => node(n, winccoa_manager_1.WinccoaElementType.DynString);
const b = (n) => node(n, winccoa_manager_1.WinccoaElementType.Bool);
function metaTypes() {
    return [
        node(constants_1.DPT.CLASS, winccoa_manager_1.WinccoaElementType.Struct, '', [
            s('iri'), s('label'), s('comment'), ds('superClasses'), ds('aspects'),
            s('mappedDpType'), b('isAbstract'), s('propsJson')
        ]),
        node(constants_1.DPT.RELATION, winccoa_manager_1.WinccoaElementType.Struct, '', [
            s('iri'), s('label'), s('inverseIri'), ds('domain'), ds('range'),
            s('cardinality'), b('symmetric'), b('transitive'), b('functional'), s('realization')
        ]),
        node(constants_1.DPT.ASPECT, winccoa_manager_1.WinccoaElementType.Struct, '', [s('iri'), s('label'), s('mappedDpType'), s('propsJson')]),
        node(constants_1.DPT.EDGE, winccoa_manager_1.WinccoaElementType.Struct, '', [
            s('relIri'), s('source'), s('target'), s('props'), node('weight', winccoa_manager_1.WinccoaElementType.Float)
        ]),
        node(constants_1.DPT.TEMPLATE, winccoa_manager_1.WinccoaElementType.Struct, '', [s('id'), s('label'), s('defJson')])
    ];
}
async function ensureType(typeNode) {
    const existing = (0, oa_1.oa)().dpTypes(typeNode.name);
    if (existing && existing.includes(typeNode.name))
        return;
    await (0, oa_1.oa)().dpTypeCreate(typeNode);
    oa_1.log.info(`created meta dpType ${typeNode.name}`);
}
async function ensureBackboneView() {
    const sys = (0, oa_1.localSystem)();
    const viewPath = `${sys}.${constants_1.SDM_VIEW}`;
    let views = [];
    try {
        views = (0, oa_1.oa)().cnsGetViews(sys) || [];
    }
    catch {
        views = [];
    }
    if (views.includes(`${viewPath}:`))
        return;
    await (0, oa_1.oa)().cnsCreateView(viewPath, {
        'en_US.utf8': 'Semantic Data Model',
        'de_AT.utf8': 'Semantisches Datenmodell'
    });
    oa_1.log.info(`created backbone CNS view ${viewPath}`);
}
/** Create all meta types and the backbone view if missing (active peer only). */
async function bootstrapSdm() {
    if (!(0, redu_1.mayWrite)())
        return;
    for (const t of metaTypes())
        await ensureType(t);
    await ensureBackboneView();
    oa_1.log.info('bootstrap complete');
}
//# sourceMappingURL=bootstrap.js.map