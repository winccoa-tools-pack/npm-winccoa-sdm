/**
 * Right panel of the SDM page: details of the selected class — effective
 * properties, its instances, and an inspector for the selected instance
 * (live values, neighbors, assert/retract relations, delete). Creating and
 * editing instances happens in a modal dialog (wui-sdm-instance-dialog),
 * opened via the "New instance" / "Edit" buttons.
 *
 * Event-driven: the instance list hotlinks the class' dpType and the inspector
 * hotlinks the selected instance's value/edge DPEs. The `busy` flag (from the
 * page's edit guard) defers these refreshes while the user is editing.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription, debounceTime } from 'rxjs';

import { SdmApi } from './sdm-api.js';
import './sdm-instance-dialog.js';
import './sdm-graph.js';
import { SdmClass, SdmInstance, SdmInstanceListItem, SdmNeighbor, SdmPropertyDef, SdmRelationType } from './sdm-types.js';

const EVENT_DEBOUNCE_MS = 250;
const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;

/** A node in the property/value tree built from dotted DPE paths. */
interface PropNode {
  seg: string;
  path: string;
  children: PropNode[];
}

export class WuiSdmClassView extends LitElement {
  static override readonly styles = css`
    :host { display: flex; flex-direction: column; height: 100%; gap: 0.75rem; overflow: auto; }
    .head { display: flex; align-items: baseline; gap: 0.5rem; }
    .head .iri { color: var(--theme-color-weak-text); font-size: 0.85rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--theme-color-soft-bdr); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    .panel {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.5rem; background: var(--theme-color-1);
      display: flex; flex-direction: column; gap: 0.5rem;
    }
    .panel-head { display: flex; align-items: center; gap: 0.5rem; }
    .panel-head .spacer { margin-left: auto; }
    .list { display: flex; flex-direction: column; gap: 2px; max-height: 20rem; overflow: auto; }
    .item {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr); border-radius: var(--theme-default-border-radius); cursor: pointer;
    }
    .item.selected { border-color: var(--theme-color-primary); background: color-mix(in srgb, var(--theme-color-primary) 12%, transparent); }
    .item .dp { margin-left: auto; color: var(--theme-color-weak-text); font-size: 0.78rem; }
    .row { display: flex; gap: 0.5rem; align-items: center; }
    .edge { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; padding: 0.2rem 0; }
    tr.struct > td { color: var(--theme-color-weak-text); font-weight: 600; }
    .pname { display: inline-flex; align-items: center; gap: 0.35rem; }
  `;

  @property() classIri = '';
  /** Externally requested instance to focus (e.g. from the asset tree). */
  @property() selectInstanceDp = '';
  @property({ attribute: false }) classes: SdmClass[] = [];
  @property({ attribute: false }) relationTypes: SdmRelationType[] = [];
  @property({ type: Boolean }) busy = false;

  @state() private props: SdmPropertyDef[] = [];
  @state() private instances: SdmInstanceListItem[] = [];
  @state() private instanceTotal = 0;
  @state() private search = '';
  @state() private offset = 0;
  @state() private selectedInstance: SdmInstance | null = null;
  @state() private neighbors: SdmNeighbor[] = [];
  @state() private message: { type: 'success' | 'alarm'; text: string } | null = null;
  @state() private dialogMode: 'create' | 'edit' | null = null;
  @state() private showGraph = false;

  // assert-relation form
  @state() private arRel = '';
  @state() private arTarget = '';

  private readonly api = new SdmApi();
  private instSub = new Subscription();
  private inspSub = new Subscription();
  private pendingInstances = false;
  private pendingInspector = false;
  private searchTimer = 0;
  /** A dp requested externally that is not in the list yet (class still loading). */
  private wantSelectDp = '';

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.instSub.unsubscribe();
    this.inspSub.unsubscribe();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('classIri')) void this.onClassChanged();
    if (changed.has('busy') && !this.busy) this.flushPending();
    if (changed.has('selectInstanceDp') && this.selectInstanceDp) this.applyExternalSelection();
  }

  /** Select an externally requested instance, or defer until its list loads. */
  private applyExternalSelection(): void {
    const dp = this.selectInstanceDp;
    if (this.instances.some((i) => i.dp === dp)) void this.selectInstance(dp);
    else this.wantSelectDp = dp;
  }

  private get currentClass(): SdmClass | undefined {
    return this.classes.find((c) => c.iri === this.classIri);
  }

  private flushPending(): void {
    if (this.pendingInstances) {
      this.pendingInstances = false;
      void this.reloadInstances();
    }
    if (this.pendingInspector) {
      this.pendingInspector = false;
      void this.refreshInspector();
    }
  }

  // ---- class selection -> properties + live instance list ----
  private async onClassChanged(): Promise<void> {
    this.selectedInstance = null;
    this.neighbors = [];
    this.dialogMode = null;
    this.search = '';
    this.offset = 0;
    this.inspSub.unsubscribe();
    this.inspSub = new Subscription();
    this.message = null;
    if (!this.classIri) {
      this.props = [];
      this.instances = [];
      this.instSub.unsubscribe();
      this.instSub = new Subscription();
      return;
    }
    try {
      this.props = await this.api.classProperties(this.classIri);
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
    this.setupInstanceWatch();
    await this.reloadInstances();
  }

  private setupInstanceWatch(): void {
    this.instSub.unsubscribe();
    this.instSub = new Subscription();
    const dpType = this.currentClass?.mappedDpType;
    if (!dpType) {
      this.instances = [];
      return;
    }
    const query = `SELECT '_original.._active' FROM '*.*' WHERE _DPT = "${dpType}"`;
    this.instSub.add(
      this.api
        .watch(query)
        .pipe(debounceTime(EVENT_DEBOUNCE_MS))
        .subscribe({ next: () => this.onInstancesEvent(), error: () => undefined })
    );
  }

  private onInstancesEvent(): void {
    if (this.busy) this.pendingInstances = true;
    else void this.reloadInstances();
  }

  private async reloadInstances(): Promise<void> {
    try {
      const list = await this.api.listInstances(this.classIri, PAGE_SIZE, this.offset, this.search);
      this.instances = list.items;
      this.instanceTotal = list.total;
      if (this.selectedInstance && !this.instances.some((i) => i.dp === this.selectedInstance?.dp)) {
        this.selectedInstance = null;
        this.neighbors = [];
        this.inspSub.unsubscribe();
        this.inspSub = new Subscription();
      }
      // A pending external selection (asset-tree click) that just became available.
      if (this.wantSelectDp && this.instances.some((i) => i.dp === this.wantSelectDp)) {
        const dp = this.wantSelectDp;
        this.wantSelectDp = '';
        void this.selectInstance(dp);
      }
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  }

  // ---- instance selection -> inspector + live value/edge hotlink ----
  private async selectInstance(dp: string): Promise<void> {
    try {
      const [inst, nb] = await Promise.all([this.api.getInstance(dp), this.api.neighbors(dp, 'both')]);
      this.selectedInstance = inst;
      this.neighbors = nb;
      this.setupInspectorWatch(dp);
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  }

  private setupInspectorWatch(dp: string): void {
    this.inspSub.unsubscribe();
    this.inspSub = new Subscription();
    const dpes = this.props.map((p) => `${dp}.${p.name}`);
    dpes.push(`${dp}.sem.edgesOut`, `${dp}.sem.edgesIn`);
    this.inspSub.add(
      this.api.connect(dpes).pipe(debounceTime(EVENT_DEBOUNCE_MS)).subscribe({ next: () => this.onInspectorEvent(), error: () => undefined })
    );
  }

  private onInspectorEvent(): void {
    if (this.busy) this.pendingInspector = true;
    else void this.refreshInspector();
  }

  private async refreshInspector(): Promise<void> {
    const dp = this.selectedInstance?.dp;
    if (!dp) return;
    try {
      const [inst, nb] = await Promise.all([this.api.getInstance(dp), this.api.neighbors(dp, 'both')]);
      this.selectedInstance = inst;
      this.neighbors = inst ? nb : [];
    } catch {
      /* transient */
    }
  }

  // ---- dialog (create / edit) ----
  private openCreate = (): void => {
    this.dialogMode = 'create';
  };
  private openEdit = (): void => {
    if (this.selectedInstance) this.dialogMode = 'edit';
  };
  private closeDialog = (): void => {
    this.dialogMode = null;
  };
  private openGraph = (): void => {
    if (this.selectedInstance) this.showGraph = true;
  };
  private closeGraph = (): void => {
    this.showGraph = false;
  };
  private onSaved = async (): Promise<void> => {
    const wasEdit = this.dialogMode === 'edit';
    this.dialogMode = null;
    await this.reloadInstances();
    if (wasEdit) await this.refreshInspector();
  };

  // ---- render ----
  override render(): TemplateResult {
    const cls = this.currentClass;
    if (!cls) return html`<ix-empty-state header="Select a class" subHeader="Pick a class on the left"></ix-empty-state>`;
    return html`
      <div class="head">
        <ix-typography format="h2">${cls.label || cls.iri}</ix-typography>
        <span class="iri">${cls.iri}${cls.mappedDpType ? ` · dpType ${cls.mappedDpType}` : ' · abstract'}</span>
      </div>
      ${this.message
        ? html`<ix-message-bar type=${this.message.type === 'success' ? 'success' : 'danger'}>${this.message.text}</ix-message-bar>`
        : ''}
      ${this.renderProperties()}
      <div class="grid">${this.renderInstances(cls)} ${this.renderInspector()}</div>
      ${this.dialogMode ? this.renderDialog() : ''}
      ${this.showGraph && this.selectedInstance
        ? html`<wui-sdm-graph
            .seed=${this.selectedInstance.dp}
            .classes=${this.classes}
            .relationTypes=${this.relationTypes}
            @wui:close=${this.closeGraph}
          ></wui-sdm-graph>`
        : ''}
    `;
  }

  // ---- property tree (dotted paths -> nested structs) ----
  /** Build a tree from dotted property paths (e.g. `state.value` -> state ▸ value). */
  private buildPropTree(paths: string[]): PropNode[] {
    const roots: PropNode[] = [];
    const index = new Map<string, PropNode>();
    for (const path of paths) {
      let prefix = '';
      let siblings = roots;
      for (const seg of path.split('.')) {
        prefix = prefix ? `${prefix}.${seg}` : seg;
        let node = index.get(prefix);
        if (!node) {
          node = { seg, path: prefix, children: [] };
          index.set(prefix, node);
          siblings.push(node);
        }
        siblings = node.children;
      }
    }
    return roots;
  }

  private renderProperties(): TemplateResult {
    const tree = this.buildPropTree(this.props.map((p) => p.name));
    const defByPath = new Map(this.props.map((p) => [p.name, p]));
    const rows = (nodes: PropNode[], depth: number): TemplateResult[] =>
      nodes.flatMap((n) => {
        const pad = `padding-left:${depth * 1.1 + 0.5}rem`;
        if (n.children.length) {
          return [
            html`<tr class="struct"><td style=${pad}><span class="pname"><ix-icon name="chevron-down" size="12"></ix-icon>${n.seg}</span></td><td></td><td></td></tr>`,
            ...rows(n.children, depth + 1)
          ];
        }
        const def = defByPath.get(n.path);
        return [html`<tr><td style=${pad}>${n.seg}</td><td>${def?.type ?? ''}</td><td>${def?.unit || ''}</td></tr>`];
      });
    return html`
      <div class="panel">
        <ix-typography format="h4">Properties (effective)</ix-typography>
        ${this.props.length
          ? html`<table>
              <tr><th>Name</th><th>Type</th><th>Unit</th></tr>
              ${rows(tree, 0)}
            </table>`
          : html`<span>No data properties</span>`}
      </div>
    `;
  }

  /** Render an instance's values as the same struct tree, values on the leaves. */
  private renderValueTree(values: { [k: string]: unknown }): TemplateResult {
    const tree = this.buildPropTree(Object.keys(values));
    const rows = (nodes: PropNode[], depth: number): TemplateResult[] =>
      nodes.flatMap((n) => {
        const pad = `padding-left:${depth * 1.1 + 0.5}rem`;
        if (n.children.length) {
          return [
            html`<tr class="struct"><td style=${pad}><span class="pname"><ix-icon name="chevron-down" size="12"></ix-icon>${n.seg}</span></td><td></td></tr>`,
            ...rows(n.children, depth + 1)
          ];
        }
        return [html`<tr><td style=${pad}>${n.seg}</td><td>${this.fmt(values[n.path])}</td></tr>`];
      });
    return html`<table>${rows(tree, 0)}</table>`;
  }

  // ---- server-side search + paging (scales to large classes) ----
  private onSearchInput(value: string): void {
    this.search = value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => {
      this.offset = 0;
      void this.reloadInstances();
    }, SEARCH_DEBOUNCE_MS);
  }
  private pagePrev = (): void => {
    if (this.offset === 0) return;
    this.offset = Math.max(0, this.offset - PAGE_SIZE);
    void this.reloadInstances();
  };
  private pageNext = (): void => {
    if (this.offset + PAGE_SIZE >= this.instanceTotal) return;
    this.offset += PAGE_SIZE;
    void this.reloadInstances();
  };

  private renderInstances(cls: SdmClass): TemplateResult {
    const from = this.instanceTotal === 0 ? 0 : this.offset + 1;
    const to = this.offset + this.instances.length;
    const paged = this.instanceTotal > PAGE_SIZE;
    return html`
      <div class="panel">
        <div class="panel-head">
          <ix-typography format="h4">Instances (${this.instanceTotal})</ix-typography>
          ${cls.isAbstract
            ? nothing
            : html`<ix-button class="spacer" icon="add-circle" @click=${this.openCreate}>New instance</ix-button>`}
        </div>
        ${cls.isAbstract
          ? nothing
          : html`<ix-input
              placeholder="search by name…"
              .value=${this.search}
              @valueChange=${(e: CustomEvent<string>) => this.onSearchInput(e.detail)}
            ></ix-input>`}
        <div class="list">
          ${this.instances.map(
            (i) => html`
              <div class="item ${this.selectedInstance?.dp === i.dp ? 'selected' : ''}" @click=${() => this.selectInstance(i.dp)}>
                <ix-icon name="box-closed" size="14"></ix-icon>
                <span>${i.label || i.dp}</span>
                <span class="dp">${i.dp}</span>
              </div>
            `
          )}
          ${this.instances.length ? nothing : html`<span>${this.search ? 'No matches' : 'None yet'}</span>`}
        </div>
        ${paged
          ? html`<div class="row">
              <span class="iri">${from}–${to} of ${this.instanceTotal}</span>
              <span class="spacer" style="margin-left:auto"></span>
              <ix-icon-button ghost size="16" icon="chevron-left" .disabled=${this.offset === 0} @click=${this.pagePrev}></ix-icon-button>
              <ix-icon-button ghost size="16" icon="chevron-right" .disabled=${this.offset + PAGE_SIZE >= this.instanceTotal} @click=${this.pageNext}></ix-icon-button>
            </div>`
          : nothing}
        ${cls.isAbstract ? html`<ix-message-bar type="info" .dismissible=${false}>Abstract class — no direct instances</ix-message-bar>` : nothing}
      </div>
    `;
  }

  // eslint-disable-next-line max-lines-per-function -- inspector with neighbors + relation form
  private renderInspector(): TemplateResult {
    const inst = this.selectedInstance;
    if (!inst) return html`<div class="panel"><ix-empty-state header="No instance selected"></ix-empty-state></div>`;
    return html`
      <div class="panel">
        <div class="row">
          <ix-typography format="h4">${inst.label || inst.dp}</ix-typography>
          <span class="spacer" style="margin-left:auto"></span>
          <ix-icon-button ghost icon="hierarchy" title="Show graph" @click=${this.openGraph}></ix-icon-button>
          <ix-icon-button ghost icon="pen" title="Edit instance" @click=${this.openEdit}></ix-icon-button>
          <ix-icon-button ghost icon="trashcan" title="Delete instance" @click=${() => this.deleteInstance(inst.dp)}></ix-icon-button>
        </div>
        <span class="iri">${inst.iri}</span>
        ${this.renderValueTree(inst.properties)}

        <ix-typography format="h5">Relations</ix-typography>
        ${this.neighbors.length
          ? this.neighbors.map(
              (n) => html`<div class="edge">
                <ix-icon name=${n.direction === 'out' ? 'arrow-right' : 'arrow-left'} size="14"></ix-icon>
                <ix-chip outline>${this.relLabel(n.rel)}</ix-chip>
                <span>${n.dp}</span>
                <ix-icon-button style="margin-left:auto" ghost size="16" icon="trashcan" @click=${() => this.retract(n)}></ix-icon-button>
              </div>`
            )
          : html`<span>No relations</span>`}

        <ix-typography format="h5">Add relation</ix-typography>
        <ix-select label="Relation type" .value=${this.arRel} @valueChange=${(e: CustomEvent<string | string[]>) => (this.arRel = String(e.detail ?? ''))}>
          ${this.relationTypes.map((r) => html`<ix-select-item value=${r.iri} label=${r.label || r.iri}></ix-select-item>`)}
        </ix-select>
        <ix-input label="Target (dp name)" .value=${this.arTarget} @valueChange=${(e: CustomEvent<string>) => (this.arTarget = e.detail)}></ix-input>
        <ix-button icon="link" @click=${() => this.assert(inst.dp)}>Assert</ix-button>
      </div>
    `;
  }

  private renderDialog(): TemplateResult {
    return html`
      <wui-sdm-instance-dialog
        .mode=${this.dialogMode}
        .classIri=${this.classIri}
        .classLabel=${this.currentClass?.label || this.classIri}
        .props=${this.props}
        .instance=${this.selectedInstance}
        @wui:saved=${this.onSaved}
        @wui:close=${this.closeDialog}
      ></wui-sdm-instance-dialog>
    `;
  }

  // ---- actions ----
  private deleteInstance = async (dp: string): Promise<void> => {
    try {
      await this.api.deleteInstance(dp);
      this.selectedInstance = null;
      this.neighbors = [];
      this.inspSub.unsubscribe();
      this.inspSub = new Subscription();
      await this.reloadInstances();
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };

  private assert = async (source: string): Promise<void> => {
    if (!this.arRel || !this.arTarget) return;
    try {
      await this.api.assertRelation(this.arRel, source, this.arTarget.trim());
      this.arTarget = '';
      await this.selectInstance(source);
      this.message = { type: 'success', text: 'Relation asserted' };
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };

  private retract = async (n: SdmNeighbor): Promise<void> => {
    const inst = this.selectedInstance;
    if (!inst) return;
    const source = n.direction === 'out' ? inst.dp : n.dp;
    const target = n.direction === 'out' ? n.dp : inst.dp;
    try {
      await this.api.retractRelation(n.rel, source, target);
      await this.selectInstance(inst.dp);
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };

  private relLabel(iri: string): string {
    return this.relationTypes.find((r) => r.iri === iri)?.label || iri;
  }

  private fmt(v: unknown): string {
    if (Array.isArray(v)) return v.join(', ');
    if (v === null || v === undefined) return '';
    return String(v);
  }
}

const TAG = 'wui-sdm-class-view';
if (!customElements.get(TAG)) customElements.define(TAG, WuiSdmClassView);
