/**
 * IBCS column chart model: periods with actual (AC) or forecast (FC) against plan (PL),
 * plus absolute (ΔPL) and relative (ΔPL%) variances.
 *
 * Input, one row per period (wide format, the shape of an IBP or BI export):
 *   Period | AC | FC | PL
 * Each period has an AC value or an FC value (not both) and, optionally, a PL value.
 * Column order is read from the header row (AC/Actual, FC/Forecast/LE/Outlook,
 * PL/Plan/Budget/OP); without a header the order AC, FC, PL is assumed.
 */
import { toleranceError, toneOf } from "./marks.js";
import { roundTo } from "./bridge.js";
import { resolveAnnotations } from "./annotations.js";
export const DEFAULT_COLUMN_OPTIONS = {
    title: "",
    subtitle: "",
    units: "$M",
    decimals: 1,
    scale: 1,
    higherIsBetter: true,
    materialityPct: 2,
    planStyle: "column",
    varianceScale: "shared",
    axisMax: 0,
    showPctPins: true,
    showVarianceBars: true,
    annotations: [],
    showTotal: false,
    totalLabel: "FY",
    scaleName: "",
    pinRange: null,
    deltaRange: null,
};
const ROLE = {
    ac: "ac", act: "ac", actual: "ac", actuals: "ac",
    fc: "fc", fcst: "fc", forecast: "fc", le: "fc", outlook: "fc",
    pl: "pl", plan: "pl", budget: "pl", bu: "pl", op: "pl", target: "pl",
};
function isBlank(c) {
    return c === null || c === undefined || (typeof c === "string" && c.trim() === "");
}
function num(c) {
    if (typeof c === "number" && Number.isFinite(c))
        return c;
    if (typeof c === "string") {
        const t = c.replace(/[\s,$€£]/g, "").replace("−", "-");
        if (t === "")
            return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : Number.NaN;
    }
    return null;
}
/** "AC ($M)" -> "ac", "Plan 2026" -> "pl". The first word decides. */
function roleOf(header) {
    if (isBlank(header))
        return null;
    const w = String(header).trim().toLowerCase().split(/[^a-z]+/).filter(Boolean)[0] ?? "";
    return ROLE[w] ?? null;
}
/** Brief §6: ΔPL is coloured only OUTSIDE ±tolerance, so exactly at the tolerance stays grey. */
function pctTone(pct, o) {
    if (pct === null || Math.abs(pct) <= o.materialityPct)
        return "neutral";
    return toneOf(pct, 0, o.higherIsBetter);
}
/** Exported for the renderer: tone of a % difference under the chart's tolerance. */
export function pctToneOf(pct, o) {
    return pctTone(pct, o);
}
export function parseColumns(values, partial = {}) {
    const options = { ...DEFAULT_COLUMN_OPTIONS, ...partial };
    if (!(options.scale > 0))
        return { ok: false, error: "Scale must be a positive number." };
    const tolErr = toleranceError(options.materialityPct);
    if (tolErr)
        return { ok: false, error: tolErr };
    options.decimals = Math.max(0, Math.min(4, Math.round(options.decimals)));
    const rows = values.filter((r) => r.some((c) => !isBlank(c)));
    if (rows.length === 0)
        return { ok: false, error: "The selection is empty. Select a table: Period | AC | FC | PL." };
    const width = rows[0]?.length ?? 0;
    if (width < 3)
        return { ok: false, error: "Select at least three columns: Period, AC and FC (PL is optional but needed for variances)." };
    // Header row: any of columns 2..n is a non-number.
    const first = rows[0];
    const hasHeader = first.slice(1).some((c) => !isBlank(c) && Number.isNaN(num(c) ?? Number.NaN));
    let col = { ac: 1, fc: 2, pl: width >= 4 ? 3 : -1 };
    if (hasHeader) {
        const found = {};
        first.forEach((h, i) => {
            if (i === 0)
                return;
            const r = roleOf(h);
            if (r && found[r] === undefined)
                found[r] = i;
        });
        if (found.ac === undefined || found.fc === undefined) {
            return { ok: false, error: `Header row: could not find both an AC column and an FC column (found: ${first.map(String).join(" | ")}). Name them AC/Actual and FC/Forecast.` };
        }
        col = { ac: found.ac, fc: found.fc, pl: found.pl ?? -1 };
    }
    const body = hasHeader ? rows.slice(1) : rows;
    const offset = hasHeader ? 2 : 1;
    if (body.length < 2)
        return { ok: false, error: "A column chart needs at least two periods." };
    if (body.length > 36)
        return { ok: false, error: `${body.length} periods is too many for one chart (36 at most). Select a shorter range.` };
    const periods = [];
    const warnings = [];
    let seenForecast = false;
    let interleaved = false;
    for (let i = 0; i < body.length; i++) {
        const r = body[i];
        const sourceRow = i + offset;
        const label = isBlank(r[0]) ? `Row ${sourceRow}` : String(r[0]).trim();
        const ac = num(r[col.ac]);
        const fc = num(r[col.fc]);
        const pl = col.pl >= 0 ? num(r[col.pl]) : null;
        for (const [name, v, cell] of [["AC", ac, r[col.ac]], ["FC", fc, r[col.fc]], ["PL", pl, col.pl >= 0 ? r[col.pl] : null]]) {
            if (v !== null && Number.isNaN(v))
                return { ok: false, error: `Row ${sourceRow} "${label}": ${name} "${String(cell)}" is not a number.` };
        }
        if (ac !== null && fc !== null)
            return { ok: false, error: `Row ${sourceRow} "${label}": has both an actual and a forecast. Keep one and leave the other blank.` };
        if (ac === null && fc === null)
            return { ok: false, error: `Row ${sourceRow} "${label}": has neither an actual nor a forecast.` };
        const kind = ac !== null ? "actual" : "forecast";
        if (kind === "forecast")
            seenForecast = true;
        else if (seenForecast)
            interleaved = true;
        const value = (ac ?? fc) / options.scale;
        const plan = pl === null ? null : pl / options.scale;
        const delta = plan === null ? null : value - plan;
        const deltaPct = plan === null || plan === 0 ? null : (delta / Math.abs(plan)) * 100;
        const tone = pctTone(deltaPct, options);
        periods.push({ label, kind, value, plan, delta, deltaPct, tone, sourceRow });
    }
    if (interleaved)
        warnings.push("Actual periods appear after forecast periods. Check the AC and FC columns.");
    const hasPlan = periods.some((p) => p.plan !== null);
    if (hasPlan && periods.some((p) => p.plan === null)) {
        const missing = periods.filter((p) => p.plan === null).map((p) => p.label);
        warnings.push(`No plan for ${missing.join(", ")}: no variance shown there.`);
    }
    if (periods.some((p) => p.plan === 0))
        warnings.push("A plan of 0 has no % variance; its pin is left out.");
    const value = periods.reduce((s, p) => s + p.value, 0);
    const planned = periods.filter((p) => p.plan !== null);
    const plan = planned.length ? planned.reduce((s, p) => s + p.plan, 0) : null;
    const delta = plan === null ? null : planned.reduce((s, p) => s + p.value, 0) - plan;
    const deltaPct = plan === null || plan === 0 ? null : (delta / Math.abs(plan)) * 100;
    // IBCS "Check" on screen: do the rounded ΔPL labels add up to the rounded total ΔPL?
    if (delta !== null) {
        const shown = planned.reduce((s, p) => s + roundTo(p.delta, options.decimals), 0);
        if (Math.abs(roundTo(shown, options.decimals) - roundTo(delta, options.decimals)) > 10 ** -(options.decimals + 3)) {
            warnings.push(`Rounded ΔPL labels add up to ${shown.toFixed(options.decimals)}, the total ΔPL is ${delta.toFixed(options.decimals)}. Show one more decimal if that matters.`);
        }
    }
    const totalTone = pctTone(deltaPct, options);
    const totalLabel = options.totalLabel.trim() || "Total";
    const total = options.showTotal
        ? { label: totalLabel, kind: periods.some((p) => p.kind === "forecast") ? "forecast" : "actual", value, plan, delta, deltaPct, tone: totalTone, sourceRow: 0, isTotal: true }
        : null;
    if (total && periods.some((p) => p.label.trim().toLowerCase() === totalLabel.toLowerCase())) {
        warnings.push(`A period is already called "${totalLabel}"; rename the total column so annotations can tell them apart.`);
    }
    const barLabels = [...periods.map((p) => p.label), ...(total ? [total.label] : [])];
    const ann = resolveAnnotations(options.annotations, barLabels, "period");
    warnings.push(...ann.warnings);
    const annotations = ann.resolved.filter((a) => {
        if (a.spec.type === "bracket" && total && (a.i === periods.length || a.j === periods.length)) {
            warnings.push(`Annotation ${a.n} (bracket ${a.spec.from} \u2192 ${a.spec.to}) includes the total column; a bracket covers periods only, so it was left out.`);
            return false;
        }
        return true;
    });
    return {
        ok: true,
        model: {
            periods,
            hasPlan,
            totals: { value, plan, delta, deltaPct, tone: totalTone },
            firstForecast: periods.findIndex((p) => p.kind === "forecast"),
            annotations,
            total,
            options,
            warnings,
        },
    };
}
export function scaleNeeds(m) {
    const vals = m.periods.flatMap((p) => (p.plan === null ? [p.value] : [p.value, p.plan]));
    const pcts = m.periods.map((p) => p.deltaPct).filter((x) => x !== null);
    if (m.total?.deltaPct !== null && m.total?.deltaPct !== undefined)
        pcts.push(m.total.deltaPct);
    const deltas = m.periods.map((p) => p.delta).filter((x) => x !== null);
    return {
        max: Math.max(0, ...vals),
        min: Math.min(0, ...vals),
        pin: [Math.min(0, ...pcts), Math.max(0, ...pcts)],
        delta: [Math.min(0, ...deltas), Math.max(0, ...deltas)],
    };
}
export function mergeNeeds(list) {
    return {
        max: Math.max(0, ...list.map((n) => n.max)),
        min: Math.min(0, ...list.map((n) => n.min)),
        pin: [Math.min(0, ...list.map((n) => n.pin[0])), Math.max(0, ...list.map((n) => n.pin[1]))],
        delta: [Math.min(0, ...list.map((n) => n.delta[0])), Math.max(0, ...list.map((n) => n.delta[1]))],
    };
}
