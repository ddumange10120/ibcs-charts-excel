/**
 * Annotations shared by every chart type: difference arrows between any two bars and
 * brackets (subtotals) over a contiguous run of bars.
 *
 * They are stored in the chart's settings and refer to bars by their LABEL (period or
 * row name), not by position, so they survive rows being added or re-sorted. A label
 * that disappears after the data changes is reported and the annotation is left out;
 * the rest of the chart still draws.
 */
export const MAX_ANNOTATIONS = 8;
const norm = (s) => s.trim().toLowerCase();
export function describeSpec(a) {
    return `${a.type === "diff" ? "arrow" : "bracket"} ${a.from} → ${a.to}`;
}
/** Validate the stored specs against the labels in the current table. */
export function resolveAnnotations(specs, labels, noun) {
    const resolved = [];
    const warnings = [];
    if (specs === undefined || specs === null)
        return { resolved, warnings };
    if (!Array.isArray(specs))
        return { resolved, warnings: ["Annotations are not a list; they were ignored."] };
    const index = new Map();
    const dupes = new Set();
    labels.forEach((l, k) => {
        const key = norm(l);
        if (index.has(key))
            dupes.add(key);
        else
            index.set(key, k);
    });
    specs.slice(0, MAX_ANNOTATIONS).forEach((raw, k) => {
        const n = k + 1;
        const a = raw;
        if (!a || (a.type !== "diff" && a.type !== "bracket") || typeof a.from !== "string" || typeof a.to !== "string") {
            warnings.push(`Annotation ${n} is incomplete; it was left out.`);
            return;
        }
        const spec = { type: a.type, from: a.from, to: a.to, ...(typeof a.label === "string" && a.label.trim() ? { label: a.label.trim() } : {}) };
        const i = index.get(norm(spec.from));
        const j = index.get(norm(spec.to));
        const missing = [i === undefined ? spec.from : null, j === undefined ? spec.to : null].filter((x) => x !== null);
        if (missing.length) {
            warnings.push(`Annotation ${n} (${describeSpec(spec)}): ${missing.map((m) => `"${m}"`).join(" and ")} ${missing.length > 1 ? "are" : "is"} not in the table any more, so it was left out. Remove it, or restore the ${noun}.`);
            return;
        }
        if (i === j) {
            warnings.push(`Annotation ${n} (${describeSpec(spec)}) starts and ends on the same ${noun}; it was left out.`);
            return;
        }
        for (const key of [norm(spec.from), norm(spec.to)]) {
            if (dupes.has(key))
                warnings.push(`Annotation ${n}: the ${noun} "${key}" appears more than once in the table; the first one is used.`);
        }
        resolved.push({ spec, n, i: i, j: j });
    });
    if (Array.isArray(specs) && specs.length > MAX_ANNOTATIONS) {
        warnings.push(`Only the first ${MAX_ANNOTATIONS} annotations are drawn.`);
    }
    return { resolved, warnings };
}
/**
 * Greedy lane packing (interval scheduling). Items are placed in the order given, each
 * in the lowest lane where it overlaps nothing (with `gap` px of air). Returns the lane
 * per item, or null when all `maxLanes` lanes are full: the caller skips it and warns.
 */
export function assignLanes(items, maxLanes, gap = 10) {
    const lanes = [];
    return items.map((it) => {
        for (let l = 0; l < maxLanes; l++) {
            const lane = (lanes[l] ??= []);
            if (lane.every((o) => it.hi + gap <= o.lo || it.lo >= o.hi + gap)) {
                lane.push(it);
                return l;
            }
        }
        return null;
    });
}
