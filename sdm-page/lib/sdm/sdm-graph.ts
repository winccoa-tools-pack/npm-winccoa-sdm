/**
 * Graph canvas for the SDM page — a neighborhood-driven, expand-on-demand graph
 * of instances and their relations, rendered with Cytoscape.js in a modal.
 *
 * Seeded at one instance; clicking a node loads and adds its neighbors (via
 * sdm.instance.neighbors). Nodes are coloured by class, edges by relation type.
 * Layout is concentric by hop distance from the seed (seed in the centre), so
 * the neighborhood reads as rings. Scales because it only loads what's explored.
 *
 * Note: Cytoscape draws on a canvas and cannot resolve CSS custom properties, so
 * the iX theme colours are read once via getComputedStyle and passed as concrete
 * values.
 */
import cytoscape, { type Core } from 'cytoscape';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { SdmApi } from './sdm-api.js';
import { SdmClass, SdmRelationType } from './sdm-types.js';

const NODE_PALETTE = ['#5aa9e6', '#ff9f43', '#5ec27e', '#ef5b6b', '#b084e9', '#c08457', '#ef94c9', '#3fc7d6', '#cdd23f'];
const EDGE_PALETTE = ['#7aa7c7', '#d6a25a', '#6fb98a', '#d77', '#a98fd0', '#69b6bd'];

// Guards for the full-substructure traversal: stop runaway loads on very large
// (or densely connected) models. Cycles are handled by the `expanded` set.
const MAX_NODES = 600;
const MAX_DEPTH = 16;

interface Theme {
  text: string;
  weak: string;
  bg: string;
  soft: string;
  primary: string;
}

export class WuiSdmGraph extends LitElement {
  static override readonly styles = css`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .panel {
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      width: 88vw;
      height: 86vh;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .bar .hint {
      color: var(--theme-color-weak-text);
      font-size: 0.82rem;
    }
    .bar .spacer {
      margin-left: auto;
    }
    .bar .relfilter,
    .bar .dirsel {
      min-width: 11rem;
      max-width: 18rem;
    }
    .legend {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      padding: 0.35rem 0.75rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      font-size: 0.78rem;
      color: var(--theme-color-weak-text);
      max-height: 3.2rem;
      overflow: auto;
    }
    .legend .item {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .legend .dot {
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
      display: inline-block;
    }
    #cy {
      flex: 1;
      min-height: 0;
    }
  `;

  @property() seed = '';
  @property({ attribute: false }) classes: SdmClass[] = [];
  @property({ attribute: false }) relationTypes: SdmRelationType[] = [];

  @state() private status = '';
  /** Relation IRIs to include while traversing; empty = all relation types. */
  @state() private relFilter: string[] = [];
  /** Traversal direction. `in` (default) follows incoming edges = the node's
   *  sub-structure (e.g. its isa:partOf children); `out` follows outgoing edges. */
  @state() private direction: 'in' | 'out' | 'both' = 'in';

  private readonly api = new SdmApi();
  private cy?: Core;
  private expanded = new Set<string>();
  private theme: Theme = { text: '#cfd3d8', weak: '#8a9099', bg: '#23272e', soft: '#3a3f47', primary: '#00bedc' };

  override firstUpdated(): void {
    this.theme = this.readTheme();
    const container = this.renderRoot.querySelector('#cy') as HTMLElement;
    container.style.background = this.theme.bg;
    this.cy = cytoscape({
      container,
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.25,
      style: this.cyStyle()
    });
    this.cy.on('tap', 'node', (evt) => void this.expand(evt.target.id()));
    this.cy.on('mouseover', 'node', (evt) => this.highlight(evt.target.id()));
    this.cy.on('mouseout', 'node', () => this.cy?.elements().removeClass('dim'));
    void this.start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cy?.destroy();
  }

  private readTheme(): Theme {
    const cs = getComputedStyle(this);
    const get = (v: string, fb: string): string => cs.getPropertyValue(v).trim() || fb;
    return {
      text: get('--theme-color-std-text', '#cfd3d8'),
      weak: get('--theme-color-weak-text', '#8a9099'),
      bg: get('--theme-color-1', '#23272e'),
      soft: get('--theme-color-soft-bdr', '#3a3f47'),
      primary: get('--theme-color-primary', '#00bedc')
    };
  }

  // eslint-disable-next-line max-lines-per-function -- one declarative stylesheet
  private cyStyle(): cytoscape.Stylesheet[] {
    const t = this.theme;
    return [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          'border-width': 2,
          'border-color': t.bg,
          label: 'data(label)',
          color: t.text,
          'font-size': '11px',
          'text-valign': 'bottom',
          'text-margin-y': 5,
          'text-background-color': t.bg,
          'text-background-opacity': 0.85,
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle',
          width: 30,
          height: 30
        }
      },
      { selector: 'node.unexpanded', style: { 'border-style': 'dashed', 'border-color': t.weak, opacity: 0.92 } },
      { selector: 'node.seed', style: { 'border-width': 4, 'border-color': t.primary, width: 38, height: 38 } },
      {
        selector: 'edge',
        style: {
          label: 'data(rel)',
          'font-size': '9px',
          color: t.weak,
          'text-rotation': 'autorotate',
          'text-background-color': t.bg,
          'text-background-opacity': 0.85,
          'text-background-padding': '2px',
          width: 1.8,
          'line-color': 'data(color)',
          'target-arrow-color': 'data(color)',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.9,
          'curve-style': 'bezier',
          'control-point-step-size': 40
        }
      },
      { selector: '.dim', style: { opacity: 0.18 } }
    ];
  }

  private nodeColor(classIri: string): string {
    const i = this.classes.findIndex((c) => c.iri === classIri);
    return NODE_PALETTE[(i < 0 ? 0 : i) % NODE_PALETTE.length];
  }
  private edgeColor(relIri: string): string {
    const i = this.relationTypes.findIndex((r) => r.iri === relIri);
    return EDGE_PALETTE[(i < 0 ? 0 : i) % EDGE_PALETTE.length];
  }
  private relLabel(iri: string): string {
    return this.relationTypes.find((r) => r.iri === iri)?.label || iri;
  }

  private highlight(id: string): void {
    if (!this.cy) return;
    this.cy.elements().addClass('dim');
    const n = this.cy.getElementById(id);
    n.removeClass('dim');
    n.connectedEdges().removeClass('dim');
    n.neighborhood('node').removeClass('dim');
  }

  private async addNode(dp: string, seed = false): Promise<void> {
    if (this.cy?.getElementById(dp).length) return;
    let label = dp;
    let classIri = '';
    try {
      const inst = await this.api.getInstance(dp);
      if (inst) {
        label = inst.label || dp;
        classIri = inst.classIri;
      }
    } catch {
      /* keep defaults */
    }
    this.cy?.add({
      group: 'nodes',
      data: { id: dp, label, classIri, color: this.nodeColor(classIri) },
      classes: seed ? 'seed' : 'unexpanded'
    });
  }

  private async start(): Promise<void> {
    if (!this.seed) return;
    await this.addNode(this.seed, true);
    await this.expandAll(this.seed);
    this.cy?.fit(undefined, 40);
  }

  private includeRel(iri: string): boolean {
    return this.relFilter.length === 0 || this.relFilter.includes(iri);
  }

  /**
   * Add one hop of relations around dp in the selected direction; returns the
   * neighbor dps. The default `in` direction follows incoming edges, so traversal
   * descends into the node's sub-structure (e.g. its isa:partOf children) rather
   * than the whole connected component. Filtered by the active relation-type
   * filter. No layout.
   */
  private async loadHop(dp: string): Promise<string[]> {
    if (!this.cy) return [];
    const neighbors = (await this.api.neighbors(dp, this.direction)).filter((n) => this.includeRel(n.rel));
    const dps = [...new Set(neighbors.map((n) => n.dp))];
    await Promise.all(dps.map((d) => this.addNode(d)));
    for (const n of neighbors) {
      const src = n.direction === 'out' ? dp : n.dp;
      const tgt = n.direction === 'out' ? n.dp : dp;
      const id = `${n.rel}|${src}|${tgt}`;
      if (!this.cy.getElementById(id).length) {
        this.cy.add({ group: 'edges', data: { id, source: src, target: tgt, rel: this.relLabel(n.rel), color: this.edgeColor(n.rel) } });
      }
    }
    return dps;
  }

  /** Single-hop expand (manual, on tap). */
  private async expand(dp: string): Promise<void> {
    if (!this.cy) return;
    if (this.expanded.has(dp)) {
      this.cy.animate({ center: { eles: this.cy.getElementById(dp) } }, { duration: 200 });
      return;
    }
    this.expanded.add(dp);
    this.cy.getElementById(dp).removeClass('unexpanded');
    this.status = `expanding ${dp} …`;
    try {
      await this.loadHop(dp);
      this.layout();
      this.status = '';
    } catch (e) {
      this.status = (e as Error).message;
    }
  }

  /**
   * Breadth-first expansion of the whole substructure reachable from `root`.
   * Cycle-safe: the `expanded` set guarantees each node is visited at most once,
   * so circular references (e.g. mutual relations) terminate. Bounded by
   * MAX_NODES / MAX_DEPTH to stay responsive on large graphs.
   */
  private async expandAll(root: string): Promise<void> {
    if (!this.cy) return;
    const queue: { dp: string; depth: number }[] = [{ dp: root, depth: 0 }];
    let capped = false;
    while (queue.length) {
      const { dp, depth } = queue.shift() as { dp: string; depth: number };
      if (this.expanded.has(dp)) continue; // already visited → breaks cycles
      if (this.cy.nodes().length >= MAX_NODES) {
        capped = true;
        break;
      }
      this.expanded.add(dp);
      this.cy.getElementById(dp).removeClass('unexpanded');
      this.status = `loading substructure … (${this.cy.nodes().length} nodes)`;
      let dps: string[] = [];
      try {
        dps = await this.loadHop(dp);
      } catch (e) {
        this.status = (e as Error).message;
        continue;
      }
      if (depth < MAX_DEPTH) for (const d of dps) if (!this.expanded.has(d)) queue.push({ dp: d, depth: depth + 1 });
    }
    this.layout();
    this.status = capped ? `truncated at ${MAX_NODES} nodes — tap a dashed node to expand further` : '';
  }

  /** Concentric rings by hop distance from the seed (seed in the centre). */
  private layout(): void {
    if (!this.cy) return;
    const dist = this.distancesFromSeed();
    const maxD = Math.max(1, ...dist.values());
    this.cy
      .layout({
        name: 'concentric',
        concentric: (node: cytoscape.NodeSingular) => maxD - (dist.get(node.id()) ?? maxD) + 1,
        levelWidth: () => 1,
        minNodeSpacing: 45,
        spacingFactor: 1.1,
        padding: 30,
        animate: true,
        animationDuration: 400
      } as never)
      .run();
  }

  private distancesFromSeed(): Map<string, number> {
    const dist = new Map<string, number>();
    if (!this.cy) return dist;
    dist.set(this.seed, 0);
    const queue = [this.seed];
    while (queue.length) {
      const cur = queue.shift() as string;
      const d = dist.get(cur) ?? 0;
      this.cy
        .getElementById(cur)
        .neighborhood('node')
        .forEach((nb) => {
          const id = nb.id();
          if (!dist.has(id)) {
            dist.set(id, d + 1);
            queue.push(id);
          }
        });
    }
    return dist;
  }

  private onFilterChange(detail: string | string[]): void {
    this.relFilter = Array.isArray(detail) ? detail : detail ? [detail] : [];
    void this.rebuild();
  }

  private onDirectionChange(detail: string | string[]): void {
    const d = Array.isArray(detail) ? detail[0] : detail;
    if (d === 'in' || d === 'out' || d === 'both') {
      this.direction = d;
      void this.rebuild();
    }
  }

  /** Re-traverse the substructure from the seed with the current relation filter. */
  private async rebuild(): Promise<void> {
    if (!this.cy) return;
    this.cy.elements().remove();
    this.expanded.clear();
    await this.addNode(this.seed, true);
    await this.expandAll(this.seed);
    this.cy.fit(undefined, 40);
  }

  private fit = (): void => {
    this.cy?.animate({ fit: { eles: this.cy.elements(), padding: 40 } }, { duration: 300 });
  };
  private close = (): void => {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  };

  private renderLegend(): TemplateResult {
    const used = [...new Set(this.cy?.nodes().map((n) => n.data('classIri') as string) ?? [])];
    const items = used.length ? used : this.classes.map((c) => c.iri);
    return html`
      <div class="legend">
        ${items.map((iri) => {
          const cls = this.classes.find((c) => c.iri === iri);
          return html`<span class="item"><span class="dot" style="background:${this.nodeColor(iri)}"></span>${cls?.label || iri || '—'}</span>`;
        })}
      </div>
    `;
  }

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="bar">
            <ix-icon name="hierarchy" size="20"></ix-icon>
            <ix-typography format="h5">Graph — ${this.seed}</ix-typography>
            <span class="hint">click a node to centre / expand further</span>
            <span class="spacer"></span>
            ${this.status ? html`<span class="hint">${this.status}</span>` : ''}
            <ix-select
              class="dirsel"
              mode="single"
              .value=${this.direction}
              @valueChange=${(e: CustomEvent<string | string[]>) => this.onDirectionChange(e.detail)}
            >
              <ix-select-item value="in" label="Sub-structure (incoming)"></ix-select-item>
              <ix-select-item value="out" label="Parents (outgoing)"></ix-select-item>
              <ix-select-item value="both" label="Both directions"></ix-select-item>
            </ix-select>
            <ix-select
              class="relfilter"
              mode="multiple"
              i18nPlaceholder="all relations"
              .value=${this.relFilter}
              @valueChange=${(e: CustomEvent<string | string[]>) => this.onFilterChange(e.detail)}
            >
              ${this.relationTypes.map((r) => html`<ix-select-item value=${r.iri} label=${r.label || r.iri}></ix-select-item>`)}
            </ix-select>
            <ix-button outline icon="maximize" @click=${this.fit}>Fit</ix-button>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          ${this.renderLegend()}
          <div id="cy"></div>
        </div>
      </div>
    `;
  }
}

const TAG = 'wui-sdm-graph';
if (!customElements.get(TAG)) customElements.define(TAG, WuiSdmGraph);
