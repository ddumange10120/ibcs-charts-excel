/**
 * Bridge model -> Office-safe SVG string, horizontal or vertical.
 *
 * Notation (IBCS): plan = outlined, actual = solid, forecast = hatched.
 * Steps: adverse red, favourable blue, below materiality grey. Text is always ink;
 * colour is carried by marks only, so the chart still reads in greyscale (the sign
 * and the bar direction carry the same information as the colour).
 */
import { assignLanes } from "./annotations.js";
import { defaultSubtitle, defaultTitle, describe, formatPct, formatValue, } from "./bridge.js";
import { F, PAD, annotationColour, breakMarkV, clampLabel, header as drawHeader, labelBox, scenarioBar, tolerancePct, toneColour } from "./marks.js";
import { THEME, arrowhead, esc, line, polygon, polyline, rect, text } from "./svg.js";
import { textWidth, wrapText } from "./text.js";
/** Break mark across a horizontal bar at x: a white slanted gap with two ink edges. */
function breakMarkH(x, yTop, yBot) {
    const o = 5;
    const slant = 9;
    const gap = 7;
    const a = [x, yBot + o];
    const b = [x + slant, yTop - o];
    return [
        polygon([a, [a[0] + gap, a[1]], [b[0] + gap, b[1]], b], { fill: THEME.surface }),
        line(a[0], a[1], b[0], b[1], { stroke: THEME.ink, "stroke-width": 1.6 }),
        line(a[0] + gap, a[1], b[0] + gap, b[1], { stroke: THEME.ink, "stroke-width": 1.6 }),
    ];
}
/** Break mark across a vertical column at y. */
function header(m, width) {
    const title = m.options.title.trim() || defaultTitle(m);
    const subtitle = m.options.subtitle.trim() || defaultSubtitle(m);
    return { ...drawHeader(title, subtitle, width), title };
}
function footerNotes(m) {
    const notes = [`Grey = steps within ${tolerancePct(m.options.materialityPct)} of the start total. Red/blue = beyond it.`];
    if (m.window.broken)
        notes.push(`Totals are broken: the value axis starts at ${formatValue(m.window.min, m.options)}. Steps are to scale.`);
    return notes;
}
/* ------------------------------------------------------------------ */
/* Horizontal                                                          */
/* ------------------------------------------------------------------ */
const DASH = { stroke: THEME.extension, "stroke-width": 1.4, "stroke-dasharray": "5 4" };
function diffWarn(m, d) {
    return `No room for the arrow ${m.rows[d.to].label} vs ${m.rows[d.from].label}; it was left out. Remove an annotation or widen the picture.`;
}
function renderHorizontal(m, width) {
    const o = m.options;
    const { parts: head, bottom: top, title } = header(m, width);
    const body = [...head];
    const warnings = [];
    const rowH = 52;
    const barH = 30;
    const n = m.rows.length;
    const yTop = (i) => top + i * rowH + (rowH - barH) / 2;
    const rowsBottom = top + n * rowH;
    const labelMax = 300;
    const labelLines = m.rows.map((r) => clampLabel(wrapText(r.label, F.category, labelMax), 2));
    const labelW = Math.min(labelMax, Math.max(...labelLines.flat().map((l) => textWidth(l, F.category)))) + 14;
    const valueText = m.rows.map((r) => formatValue(r.value, o, r.kind === "step"));
    const valueW = Math.max(...valueText.map((t, i) => textWidth(t, F.value, m.rows[i].kind !== "step"))) + 8;
    // Brackets sit right of the value column, in lanes: overlapping row ranges (or label blocks) never share a lane.
    const groupLabelMax = 170;
    const groupLines = m.groups.map((g) => [formatValue(g.sum, o, true), ...clampLabel(wrapText(g.label, F.note, groupLabelMax), 2)]);
    const blockH = (ls) => F.annotation + (ls.length - 1) * (F.note + 4) + 8;
    const gSpan = m.groups.map((g, k) => {
        const ya = yTop(g.first) - 2;
        const yb = yTop(g.last) + barH + 2;
        const mid = (ya + yb) / 2;
        const h = blockH(groupLines[k]);
        return { lo: Math.min(ya, mid - h / 2), hi: Math.max(yb, mid + h / 2) };
    });
    const gOrder = m.groups.map((_, k) => k).sort((a, b) => gSpan[a].hi - gSpan[a].lo - (gSpan[b].hi - gSpan[b].lo));
    const gLaneSorted = assignLanes(gOrder.map((k) => gSpan[k]), 3, 4);
    const gLane = new Array(m.groups.length).fill(null);
    gOrder.forEach((k, idx) => (gLane[k] = gLaneSorted[idx]));
    gLane.forEach((l, k) => {
        if (l === null)
            warnings.push(`No room for the bracket "${m.groups[k].label}"; it was left out.`);
    });
    const gLanes = Math.max(0, ...gLane.map((l) => (l === null ? -1 : l + 1)));
    const laneTextW = m.groups.length
        ? Math.max(...groupLines.map((ls) => Math.max(textWidth(ls[0], F.annotation, true), ...ls.slice(1).map((l) => textWidth(l, F.note)))))
        : 0;
    const bracketLaneW = 26 + laneTextW;
    const bracketW = gLanes ? gLanes * bracketLaneW + (gLanes - 1) * 10 : 0;
    const plotX0 = PAD + labelW + 10;
    const valueRight = width - PAD - bracketW - (bracketW ? 12 : 0);
    const plotX1 = valueRight - valueW - 18;
    const { min, max, broken } = m.window;
    const x = (v) => plotX0 + ((v - min) / (max - min || 1)) * (plotX1 - plotX0);
    const base = broken ? min : 0;
    // Difference arrows below the rows, in lanes (the gap arrow first, then annotations, shortest first).
    const dCx = m.diffs.map((d) => {
        const lw = textWidth(d.text, F.annotation, true) + 12;
        const cx = Math.min(width - PAD - lw / 2, Math.max(PAD + lw / 2, (x(d.a) + x(d.b)) / 2));
        return { cx, lw };
    });
    const dSpan = m.diffs.map((d, k) => ({
        lo: Math.min(x(d.a), x(d.b), dCx[k].cx - dCx[k].lw / 2),
        hi: Math.max(x(d.a), x(d.b), dCx[k].cx + dCx[k].lw / 2),
    }));
    const dOrder = m.diffs.map((_, k) => k).sort((a, b) => {
        if (m.diffs[a].isGap !== m.diffs[b].isGap)
            return m.diffs[a].isGap ? -1 : 1;
        return dSpan[a].hi - dSpan[a].lo - (dSpan[b].hi - dSpan[b].lo);
    });
    const dLaneSorted = assignLanes(dOrder.map((k) => dSpan[k]), 4, 14);
    const dLane = new Array(m.diffs.length).fill(null);
    dOrder.forEach((k, idx) => (dLane[k] = dLaneSorted[idx]));
    dLane.forEach((l, k) => {
        if (l === null)
            warnings.push(diffWarn(m, m.diffs[k]));
    });
    const dLanes = Math.max(0, ...dLane.map((l) => (l === null ? -1 : l + 1)));
    const laneY = (l) => rowsBottom + 22 + l * 62;
    // 1. Extension lines go first, so bars sit on top of them.
    m.diffs.forEach((d, k) => {
        const l = dLane[k];
        if (l === null || l === undefined)
            return;
        body.push(line(x(d.a), yTop(d.from) + barH, x(d.a), laneY(l) + 8, DASH));
        body.push(line(x(d.b), yTop(d.to) + barH, x(d.b), laneY(l) + 8, DASH));
    });
    // 2. Baseline at the start of the value window.
    body.push(line(x(base), yTop(0) - 8, x(base), yTop(n - 1) + barH + 8, { stroke: THEME.axis, "stroke-width": 2 }));
    // 3. Connectors between consecutive bars.
    for (let i = 0; i < n - 1; i++) {
        const lv = m.rows[i].to;
        body.push(line(x(lv), yTop(i) + barH, x(lv), yTop(i + 1), { stroke: THEME.connector, "stroke-width": 1.4 }));
    }
    // 4. Bars, category labels and value labels.
    m.rows.forEach((r, i) => {
        const y0 = yTop(i);
        const cy = y0 + barH / 2;
        if (r.kind === "step") {
            const a = x(Math.min(r.from, r.to));
            const b = x(Math.max(r.from, r.to));
            const w = Math.max(2, b - a);
            body.push(rect(b - a < 2 ? a - 1 : a, y0, w, barH, { fill: toneColour(r.tone) }));
        }
        else {
            const a = x(Math.min(base, r.value));
            const b = x(Math.max(base, r.value));
            body.push(...scenarioBar(r.kind, a, y0, b - a, barH));
            if (broken && b - a > 40)
                body.push(...breakMarkH(a + 20, y0, y0 + barH));
        }
        const ls = labelLines[i];
        const lineGap = F.category + 3;
        let ly = cy + F.category * 0.35 - ((ls.length - 1) * lineGap) / 2;
        for (const l of ls) {
            body.push(text(plotX0 - 14, ly, l, { size: F.category, anchor: "end", bold: r.kind !== "step" }));
            ly += lineGap;
        }
        body.push(text(valueRight, cy + F.value * 0.35, valueText[i], { size: F.value, anchor: "end", bold: r.kind !== "step" }));
    });
    // 5. Brackets, right of the value column.
    m.groups.forEach((g, gi) => {
        const l = gLane[gi];
        if (l === null || l === undefined)
            return;
        const xb = valueRight + 14 + l * (bracketLaneW + 10);
        const ya = yTop(g.first) - 2;
        const yb = yTop(g.last) + barH + 2;
        body.push(polyline([[xb - 8, ya], [xb, ya], [xb, yb], [xb - 8, yb]], { stroke: THEME.ink2, "stroke-width": 2 }));
        const ls = groupLines[gi];
        const h = blockH(ls) - 8;
        let ty = (ya + yb) / 2 - h / 2 + F.annotation * 0.8;
        body.push(text(xb + 10, ty, ls[0], { size: F.annotation, bold: true }));
        ty += F.note + 6;
        for (const t of ls.slice(1)) {
            body.push(text(xb + 10, ty, t, { size: F.note, fill: THEME.ink2 }));
            ty += F.note + 4;
        }
    });
    // 6. Difference arrows: line, start tick, arrowhead at the target, label on a white box.
    m.diffs.forEach((d, k) => {
        const l = dLane[k];
        if (l === null || l === undefined)
            return;
        const y = laneY(l);
        const xa = x(d.a);
        const xe = x(d.b);
        const colour = annotationColour(d.tone);
        const dir = Math.sign(xe - xa) || 1;
        body.push(line(xa, y, xe - dir * 10, y, { stroke: colour, "stroke-width": 2.6 }));
        body.push(line(xa, y - 7, xa, y + 7, { stroke: colour, "stroke-width": 2.6 }));
        body.push(arrowhead(xe, y, dir, 0, 13, colour));
        body.push(...labelBox(dCx[k].cx, y + 30, d.text, F.annotation));
    });
    let bottom = rowsBottom + (dLanes ? 22 + (dLanes - 1) * 62 + 38 : 0);
    bottom += 6;
    for (const note of footerNotes(m)) {
        for (const l of wrapText(note, F.note, width - 2 * PAD)) {
            bottom += F.note + 9;
            body.push(text(PAD, bottom, l, { size: F.note, fill: THEME.muted }));
        }
    }
    return { body, height: Math.ceil(bottom + PAD), title, warnings };
}
/* ------------------------------------------------------------------ */
/* Vertical                                                            */
/* ------------------------------------------------------------------ */
function renderVertical(m, width) {
    const o = m.options;
    const { parts: head, bottom: headBottom, title } = header(m, width);
    const body = [...head];
    const warnings = [];
    const n = m.rows.length;
    const plotH = 330;
    const { min, max, broken } = m.window;
    const rel = (v) => plotH - ((v - min) / (max - min || 1)) * plotH; // y within the plot
    const base = broken ? min : 0;
    // Difference arrows to the right of the plot, one lane (column) each unless their label blocks don't overlap.
    const dLines = m.diffs.map((d) => [...(d.label ? [d.label] : []), d.valueText, ...(d.pctText ? [d.pctText] : [])]);
    const lineH = F.annotation + 4;
    const dTextW = m.diffs.length ? Math.max(...dLines.flat().map((t) => textWidth(t, F.annotation, true))) : 0;
    const laneW = 30 + dTextW;
    const maxDiffLanes = Math.max(1, Math.floor((width * 0.36) / laneW));
    const dSpan = m.diffs.map((d, k) => {
        const ya = rel(d.a);
        const yb = rel(d.b);
        const mid = (ya + yb) / 2;
        const h = dLines[k].length * lineH + 8;
        return { lo: Math.min(ya, yb, mid - h / 2), hi: Math.max(ya, yb, mid + h / 2) };
    });
    const dOrder = m.diffs.map((_, k) => k).sort((a, b) => {
        if (m.diffs[a].isGap !== m.diffs[b].isGap)
            return m.diffs[a].isGap ? -1 : 1;
        return dSpan[a].hi - dSpan[a].lo - (dSpan[b].hi - dSpan[b].lo);
    });
    const dLaneSorted = assignLanes(dOrder.map((k) => dSpan[k]), maxDiffLanes, 6);
    const dLane = new Array(m.diffs.length).fill(null);
    dOrder.forEach((k, idx) => (dLane[k] = dLaneSorted[idx]));
    dLane.forEach((l, k) => {
        if (l === null)
            warnings.push(diffWarn(m, m.diffs[k]));
    });
    const dLanes = Math.max(0, ...dLane.map((l) => (l === null ? -1 : l + 1)));
    const rightW = dLanes * laneW;
    const plotX0 = PAD + 6;
    const plotX1 = width - PAD - rightW;
    const slotW = (plotX1 - plotX0) / n;
    const colW = Math.min(110, slotW * 0.62);
    const slotX = (i) => plotX0 + i * slotW;
    const colX = (i) => slotX(i) + (slotW - colW) / 2;
    // Brackets above the columns, in stacked lanes when they (or their labels) overlap.
    const gText = m.groups.map((g) => `${g.label}: ${formatValue(g.sum, o, true)}`);
    const gSpan = m.groups.map((g, k) => {
        const xa = colX(g.first) - 4;
        const xb = colX(g.last) + colW + 4;
        const lw = textWidth(gText[k], F.note + 1, true) + 12;
        const cx = Math.min(width - PAD - lw / 2, Math.max(PAD + lw / 2, (xa + xb) / 2));
        return { lo: Math.min(xa, cx - lw / 2), hi: Math.max(xb, cx + lw / 2), cx, xa, xb };
    });
    const gOrder = m.groups.map((_, k) => k).sort((a, b) => gSpan[a].hi - gSpan[a].lo - (gSpan[b].hi - gSpan[b].lo));
    const gLaneSorted = assignLanes(gOrder.map((k) => gSpan[k]), 3, 10);
    const gLane = new Array(m.groups.length).fill(null);
    gOrder.forEach((k, idx) => (gLane[k] = gLaneSorted[idx]));
    gLane.forEach((l, k) => {
        if (l === null)
            warnings.push(`No room for the bracket "${m.groups[k].label}"; it was left out.`);
    });
    const gLanes = Math.max(0, ...gLane.map((l) => (l === null ? -1 : l + 1)));
    const groupBand = gLanes ? gLanes * 40 + 6 : 0;
    const plotTop = headBottom + groupBand + 34; // room for value labels above the tallest bar
    const plotBottom = plotTop + plotH;
    const y = (v) => plotTop + rel(v);
    const catLines = m.rows.map((r) => clampLabel(wrapText(r.label, F.note + 2, slotW - 8), 3));
    const catSize = F.note + 2;
    const dimX = (l) => plotX1 + 16 + l * laneW;
    // Extension lines first.
    m.diffs.forEach((d, k) => {
        const l = dLane[k];
        if (l === null || l === undefined)
            return;
        body.push(line(colX(d.from) + colW, y(d.a), dimX(l) + 8, y(d.a), DASH));
        body.push(line(colX(d.to) + colW, y(d.b), dimX(l) + 8, y(d.b), DASH));
    });
    body.push(line(plotX0, y(base), plotX1, y(base), { stroke: THEME.axis, "stroke-width": 2 }));
    for (let i = 0; i < n - 1; i++) {
        const lv = m.rows[i].to;
        body.push(line(colX(i) + colW, y(lv), colX(i + 1), y(lv), { stroke: THEME.connector, "stroke-width": 1.4 }));
    }
    m.rows.forEach((r, i) => {
        const x0 = colX(i);
        const cx = x0 + colW / 2;
        const label = formatValue(r.value, o, r.kind === "step");
        if (r.kind === "step") {
            const ya = y(Math.max(r.from, r.to));
            const yb = y(Math.min(r.from, r.to));
            const h = Math.max(2, yb - ya);
            body.push(rect(x0, yb - ya < 2 ? ya - 1 : ya, colW, h, { fill: toneColour(r.tone) }));
            // Label at the end the step moves to: above an increase, below a decrease.
            const ly = r.value >= 0 ? ya - 9 : yb + F.value + 3;
            body.push(text(cx, ly, label, { size: F.value, anchor: "middle" }));
        }
        else {
            const ya = y(Math.max(base, r.value));
            const yb = y(Math.min(base, r.value));
            body.push(...scenarioBar(r.kind, x0, ya, colW, yb - ya));
            if (broken && yb - ya > 40)
                body.push(...breakMarkV(x0, x0 + colW, yb - 16));
            body.push(text(cx, ya - 9, label, { size: F.value, anchor: "middle", bold: true }));
        }
        let ty = plotBottom + 14 + catSize;
        for (const l of catLines[i]) {
            body.push(text(slotX(i) + slotW / 2, ty, l, { size: catSize, anchor: "middle", bold: r.kind !== "step" }));
            ty += catSize + 3;
        }
    });
    // Brackets (lane 0 nearest the columns).
    m.groups.forEach((g, k) => {
        const l = gLane[k];
        if (l === null || l === undefined)
            return;
        const sp = gSpan[k];
        const yb = headBottom + groupBand - 4 - l * 40;
        body.push(polyline([[sp.xa, yb + 8], [sp.xa, yb], [sp.xb, yb], [sp.xb, yb + 8]], { stroke: THEME.ink2, "stroke-width": 2 }));
        body.push(...labelBox(sp.cx, yb - 9, gText[k], F.note + 1));
    });
    // Difference arrows.
    m.diffs.forEach((d, k) => {
        const l = dLane[k];
        if (l === null || l === undefined)
            return;
        const dx = dimX(l);
        const ya = y(d.a);
        const ye = y(d.b);
        const colour = annotationColour(d.tone);
        const dir = Math.sign(ye - ya) || 1;
        body.push(line(dx, ya, dx, ye - dir * 10, { stroke: colour, "stroke-width": 2.6 }));
        body.push(line(dx - 7, ya, dx + 7, ya, { stroke: colour, "stroke-width": 2.6 }));
        body.push(arrowhead(dx, ye, 0, dir, 13, colour));
        const ls = dLines[k];
        let ty = (ya + ye) / 2 - ((ls.length - 1) * lineH) / 2 + F.annotation * 0.35;
        for (const t of ls) {
            body.push(...labelBox(dx + 12, ty, t, F.annotation, true, "start"));
            ty += lineH;
        }
    });
    const maxCat = Math.max(...catLines.map((l) => l.length));
    let bottom = plotBottom + 14 + maxCat * (catSize + 3);
    bottom += 6;
    for (const note of footerNotes(m)) {
        for (const l of wrapText(note, F.note, width - 2 * PAD)) {
            bottom += F.note + 9;
            body.push(text(PAD, bottom, l, { size: F.note, fill: THEME.muted }));
        }
    }
    return { body, height: Math.ceil(bottom + PAD), title, warnings };
}
export function renderBridge(m, r = {}) {
    const width = Math.max(560, Math.round(r.width ?? 960));
    const { body, height, title, warnings } = m.options.orientation === "vertical" ? renderVertical(m, width) : renderHorizontal(m, width);
    const description = describe(m);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="ibcs-t ibcs-d">` +
        `<title id="ibcs-t">${esc(title)}</title><desc id="ibcs-d">${esc(description)}</desc>` +
        rect(0, 0, width, height, { fill: THEME.surface }) +
        body.join("") +
        `</svg>`;
    return { svg, width, height, description, title, warnings };
}
