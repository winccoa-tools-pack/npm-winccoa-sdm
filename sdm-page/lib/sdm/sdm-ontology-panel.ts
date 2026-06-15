/**
 * Left panel of the SDM page: browse the ontology (classes / relation types)
 * and create new ones. Selecting a class emits `wui:select`; any successful
 * mutation emits `wui:change` so the page reloads the ontology.
 */
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { SdmApi } from './sdm-api.js';
import './sdm-asset-tree.js';
import { SDM_DATATYPES, SdmClass, SdmRelationType, SdmSelectDetail } from './sdm-types.js';

interface PropRow {
  name: string;
  type: string;
}

const TAG = 'wui-sdm-ontology-panel';

export class WuiSdmOntologyPanel extends LitElement {
  static override readonly styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0.5rem;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: auto;
      flex: 1;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      cursor: pointer;
      background: var(--theme-color-1);
    }
    .row:hover {
      background: var(--theme-color-2);
    }
    .row.selected {
      border-color: var(--theme-color-primary);
      background: color-mix(in srgb, var(--theme-color-primary) 12%, transparent);
    }
    .row .meta {
      margin-left: auto;
      color: var(--theme-color-weak-text);
      font-size: 0.8rem;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.5rem;
      background: var(--theme-color-2);
    }
    .prop-row {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 0.4rem;
      align-items: center;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
    }
  `;

  @property({ attribute: false }) classes: SdmClass[] = [];
  @property({ attribute: false }) relationTypes: SdmRelationType[] = [];
  @property() selectedClass = '';
  @property() selectedInstance = '';

  @state() private tab: 'classes' | 'relations' | 'assets' = 'classes';
  @state() private showForm = false;
  @state() private message: { type: 'success' | 'alarm'; text: string } | null = null;

  // class form state
  @state() private cIri = '';
  @state() private cLabel = '';
  @state() private cSuper = '';
  @state() private cAbstract = false;
  @state() private cProps: PropRow[] = [];

  // relation form state
  @state() private rIri = '';
  @state() private rDomain = '';
  @state() private rRange = '';
  @state() private rCardinality = '0..*';

  private readonly api = new SdmApi();

  private get tabIndex(): number {
    return this.tab === 'classes' ? 0 : this.tab === 'relations' ? 1 : 2;
  }

  override render(): TemplateResult {
    return html`
      <ix-tabs .selected=${this.tabIndex}>
        <ix-tab-item @click=${() => (this.tab = 'classes')}>Classes</ix-tab-item>
        <ix-tab-item @click=${() => (this.tab = 'relations')}>Relations</ix-tab-item>
        <ix-tab-item @click=${() => (this.tab = 'assets')}>Assets</ix-tab-item>
      </ix-tabs>

      ${this.tab === 'assets' ? this.renderAssets() : this.renderOntologyTab()}
    `;
  }

  private renderAssets(): TemplateResult {
    return html`
      <wui-sdm-asset-tree .classes=${this.classes} .selectedInstance=${this.selectedInstance}></wui-sdm-asset-tree>
    `;
  }

  private renderOntologyTab(): TemplateResult {
    return html`
      <div class="actions">
        <ix-button @click=${() => (this.showForm = !this.showForm)} icon="add-circle">
          ${this.tab === 'classes' ? 'New class' : 'New relation'}
        </ix-button>
      </div>

      ${this.message
        ? html`<ix-message-bar type=${this.message.type === 'success' ? 'success' : 'danger'}
            >${this.message.text}</ix-message-bar
          >`
        : ''}
      ${this.showForm ? (this.tab === 'classes' ? this.renderClassForm() : this.renderRelationForm()) : ''}
      ${this.tab === 'classes' ? this.renderClassList() : this.renderRelationList()}
    `;
  }

  private renderClassList(): TemplateResult {
    if (!this.classes.length) return html`<ix-empty-state header="No classes" subHeader="Create one above"></ix-empty-state>`;
    return html`
      <div class="list">
        ${this.classes.map(
          (c) => html`
            <div
              class="row ${c.iri === this.selectedClass ? 'selected' : ''}"
              @click=${() => this.selectClass(c.iri)}
            >
              <ix-icon name=${c.isAbstract ? 'hierarchy' : 'box-closed'} size="16"></ix-icon>
              <span>${c.label || c.iri}</span>
              <span class="meta">${c.iri}</span>
            </div>
          `
        )}
      </div>
    `;
  }

  private renderRelationList(): TemplateResult {
    if (!this.relationTypes.length) return html`<ix-empty-state header="No relation types"></ix-empty-state>`;
    return html`
      <div class="list">
        ${this.relationTypes.map(
          (r) => html`
            <div class="row">
              <ix-icon name="link" size="16"></ix-icon>
              <span>${r.label || r.iri}</span>
              <span class="meta">${r.cardinality}${r.symmetric ? ' · sym' : ''}</span>
            </div>
          `
        )}
      </div>
    `;
  }

  // eslint-disable-next-line max-lines-per-function -- form template
  private renderClassForm(): TemplateResult {
    return html`
      <div class="form">
        <ix-input label="IRI" placeholder="ex:Pump" .value=${this.cIri} @valueChange=${(e: CustomEvent<string>) => (this.cIri = e.detail)}></ix-input>
        <ix-input label="Label" .value=${this.cLabel} @valueChange=${(e: CustomEvent<string>) => (this.cLabel = e.detail)}></ix-input>
        <ix-select label="Super class (optional)" .value=${this.cSuper} @valueChange=${(e: CustomEvent<string | string[]>) => (this.cSuper = String(e.detail ?? ''))}>
          <ix-select-item value="" label="—"></ix-select-item>
          ${this.classes.map((c) => html`<ix-select-item value=${c.iri} label=${c.label || c.iri}></ix-select-item>`)}
        </ix-select>
        <ix-checkbox label="Abstract" .checked=${this.cAbstract} @checkedChange=${(e: CustomEvent<boolean>) => (this.cAbstract = e.detail)}></ix-checkbox>

        <div>Properties</div>
        ${this.cProps.map(
          (p, i) => html`
            <div class="prop-row">
              <ix-input placeholder="name" .value=${p.name} @valueChange=${(e: CustomEvent<string>) => this.updateProp(i, 'name', e.detail)}></ix-input>
              <ix-select .value=${p.type} @valueChange=${(e: CustomEvent<string | string[]>) => this.updateProp(i, 'type', String(e.detail))}>
                ${SDM_DATATYPES.map((t) => html`<ix-select-item value=${t} label=${t}></ix-select-item>`)}
              </ix-select>
              <ix-icon-button ghost icon="trashcan" @click=${() => this.removeProp(i)}></ix-icon-button>
            </div>
          `
        )}
        <ix-button outline icon="add-circle" @click=${this.addProp}>Add property</ix-button>

        <div class="actions">
          <ix-button @click=${this.submitClass}>Create</ix-button>
          <ix-button outline @click=${() => (this.showForm = false)}>Cancel</ix-button>
        </div>
      </div>
    `;
  }

  private renderRelationForm(): TemplateResult {
    return html`
      <div class="form">
        <ix-input label="IRI" placeholder="ex:feeds" .value=${this.rIri} @valueChange=${(e: CustomEvent<string>) => (this.rIri = e.detail)}></ix-input>
        <ix-select label="Domain (source class)" .value=${this.rDomain} @valueChange=${(e: CustomEvent<string | string[]>) => (this.rDomain = String(e.detail ?? ''))}>
          <ix-select-item value="" label="—"></ix-select-item>
          ${this.classes.map((c) => html`<ix-select-item value=${c.iri} label=${c.label || c.iri}></ix-select-item>`)}
        </ix-select>
        <ix-select label="Range (target class)" .value=${this.rRange} @valueChange=${(e: CustomEvent<string | string[]>) => (this.rRange = String(e.detail ?? ''))}>
          <ix-select-item value="" label="—"></ix-select-item>
          ${this.classes.map((c) => html`<ix-select-item value=${c.iri} label=${c.label || c.iri}></ix-select-item>`)}
        </ix-select>
        <ix-input label="Cardinality" .value=${this.rCardinality} @valueChange=${(e: CustomEvent<string>) => (this.rCardinality = e.detail)}></ix-input>
        <div class="actions">
          <ix-button @click=${this.submitRelation}>Create</ix-button>
          <ix-button outline @click=${() => (this.showForm = false)}>Cancel</ix-button>
        </div>
      </div>
    `;
  }

  private addProp = (): void => {
    this.cProps = [...this.cProps, { name: '', type: 'string' }];
  };
  private removeProp(i: number): void {
    this.cProps = this.cProps.filter((_, idx) => idx !== i);
  }
  private updateProp(i: number, key: keyof PropRow, value: string): void {
    this.cProps = this.cProps.map((p, idx) => (idx === i ? { ...p, [key]: value } : p));
  }

  private selectClass(iri: string): void {
    const detail: SdmSelectDetail = { kind: 'class', iri };
    this.dispatchEvent(new CustomEvent('wui:select', { detail, bubbles: true, composed: true }));
  }

  private emitChange = (): void => {
    this.dispatchEvent(new CustomEvent('wui:change', { bubbles: true, composed: true }));
  };

  private submitClass = async (): Promise<void> => {
    try {
      await this.api.createClass({
        iri: this.cIri.trim(),
        label: this.cLabel.trim() || undefined,
        superClasses: this.cSuper ? [this.cSuper] : [],
        isAbstract: this.cAbstract,
        properties: this.cProps.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), type: p.type }))
      });
      this.message = { type: 'success', text: `Class ${this.cIri} created` };
      this.cIri = this.cLabel = this.cSuper = '';
      this.cAbstract = false;
      this.cProps = [];
      this.showForm = false;
      this.emitChange();
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };

  private submitRelation = async (): Promise<void> => {
    try {
      await this.api.createRelationType({
        iri: this.rIri.trim(),
        domain: this.rDomain ? [this.rDomain] : [],
        range: this.rRange ? [this.rRange] : [],
        cardinality: this.rCardinality.trim() || '0..*'
      });
      this.message = { type: 'success', text: `Relation ${this.rIri} created` };
      this.rIri = this.rDomain = this.rRange = '';
      this.rCardinality = '0..*';
      this.showForm = false;
      this.emitChange();
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };
}

// Guard against double registration when the page module is evaluated more
// than once (re-navigation / reload).
if (!customElements.get(TAG)) customElements.define(TAG, WuiSdmOntologyPanel);
