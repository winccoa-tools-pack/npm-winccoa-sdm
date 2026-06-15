// Shared SDM domain types.

export interface PropertyDef {
  name: string;
  type: string; // friendly datatype key (see TYPE_MAP)
  label?: string;
  unit?: string;
}

/**
 * An effective (resolved) property of a class: the flat semantic `name` plus the
 * actual DPE `path` within an instance. With type-in-type (DPT references),
 * inherited properties live under a reference element, e.g. own `flow` -> path
 * `flow`, inherited `location` -> path `super.location`, aspect `lastService`
 * -> path `<aspect>.lastService`. The UI/MCP only see `name`; the model maps to
 * `path` for dpGet/dpSet.
 */
export interface EffProp extends PropertyDef {
  path: string;
}

export interface ClassDef {
  iri: string;
  label: string;
  comment: string;
  superClasses: string[];
  aspects: string[];
  mappedDpType: string;
  isAbstract: boolean;
  ownProps: PropertyDef[];
}

export interface RelationTypeDef {
  iri: string;
  label: string;
  inverseIri: string;
  domain: string[];
  range: string[];
  cardinality: string; // '1' | '0..1' | '1..*' | '0..*' | 'n..m'
  symmetric: boolean;
  transitive: boolean;
  functional: boolean;
  realization: string; // 'inline' | 'edgeDp'
}

export interface AspectDef {
  iri: string;
  label: string;
  mappedDpType: string;
  ownProps: PropertyDef[];
}

export interface EdgeRecord {
  rel: string;
  src: string; // qualified source IRI
  tgt: string; // qualified target IRI
  props?: { [k: string]: unknown };
  edgeDp?: string; // qualified _SemEdge dp (only for realization 'edgeDp')
}

export interface Instance {
  dp: string;
  iri: string;
  classIri: string;
  label: string;
  createdAt: unknown;
  properties: { [k: string]: unknown };
  edgesOut: EdgeRecord[];
  edgesIn: EdgeRecord[];
}

export interface Neighbor {
  direction: 'out' | 'in';
  rel: string;
  neighbor: string;
  dp: string;
  edgeDp: string | null;
  props: { [k: string]: unknown } | null;
}
