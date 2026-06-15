/**
 * Asset tree — integrated, LIVE management surface for the ISA-95 containment
 * hierarchy, derived from the `isa:partOf` edges.
 *
 * Scales to large systems via lazy loading: only the root level is fetched up
 * front (sdm.hierarchy.roots); a node's children are fetched on demand when it
 * is expanded (sdm.hierarchy.children — read from that node's in-edges, no graph
 * scan). The client never holds the whole tree, and only opened branches cost
 * anything.
 *
 *  - Add root / Add child → create an instance (class picker) and attach it.
 *  - Edit                  → change label + properties.
 *  - Move                  → re-parent (retract old edge, assert new one).
 *  - Delete                → delete the instance; its children detach.
 *
 * Clicking a node selects its instance in the class view on the right.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { SdmApi } from './sdm-api.js';
import './sdm-node-dialog.js';
import { MoveCandidate } from './sdm-node-dialog.js';
import { SdmClass, SdmSelectDetail, SdmViewNode } from './sdm-types.js';

const TAG = 'wui-sdm-asset-tree';
const PART_OF = 'isa:partOf';

type DialogState =
  | { mode: 'create'; parentDp: string; parentName: string }
  | { mode: 'edit'; node: SdmViewNode }
  | { mode: 'move'; node: SdmViewNode };

export class WuiSdmAssetTree extends LitElement {
  static override readonly styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0.5rem;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .hint {
      color: var(--theme-color-weak-text);
      font-size: 0.8rem;
    }
    .tree {
      display: flex;
      flex-direction: column;
      gap: 1px;
      overflow: auto;
      flex: 1;
    }
    .node {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.4rem;
      border: 1px solid transparent;
      border-radius: var(--theme-default-border-radius);
      cursor: pointer;
    }
    .node:hover {
      background: var(--theme-color-2);
    }
    .node:hover .row-actions {
      visibility: visible;
    }
    .node.selected {
      border-color: var(--theme-color-primary);
      background: color-mix(in srgb, var(--theme-color-primary) 12%, transparent);
    }
    .twist {
      width: 1rem;
      display: inline-flex;
      justify-content: center;
      color: var(--theme-color-weak-text);
    }
    .twist.leaf {
      visibility: hidden;
    }
    .label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cls {
      color: var(--theme-color-weak-text);
      font-size: 0.76rem;
    }
    .loading {
      color: var(--theme-color-weak-text);
      font-size: 0.78rem;
      padding: 0.2rem 0;
    }
    .row-actions {
      margin-left: auto;
      display: inline-flex;
      gap: 0.1rem;
      visibility: hidden;
    }
    .confirm {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
    }
    .confirm .spacer {
      margin-left: auto;
    }
  `;

  @property({ attribute: false }) classes: SdmClass[] = [];
  @property() selectedInstance = '';

  @state() private roots: SdmViewNode[] = [];
  @state() private expanded = new Set<string>();
  @state() private childrenMap = new Map<string, SdmViewNode[]>();
  @state() private loadingChildren = new Set<string>();
  @state() private message: { type: 'success' | 'alarm'; text: string } | null = null;
  @state() private loading = false;
  @state() private dialog: DialogState | null = null;
  @state() private pendingDelete: SdmViewNode | null = null;

  /** Flat node list, loaded only when a Move dialog opens (for the target picker). */
  private allForMove: SdmViewNode[] = [];

  private readonly api = new SdmApi();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadRoots();
  }

  private async loadRoots(): Promise<void> {
    this.loading = true;
    try {
      this.roots = await this.api.hierarchyRoots(PART_OF);
      this.message = null;
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    } finally {
      this.loading = false;
    }
  }

  /** Reload roots and re-fetch children for every currently-expanded node. */
  private async refresh(): Promise<void> {
    this.loading = true;
    try {
      const next = new Map<string, SdmViewNode[]>();
      this.roots = await this.api.hierarchyRoots(PART_OF);
      for (const dp of this.expanded) {
        try {
          next.set(dp, await this.api.hierarchyChildren(dp, PART_OF));
        } catch {
          /* node disappeared — drop its cached children */
        }
      }
      this.childrenMap = next;
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    } finally {
      this.loading = false;
    }
  }

  private async loadChildren(dp: string): Promise<void> {
    this.loadingChildren = new Set(this.loadingChildren).add(dp);
    try {
      const kids = await this.api.hierarchyChildren(dp, PART_OF);
      this.childrenMap = new Map(this.childrenMap).set(dp, kids);
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    } finally {
      const s = new Set(this.loadingChildren);
      s.delete(dp);
      this.loadingChildren = s;
    }
  }

  private async toggle(node: SdmViewNode): Promise<void> {
    const dp = node.dp;
    if (!dp) return;
    const next = new Set(this.expanded);
    if (next.has(dp)) {
      next.delete(dp);
      this.expanded = next;
      return;
    }
    next.add(dp);
    this.expanded = next;
    if (!this.childrenMap.has(dp)) await this.loadChildren(dp);
  }

  // ---- move-target helpers (full list loaded lazily on demand) ----
  private flatten(nodes: SdmViewNode[], out: SdmViewNode[] = []): SdmViewNode[] {
    for (const n of nodes) {
      out.push(n);
      this.flatten(n.children, out);
    }
    return out;
  }
  private subtreeDps(node: SdmViewNode, acc = new Set<string>()): Set<string> {
    if (node.dp) acc.add(node.dp);
    for (const c of node.children) this.subtreeDps(c, acc);
    return acc;
  }
  private moveCandidates(node: SdmViewNode): MoveCandidate[] {
    const blocked = this.subtreeDps(this.allForMove.find((n) => n.dp === node.dp) ?? node);
    if (node.dp) blocked.add(node.dp);
    return this.allForMove.filter((n) => n.dp && !blocked.has(n.dp)).map((n) => ({ dp: n.dp as string, name: n.name }));
  }

  // ---- interactions ----
  private select(node: SdmViewNode): void {
    if (!node.dp) return;
    const detail: SdmSelectDetail = { kind: 'instance', iri: node.dp, dp: node.dp, classIri: node.classIri };
    this.dispatchEvent(new CustomEvent('wui:select', { detail, bubbles: true, composed: true }));
  }

  private addRoot = (): void => {
    this.dialog = { mode: 'create', parentDp: '', parentName: '' };
  };
  private addChild(node: SdmViewNode): void {
    if (node.dp) this.dialog = { mode: 'create', parentDp: node.dp, parentName: node.name };
  }
  private edit(node: SdmViewNode): void {
    this.dialog = { mode: 'edit', node };
  }
  private move = async (node: SdmViewNode): Promise<void> => {
    try {
      this.allForMove = this.flatten(await this.api.getHierarchy(PART_OF));
    } catch {
      this.allForMove = [];
    }
    this.dialog = { mode: 'move', node };
  };
  private askDelete(node: SdmViewNode): void {
    this.pendingDelete = node;
  }

  private onSaved = async (): Promise<void> => {
    const d = this.dialog;
    // After adding a child, make sure the parent is expanded so the new node shows.
    if (d?.mode === 'create' && d.parentDp) this.expanded = new Set(this.expanded).add(d.parentDp);
    this.dialog = null;
    await this.refresh();
  };
  private closeDialog = (): void => {
    this.dialog = null;
  };

  private confirmDelete = async (): Promise<void> => {
    const node = this.pendingDelete;
    this.pendingDelete = null;
    if (!node?.dp) return;
    try {
      await this.api.deleteInstance(node.dp);
      this.message = { type: 'success', text: `Deleted ${node.name}` };
      await this.refresh();
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };

  private classLabel(iri?: string): string {
    if (!iri) return '';
    return this.classes.find((c) => c.iri === iri)?.label || iri;
  }

  // ---- render ----
  override render(): TemplateResult {
    return html`
      <div class="actions">
        <ix-button icon="add-circle" .disabled=${this.loading} @click=${this.addRoot}>Add root</ix-button>
        <ix-icon-button ghost icon="refresh" title="Reload" .disabled=${this.loading} @click=${() => void this.refresh()}></ix-icon-button>
        <span class="hint">ISA-95 containment · live, lazy-loaded</span>
      </div>
      ${this.message
        ? html`<ix-message-bar type=${this.message.type === 'success' ? 'success' : 'danger'}>${this.message.text}</ix-message-bar>`
        : ''}
      ${this.pendingDelete ? this.renderConfirm() : ''}
      ${this.roots.length
        ? html`<div class="tree">${this.roots.map((n) => this.renderNode(n, 0))}</div>`
        : html`<ix-empty-state header="No nodes yet" subHeader="Use “Add root” to start the hierarchy"></ix-empty-state>`}
      ${this.dialog ? this.renderDialog() : ''}
    `;
  }

  private renderConfirm(): TemplateResult {
    const n = this.pendingDelete as SdmViewNode;
    return html`
      <div class="confirm">
        <ix-icon name="trashcan" size="16"></ix-icon>
        <span>Delete <b>${n.name}</b>? Children (if any) are detached.</span>
        <span class="spacer"></span>
        <ix-button outline @click=${() => (this.pendingDelete = null)}>Cancel</ix-button>
        <ix-button variant="danger" @click=${this.confirmDelete}>Delete</ix-button>
      </div>
    `;
  }

  // eslint-disable-next-line max-lines-per-function -- node row + lazy children
  private renderNode(node: SdmViewNode, depth: number): TemplateResult {
    const dp = node.dp || node.path;
    const isExpanded = this.expanded.has(dp);
    const kids = this.childrenMap.get(dp);
    const isLoading = this.loadingChildren.has(dp);
    return html`
      <div
        class="node ${node.dp && node.dp === this.selectedInstance ? 'selected' : ''}"
        style="padding-left:${depth * 1.1 + 0.4}rem"
        @click=${() => this.select(node)}
      >
        <span
          class="twist ${node.hasChildren ? '' : 'leaf'}"
          @click=${(e: Event) => {
            e.stopPropagation();
            void this.toggle(node);
          }}
        >
          <ix-icon name=${isExpanded ? 'chevron-down' : 'chevron-right'} size="12"></ix-icon>
        </span>
        <ix-icon name=${node.hasChildren ? 'folder' : 'box-closed'} size="14"></ix-icon>
        <span class="label">${node.name}</span>
        <span class="cls">${this.classLabel(node.classIri)}</span>
        <span class="row-actions" @click=${(e: Event) => e.stopPropagation()}>
          <ix-icon-button ghost size="16" icon="add-circle" title="Add child" @click=${() => this.addChild(node)}></ix-icon-button>
          <ix-icon-button ghost size="16" icon="pen" title="Edit" @click=${() => this.edit(node)}></ix-icon-button>
          <ix-icon-button ghost size="16" icon="export" title="Move" @click=${() => void this.move(node)}></ix-icon-button>
          <ix-icon-button ghost size="16" icon="trashcan" title="Delete" @click=${() => this.askDelete(node)}></ix-icon-button>
        </span>
      </div>
      ${isExpanded && node.hasChildren
        ? kids
          ? kids.map((c) => this.renderNode(c, depth + 1))
          : isLoading
            ? html`<div class="loading" style="padding-left:${(depth + 1) * 1.1 + 0.4}rem">loading …</div>`
            : nothing
        : nothing}
    `;
  }

  private renderDialog(): TemplateResult {
    const d = this.dialog as DialogState;
    if (d.mode === 'create') {
      return html`<wui-sdm-node-dialog
        .mode=${'create'}
        .relIri=${PART_OF}
        .classes=${this.classes}
        .parentDp=${d.parentDp}
        .parentName=${d.parentName}
        @wui:saved=${this.onSaved}
        @wui:close=${this.closeDialog}
      ></wui-sdm-node-dialog>`;
    }
    const node = d.node;
    return html`<wui-sdm-node-dialog
      .mode=${d.mode}
      .relIri=${PART_OF}
      .classes=${this.classes}
      .dp=${node.dp || ''}
      .classIri=${node.classIri || ''}
      .nodeLabel=${node.name}
      .currentParentDp=${node.parentDp || ''}
      .candidates=${d.mode === 'move' ? this.moveCandidates(node) : []}
      @wui:saved=${this.onSaved}
      @wui:close=${this.closeDialog}
    ></wui-sdm-node-dialog>`;
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, WuiSdmAssetTree);
