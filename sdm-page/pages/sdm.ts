/**
 * Semantic Data Model (SDM) page — standalone WebUI page.
 *
 * Event-driven & online-changeable (no manual reload): the page hotlinks the
 * ontology meta types via dpQueryConnect, so classes/relations created or
 * changed anywhere refresh automatically. An edit guard (driven by input focus)
 * defers refreshes while the user is creating/editing, then applies the pending
 * refresh once focus leaves — so the UI never reloads under your hands.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { Subscription, debounceTime } from 'rxjs';

import { SdmApi } from './sdm/sdm-api.js';
import './sdm/sdm-bulk-dialog.js';
import './sdm/sdm-class-view.js';
import './sdm/sdm-ontology-panel.js';
import { SdmClass, SdmHealth, SdmRelationType, SdmSelectDetail } from './sdm/sdm-types.js';

const TAG = 'wui-sdm-page';
const LEFT_WIDTH_DEFAULT = 352; // px (~22rem)
const LEFT_WIDTH_MIN = 220;
const RIGHT_WIDTH_MIN = 320;
const LEFT_WIDTH_STORAGE_KEY = 'wui-sdm.leftWidth';
const ONTOLOGY_QUERY =
  "SELECT '_original.._active' FROM '*.*' WHERE _DPT = \"_SemClass\" OR _DPT = \"_SemRelationType\" OR _DPT = \"_SemAspect\"";
const EVENT_DEBOUNCE_MS = 250;
const BLUR_DEBOUNCE_MS = 250;

export class WuiSdmPage extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 0.5rem;
      }
      .status {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
        padding: 0 0.25rem;
      }
      .status .live {
        margin-left: auto;
        color: var(--theme-color-weak-text);
        font-size: 0.8rem;
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .dot {
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 50%;
        background: var(--theme-color-success);
      }
      .dot.paused {
        background: var(--theme-color-warning);
      }
      .shell {
        display: grid;
        gap: 0.5rem;
        flex: 1;
        min-height: 0;
      }
      .shell.dragging {
        cursor: col-resize;
        user-select: none;
      }
      .pane {
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
        background: var(--theme-color-2);
        padding: 0.5rem;
        min-height: 0;
        overflow: hidden;
      }
      .splitter {
        width: 6px;
        align-self: stretch;
        border-radius: 3px;
        background: var(--theme-color-soft-bdr);
        cursor: col-resize;
        transition: background 0.15s;
      }
      .splitter:hover,
      .shell.dragging .splitter {
        background: var(--theme-color-primary);
      }
    `
  ];

  @state() private classes: SdmClass[] = [];
  @state() private relationTypes: SdmRelationType[] = [];
  @state() private health: SdmHealth | null = null;
  @state() private selectedClass = '';
  @state() private selectedInstance = '';
  @state() private error = '';
  @state() private busy = false;
  @state() private showBulk = false;
  @state() private leftWidth = LEFT_WIDTH_DEFAULT;
  @state() private dragging = false;

  private readonly api = new SdmApi();
  private sub = new Subscription();
  private blurTimer = 0;
  private pendingOntology = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.leftWidth = this.readStoredWidth();
    // Edit guard: any focused input inside the page (focusin/focusout are
    // composed and bubble across shadow roots) marks the page busy.
    this.addEventListener('focusin', this.onFocusIn);
    this.addEventListener('focusout', this.onFocusOut);
    // Initial paint, then live updates whenever a class / relation type DP is
    // created or deleted (scoped by WHERE _DPT), guarded by the edit state.
    void this.reloadOntology();
    this.sub.add(
      this.api
        .watch(ONTOLOGY_QUERY)
        .pipe(debounceTime(EVENT_DEBOUNCE_MS))
        .subscribe({
          next: () => this.onOntologyEvent(),
          error: (e: unknown) => (this.error = String(e))
        })
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('focusin', this.onFocusIn);
    this.removeEventListener('focusout', this.onFocusOut);
    this.sub.unsubscribe();
    this.sub = new Subscription();
  }

  private onFocusIn = (): void => {
    if (this.blurTimer) {
      clearTimeout(this.blurTimer);
      this.blurTimer = 0;
    }
    this.setBusy(true);
  };

  private onFocusOut = (): void => {
    this.blurTimer = window.setTimeout(() => this.setBusy(false), BLUR_DEBOUNCE_MS);
  };

  private setBusy(value: boolean): void {
    if (value === this.busy) return;
    this.busy = value;
    if (!value && this.pendingOntology) {
      this.pendingOntology = false;
      void this.reloadOntology();
    }
  }

  private onOntologyEvent(): void {
    if (this.busy) this.pendingOntology = true;
    else void this.reloadOntology();
  }

  // ---- resizable split between the left panel and the detail view ----
  private readStoredWidth(): number {
    try {
      const v = Number(localStorage.getItem(LEFT_WIDTH_STORAGE_KEY));
      if (Number.isFinite(v) && v >= LEFT_WIDTH_MIN) return v;
    } catch {
      /* localStorage unavailable */
    }
    return LEFT_WIDTH_DEFAULT;
  }

  private startDrag = (e: PointerEvent): void => {
    e.preventDefault();
    const shell = (e.currentTarget as HTMLElement).parentElement;
    if (!shell) return;
    this.dragging = true;
    const onMove = (ev: PointerEvent): void => {
      const rect = shell.getBoundingClientRect();
      const max = rect.width - RIGHT_WIDTH_MIN;
      this.leftWidth = Math.max(LEFT_WIDTH_MIN, Math.min(max, ev.clientX - rect.left));
    };
    const onUp = (): void => {
      this.dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try {
        localStorage.setItem(LEFT_WIDTH_STORAGE_KEY, String(Math.round(this.leftWidth)));
      } catch {
        /* localStorage unavailable */
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  private async reloadOntology(): Promise<void> {
    try {
      const [classes, relationTypes, health] = await Promise.all([
        this.api.listClasses(),
        this.api.listRelationTypes(),
        this.api.health()
      ]);
      this.classes = classes;
      this.relationTypes = relationTypes;
      this.health = health;
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private onSelect(e: CustomEvent<SdmSelectDetail>): void {
    const d = e.detail;
    if (d.kind === 'class') {
      this.selectedClass = d.iri;
      this.selectedInstance = '';
    } else if (d.kind === 'instance' && d.dp) {
      // From the asset tree: focus the instance's class, then the instance.
      if (d.classIri) this.selectedClass = d.classIri;
      this.selectedInstance = d.dp;
    }
  }

  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{
          headerTitle: {
            context: 'translate',
            config: { 'en_US.utf8': 'Semantic Data Model', 'de_AT.utf8': 'Semantisches Datenmodell' }
          }
        }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>

      <div class="status">
        ${this.health
          ? html`
              <ix-chip outline icon="ontology-filled">${this.health.classes} classes</ix-chip>
              <ix-chip outline icon="link">${this.health.relationTypes} relations</ix-chip>
              <ix-chip outline icon="layers">${this.health.aspects} aspects</ix-chip>
              <ix-chip variant=${this.health.active ? 'success' : 'warning'}>
                ${this.health.redundant ? (this.health.active ? 'redu · active' : 'redu · standby') : 'standalone'}
              </ix-chip>
            `
          : ''}
        ${this.error ? html`<ix-message-bar type="danger">${this.error}</ix-message-bar>` : ''}
        <ix-button style="margin-left:auto" outline icon="database" @click=${() => (this.showBulk = true)}>Mass engineering</ix-button>
        <span class="live" title=${this.busy ? 'Live updates paused while editing' : 'Live'}>
          <span class="dot ${this.busy ? 'paused' : ''}"></span>${this.busy ? 'editing' : 'live'}
        </span>
      </div>

      <div
        class="shell ${this.dragging ? 'dragging' : ''}"
        style="grid-template-columns:${this.leftWidth}px auto 1fr"
        @wui:select=${(e: CustomEvent<SdmSelectDetail>) => this.onSelect(e)}
        @wui:change=${() => this.onOntologyEvent()}
      >
        <div class="pane">
          <wui-sdm-ontology-panel
            .classes=${this.classes}
            .relationTypes=${this.relationTypes}
            .selectedClass=${this.selectedClass}
            .selectedInstance=${this.selectedInstance}
          ></wui-sdm-ontology-panel>
        </div>
        <div class="splitter" title="Drag to resize" @pointerdown=${this.startDrag}></div>
        <div class="pane">
          <wui-sdm-class-view
            .classIri=${this.selectedClass}
            .selectInstanceDp=${this.selectedInstance}
            .classes=${this.classes}
            .relationTypes=${this.relationTypes}
            .busy=${this.busy}
          ></wui-sdm-class-view>
        </div>
      </div>

      ${this.showBulk
        ? html`<wui-sdm-bulk-dialog
            .classes=${this.classes}
            @wui:close=${() => {
              this.showBulk = false;
              void this.reloadOntology();
            }}
          ></wui-sdm-bulk-dialog>`
        : ''}
    `;
  }
}

// Guard against double registration when the page module is evaluated more
// than once (re-navigation / reload).
if (!customElements.get(TAG)) customElements.define(TAG, WuiSdmPage);
