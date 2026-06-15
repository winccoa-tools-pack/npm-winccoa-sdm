// -----------------------------------------------------------------------------
// Idempotent creation of the meta data point types (ontology storage) and the
// default CNS backbone view. Runs only on the active peer (see redu.ts); the
// result replicates to the standby via OA redundancy.
// -----------------------------------------------------------------------------
import { WinccoaDpTypeNode, WinccoaElementType as ET } from 'winccoa-manager';
import { oa, localSystem, log } from './oa';
import { DPT, SDM_VIEW } from './constants';
import { mayWrite } from './redu';

function node(name: string, type: ET, ref = '', children: WinccoaDpTypeNode[] = []): WinccoaDpTypeNode {
  return new WinccoaDpTypeNode(name, type, ref, children);
}
const s = (n: string) => node(n, ET.String);
const ds = (n: string) => node(n, ET.DynString);
const b = (n: string) => node(n, ET.Bool);

function metaTypes(): WinccoaDpTypeNode[] {
  return [
    node(DPT.CLASS, ET.Struct, '', [
      s('iri'), s('label'), s('comment'), ds('superClasses'), ds('aspects'),
      s('mappedDpType'), b('isAbstract'), s('propsJson')
    ]),
    node(DPT.RELATION, ET.Struct, '', [
      s('iri'), s('label'), s('inverseIri'), ds('domain'), ds('range'),
      s('cardinality'), b('symmetric'), b('transitive'), b('functional'), s('realization')
    ]),
    node(DPT.ASPECT, ET.Struct, '', [s('iri'), s('label'), s('mappedDpType'), s('propsJson')]),
    node(DPT.EDGE, ET.Struct, '', [
      s('relIri'), s('source'), s('target'), s('props'), node('weight', ET.Float)
    ]),
    node(DPT.TEMPLATE, ET.Struct, '', [s('id'), s('label'), s('defJson')])
  ];
}

async function ensureType(typeNode: WinccoaDpTypeNode): Promise<void> {
  const existing = oa().dpTypes(typeNode.name);
  if (existing && existing.includes(typeNode.name)) return;
  await oa().dpTypeCreate(typeNode);
  log.info(`created meta dpType ${typeNode.name}`);
}

async function ensureBackboneView(): Promise<void> {
  const sys = localSystem();
  const viewPath = `${sys}.${SDM_VIEW}`;
  let views: string[] = [];
  try {
    views = oa().cnsGetViews(sys) || [];
  } catch {
    views = [];
  }
  if (views.includes(`${viewPath}:`)) return;
  await oa().cnsCreateView(viewPath, {
    'en_US.utf8': 'Semantic Data Model',
    'de_AT.utf8': 'Semantisches Datenmodell'
  });
  log.info(`created backbone CNS view ${viewPath}`);
}

/** Create all meta types and the backbone view if missing (active peer only). */
export async function bootstrapSdm(): Promise<void> {
  if (!mayWrite()) return;
  for (const t of metaTypes()) await ensureType(t);
  await ensureBackboneView();
  log.info('bootstrap complete');
}
