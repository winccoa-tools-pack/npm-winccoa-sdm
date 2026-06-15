/**
 * Modal dialog to create a new instance or edit an existing one. Self-contained
 * overlay (position: fixed inside the shadow DOM). Does its own sdm.* calls and
 * emits `wui:saved` on success and `wui:close` to dismiss.
 */
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { SdmApi } from './sdm-api.js';
import { SdmInstance, SdmPropertyDef } from './sdm-types.js';

const NUMERIC = new Set(['int', 'uint', 'long', 'float']);

export class WuiSdmInstanceDialog extends LitElement {
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
    .ro {
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

  @property() mode: 'create' | 'edit' = 'create';
  @property() classIri = '';
  @property() classLabel = '';
  @property({ attribute: false }) props: SdmPropertyDef[] = [];
  @property({ attribute: false }) instance: SdmInstance | null = null;

  @state() private name = '';
  @state() private label = '';
  @state() private values: Record<string, string | boolean> = {};
  @state() private message = '';

  private readonly api = new SdmApi();

  override firstUpdated(): void {
    if (this.mode === 'edit' && this.instance) {
      this.name = this.instance.dp;
      this.label = this.instance.label || '';
      const v: Record<string, string | boolean> = {};
      for (const p of this.props) v[p.name] = this.toInput(p, this.instance.properties[p.name]);
      this.values = v;
    }
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

  override render(): TemplateResult {
    const title = this.mode === 'create' ? `New ${this.classLabel || this.classIri}` : `Edit ${this.instance?.label || this.name}`;
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="title">
            <ix-icon name=${this.mode === 'create' ? 'add-circle' : 'pen'} size="24"></ix-icon>
            <ix-typography format="h3">${title}</ix-typography>
          </div>
          ${this.message ? html`<ix-message-bar type="danger">${this.message}</ix-message-bar>` : ''}

          ${this.mode === 'create'
            ? html`<ix-input label="Name (dp)" .value=${this.name} @valueChange=${(e: CustomEvent<string>) => (this.name = e.detail)}></ix-input>`
            : html`<div class="ro">Data point: ${this.name}</div>`}
          <ix-input label="Label" .value=${this.label} @valueChange=${(e: CustomEvent<string>) => (this.label = e.detail)}></ix-input>

          ${this.props.map((p) => this.renderField(p))}

          <div class="actions">
            <ix-button outline @click=${this.close}>Cancel</ix-button>
            <ix-button icon=${this.mode === 'create' ? 'add-circle' : 'check'} @click=${this.save}>
              ${this.mode === 'create' ? 'Create' : 'Save'}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderField(p: SdmPropertyDef): TemplateResult {
    if (p.type === 'bool') {
      return html`<ix-checkbox label=${p.name} .checked=${!!this.values[p.name]} @checkedChange=${(e: CustomEvent<boolean>) => this.setVal(p.name, e.detail)}></ix-checkbox>`;
    }
    const label = `${p.name} (${p.type})${p.unit ? ` [${p.unit}]` : ''}`;
    return html`<ix-input label=${label} .value=${String(this.values[p.name] ?? '')} @valueChange=${(e: CustomEvent<string>) => this.setVal(p.name, e.detail)}></ix-input>`;
  }

  private buildProperties(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const p of this.props) {
      const raw = this.values[p.name];
      if (this.mode === 'edit') {
        out[p.name] = this.coerce(p, raw ?? '');
      } else if (raw !== undefined && raw !== '') {
        out[p.name] = this.coerce(p, raw);
      }
    }
    return out;
  }

  private save = async (): Promise<void> => {
    try {
      const properties = this.buildProperties();
      if (this.mode === 'create') {
        await this.api.createInstance({
          classIri: this.classIri,
          name: this.name.trim() || undefined,
          label: this.label.trim() || undefined,
          properties
        });
      } else {
        await this.api.updateInstance(this.name, this.label.trim(), properties);
      }
      this.dispatchEvent(new CustomEvent('wui:saved', { bubbles: true, composed: true }));
    } catch (e) {
      this.message = (e as Error).message;
    }
  };

  private close = (): void => {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  };
}

const TAG = 'wui-sdm-instance-dialog';
if (!customElements.get(TAG)) customElements.define(TAG, WuiSdmInstanceDialog);
