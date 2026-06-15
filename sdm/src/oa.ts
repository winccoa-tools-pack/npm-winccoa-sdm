// -----------------------------------------------------------------------------
// Access to the WinCC OA API + small, model-agnostic helpers.
//
// The WinccoaManager is INJECTED at startup so the same model code runs in
// different hosts without depending on any of them:
//   - webserver.js host: setManager(WsjServerGlobal.winccoa)   (see run.js)
//   - standalone manager (e.g. the SDM MCP server): setManager(new WinccoaManager())
// -----------------------------------------------------------------------------
import type { WinccoaManager } from 'winccoa-manager';

let manager: WinccoaManager | undefined;

/** Inject the WinccoaManager to use. Must be called once before any model call. */
export function setManager(m: WinccoaManager): void {
  manager = m;
}

export function oa(): WinccoaManager {
  if (!manager) throw new Error('SDM: WinccoaManager not set — call setManager() at startup');
  return manager;
}

/** Local system name without trailing colon, e.g. "System1". */
export function localSystem(): string {
  let s = oa().getSystemName();
  if (typeof s === 'string' && s.endsWith(':')) s = s.slice(0, -1);
  return s;
}

/** Fully qualify a dp/dpe name with the local system if it has none. */
export function qualify(name: string, system: string = localSystem()): string {
  if (!name) return name;
  return name.includes(':') ? name : `${system}:${name}`;
}

/** Strip the "System:" prefix from a (possibly) qualified name. */
export function localName(name: string): string {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

/** Reduce an arbitrary IRI/string to a legal WinCC OA dp name fragment. */
export function sanitizeName(iri: string): string {
  const cleaned = String(iri).replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_');
  const trimmed = cleaned.replace(/^_+|_+$/g, '');
  return trimmed || 'n';
}

/** dpExists wrapper (defensive). */
export async function exists(dpe: string): Promise<boolean> {
  try {
    return await oa().dpExists(dpe);
  } catch {
    return false;
  }
}

const PREFIX = '[SDM]';

export const log = {
  info(...a: unknown[]): void {
    try {
      oa().logInfo(PREFIX, ...(a as never[]));
    } catch {
      /* log not available yet */
    }
  },
  warn(...a: unknown[]): void {
    try {
      oa().logWarning(PREFIX, ...(a as never[]));
    } catch {
      /* ignore */
    }
  },
  error(...a: unknown[]): void {
    try {
      oa().logSevere(PREFIX, ...(a as never[]));
    } catch {
      /* ignore */
    }
  }
};
