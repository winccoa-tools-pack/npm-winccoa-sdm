"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
exports.setManager = setManager;
exports.oa = oa;
exports.localSystem = localSystem;
exports.qualify = qualify;
exports.localName = localName;
exports.sanitizeName = sanitizeName;
exports.exists = exists;
let manager;
/** Inject the WinccoaManager to use. Must be called once before any model call. */
function setManager(m) {
    manager = m;
}
function oa() {
    if (!manager)
        throw new Error('SDM: WinccoaManager not set — call setManager() at startup');
    return manager;
}
/** Local system name without trailing colon, e.g. "System1". */
function localSystem() {
    let s = oa().getSystemName();
    if (typeof s === 'string' && s.endsWith(':'))
        s = s.slice(0, -1);
    return s;
}
/** Fully qualify a dp/dpe name with the local system if it has none. */
function qualify(name, system = localSystem()) {
    if (!name)
        return name;
    return name.includes(':') ? name : `${system}:${name}`;
}
/** Strip the "System:" prefix from a (possibly) qualified name. */
function localName(name) {
    const i = name.indexOf(':');
    return i >= 0 ? name.slice(i + 1) : name;
}
/** Reduce an arbitrary IRI/string to a legal WinCC OA dp name fragment. */
function sanitizeName(iri) {
    const cleaned = String(iri).replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_');
    const trimmed = cleaned.replace(/^_+|_+$/g, '');
    return trimmed || 'n';
}
/** dpExists wrapper (defensive). */
async function exists(dpe) {
    try {
        return await oa().dpExists(dpe);
    }
    catch {
        return false;
    }
}
const PREFIX = '[SDM]';
exports.log = {
    info(...a) {
        try {
            oa().logInfo(PREFIX, ...a);
        }
        catch {
            /* log not available yet */
        }
    },
    warn(...a) {
        try {
            oa().logWarning(PREFIX, ...a);
        }
        catch {
            /* ignore */
        }
    },
    error(...a) {
        try {
            oa().logSevere(PREFIX, ...a);
        }
        catch {
            /* ignore */
        }
    }
};
//# sourceMappingURL=oa.js.map