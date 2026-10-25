/**
 * IBCS bridge (waterfall) model: parse an Excel range, check that it adds up,
 * classify every step and decide the visible value window (axis break).
 *
 * Pure functions only: no DOM, no Office.js. Rendering lives in render.ts.
 */
import { toleranceError, toneOf } from "./marks.js";
export { toneOf } from "./marks.js";
export const DEFAULT_OPTIONS = {
    orientation: "horizontal",
    title: "",
    subtitle: "",
    prefix: "$",
    suffix: "M",
    decimals: 1,
    scale: 1,
    higherIsBetter: true,
    materialityPct: 1,
    breakAxis: "auto",
    showGapArrow: true,
};
const KIND_SYNONYMS = {
    plan: "plan", pl: "plan", budget: "plan", bu: "plan", op: "plan", target: "plan",
    actual: "actual", ac: "actual", act: "actual",
    forecast: "forecast", fc: "forecast", outlook: "forecast", le: "forecast", fcst: "forecast",
    step: "step", delta: "step", "Δ": "step", change: "step", driver: "step",
};
function toNumber(cell) {
    if (typeof cell === "number" && Number.isFinite(cell))
        return cell;
    if (typeof cell === "string") {
        const cleaned = cell.replace(/[\s,$€£]/g, "").replace("−", "-");
        if (cleaned === "")
            return null;
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : Number.NaN;
    }
    return null;
}
function isBlank(cell) {
    return cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");
}
function parseKind(cell) {
    if (isBlank(cell))
        return null;
    const key = String(cell).trim().toLowerCase();
    return KIND_SYNONYMS[key] ?? "invalid";
}
/** Round to `decimals` the way the label will show it (half away from zero). */
export function roundTo(value, decimals) {
    const f = 10 ** decimals;
    const r = Math.round(Math.abs(value) * f + 1e-9) / f;
    return value < 0 ? -r : r;
}
/** 1-2-5 "nice" step at or below `raw`. */
function niceStep(raw) {
    const exp = Math.floor(Math.log10(raw));
    const base = 10 ** exp;
    const m = raw / base;
    const nice = m >= 5 ? 5 : m >= 2 ? 2 : 1;
    return nice * base;
}
/**
 * Visible value window. Totals are long and steps are short, so drawing from zero
 * squeezes the steps into a sliver. When all levels share a sign and the steps span
 * under 35% of the largest level, the window starts near the smallest level and the
 * totals are drawn with an explicit break mark (IBCS "Check": never truncate silently).
 */
export function chooseWindow(levels, mode) {
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    const allPositive = lo > 0;
    const span = hi - lo;
    const wantsBreak = mode === "on" || (mode === "auto" && span > 0 && span / hi < 0.35);
    if (!allPositive || !wantsBreak || span === 0) {
        return { min: Math.min(0, lo), max: Math.max(0, hi), broken: false };
    }
    // Leave the broken totals a visible stub: pad the window by 60% of the step span.
    const step = niceStep(span / 4);
    let min = Math.floor((lo - span * 0.6) / step) * step;
    if (min <= 0)
        return { min: 0, max: hi, broken: false };
    min = Number(min.toPrecision(12));
    return { min, max: hi, broken: true };
}
/**
 * Parse a 2-D range (as Excel returns `range.values`) into a bridge model.
 * Columns: Label | Value | Type (optional) | Group (optional). A header row is
 * detected when the first row's value cell is not a number.
 */
export function parseBridge(values, partial = {}) {
    const options = { ...DEFAULT_OPTIONS, ...partial };
    if (!(options.scale > 0))
        return { ok: false, error: "Scale must be a positive number." };
    const tolErr = toleranceError(options.materialityPct);
    if (tolErr)
        return { ok: false, error: tolErr };
    const decimals = Math.max(0, Math.min(4, Math.round(options.decimals)));
    options.decimals = decimals;
    const rowsIn = values.filter((r) => r.some((c) => !isBlank(c)));
    if (rowsIn.length === 0) {
        return { ok: false, error: "The selection is empty. Select a table: Label | Value | Type | Group." };
    }
    if ((rowsIn[0]?.length ?? 0) < 2) {
        return { ok: false, error: "Select at least two columns: Label and Value (Type and Group are optional)." };
    }
    const firstValue = rowsIn[0]?.[1];
    const hasHeader = !isBlank(firstValue) && Number.isNaN(toNumber(firstValue) ?? Number.NaN);
    const body = hasHeader ? rowsIn.slice(1) : rowsIn;
    const offset = hasHeader ? 2 : 1;
    if (body.length < 3) {
        return { ok: false, error: "A bridge needs a start total, at least one step and an end total (3 rows or more)." };
    }
    // Pass 1: kinds and raw numbers.
    const parsed = [];
    for (let i = 0; i < body.length; i++) {
        const r = body[i] ?? [];
        const sourceRow = i + offset;
        const label = isBlank(r[0]) ? `Row ${sourceRow}` : String(r[0]).trim();
        const k = parseKind(r[2]);
        if (k === "invalid") {
            return { ok: false, error: `Row ${sourceRow} "${label}": type "${String(r[2])}" is not one of Plan, Actual, Forecast, Step.` };
        }
        const isFirst = i === 0;
        const isLast = i === body.length - 1;
        const kind = k ?? (isFirst ? "plan" : isLast ? "forecast" : "step");
        const raw = toNumber(r[1]);
        if (raw !== null && Number.isNaN(raw)) {
            return { ok: false, error: `Row ${sourceRow} "${label}": "${String(r[1])}" is not a number.` };
        }
        const group = isBlank(r[3]) ? "" : String(r[3]).trim();
        parsed.push({ label, kind, raw: raw === null ? null : raw / options.scale, group, sourceRow });
    }
    const head = parsed[0];
    const tail = parsed[parsed.length - 1];
    if (head.kind === "step")
        return { ok: false, error: `Row ${head.sourceRow} "${head.label}": the first row must be a total (Plan, Actual or Forecast).` };
    if (tail.kind === "step")
        return { ok: false, error: `Row ${tail.sourceRow} "${tail.label}": the last row must be a total (Plan, Actual or Forecast).` };
    if (head.raw === null)
        return { ok: false, error: `Row ${head.sourceRow} "${head.label}": the start total needs a value.` };
    // Pass 2: running levels; given totals must match the steps exactly.
    const threshold = (Math.abs(head.raw) * options.materialityPct) / 100;
    const rows = [];
    let level = 0;
    for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i];
        if (p.kind === "step") {
            if (p.raw === null)
                return { ok: false, error: `Row ${p.sourceRow} "${p.label}": the step has no value.` };
            const from = level;
            level += p.raw;
            rows.push({ label: p.label, kind: "step", value: p.raw, from, to: level, tone: toneOf(p.raw, threshold, options.higherIsBetter), computed: false, group: p.group, sourceRow: p.sourceRow });
        }
        else {
            let computed = false;
            if (i === 0) {
                level = p.raw;
            }
            else if (p.raw === null) {
                computed = true;
            }
            else {
                const tol = 1e-9 * Math.max(1, Math.abs(p.raw), Math.abs(level));
                if (Math.abs(p.raw - level) > tol) {
                    const d = p.raw - level;
                    return {
                        ok: false,
                        error: `Row ${p.sourceRow} "${p.label}": the steps add up to ${level.toFixed(decimals + 2)} but the total says ${p.raw.toFixed(decimals + 2)} (difference ${d.toFixed(decimals + 2)}). Fix a step, add an "Other" step, or leave the total blank to compute it.`,
                    };
                }
                level = p.raw;
            }
            rows.push({ label: p.label, kind: p.kind, value: level, from: 0, to: level, tone: "neutral", computed, group: "", sourceRow: p.sourceRow });
        }
    }
    const start = rows[0];
    const end = rows[rows.length - 1];
    const gap = end.value - start.value;
    const gapPct = start.value === 0 ? 0 : (gap / Math.abs(start.value)) * 100;
    // Groups: consecutive steps sharing a Group label get a bracket with their sum.
    const groups = [];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.kind !== "step" || !r.group)
            continue;
        const prev = groups[groups.length - 1];
        if (prev && prev.label === r.group && prev.last === i - 1) {
            prev.last = i;
            prev.sum += r.value;
        }
        else {
            groups.push({ label: r.group, first: i, last: i, sum: r.value, tone: "neutral" });
        }
    }
    for (const g of groups)
        g.tone = toneOf(g.sum, threshold, options.higherIsBetter);
    const levels = rows.flatMap((r) => (r.kind === "step" ? [r.from, r.to] : [r.to]));
    const window = chooseWindow(levels, options.breakAxis);
    // IBCS "Check" on screen: do the rounded step labels add up to the rounded gap?
    const warnings = [];
    const stepLabelSum = rows.filter((r) => r.kind === "step").reduce((s, r) => s + roundTo(r.value, decimals), 0);
    const shownGap = roundTo(end.value, decimals) - roundTo(start.value, decimals);
    if (Math.abs(stepLabelSum - shownGap) > 10 ** -(decimals + 3)) {
        warnings.push(`Rounded labels do not add up on screen: steps show ${stepLabelSum.toFixed(decimals)}, totals differ by ${shownGap.toFixed(decimals)}. Show one more decimal or round the inputs.`);
    }
    return {
        ok: true,
        model: { rows, groups, start, end, gap, gapPct, gapTone: toneOf(gap, threshold, options.higherIsBetter), window, options, warnings },
    };
}
/** "+$0.4M", "−$1.3M", "$36.0M". Uses the true minus sign. */
export function formatValue(v, o, signed = false) {
    const r = roundTo(v, o.decimals);
    const body = `${o.prefix}${Math.abs(r).toFixed(o.decimals)}${o.suffix}`;
    if (r < 0)
        return `−${body}`;
    return signed && r > 0 ? `+${body}` : body;
}
export function formatPct(p, decimals = 1) {
    const r = roundTo(p, decimals);
    if (r < 0)
        return `−${Math.abs(r).toFixed(decimals)}%`;
    return r > 0 ? `+${r.toFixed(decimals)}%` : `${r.toFixed(decimals)}%`;
}
export function defaultTitle(m) {
    const o = m.options;
    return `${m.end.label} ${formatValue(m.gap, o, true)} (${formatPct(m.gapPct)}) vs ${m.start.label}`;
}
export function defaultSubtitle(m) {
    const o = m.options;
    return `${m.start.label} to ${m.end.label}, ${o.prefix}${o.suffix}`.replace(/, $/, "");
}
/** Plain-language description for alt text and screen readers. */
export function describe(m) {
    const o = m.options;
    const parts = m.rows.map((r) => `${r.label} ${formatValue(r.value, o, r.kind === "step")}`);
    const gap = `Gap ${formatValue(m.gap, o, true)} (${formatPct(m.gapPct)}).`;
    const brk = m.window.broken ? ` Value axis broken: bars start at ${formatValue(m.window.min, o)}.` : "";
    return `Bridge chart. ${parts.join("; ")}. ${gap}${brk}`;
}
