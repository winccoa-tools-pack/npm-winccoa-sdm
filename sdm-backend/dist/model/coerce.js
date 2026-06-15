"use strict";
// -----------------------------------------------------------------------------
// Value coercion: turn loosely-typed input (CSV strings, template params) into
// the concrete value the property's datatype expects, so dpSetWait gets the
// right runtime type. Used by the bulk importer and the template engine.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.coerceValue = coerceValue;
const TRUE = new Set(['true', '1', 'yes', 'on', 'x', 'ja']);
function toArray(raw) {
    if (Array.isArray(raw))
        return raw.map((x) => String(x));
    const s = String(raw).trim();
    if (!s)
        return [];
    return s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
}
/** Coerce `raw` to the runtime value for a friendly SDM datatype string. */
function coerceValue(type, raw) {
    if (raw === null || raw === undefined)
        return raw;
    if (type === 'bool')
        return typeof raw === 'boolean' ? raw : TRUE.has(String(raw).trim().toLowerCase());
    if (type === 'int' || type === 'uint' || type === 'long') {
        return typeof raw === 'number' ? Math.trunc(raw) : parseInt(String(raw), 10) || 0;
    }
    if (type === 'float' || type === 'double') {
        return typeof raw === 'number' ? raw : parseFloat(String(raw)) || 0;
    }
    if (type === 'dyn_int')
        return toArray(raw).map((x) => parseInt(x, 10) || 0);
    if (type === 'dyn_float')
        return toArray(raw).map((x) => parseFloat(x) || 0);
    if (type === 'dyn_bool')
        return toArray(raw).map((x) => TRUE.has(x.toLowerCase()));
    if (type.startsWith('dyn_'))
        return toArray(raw);
    return String(raw);
}
//# sourceMappingURL=coerce.js.map