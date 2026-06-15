/**
 * Mass-engineering surface for large systems — a modal with two tools:
 *
 *  • Templates / Typicals — author a reusable parametrized sub-network (ISA-88
 *    equipment module) as JSON, then stamp it out for many bindings at once.
 *    Always dry-run first (shows what would be created / conflicts / errors),
 *    then apply.
 *
 *  • Import / Export — the spreadsheet round-trip. Export instances to CSV, edit
 *    in Excel, re-import. Import is previewed as a DIFF (creates / updates /
 *    unchanged / errors) before anything is written.
 *
 * CSV is parsed/serialized locally (no dependency); the backend works on plain
 * row objects, so the same path also accepts JSON.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import * as XLSX from 'xlsx';

import { SdmApi } from './sdm-api.js';
import { SdmClass, SdmImportDiff, SdmInstantiateResult, SdmOaImportPlan, SdmOaImportResult, SdmTemplate, SdmValidationReport } from './sdm-types.js';

const TAG = 'wui-sdm-bulk-dialog';

// ---- CSV helpers ------------------------------------------------------------
function csvParse(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = (r[i] ?? '').trim()));
    return o;
  });
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvStringify(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n');
}
function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Excel (SheetJS) helpers ------------------------------------------------
function xlsxDownload(name: string, columns: string[], rows: Record<string, unknown>[]): void {
  const aoa = [columns, ...rows.map((r) => columns.map((c) => r[c] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'instances');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  downloadBlob(name, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

async function xlsxParse(file: File): Promise<Record<string, string>[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  // raw:false → formatted strings (the backend coerces by property type)
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false });
}

export class WuiSdmBulkDialog extends LitElement {
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
      width: 70rem;
      max-width: 94vw;
      height: 84vh;
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
    .bar .spacer {
      margin-left: auto;
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      min-height: 0;
    }
    .card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 9rem;
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.8rem;
      background: var(--theme-color-2);
      color: var(--theme-color-std-text);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.4rem;
      resize: vertical;
    }
    .row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 12rem;
      overflow: auto;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.3rem 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      cursor: pointer;
    }
    .item.sel {
      border-color: var(--theme-color-primary);
      background: color-mix(in srgb, var(--theme-color-primary) 12%, transparent);
    }
    .item .meta {
      margin-left: auto;
      color: var(--theme-color-weak-text);
      font-size: 0.78rem;
    }
    .chips {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.2rem 0.4rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      white-space: nowrap;
    }
    .hint {
      color: var(--theme-color-weak-text);
      font-size: 0.8rem;
    }
    .err {
      color: var(--theme-color-alarm, #ef5b6b);
    }
    code {
      font-size: 0.78rem;
    }
  `;

  @property({ attribute: false }) classes: SdmClass[] = [];

  @state() private tab: 'templates' | 'import' | 'validate' | 'oa' = 'templates';
  @state() private message: { type: 'success' | 'alarm' | 'info'; text: string } | null = null;

  // templates
  @state() private templates: SdmTemplate[] = [];
  @state() private tplJson = '';
  @state() private selTpl = '';
  @state() private bindingsText = '';
  @state() private onConflict: 'skip' | 'update' | 'error' = 'skip';
  @state() private instResult: SdmInstantiateResult | null = null;

  // import / export
  @state() private exportClass = '';
  @state() private exportFormat: 'xlsx' | 'csv' = 'xlsx';

  // validation
  @state() private report: SdmValidationReport | null = null;
  @state() private validating = false;

  // WinCC OA migration
  @state() private oaPlan: SdmOaImportPlan | null = null;
  @state() private oaResult: SdmOaImportResult | null = null;
  @state() private oaIncludeDp = true;
  @state() private oaAdopt = true;
  @state() private oaBusy = false;
  @state() private importRows: Record<string, string>[] = [];
  @state() private importFile = '';
  @state() private diff: SdmImportDiff | null = null;

  private readonly api = new SdmApi();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadTemplates();
  }

  private async loadTemplates(): Promise<void> {
    try {
      this.templates = await this.api.listTemplates();
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  }

  private close = (): void => {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  };

  // ---- templates ----
  private scaffold = (): void => {
    const cls = this.classes.find((c) => !c.isAbstract)?.iri || 'ex:Pump';
    this.tplJson = JSON.stringify(
      {
        id: 'isa:ReactorUnit',
        label: 'Reactor Unit',
        params: ['site', 'n', 'parent'],
        nodes: [
          { key: 'unit', classIri: 'isa:Unit', name: 'Unit_{site}_{n}', label: 'Reactor Unit {n}', properties: { equipmentId: 'U-{n}' } },
          { key: 'pump', classIri: cls, name: 'Pump_{site}_{n}', label: 'Pump {n}' }
        ],
        edges: [
          { rel: 'isa:partOf', src: 'pump', tgt: 'unit' },
          { rel: 'isa:partOf', src: 'unit', tgt: '@parent' }
        ]
      },
      null,
      2
    );
  };

  private saveTemplate = async (): Promise<void> => {
    try {
      const def = JSON.parse(this.tplJson) as SdmTemplate;
      await this.api.createTemplate(def);
      this.message = { type: 'success', text: `Template “${def.id}” saved` };
      await this.loadTemplates();
      this.selTpl = def.id;
    } catch (e) {
      this.message = { type: 'alarm', text: `Template invalid: ${(e as Error).message}` };
    }
  };

  private editTemplate(t: SdmTemplate): void {
    this.selTpl = t.id;
    this.tplJson = JSON.stringify(t, null, 2);
    this.instResult = null;
  }

  private deleteTemplate = async (id: string): Promise<void> => {
    try {
      await this.api.deleteTemplate(id);
      if (this.selTpl === id) this.selTpl = '';
      await this.loadTemplates();
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };

  /** Bindings text → array of param objects (accepts a JSON array or CSV). */
  private parseBindings(): Record<string, string>[] {
    const text = this.bindingsText.trim();
    if (!text) return [];
    if (text.startsWith('[') || text.startsWith('{')) {
      const v = JSON.parse(text);
      return Array.isArray(v) ? v : [v];
    }
    return csvParse(text);
  }

  private instantiate = async (dryRun: boolean): Promise<void> => {
    if (!this.selTpl) return;
    try {
      const bindings = this.parseBindings();
      if (!bindings.length) {
        this.message = { type: 'alarm', text: 'No bindings — provide a JSON array or CSV (header = params).' };
        return;
      }
      this.instResult = await this.api.instantiateTemplate(this.selTpl, bindings, { dryRun, onConflict: this.onConflict });
      if (!dryRun) this.message = { type: 'success', text: 'Template applied' };
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };

  // ---- import / export ----
  private doExport = async (): Promise<void> => {
    try {
      const res = await this.api.exportInstances(this.exportClass || undefined);
      const base = this.exportClass ? this.exportClass.replace(/[^\w]+/g, '_') : 'sdm_instances';
      if (this.exportFormat === 'xlsx') xlsxDownload(`${base}.xlsx`, res.columns, res.rows);
      else downloadBlob(`${base}.csv`, new Blob([csvStringify(res.columns, res.rows)], { type: 'text/csv;charset=utf-8' }));
      this.message = { type: 'info', text: `Exported ${res.rows.length} rows (${this.exportFormat.toUpperCase()})` };
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };

  private onFile = async (e: Event): Promise<void> => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.importFile = file.name;
    this.diff = null;
    try {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      this.importRows = isExcel ? await xlsxParse(file) : csvParse(await file.text());
      this.message = { type: 'info', text: `${this.importRows.length} rows read from ${file.name}` };
    } catch (err) {
      this.message = { type: 'alarm', text: (err as Error).message };
    }
    input.value = '';
  };

  private preview = async (): Promise<void> => {
    if (!this.importRows.length) return;
    try {
      this.diff = await this.api.importPlan(this.importRows);
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };

  private applyImport = async (): Promise<void> => {
    if (!this.importRows.length) return;
    try {
      const res = await this.api.importApply(this.importRows);
      this.message = {
        type: res.errors.length ? 'alarm' : 'success',
        text: `Applied: ${res.created} created, ${res.updated} updated, ${res.unchanged} unchanged${res.errors.length ? `, ${res.errors.length} errors` : ''}`
      };
      this.diff = null;
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    }
  };

  // ---- render ----
  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="bar">
            <ix-icon name="database" size="20"></ix-icon>
            <ix-typography format="h5">Mass engineering</ix-typography>
            <ix-tabs class="spacer" .selected=${this.tab === 'templates' ? 0 : this.tab === 'import' ? 1 : this.tab === 'validate' ? 2 : 3}>
              <ix-tab-item @click=${() => (this.tab = 'templates')}>Templates</ix-tab-item>
              <ix-tab-item @click=${() => (this.tab = 'import')}>Import / Export</ix-tab-item>
              <ix-tab-item @click=${() => (this.tab = 'validate')}>Validate</ix-tab-item>
              <ix-tab-item @click=${() => (this.tab = 'oa')}>WinCC OA</ix-tab-item>
            </ix-tabs>
            <ix-icon-button class="spacer" ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="body">
            ${this.message
              ? html`<ix-message-bar type=${this.message.type === 'success' ? 'success' : this.message.type === 'info' ? 'info' : 'danger'}>${this.message.text}</ix-message-bar>`
              : ''}
            ${this.tab === 'templates'
              ? this.renderTemplates()
              : this.tab === 'import'
                ? this.renderImport()
                : this.tab === 'validate'
                  ? this.renderValidate()
                  : this.renderOaImport()}
          </div>
        </div>
      </div>
    `;
  }

  private renderTemplates(): TemplateResult {
    return html`
      <div class="cols">
        <div class="card">
          <div class="row">
            <ix-typography format="h5">Templates</ix-typography>
            <ix-button class="spacer" outline icon="add-circle" @click=${this.scaffold}>Scaffold</ix-button>
          </div>
          <div class="list">
            ${this.templates.map(
              (t) => html`<div class="item ${t.id === this.selTpl ? 'sel' : ''}" @click=${() => this.editTemplate(t)}>
                <ix-icon name="copy" size="14"></ix-icon>
                <span>${t.label || t.id}</span>
                <span class="meta">${t.nodes?.length || 0} nodes</span>
                <ix-icon-button ghost size="16" icon="trashcan" @click=${(e: Event) => {
                  e.stopPropagation();
                  void this.deleteTemplate(t.id);
                }}></ix-icon-button>
              </div>`
            )}
            ${this.templates.length ? nothing : html`<span class="hint">No templates yet — “Scaffold” for an example.</span>`}
          </div>
          <ix-typography format="h5">Definition (JSON)</ix-typography>
          <textarea .value=${this.tplJson} @input=${(e: Event) => (this.tplJson = (e.target as HTMLTextAreaElement).value)}></textarea>
          <div class="row">
            <ix-button icon="upload" @click=${this.saveTemplate}>Save template</ix-button>
            <span class="hint">{param} slots in name / label / string props · edge endpoints = node key or “@param”.</span>
          </div>
        </div>

        <div class="card">
          <ix-typography format="h5">Instantiate ${this.selTpl ? html`· <code>${this.selTpl}</code>` : ''}</ix-typography>
          <span class="hint">Bindings — one structure per row. JSON array <code>[{ "site":"HAM", "n":"1", "parent":"Cell_01" }]</code> or CSV (header = params).</span>
          <textarea
            .value=${this.bindingsText}
            placeholder="site,n,parent&#10;HAM,1,Cell_01&#10;HAM,2,Cell_01"
            @input=${(e: Event) => (this.bindingsText = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
          <div class="row">
            <ix-select .value=${this.onConflict} @valueChange=${(e: CustomEvent<string | string[]>) => (this.onConflict = String(e.detail ?? 'skip') as 'skip' | 'update' | 'error')}>
              <ix-select-item value="skip" label="on conflict: skip"></ix-select-item>
              <ix-select-item value="update" label="on conflict: update"></ix-select-item>
              <ix-select-item value="error" label="on conflict: error"></ix-select-item>
            </ix-select>
            <ix-button outline icon="search" .disabled=${!this.selTpl} @click=${() => this.instantiate(true)}>Dry-run</ix-button>
            <ix-button icon="play" .disabled=${!this.selTpl} @click=${() => this.instantiate(false)}>Apply</ix-button>
          </div>
          ${this.renderInstResult()}
        </div>
      </div>
    `;
  }

  private renderInstResult(): TemplateResult {
    const r = this.instResult;
    if (!r) return html``;
    return html`
      <div class="chips">
        <ix-chip outline>${r.summary.rows} rows</ix-chip>
        <ix-chip variant="success">${r.summary.toCreate} to create</ix-chip>
        <ix-chip variant=${r.summary.conflicts ? 'warning' : 'info'}>${r.summary.conflicts} existing</ix-chip>
        <ix-chip outline>${r.summary.edges} edges</ix-chip>
        ${r.summary.errors ? html`<ix-chip variant="alarm">${r.summary.errors} errors</ix-chip>` : nothing}
        ${r.dryRun ? html`<ix-chip outline>dry-run</ix-chip>` : html`<ix-chip variant="success">applied</ix-chip>`}
      </div>
      ${r.applied
        ? html`<span class="hint">created ${r.applied.created} · updated ${r.applied.updated} · skipped ${r.applied.skipped} · edges ${r.applied.edges}</span>`
        : nothing}
      ${r.plan.flatMap((p) => p.errors).length
        ? html`<div class="err">${r.plan.flatMap((p) => p.errors).slice(0, 10).map((e) => html`<div>⚠ ${e}</div>`)}</div>`
        : nothing}
      ${r.applied?.errors.length
        ? html`<div class="err">${r.applied.errors.slice(0, 10).map((e) => html`<div>⚠ ${e}</div>`)}</div>`
        : nothing}
    `;
  }

  private renderImport(): TemplateResult {
    return html`
      <div class="cols">
        <div class="card">
          <ix-typography format="h5">Export</ix-typography>
          <ix-select label="Class (optional — all if empty)" .value=${this.exportClass} @valueChange=${(e: CustomEvent<string | string[]>) => (this.exportClass = String(e.detail ?? ''))}>
            <ix-select-item value="" label="— all concrete classes"></ix-select-item>
            ${this.classes.filter((c) => !c.isAbstract).map((c) => html`<ix-select-item value=${c.iri} label=${c.label || c.iri}></ix-select-item>`)}
          </ix-select>
          <div class="row">
            <ix-select .value=${this.exportFormat} @valueChange=${(e: CustomEvent<string | string[]>) => (this.exportFormat = String(e.detail ?? 'xlsx') as 'xlsx' | 'csv')}>
              <ix-select-item value="xlsx" label="Excel (.xlsx)"></ix-select-item>
              <ix-select-item value="csv" label="CSV"></ix-select-item>
            </ix-select>
            <ix-button icon="export" @click=${this.doExport}>Download</ix-button>
          </div>
          <span class="hint">Columns: dp, class, label, parent + one per property. Edit in Excel and re-import.</span>
        </div>

        <div class="card">
          <ix-typography format="h5">Import</ix-typography>
          <div class="row">
            <input id="file" type="file" accept=".csv,.xlsx,.xls,text/csv" style="display:none" @change=${this.onFile} />
            <ix-button outline icon="upload" @click=${() => (this.renderRoot.querySelector('#file') as HTMLInputElement)?.click()}>Choose file (CSV / Excel)</ix-button>
            <span class="hint">${this.importFile ? `${this.importFile} · ${this.importRows.length} rows` : 'no file'}</span>
          </div>
          <div class="row">
            <ix-button outline icon="search" .disabled=${!this.importRows.length} @click=${this.preview}>Preview diff</ix-button>
            <ix-button icon="play" .disabled=${!this.importRows.length} @click=${this.applyImport}>Apply</ix-button>
          </div>
          ${this.renderDiff()}
        </div>
      </div>
    `;
  }

  private renderDiff(): TemplateResult {
    const d = this.diff;
    if (!d) return html``;
    return html`
      <div class="chips">
        <ix-chip variant="success">${d.summary.creates} create</ix-chip>
        <ix-chip variant="warning">${d.summary.updates} update</ix-chip>
        <ix-chip outline>${d.summary.unchanged} unchanged</ix-chip>
        ${d.summary.errors ? html`<ix-chip variant="alarm">${d.summary.errors} errors</ix-chip>` : nothing}
      </div>
      ${d.updates.length
        ? html`<table>
            <tr><th>dp</th><th>changes</th></tr>
            ${d.updates.slice(0, 30).map(
              (u) => html`<tr><td>${u.dp}</td><td class="hint">${Object.entries(u.changes).map(([k, c]) => `${k}: ${this.fmt(c.from)}→${this.fmt(c.to)}`).join(' · ')}</td></tr>`
            )}
          </table>`
        : nothing}
      ${d.errors.length ? html`<div class="err">${d.errors.slice(0, 15).map((e) => html`<div>⚠ ${e.dp}: ${e.msg}</div>`)}</div>` : nothing}
    `;
  }

  private fmt(v: unknown): string {
    if (Array.isArray(v)) return v.join(',');
    return v === null || v === undefined || v === '' ? '∅' : String(v);
  }

  // ---- WinCC OA migration ----
  private oaDryRun = async (): Promise<void> => {
    this.oaBusy = true;
    this.oaResult = null;
    try {
      this.oaPlan = await this.api.oaImportPlan(this.oaIncludeDp, this.oaAdopt);
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    } finally {
      this.oaBusy = false;
    }
  };
  private oaApply = async (): Promise<void> => {
    this.oaBusy = true;
    try {
      const r = await this.api.oaImportApply(this.oaIncludeDp, this.oaAdopt);
      this.oaResult = r;
      this.oaPlan = null;
      this.message = {
        type: r.errors.length ? 'alarm' : 'success',
        text: `Imported (${r.mode}): ${r.createdNodes} nodes, ${r.dataPointClasses} dp-classes, ${r.edges} edges${r.createdDataPoints ? `, ${r.createdDataPoints} proxies` : ''}${r.errors.length ? `, ${r.errors.length} errors` : ''}`
      };
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    } finally {
      this.oaBusy = false;
    }
  };

  private renderOaImport(): TemplateResult {
    const p = this.oaPlan;
    return html`
      <div class="card">
        <ix-typography format="h5">Import from WinCC OA</ix-typography>
        <span class="hint">
          Reads <code>_PanelTopology</code> → asset hierarchy (oa:TopologyNode + isa:partOf), and each node's
          sum-alarm DP (<code>fileName→_&lt;sumAlertNumber&gt;</code>) → its member data points. One SDM class per
          member dpType.
        </span>
        <div class="row">
          <ix-checkbox label="Include data-point assignment (sum-alarms)" .checked=${this.oaIncludeDp} @checkedChange=${(e: CustomEvent<boolean>) => (this.oaIncludeDp = e.detail)}></ix-checkbox>
        </div>
        <div class="row">
          <ix-checkbox
            label="Adopt data points (dpType = class, real DPs are the instances)"
            .checked=${this.oaAdopt}
            .disabled=${!this.oaIncludeDp}
            @checkedChange=${(e: CustomEvent<boolean>) => (this.oaAdopt = e.detail)}
          ></ix-checkbox>
        </div>
        <span class="hint">
          ${this.oaAdopt
            ? 'Adopt: each member dpType becomes an SDM class (the type is augmented in place with a sem struct) and its existing DPs become the instances.'
            : 'Proxy (non-invasive): per-dpType reference classes + one oaDp_* reference instance per DP; the real DPs stay untouched.'}
        </span>
        <div class="row">
          <ix-button outline icon="search" .disabled=${this.oaBusy} @click=${this.oaDryRun}>Dry-run</ix-button>
          <ix-button icon="play" .disabled=${this.oaBusy} @click=${this.oaApply}>Apply</ix-button>
        </div>
        ${this.oaResult
          ? html`<div class="chips">
              <ix-chip outline>${this.oaResult.mode}</ix-chip>
              <ix-chip variant="success">${this.oaResult.createdNodes} nodes</ix-chip>
              <ix-chip variant="success">${this.oaResult.dataPointClasses} dp-classes</ix-chip>
              <ix-chip outline>${this.oaResult.edges} edges</ix-chip>
              ${this.oaResult.createdDataPoints ? html`<ix-chip outline>${this.oaResult.createdDataPoints} proxies</ix-chip>` : nothing}
              ${this.oaResult.errors.length ? html`<ix-chip variant="alarm">${this.oaResult.errors.length} errors</ix-chip>` : nothing}
            </div>`
          : nothing}
        ${this.oaResult?.errors.length
          ? html`<div class="err" style="max-height:14rem;overflow:auto">
              ${this.oaResult.errors.slice(0, 200).map((e) => html`<div>⚠ ${e}</div>`)}
              ${this.oaResult.errors.length > 200 ? html`<div>… +${this.oaResult.errors.length - 200} more</div>` : nothing}
            </div>`
          : nothing}
        ${p ? this.renderOaPlan(p) : nothing}
      </div>
    `;
  }

  private renderOaPlan(p: SdmOaImportPlan): TemplateResult {
    return html`
      <div class="chips">
        <ix-chip outline>${p.mode}</ix-chip>
        <ix-chip variant="success">${p.summary.newNodes} new nodes</ix-chip>
        <ix-chip outline>${p.summary.nodes} total</ix-chip>
        <ix-chip variant=${p.summary.newDataPointClasses ? 'success' : 'info'}>${p.summary.newDataPointClasses} new dp-classes (${p.summary.dataPointClasses})</ix-chip>
        <ix-chip outline>${p.summary.dataPoints} data points</ix-chip>
        <ix-chip outline>${p.summary.nodesWithSumAlert} nodes w/ sum-alarm</ix-chip>
      </div>
      <table>
        <tr><th>node</th><th>label</th><th>parent</th><th>sum-alarm DP</th></tr>
        ${p.nodes.slice(0, 60).map(
          (n) => html`<tr><td>${n.dp}</td><td>${n.label}</td><td class="hint">${n.parentDp ?? '(root)'}</td><td class="hint">${n.sumAlertDp ?? '—'}</td></tr>`
        )}
      </table>
      ${p.dataPointClasses.length
        ? html`<table>
            <tr><th>dpType → class</th><th></th></tr>
            ${p.dataPointClasses.slice(0, 40).map(
              (c) => html`<tr><td>${c.dpType}</td><td class="hint">${c.classIri}${c.exists ? ' (exists)' : ''}</td></tr>`
            )}
          </table>`
        : nothing}
      ${p.dataPoints.length
        ? html`<span class="hint">${p.dataPoints.length} data points, e.g. ${p.dataPoints.slice(0, 8).map((d) => d.dp).join(', ')}${p.dataPoints.length > 8 ? ' …' : ''}</span>`
        : nothing}
    `;
  }

  // ---- validate ----
  private runValidate = async (): Promise<void> => {
    this.validating = true;
    try {
      this.report = await this.api.validateModel();
    } catch (e) {
      this.message = { type: 'alarm', text: (e as Error).message };
    } finally {
      this.validating = false;
    }
  };

  private renderValidate(): TemplateResult {
    const r = this.report;
    return html`
      <div class="card">
        <div class="row">
          <ix-button icon="play" .disabled=${this.validating} @click=${this.runValidate}>Run validation</ix-button>
          <span class="hint">Checks: unknown class · orphan edge · adjacency · cardinality · domain / range.</span>
        </div>
        ${r
          ? html`
              <div class="chips">
                <ix-chip outline>${r.summary.instances} instances</ix-chip>
                <ix-chip outline>${r.summary.edges} edges</ix-chip>
                <ix-chip variant=${r.summary.errors ? 'alarm' : 'success'}>${r.summary.errors} errors</ix-chip>
                <ix-chip variant=${r.summary.warnings ? 'warning' : 'info'}>${r.summary.warnings} warnings</ix-chip>
                ${r.truncated ? html`<ix-chip variant="warning">truncated</ix-chip>` : nothing}
              </div>
              ${r.findings.length
                ? html`<table>
                    <tr><th></th><th>kind</th><th>subject</th><th>message</th></tr>
                    ${r.findings.slice(0, 200).map(
                      (f) => html`<tr>
                        <td><ix-icon name=${f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'alarm' : 'info'} size="14"></ix-icon></td>
                        <td>${f.kind}</td>
                        <td>${f.subject}</td>
                        <td class="hint">${f.message}</td>
                      </tr>`
                    )}
                  </table>`
                : html`<ix-message-bar type="success" .dismissible=${false}>No problems found — model is consistent.</ix-message-bar>`}
            `
          : html`<span class="hint">Run a full consistency scan over all instances and edges.</span>`}
      </div>
    `;
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, WuiSdmBulkDialog);
