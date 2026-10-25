/**
 * Marks and layout pieces shared by every chart type, so the notation is identical
 * everywhere (IBCS "Unify"): same fonts, same scenario fills, same exception colours.
 */
import { THEME, hatchLines, line, polygon, rect, text } from "./svg.js";
import { textWidth, wrapText } from "./text.js";
/** Font sizes in px at the 960 px design width. Large on purpose: these are read on screens and slides. */
export const F = {
    title: 26,
    subtitle: 20,
    category: 21,
    value: 21,
    annotation: 20,
    note: 17,
};
export const PAD = 18;
export function toneColour(t) {
    return t === "adverse" ? THEME.adverse : t === "favourable" ? THEME.favourable : THEME.neutral;
}
/** Exactly at the tolerance counts as within (grey). A tolerance of 0 colours every non-zero variance. */
export function toneOf(delta, threshold, higherIsBetter) {
    if (delta === 0 || Math.abs(delta) <= threshold)
        return "neutral";
    return delta > 0 === higherIsBetter ? "favourable" : "adverse";
}
export const TOLERANCE_MIN = 0;
export const TOLERANCE_MAX = 50;
/** The tolerance is a user setting: 0 to 50 %, decimals allowed. Returns an error message or null. */
export function toleranceError(pct) {
    const n = typeof pct === "number" ? pct : Number.NaN;
    if (!Number.isFinite(n) || n < TOLERANCE_MIN || n > TOLERANCE_MAX) {
        const got = Number.isNaN(n) ? "an empty or non-numeric value" : `"${String(pct)}"`;
        return `Tolerance \u00b1% must be a number from ${TOLERANCE_MIN} to ${TOLERANCE_MAX} (decimals allowed); got ${got}.`;
    }
    return null;
}
/** "±2.0%": one decimal, so a tolerance of 2.5 and of 2 read differently. */
export function tolerancePct(pct) {
    return `\u00b1${pct.toFixed(Math.abs(pct * 10 - Math.round(pct * 10)) > 1e-9 ? 2 : 1)}%`;
}
/** A bar in IBCS scenario notation: actual solid, forecast hatched, plan outlined. */
export function scenarioBar(kind, x, y, w, h) {
    const out = [];
    if (w <= 0 || h <= 0)
        return out;
    if (kind === "actual") {
        out.push(rect(x, y, w, h, { fill: THEME.actual }));
    }
    else if (kind === "forecast") {
        out.push(rect(x, y, w, h, { fill: THEME.surface }));
        // Hatch inside the outline (inset) so line ends never poke out past the border.
        out.push(...hatchLines(x + 1.6, y + 1.6, x + w - 1.6, y + h - 1.6, 9, { stroke: THEME.actual, "stroke-width": 1.6 }));
        out.push(rect(x + 0.8, y + 0.8, w - 1.6, h - 1.6, { fill: "none", stroke: THEME.actual, "stroke-width": 1.6 }));
    }
    else {
        // plan: outlined. Inset by half the stroke so the outline stays inside the bar.
        out.push(rect(x + 1, y + 1, w - 2, h - 2, { fill: THEME.surface, stroke: THEME.ink, "stroke-width": 2 }));
    }
    return out;
}
/** Message title (bold, wrapped) + subtitle. Returns the y where the chart body may start. */
export function header(title, subtitle, width) {
    const parts = [];
    let y = PAD + F.title; // baseline of the first title line
    wrapText(title, F.title, width - 2 * PAD, true).forEach((l, i) => {
        if (i > 0)
            y += F.title + 7;
        parts.push(text(PAD, y, l, { size: F.title, bold: true }));
    });
    for (const l of wrapText(subtitle, F.subtitle, width - 2 * PAD)) {
        y += F.subtitle + 9;
        parts.push(text(PAD, y, l, { size: F.subtitle, fill: THEME.ink2 }));
    }
    return { parts, bottom: y + 24 };
}
export function clampLabel(lines, max) {
    if (lines.length <= max)
        return lines;
    const kept = lines.slice(0, max);
    kept[max - 1] = `${kept[max - 1]}…`;
    return kept;
}
/**
 * A label on a white box, so lines that pass behind it (leaders, extension lines) never
 * run through the text. `baseline` is the text baseline.
 */
export function labelBox(x, baseline, content, size, bold = true, anchor = "middle", fill = THEME.ink) {
    const w = textWidth(content, size, bold) + 12;
    const left = anchor === "middle" ? x - w / 2 : anchor === "start" ? x - 6 : x - w + 6;
    return [rect(left, baseline - size * 0.82 - 5, w, size + 9, { fill: THEME.surface }), text(x, baseline, content, { size, bold, anchor, fill })];
}
/** Colour for an annotation line: exception colours, but dark grey (not pale grey) when within tolerance. */
export function annotationColour(t) {
    return t === "neutral" ? THEME.ink2 : toneColour(t);
}
/** Break mark across a vertical column at y: a white slanted gap with two ink edges. */
export function breakMarkV(xLeft, xRight, y) {
    const o = 5;
    const slant = 9;
    const gap = 7;
    const a = [xLeft - o, y];
    const b = [xRight + o, y - slant];
    return [
        polygon([a, b, [b[0], b[1] - gap], [a[0], a[1] - gap]], { fill: THEME.surface }),
        line(a[0], a[1], b[0], b[1], { stroke: THEME.ink, "stroke-width": 1.6 }),
        line(a[0], a[1] - gap, b[0], b[1] - gap, { stroke: THEME.ink, "stroke-width": 1.6 }),
    ];
}
/** 1-2-5 "nice" step at or below `raw`. */
export function niceStep(raw) {
    if (!(raw > 0))
        return 1;
    const exp = Math.floor(Math.log10(raw));
    const base = 10 ** exp;
    const m = raw / base;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * base;
}
/** The IBCS-style legend for scenario notation (actual solid, forecast hatched, plan outlined or tick). */
export function scenarioLegend(items, x, y, planAsTick) {
    const out = [];
    const names = { actual: "Actual (AC)", forecast: "Forecast (FC)", plan: "Plan (PL)" };
    let lx = x;
    for (const k of items) {
        if (k === "plan" && planAsTick)
            out.push(line(lx, y - 6, lx + 24, y - 6, { stroke: THEME.ink, "stroke-width": 3 }));
        else
            out.push(...scenarioBar(k, lx, y - 15, 24, 16));
        out.push(text(lx + 32, y, names[k], { size: F.note }));
        lx += 32 + textWidth(names[k], F.note) + 26;
    }
    return out;
}
