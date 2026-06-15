// -----------------------------------------------------------------------------
// Constants and property datatype mappings for the Semantic Data Model (SDM).
//
// The whole model lives in OA primitives (DPT / DP / CNS) so that it is covered
// by OA redundancy and distribution automatically. Nothing is runtime-only
// state; everything is reconstructable from DP + CNS.
// -----------------------------------------------------------------------------
import { WinccoaElementType, WinccoaCtrlType } from 'winccoa-manager';

/** Meta data point types (TBox / ontology storage). */
export const DPT = {
  CLASS: '_SemClass', // one DP per semantic class
  RELATION: '_SemRelationType', // one DP per object-property / edge type
  ASPECT: '_SemAspect', // reusable mixin / aspect
  EDGE: '_SemEdge', // reified ("living") relationship instance
  TEMPLATE: '_SemTemplate' // reusable typical / equipment-module template
} as const;

/** Embedded base struct injected into every class DPT. */
export const SEM_NODE = 'sem';
export const SEM = {
  IRI: `${SEM_NODE}.iri`,
  CLASS_IRI: `${SEM_NODE}.classIri`,
  LABEL: `${SEM_NODE}.label`,
  EDGES_OUT: `${SEM_NODE}.edgesOut`,
  EDGES_IN: `${SEM_NODE}.edgesIn`,
  CREATED: `${SEM_NODE}.createdAt`
} as const;

/** Default CNS backbone view (registry + part-of hierarchy). */
export const SDM_VIEW = '_SDM';

/** Property keys used on CNS nodes. */
export const CNS_PROP = {
  CLASS: 'sdm:class',
  IRI: 'sdm:iri'
} as const;

/** Edge realization strategy (see _SemRelationType.realization). */
export const REALIZATION = {
  INLINE: 'inline', // adjacency lists on the instance DP (default, scales)
  EDGE_DP: 'edgeDp' // reified _SemEdge data point (attributed / living edge)
} as const;

/** WebSocket command prefix handled by the SDM request handler. */
export const SDM_PREFIX = 'sdm.';

export interface TypeMapping {
  et: WinccoaElementType;
  ct: WinccoaCtrlType;
}

/** Friendly type string -> { dpType element type, cns/ctrl value type }. */
export const TYPE_MAP: { [k: string]: TypeMapping } = {
  bool: { et: WinccoaElementType.Bool, ct: WinccoaCtrlType.bool },
  int: { et: WinccoaElementType.Int, ct: WinccoaCtrlType.int },
  uint: { et: WinccoaElementType.UInt, ct: WinccoaCtrlType.uint },
  long: { et: WinccoaElementType.Long, ct: WinccoaCtrlType.long },
  float: { et: WinccoaElementType.Float, ct: WinccoaCtrlType.float },
  double: { et: WinccoaElementType.Float, ct: WinccoaCtrlType.double },
  string: { et: WinccoaElementType.String, ct: WinccoaCtrlType.string },
  time: { et: WinccoaElementType.Time, ct: WinccoaCtrlType.time },
  langString: { et: WinccoaElementType.LangString, ct: WinccoaCtrlType.langString },
  blob: { et: WinccoaElementType.Blob, ct: WinccoaCtrlType.blob },
  dyn_string: { et: WinccoaElementType.DynString, ct: WinccoaCtrlType.dyn_string },
  dyn_int: { et: WinccoaElementType.DynInt, ct: WinccoaCtrlType.dyn_int },
  dyn_float: { et: WinccoaElementType.DynFloat, ct: WinccoaCtrlType.dyn_float },
  dyn_bool: { et: WinccoaElementType.DynBool, ct: WinccoaCtrlType.dyn_bool }
};

export function mapType(typeStr: string): TypeMapping {
  const m = TYPE_MAP[typeStr];
  if (!m) throw new Error(`Unsupported property datatype: '${typeStr}'`);
  return m;
}
