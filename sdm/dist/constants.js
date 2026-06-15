"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TYPE_MAP = exports.SDM_PREFIX = exports.REALIZATION = exports.CNS_PROP = exports.SDM_VIEW = exports.SEM = exports.SEM_NODE = exports.DPT = void 0;
exports.mapType = mapType;
// -----------------------------------------------------------------------------
// Constants and property datatype mappings for the Semantic Data Model (SDM).
//
// The whole model lives in OA primitives (DPT / DP / CNS) so that it is covered
// by OA redundancy and distribution automatically. Nothing is runtime-only
// state; everything is reconstructable from DP + CNS.
// -----------------------------------------------------------------------------
const winccoa_manager_1 = require("winccoa-manager");
/** Meta data point types (TBox / ontology storage). */
exports.DPT = {
    CLASS: '_SemClass', // one DP per semantic class
    RELATION: '_SemRelationType', // one DP per object-property / edge type
    ASPECT: '_SemAspect', // reusable mixin / aspect
    EDGE: '_SemEdge', // reified ("living") relationship instance
    TEMPLATE: '_SemTemplate' // reusable typical / equipment-module template
};
/** Embedded base struct injected into every class DPT. */
exports.SEM_NODE = 'sem';
exports.SEM = {
    IRI: `${exports.SEM_NODE}.iri`,
    CLASS_IRI: `${exports.SEM_NODE}.classIri`,
    LABEL: `${exports.SEM_NODE}.label`,
    EDGES_OUT: `${exports.SEM_NODE}.edgesOut`,
    EDGES_IN: `${exports.SEM_NODE}.edgesIn`,
    CREATED: `${exports.SEM_NODE}.createdAt`
};
/** Default CNS backbone view (registry + part-of hierarchy). */
exports.SDM_VIEW = '_SDM';
/** Property keys used on CNS nodes. */
exports.CNS_PROP = {
    CLASS: 'sdm:class',
    IRI: 'sdm:iri'
};
/** Edge realization strategy (see _SemRelationType.realization). */
exports.REALIZATION = {
    INLINE: 'inline', // adjacency lists on the instance DP (default, scales)
    EDGE_DP: 'edgeDp' // reified _SemEdge data point (attributed / living edge)
};
/** WebSocket command prefix handled by the SDM request handler. */
exports.SDM_PREFIX = 'sdm.';
/** Friendly type string -> { dpType element type, cns/ctrl value type }. */
exports.TYPE_MAP = {
    bool: { et: winccoa_manager_1.WinccoaElementType.Bool, ct: winccoa_manager_1.WinccoaCtrlType.bool },
    int: { et: winccoa_manager_1.WinccoaElementType.Int, ct: winccoa_manager_1.WinccoaCtrlType.int },
    uint: { et: winccoa_manager_1.WinccoaElementType.UInt, ct: winccoa_manager_1.WinccoaCtrlType.uint },
    long: { et: winccoa_manager_1.WinccoaElementType.Long, ct: winccoa_manager_1.WinccoaCtrlType.long },
    float: { et: winccoa_manager_1.WinccoaElementType.Float, ct: winccoa_manager_1.WinccoaCtrlType.float },
    double: { et: winccoa_manager_1.WinccoaElementType.Float, ct: winccoa_manager_1.WinccoaCtrlType.double },
    string: { et: winccoa_manager_1.WinccoaElementType.String, ct: winccoa_manager_1.WinccoaCtrlType.string },
    time: { et: winccoa_manager_1.WinccoaElementType.Time, ct: winccoa_manager_1.WinccoaCtrlType.time },
    langString: { et: winccoa_manager_1.WinccoaElementType.LangString, ct: winccoa_manager_1.WinccoaCtrlType.langString },
    blob: { et: winccoa_manager_1.WinccoaElementType.Blob, ct: winccoa_manager_1.WinccoaCtrlType.blob },
    dyn_string: { et: winccoa_manager_1.WinccoaElementType.DynString, ct: winccoa_manager_1.WinccoaCtrlType.dyn_string },
    dyn_int: { et: winccoa_manager_1.WinccoaElementType.DynInt, ct: winccoa_manager_1.WinccoaCtrlType.dyn_int },
    dyn_float: { et: winccoa_manager_1.WinccoaElementType.DynFloat, ct: winccoa_manager_1.WinccoaCtrlType.dyn_float },
    dyn_bool: { et: winccoa_manager_1.WinccoaElementType.DynBool, ct: winccoa_manager_1.WinccoaCtrlType.dyn_bool }
};
function mapType(typeStr) {
    const m = exports.TYPE_MAP[typeStr];
    if (!m)
        throw new Error(`Unsupported property datatype: '${typeStr}'`);
    return m;
}
//# sourceMappingURL=constants.js.map