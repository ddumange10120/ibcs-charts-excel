/**
 * Marks and layout pieces shared by every chart type, so the notation is identical
 * everywhere (IBCS "Unify"): same fonts, same scenario fills, same exception colours.
 */
import { THEME, hatchLines, rect, text } from "./svg.js";
import { wrapText } from "./text.js";
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
