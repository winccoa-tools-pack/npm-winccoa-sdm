/**
 * Modal dialog for managing an asset-tree node — create, edit or move — driven
 * purely by instances + part-of edges (no CNS rebuild). Self-contained overlay;
 * does its own sdm.* calls and emits `wui:saved` on success / `wui:close`.
 *
 *  - create: pick a (concrete) class, name + label + properties; on save creates
 *    the instance and, if a parent is given, asserts `relIri` child→parent.
 *  - edit:   change label + properties of the existing instance.
 *  - move:   re-parent — retract the old part-of edge, assert the new one.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { SdmApi } from './sdm-api.js';
import { SdmClass, SdmPropertyDef } from './sdm-types.js';

const NUMERIC = new Set(['int', 'uint', 'long', 'float']);

export interface MoveCandidate {
  dp: string;
  name: string;
}

export class WuiSdmNodeDialog extends LitElement {
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
      width: 32rem;
      max-width: 92vw;
      max-height: 88vh;
      overflow: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      padding: 1rem;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .ctx {
      color: var(--theme-color-weak-text);
      font-size: 0.85rem;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
      margin-top: 0.5rem;
    }
  `;

  @property() mode: 'create' | 'edit' | 'move' = 'create';
  @property() relIri = 'isa:partOf';
  @property({ attribute: false }) classes: SdmClass[] = [];

  // create context
  @property() parentDp = ''; // empty = create as root
  @property() parentName = '';

  // edit / move context
  @property() dp = '';
  @property() classIri = '';
  @property() nodeLabel = '';
  @property() currentParentDp = '';
  @property({ attribute: false }) candidates: MoveCandidate[] = [];

  @state() private cClass = '';
  @state() private name = '';
  @state() private label = '';
  @state() private props: SdmPropertyDef[] = [];
  @state() private values: Record<string, string | boolean> = {};
  @state() private moveTarget = '';
  @state() private message = '';
  @state() private busy = false;

  private readonly api = new SdmApi();

  override async firstUpdated(): Promise<void> {
    if (this.mode === 'edit') {
      this.cClass = this.classIri;
      this.label = this.nodeLabel;
      this.name = this.dp;
      await this.loadProps(this.classIri, this.dp);
    } else if (this.mode === 'move') {
      this.moveTarget = this.currentParentDp;
    }
  }

  private async loadProps(classIri: string, dp?: string): Promise<void> {
    try {
      this.props = await this.api.classProperties(classIri);
      const v: Record<string, string | boolean> = {};
      const inst = dp ? await this.api.getInstance(dp) : null;
      for (const p of this.props) v[p.name] = this.toInput(p, inst?.properties[p.name]);
      this.values = v;
    } catch (e) {
      this.message = (e as Error).message;
    }
  }

  private onClassPick(iri: string): void {
    this.cClass = iri;
    void this.loadProps(iri);
  }

  private toInput(p: SdmPropertyDef, raw: unknown): string | boolean {
    if (p.type === 'bool') return !!raw;
    if (Array.isArray(raw)) return raw.join(', ');
    return raw === null || raw === undefined ? '' : String(raw);
  }
  private coerce(p: SdmPropertyDef, raw: string | boolean): unknown {
    if (p.type === 'bool') return !!raw;
    const s = String(raw);
    if (NUMERIC.has(p.type)) return s === '' ? 0 : Number(s);
    if (p.type.startsWith('dyn_')) return s === '' ? [] : s.split(',').map((x) => x.trim());
    return s;
  }
  private setVal(name: string, value: string | boolean): void {
    this.values = { ...this.values, [name]: value };
  }
  private buildProperties(includeEmpty: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const p of this.props) {
      const raw = this.values[p.name];
      if (includeEmpty) out[p.name] = this.coerce(p, raw ?? '');
      else if (raw !== undefined && raw !== '') out[p.name] = this.coerce(p, raw);
    }
    return out;
  }

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="title">
            <ix-icon name=${this.icon} size="24"></ix-icon>
            <ix-typography format="h3">${this.heading}</ix-typography>
          </div>
          ${this.message ? html`<ix-message-bar type="danger">${this.message}</ix-message-bar>` : ''}
          ${this.mode === 'move' ? this.renderMove() : this.renderForm()}
          <div class="actions">
            <ix-button outline @click=${this.close}>Cancel</ix-button>
            <ix-button .disabled=${this.busy} icon=${this.mode === 'create' ? 'add-circle' : 'check'} @click=${this.save}>
              ${this.mode === 'create' ? 'Create' : 'Save'}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private get icon(): string {
    return this.mode === 'create' ? 'add-circle' : this.mode === 'move' ? 'export' : 'pen';
  }
  private get heading(): string {
    if (this.mode === 'create') return this.parentDp ? `New node under ${this.parentName}` : 'New root node';
    if (this.mode === 'move') return `Move ${this.nodeLabel || this.dp}`;
    return `Edit ${this.nodeLabel || this.dp}`;
  }

  private renderForm(): TemplateResult {
    const concrete = this.classes.filter((c) => !c.isAbstract);
    return html`
      ${this.mode === 'create'
        ? html`
            <ix-select label="Class" .value=${this.cClass} @valueChange=${(e: CustomEvent<string | string[]>) => this.onClassPick(String(e.detail ?? ''))}>
              ${concrete.map((c) => html`<ix-select-item value=${c.iri} label=${c.label || c.iri}></ix-select-item>`)}
            </ix-select>
            <ix-input label="Name (dp)" .value=${this.name} @valueChange=${(e: CustomEvent<string>) => (this.name = e.detail)}></ix-input>
          `
        : html`<div class="ctx">${this.classLabel(this.classIri)} · ${this.dp}</div>`}
      <ix-input label="Label" .value=${this.label} @valueChange=${(e: CustomEvent<string>) => (this.label = e.detail)}></ix-input>
      ${this.cClass ? this.props.map((p) => this.renderField(p)) : nothing}
    `;
  }

  private renderMove(): TemplateResult {
    return html`
      <div class="ctx">Choose the new parent (or none to make it a root).</div>
      <ix-select label="New parent" .value=${this.moveTarget} @valueChange=${(e: CustomEvent<string | string[]>) => (this.moveTarget = String(e.detail ?? ''))}>
        <ix-select-item value="" label="— (root)"></ix-select-item>
        ${this.candidates.map((c) => html`<ix-select-item value=${c.dp} label=${c.name}></ix-select-item>`)}
      </ix-select>
    `;
  }

  private renderField(p: SdmPropertyDef): TemplateResult {
    if (p.type === 'bool') {
      return html`<ix-checkbox label=${p.name} .checked=${!!this.values[p.name]} @checkedChange=${(e: CustomEvent<boolean>) => this.setVal(p.name, e.detail)}></ix-checkbox>`;
    }
    const label = `${p.name} (${p.type})${p.unit ? ` [${p.unit}]` : ''}`;
    return html`<ix-input label=${label} .value=${String(this.values[p.name] ?? '')} @valueChange=${(e: CustomEvent<string>) => this.setVal(p.name, e.detail)}></ix-input>`;
  }

  private classLabel(iri: string): string {
    return this.classes.find((c) => c.iri === iri)?.label || iri;
  }

  private save = async (): Promise<void> => {
    this.busy = true;
    try {
      if (this.mode === 'create') await this.doCreate();
      else if (this.mode === 'edit') await this.api.updateInstance(this.dp, this.label.trim(), this.buildProperties(true));
      else await this.doMove();
      this.dispatchEvent(new CustomEvent('wui:saved', { bubbles: true, composed: true }));
    } catch (e) {
      this.message = (e as Error).message;
      this.busy = false;
    }
  };

  private async doCreate(): Promise<void> {
    if (!this.cClass) {
      this.message = 'Pick a class';
      this.busy = false;
      throw new Error('no class');
    }
    const created = await this.api.createInstance({
      classIri: this.cClass,
      name: this.name.trim() || undefined,
      label: this.label.trim() || undefined,
      properties: this.buildProperties(false)
    });
    if (this.parentDp) await this.api.assertRelation(this.relIri, created.dp, this.parentDp);
  }

  private async doMove(): Promise<void> {
    if (this.moveTarget === this.currentParentDp) return; // no change
    if (this.currentParentDp) await this.api.retractRelation(this.relIri, this.dp, this.currentParentDp);
    if (this.moveTarget) await this.api.assertRelation(this.relIri, this.dp, this.moveTarget);
  }

  private close = (): void => {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  };
}

const TAG = 'wui-sdm-node-dialog';
if (!customElements.get(TAG)) customElements.define(TAG, WuiSdmNodeDialog);
