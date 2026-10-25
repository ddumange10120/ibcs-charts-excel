/**
 * Bridge model -> Office-safe SVG string, horizontal or vertical.
 *
 * Notation (IBCS): plan = outlined, actual = solid, forecast = hatched.
 * Steps: adverse red, favourable blue, below materiality grey. Text is always ink;
 * colour is carried by marks only, so the chart still reads in greyscale (the sign
 * and the bar direction carry the same information as the colour).
 */
import { defaultSubtitle, defaultTitle, describe, formatPct, formatValue, } from "./bridge.js";
import { F, PAD, clampLabel, header as drawHeader, scenarioBar, toneColour } from "./marks.js";
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
function breakMarkV(xLeft, xRight, y) {
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
function header(m, width) {
    const title = m.options.title.trim() || defaultTitle(m);
    const subtitle = m.options.subtitle.trim() || defaultSubtitle(m);
    return { ...drawHeader(title, subtitle, width), title };
}
function footerNote(m) {
    if (!m.window.broken)
        return null;
    return `Totals are broken: the value axis starts at ${formatValue(m.window.min, m.options)}. Steps are to scale.`;
}
/* ------------------------------------------------------------------ */
/* Horizontal                                                          */
/* ------------------------------------------------------------------ */
function renderHorizontal(m, width) {
    const o = m.options;
    const { parts: head, bottom: top, title } = header(m, width);
    const body = [...head];
    const rowH = 52;
    const barH = 30;
    const n = m.rows.length;
    const labelMax = 300;
    const labelLines = m.rows.map((r) => clampLabel(wrapText(r.label, F.category, labelMax), 2));
    const labelW = Math.min(labelMax, Math.max(...labelLines.flat().map((l) => textWidth(l, F.category)))) + 14;
    const valueText = m.rows.map((r) => formatValue(r.value, o, r.kind === "step"));
    const valueW = Math.max(...valueText.map((t, i) => textWidth(t, F.value, m.rows[i].kind !== "step"))) + 8;
    const groupLabelMax = 170;
    const groupLines = m.groups.map((g) => [formatValue(g.sum, o, true), ...clampLabel(wrapText(g.label, F.note, groupLabelMax), 2)]);
    const bracketW = m.groups.length
        ? 26 + Math.max(...groupLines.map((ls) => Math.max(textWidth(ls[0], F.annotation, true), ...ls.slice(1).map((l) => textWidth(l, F.note)))))
        : 0;
    const plotX0 = PAD + labelW + 10;
    const valueRight = width - PAD - bracketW - (bracketW ? 12 : 0);
    const plotX1 = valueRight - valueW - 18;
    const { min, max, broken } = m.window;
    const x = (v) => plotX0 + ((v - min) / (max - min || 1)) * (plotX1 - plotX0);
    const base = broken ? min : 0;
    const yTop = (i) => top + i * rowH + (rowH - barH) / 2;
    const rowsBottom = top + n * rowH;
    // 1. Extension lines of the gap arrow go first, so bars sit on top of them.
    const dimY = rowsBottom + 22;
    const arrow = o.showGapArrow && Math.abs(m.gap) > 0;
    if (arrow) {
        const dash = { stroke: THEME.extension, "stroke-width": 1.4, "stroke-dasharray": "5 4" };
        body.push(line(x(m.start.value), yTop(0) + barH, x(m.start.value), dimY + 8, dash));
        body.push(line(x(m.end.value), yTop(n - 1) + barH, x(m.end.value), dimY + 8, dash));
    }
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
    // 5. Group brackets, right of the value column.
    m.groups.forEach((g, gi) => {
        const xb = valueRight + 14;
        const ya = yTop(g.first) - 2;
        const yb = yTop(g.last) + barH + 2;
        body.push(polyline([[xb - 8, ya], [xb, ya], [xb, yb], [xb - 8, yb]], { stroke: THEME.ink2, "stroke-width": 2 }));
        const ls = groupLines[gi];
        const blockH = F.annotation + (ls.length - 1) * (F.note + 4);
        let ty = (ya + yb) / 2 - blockH / 2 + F.annotation * 0.8;
        body.push(text(xb + 10, ty, ls[0], { size: F.annotation, bold: true }));
        ty += F.note + 6;
        for (const l of ls.slice(1)) {
            body.push(text(xb + 10, ty, l, { size: F.note, fill: THEME.ink2 }));
            ty += F.note + 4;
        }
    });
    // 6. Gap arrow (difference between first and last total).
    let bottom = rowsBottom;
    if (arrow) {
        const xa = x(m.start.value);
        const xe = x(m.end.value);
        const colour = toneColour(m.gapTone);
        const dir = Math.sign(xe - xa);
        body.push(line(xa, dimY, xe - dir * 10, dimY, { stroke: colour, "stroke-width": 2.6 }));
        body.push(line(xa, dimY - 7, xa, dimY + 7, { stroke: colour, "stroke-width": 2.6 }));
        body.push(arrowhead(xe, dimY, dir, 0, 13, colour));
        const label = `${formatValue(m.gap, o, true)} (${formatPct(m.gapPct)}) vs ${m.start.label}`;
        const lw = textWidth(label, F.annotation, true);
        const cx = Math.min(width - PAD - lw / 2, Math.max(PAD + lw / 2, (xa + xe) / 2));
        body.push(text(cx, dimY + 30, label, { size: F.annotation, bold: true, anchor: "middle" }));
        bottom = dimY + 30 + 8;
    }
    const note = footerNote(m);
    if (note) {
        bottom += 30;
        body.push(text(PAD, bottom, note, { size: F.note, fill: THEME.muted }));
    }
    return { body, height: Math.ceil(bottom + PAD), title };
}
/* ------------------------------------------------------------------ */
/* Vertical                                                            */
/* ------------------------------------------------------------------ */
function renderVertical(m, width) {
    const o = m.options;
    const { parts: head, bottom: headBottom, title } = header(m, width);
    const body = [...head];
    const n = m.rows.length;
    const arrow = o.showGapArrow && Math.abs(m.gap) > 0;
    const gapValue = formatValue(m.gap, o, true);
    const gapPct = `(${formatPct(m.gapPct)})`;
    const rightW = arrow ? 34 + Math.max(textWidth(gapValue, F.annotation, true), textWidth(gapPct, F.annotation, true)) : 0;
    const plotX0 = PAD + 6;
    const plotX1 = width - PAD - rightW;
    const slotW = (plotX1 - plotX0) / n;
    const colW = Math.min(110, slotW * 0.62);
    const slotX = (i) => plotX0 + i * slotW;
    const colX = (i) => slotX(i) + (slotW - colW) / 2;
    const groupBand = m.groups.length ? 46 : 0;
    const plotTop = headBottom + groupBand + 34; // room for value labels above the tallest bar
    const plotH = 330;
    const plotBottom = plotTop + plotH;
    const { min, max, broken } = m.window;
    const y = (v) => plotBottom - ((v - min) / (max - min || 1)) * plotH;
    const base = broken ? min : 0;
    const catLines = m.rows.map((r) => clampLabel(wrapText(r.label, F.note + 2, slotW - 8), 3));
    const catSize = F.note + 2;
    // Extension lines first.
    const dimX = plotX1 + 16;
    if (arrow) {
        const dash = { stroke: THEME.extension, "stroke-width": 1.4, "stroke-dasharray": "5 4" };
        body.push(line(colX(0) + colW, y(m.start.value), dimX + 8, y(m.start.value), dash));
        body.push(line(colX(n - 1) + colW, y(m.end.value), dimX + 8, y(m.end.value), dash));
    }
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
    // Group brackets above the columns.
    for (const g of m.groups) {
        const xa = colX(g.first) - 4;
        const xb = colX(g.last) + colW + 4;
        const yb = headBottom + groupBand - 4;
        body.push(polyline([[xa, yb + 8], [xa, yb], [xb, yb], [xb, yb + 8]], { stroke: THEME.ink2, "stroke-width": 2 }));
        const label = `${g.label}: ${formatValue(g.sum, o, true)}`;
        const lw = textWidth(label, F.note + 1, true);
        const cx = Math.min(width - PAD - lw / 2, Math.max(PAD + lw / 2, (xa + xb) / 2));
        body.push(text(cx, yb - 9, label, { size: F.note + 1, bold: true, anchor: "middle" }));
    }
    if (arrow) {
        const ya = y(m.start.value);
        const ye = y(m.end.value);
        const colour = toneColour(m.gapTone);
        const dir = Math.sign(ye - ya);
        body.push(line(dimX, ya, dimX, ye - dir * 10, { stroke: colour, "stroke-width": 2.6 }));
        body.push(line(dimX - 7, ya, dimX + 7, ya, { stroke: colour, "stroke-width": 2.6 }));
        body.push(arrowhead(dimX, ye, 0, dir, 13, colour));
        const mid = (ya + ye) / 2;
        body.push(text(dimX + 12, mid - 2, gapValue, { size: F.annotation, bold: true }));
        body.push(text(dimX + 12, mid + F.annotation + 2, gapPct, { size: F.annotation, bold: true }));
    }
    const maxCat = Math.max(...catLines.map((l) => l.length));
    let bottom = plotBottom + 14 + maxCat * (catSize + 3);
    const note = footerNote(m);
    if (note) {
        bottom += 30;
        for (const l of wrapText(note, F.note, width - 2 * PAD)) {
            body.push(text(PAD, bottom, l, { size: F.note, fill: THEME.muted }));
            bottom += F.note + 5;
        }
        bottom -= F.note + 5;
    }
    return { body, height: Math.ceil(bottom + PAD), title };
}
export function renderBridge(m, r = {}) {
    const width = Math.max(560, Math.round(r.width ?? 960));
    const { body, height, title } = m.options.orientation === "vertical" ? renderVertical(m, width) : renderHorizontal(m, width);
    const description = describe(m);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="ibcs-t ibcs-d">` +
        `<title id="ibcs-t">${esc(title)}</title><desc id="ibcs-d">${esc(description)}</desc>` +
        rect(0, 0, width, height, { fill: THEME.surface }) +
        body.join("") +
        `</svg>`;
    return { svg, width, height, description, title };
}
