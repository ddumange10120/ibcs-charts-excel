/**
 * IBCS column chart -> Office-safe SVG.
 *
 * Stacked panels sharing one x axis (IBCS "integrated variances"), top to bottom:
 *   ΔPL%  pin chart (relative variance, own % scale)
 *   ΔPL   variance bars (absolute variance, same scale as the main chart by default)
 *   main  AC solid / FC hatched columns, PL as an outlined column behind (or a tick)
 * Colour marks exceptions only: red adverse, blue favourable beyond ±materiality, grey within.
 */
import { pctToneOf } from "./columns.js";
import { assignLanes } from "./annotations.js";
import { formatPct, roundTo } from "./bridge.js";
import { F, PAD, annotationColour, clampLabel, header, labelBox, scenarioBar, tolerancePct, toneColour } from "./marks.js";
import { THEME, arrowhead, esc, line, polyline, rect, text } from "./svg.js";
import { textWidth, wrapText } from "./text.js";
const num = (v, d, signed = false) => {
    const r = roundTo(v, d);
    const body = Math.abs(r).toFixed(d);
    if (r < 0)
        return `−${body}`;
    return signed && r > 0 ? `+${body}` : body;
};
export function defaultColumnTitle(m) {
    const o = m.options;
    const t = m.totals;
    const kinds = new Set(m.periods.map((p) => p.kind));
    const name = kinds.size === 2 ? "AC + FC" : kinds.has("actual") ? "AC" : "FC";
    if (t.plan === null || t.delta === null)
        return `${name} ${num(t.value, o.decimals)} ${o.units}`.trim();
    return `${name} ${num(t.value, o.decimals)} vs PL ${num(t.plan, o.decimals)} ${o.units}: ${num(t.delta, o.decimals, true)} (${t.deltaPct === null ? "n/a" : formatPct(t.deltaPct)})`;
}
export function defaultColumnSubtitle(m) {
    return `${m.options.units ? `${m.options.units} ` : ""}by period, ${m.periods[0].label} to ${m.periods[m.periods.length - 1].label}`;
}
export function describeColumns(m) {
    const o = m.options;
    const parts = m.periods.map((p) => {
        const base = `${p.label} ${p.kind === "actual" ? "AC" : "FC"} ${num(p.value, o.decimals)}`;
        return p.plan === null ? base : `${base}, PL ${num(p.plan, o.decimals)}, ${p.deltaPct === null ? "" : formatPct(p.deltaPct)}`.replace(/, $/, "");
    });
    return `Column chart, ${o.units}. ${parts.join("; ")}.`;
}
export function renderColumns(m, r = {}) {
    const width = Math.max(560, Math.round(r.width ?? 960));
    const o = m.options;
    const n = m.periods.length;
    const title = o.title.trim() || defaultColumnTitle(m);
    const subtitle = o.subtitle.trim() || defaultColumnSubtitle(m);
    const head = header(title, subtitle, width);
    const body = [...head.parts];
    const notes = [];
    // ---- horizontal geometry
    const gutter = 76; // panel names on the left
    const x0 = PAD + gutter;
    const x1 = width - PAD - 6;
    const slotW = (x1 - x0) / n;
    const colW = Math.min(64, slotW * (o.planStyle === "column" && m.hasPlan ? 0.5 : 0.62));
    const planOffset = colW * 0.34;
    const groupW = o.planStyle === "column" && m.hasPlan ? colW + planOffset : colW;
    const slotX = (i) => x0 + i * slotW;
    const colX = (i) => slotX(i) + (slotW - groupW) / 2; // AC/FC column left edge
    const centre = (i) => colX(i) + colW / 2;
    const dense = slotW < 58;
    const labelSize = slotW < 44 ? 15 : slotW < 58 ? 17 : 19;
    const pctDecimals = dense ? 0 : 1;
    const labelAll = slotW >= 46; // narrow slots: label exceptions only (IBCS: emphasise what matters)
    // ---- legend row
    let y = head.bottom + 6; // legend baseline, clear of the subtitle
    {
        let lx = PAD;
        const items = [];
        if (m.periods.some((p) => p.kind === "actual"))
            items.push(["actual", "Actual (AC)"]);
        if (m.periods.some((p) => p.kind === "forecast"))
            items.push(["forecast", "Forecast (FC)"]);
        if (m.hasPlan)
            items.push(["plan", "Plan (PL)"]);
        for (const [k, label] of items) {
            if (k === "plan" && o.planStyle === "marker") {
                body.push(line(lx, y - 6, lx + 24, y - 6, { stroke: THEME.ink, "stroke-width": 3 }));
            }
            else {
                body.push(...scenarioBar(k, lx, y - 15, 24, 16));
            }
            body.push(text(lx + 32, y, label, { size: F.note }));
            lx += 32 + textWidth(label, F.note) + 26;
        }
        y += 22;
    }
    // ---- value scale of the main chart
    const values = m.periods.flatMap((p) => (p.plan === null ? [p.value] : [p.value, p.plan]));
    const dataMax = Math.max(0, ...values);
    const dataMin = Math.min(0, ...values);
    let vMax = dataMax;
    if (o.axisMax > 0) {
        if (o.axisMax < dataMax)
            notes.push(`Axis maximum ${o.axisMax} is below the data (${num(dataMax, o.decimals)}); the data maximum is used.`);
        else {
            vMax = o.axisMax;
            notes.push(`Value axis fixed at ${num(dataMin, o.decimals)} to ${num(o.axisMax, o.decimals)} ${o.units} so charts can be compared.`.replace(/ +\./, "."));
        }
    }
    const mainH = 250;
    const ppuMain = mainH / (vMax - dataMin || 1);
    // ---- ΔPL% pins
    const withPct = m.periods.filter((p) => p.deltaPct !== null);
    const pinsOn = o.showPctPins && withPct.length > 0;
    const barsOn = o.showVarianceBars && m.periods.some((p) => p.delta !== null);
    const labelPad = labelSize + 10;
    const panelLabel = (yMid, label) => {
        body.push(text(x0 - 14, yMid + F.note * 0.35, label, { size: F.note, bold: true, anchor: "end", fill: THEME.ink2 }));
    };
    const pinTop = y + 8;
    let pinBottom = pinTop;
    const pinMarks = [];
    if (pinsOn) {
        const hi = Math.max(0, ...withPct.map((p) => p.deltaPct));
        const lo = Math.min(0, ...withPct.map((p) => p.deltaPct));
        const pinH = 84;
        const ppu = pinH / (hi - lo || 1);
        const zeroY = pinTop + labelPad + hi * ppu;
        pinBottom = zeroY + -lo * ppu + labelPad;
        pinMarks.push(line(x0, zeroY, x1, zeroY, { stroke: THEME.axis, "stroke-width": 1.6 }));
        m.periods.forEach((p, i) => {
            if (p.deltaPct === null)
                return;
            const cx = centre(i);
            const yEnd = zeroY - p.deltaPct * ppu;
            const c = toneColour(p.tone);
            pinMarks.push(line(cx, zeroY, cx, yEnd, { stroke: c, "stroke-width": 3 }));
            pinMarks.push(rect(cx - 5, yEnd - 5, 10, 10, { fill: c }));
            // Label exceptions always; label in-tolerance pins only when there is room and the value is not 0.
            if (p.tone !== "neutral" || (labelAll && roundTo(p.deltaPct, pctDecimals) !== 0)) {
                const ly = p.deltaPct >= 0 ? yEnd - 10 : yEnd + labelSize + 6;
                pinMarks.push(text(cx, ly, formatPct(p.deltaPct, pctDecimals), { size: labelSize - 1, anchor: "middle", bold: p.tone !== "neutral" }));
            }
        });
        panelLabel(zeroY, "ΔPL%");
    }
    // ---- ΔPL bars
    const barTop = pinsOn ? pinBottom + 6 : y + 8;
    let barBottom = barTop;
    const barMarks = [];
    if (barsOn) {
        const deltas = m.periods.filter((p) => p.delta !== null).map((p) => p.delta);
        const hi = Math.max(0, ...deltas);
        const lo = Math.min(0, ...deltas);
        let ppu = ppuMain;
        if (o.varianceScale === "own") {
            ppu = 84 / (hi - lo || 1);
            const k = ppu / ppuMain;
            if (k > 1.05)
                notes.push(`ΔPL bars are magnified ×${k >= 10 ? Math.round(k) : k.toFixed(1)} against the main chart.`);
        }
        const zeroY = barTop + labelPad + hi * ppu;
        barBottom = zeroY + -lo * ppu + labelPad;
        barMarks.push(line(x0, zeroY, x1, zeroY, { stroke: THEME.axis, "stroke-width": 1.6 }));
        m.periods.forEach((p, i) => {
            if (p.delta === null)
                return;
            const xa = colX(i);
            const h = Math.abs(p.delta) * ppu;
            const yA = p.delta >= 0 ? zeroY - h : zeroY;
            barMarks.push(rect(xa, h < 2 ? zeroY - 1 : yA, colW, Math.max(2, h), { fill: toneColour(p.tone) }));
            if (p.tone !== "neutral" || (labelAll && roundTo(p.delta, o.decimals) !== 0)) {
                const ly = p.delta >= 0 ? zeroY - h - 8 : zeroY + h + labelSize + 4;
                barMarks.push(text(centre(i), ly, num(p.delta, o.decimals, true), { size: labelSize - 1, anchor: "middle", bold: p.tone !== "neutral" }));
            }
        });
        panelLabel(zeroY, "ΔPL");
    }
    // ---- annotation band: between the variance panels and the columns, so arrows and
    // brackets never cross a panel, the legend or a value label. Lanes stack upwards.
    const annTop = (barsOn ? barBottom : pinsOn ? pinBottom : y) + 4;
    const annSize = F.note + 1;
    const warnings = [];
    const anns = m.annotations.map((a) => {
        const lo = Math.min(a.i, a.j);
        const hi = Math.max(a.i, a.j);
        let txt;
        let tone = "neutral";
        let xa;
        let xb;
        if (a.spec.type === "diff") {
            const pa = m.periods[a.i];
            const pb = m.periods[a.j];
            const d = pb.value - pa.value;
            const pct = pa.value === 0 ? null : (d / Math.abs(pa.value)) * 100;
            tone = pctToneOf(pct, o);
            txt = `${a.spec.label ?? `${pb.label} vs ${pa.label}`}: ${num(d, o.decimals, true)}${pct === null ? "" : ` (${formatPct(pct)})`}`;
            xa = centre(a.i);
            xb = centre(a.j);
        }
        else {
            const run = m.periods.slice(lo, hi + 1);
            const sum = run.reduce((acc, p) => acc + p.value, 0);
            const plan = run.every((p) => p.plan !== null) ? run.reduce((acc, p) => acc + p.plan, 0) : null;
            const pct = plan === null || plan === 0 ? null : ((sum - plan) / Math.abs(plan)) * 100;
            txt = `${a.spec.label ?? `${run[0].label}\u2013${run[run.length - 1].label}`}: ${num(sum, o.decimals)}${pct === null ? "" : ` (${formatPct(pct)} vs PL)`}`;
            xa = colX(lo) - 2;
            xb = colX(hi) + groupW + 2;
        }
        const lw = textWidth(txt, annSize, true) + 12;
        const cx = Math.min(width - PAD - lw / 2, Math.max(PAD + lw / 2, (xa + xb) / 2));
        return { a, txt, tone, xa, xb, cx, span: { lo: Math.min(xa, xb, cx - lw / 2), hi: Math.max(xa, xb, cx + lw / 2) } };
    });
    const order = anns.map((_, k) => k).sort((p, q) => anns[p].span.hi - anns[p].span.lo - (anns[q].span.hi - anns[q].span.lo));
    const laneSorted = assignLanes(order.map((k) => anns[k].span), 4, 12); // MAX_LANES
    const lane = new Array(anns.length).fill(null);
    order.forEach((k, idx) => (lane[k] = laneSorted[idx]));
    lane.forEach((l, k) => {
        if (l === null)
            warnings.push(`No room for annotation ${anns[k].a.n} (${anns[k].txt}); it was left out. Remove one or use fewer overlapping annotations.`);
    });
    // Leaders of arrows in higher lanes drop through the lanes below, and a label box there
    // would hide them. Fix each conflict by (1) sliding the box sideways, staying over its own
    // line, or (2) moving that annotation up above the arrow whose leader it hits. Warn if neither works.
    const MAX_LANES = 4;
    const boxW = anns.map((an) => textWidth(an.txt, annSize, true) + 12);
    const spanAt = (k, cx) => {
        const an = anns[k];
        return { lo: Math.min(an.xa, an.xb, cx - boxW[k] / 2), hi: Math.max(an.xa, an.xb, cx + boxW[k] / 2) };
    };
    const fits = (k, l, sp) => anns.every((_, k2) => k2 === k || lane[k2] !== l || sp.hi + 12 <= anns[k2].span.lo || sp.lo >= anns[k2].span.hi + 12);
    const leadersAbove = (l) => anns.flatMap((o2, k2) => {
        const l2 = lane[k2];
        return l2 !== null && l2 !== undefined && l2 > l && o2.a.spec.type === "diff" ? [{ x: o2.xa, lane: l2 }, { x: o2.xb, lane: l2 }] : [];
    });
    const hits = (k, cx, l) => leadersAbove(l).filter((ld) => ld.x >= cx - boxW[k] / 2 - 8 && ld.x <= cx + boxW[k] / 2 + 8);
    const unresolved = new Set();
    for (let pass = 0; pass < 12; pass++) {
        let moved = false;
        unresolved.clear();
        for (let k = 0; k < anns.length; k++) {
            const l = lane[k];
            if (l === null || l === undefined)
                continue;
            const an = anns[k];
            const hit = hits(k, an.cx, l);
            if (!hit.length)
                continue;
            // (1) slide
            const lo = Math.min(an.xa, an.xb);
            const hi = Math.max(an.xa, an.xb);
            const slide = leadersAbove(l)
                .flatMap((ld) => [ld.x - 8 - boxW[k] / 2 - 1, ld.x + 8 + boxW[k] / 2 + 1])
                .filter((cx) => cx >= lo && cx <= hi && cx - boxW[k] / 2 >= PAD && cx + boxW[k] / 2 <= width - PAD)
                .filter((cx) => !hits(k, cx, l).length && fits(k, l, spanAt(k, cx)))
                .sort((p1, p2) => Math.abs(p1 - an.cx) - Math.abs(p2 - an.cx));
            if (slide.length) {
                an.cx = slide[0];
                an.span = spanAt(k, an.cx);
                continue;
            }
            // (2) move above the highest arrow it collides with
            const above = Math.max(...hit.map((h) => h.lane)) + 1;
            let target = null;
            for (let l2 = above; l2 < MAX_LANES; l2++)
                if (fits(k, l2, an.span)) {
                    target = l2;
                    break;
                }
            if (target !== null) {
                lane[k] = target;
                moved = true;
                break;
            }
            unresolved.add(k);
        }
        if (!moved)
            break;
    }
    for (const k of unresolved) {
        warnings.push(`The label of annotation ${anns[k].a.n} (${anns[k].txt}) overlaps another arrow's line; there was no free spot. Remove an annotation if it reads badly.`);
    }
    const lanes = Math.max(0, ...lane.map((l) => (l === null ? -1 : l + 1)));
    const laneH = 40;
    const bandH = lanes ? lanes * laneH + 6 : 0;
    const laneY = (l) => annTop + bandH - 22 - l * laneH;
    // ---- main chart
    const mainTop = annTop - 4 + bandH + labelSize + 14;
    const yv = (v) => mainTop + (vMax - v) * ppuMain;
    const zero = yv(0);
    const mainMarks = [];
    const clearTop = []; // highest ink above each column (value label, column or plan), for annotation leaders
    m.periods.forEach((p, i) => {
        const xa = colX(i);
        if (p.plan !== null && o.planStyle === "column") {
            // Plan behind, shifted right (IBCS overlapping columns: the reference scenario sits in the background).
            const top = yv(Math.max(0, p.plan));
            mainMarks.push(...scenarioBar("plan", xa + planOffset, top, colW, Math.abs(yv(p.plan) - zero)));
        }
        const top = yv(Math.max(0, p.value));
        const h = Math.abs(yv(p.value) - zero);
        mainMarks.push(...scenarioBar(p.kind, xa, top, colW, h));
        if (p.plan !== null && o.planStyle === "marker") {
            mainMarks.push(line(xa - 5, yv(p.plan), xa + colW + 5, yv(p.plan), { stroke: THEME.ink, "stroke-width": 3 }));
        }
        // Label above whichever is taller, AC/FC or the plan behind it, so it never sits on the plan outline.
        const vy = p.value >= 0 ? Math.min(top, p.plan !== null ? yv(Math.max(0, p.plan)) : top) - 8 : yv(p.value) + labelSize + 4;
        mainMarks.push(text(centre(i), vy, num(p.value, o.decimals), { size: labelSize, anchor: "middle" }));
        clearTop[i] = Math.min(top, p.plan !== null ? yv(Math.max(0, p.plan)) : top, p.value >= 0 ? vy - labelSize : top) - 6;
    });
    mainMarks.push(line(x0, zero, x1, zero, { stroke: THEME.axis, "stroke-width": 2 }));
    const mainBottom = yv(Math.min(0, dataMin));
    panelLabel((mainTop + zero) / 2, "AC/FC");
    // ---- AC | FC separator across all panels
    if (m.firstForecast > 0) {
        const sx = slotX(m.firstForecast);
        body.push(line(sx, y + 4, sx, mainBottom + 4, { stroke: THEME.extension, "stroke-width": 1.4, "stroke-dasharray": "5 4" }));
    }
    body.push(...pinMarks, ...barMarks, ...mainMarks);
    // ---- annotations: lines first, label boxes last (so a leader passing behind a label never runs through its text)
    const annBoxes = [];
    anns.forEach((an, k) => {
        const l = lane[k];
        if (l === null || l === undefined)
            return;
        const ly = laneY(l);
        if (an.a.spec.type === "diff") {
            const c = annotationColour(an.tone);
            const yA = clearTop[an.a.i];
            const yB = clearTop[an.a.j];
            body.push(line(an.xa, ly, an.xa, yA, { stroke: c, "stroke-width": 2 }));
            body.push(line(an.xa, ly, an.xb, ly, { stroke: c, "stroke-width": 2 }));
            body.push(line(an.xb, ly, an.xb, yB - 10, { stroke: c, "stroke-width": 2 }));
            body.push(arrowhead(an.xb, yB, 0, 1, 12, c));
            annBoxes.push(...labelBox(an.cx, ly + annSize * 0.35, an.txt, annSize));
        }
        else {
            // Bracket: the line sits under its label, so a label wider than the bracket can never hide it.
            body.push(polyline([[an.xa, ly + 18], [an.xa, ly + 9], [an.xb, ly + 9], [an.xb, ly + 18]], { stroke: THEME.ink2, "stroke-width": 2 }));
            annBoxes.push(...labelBox(an.cx, ly + 1, an.txt, annSize));
        }
    });
    body.push(...annBoxes);
    // ---- period labels
    let catBottom = mainBottom;
    const catSize = Math.min(F.category - 2, labelSize);
    m.periods.forEach((p, i) => {
        let ty = mainBottom + 12 + catSize;
        for (const l of clampLabel(wrapText(p.label, catSize, slotW - 4), 2)) {
            body.push(text(slotX(i) + slotW / 2, ty, l, { size: catSize, anchor: "middle" }));
            catBottom = Math.max(catBottom, ty);
            ty += catSize + 3;
        }
    });
    // ---- footnotes
    let bottom = catBottom + 8;
    if (m.hasPlan)
        notes.unshift(`Grey = within ${tolerancePct(o.materialityPct)} of plan. Red/blue = beyond it.`);
    for (const nline of notes) {
        for (const l of wrapText(nline, F.note, width - 2 * PAD)) {
            bottom += F.note + 9;
            body.push(text(PAD, bottom, l, { size: F.note, fill: THEME.muted }));
        }
    }
    const height = Math.ceil(bottom + PAD);
    const description = describeColumns(m);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="ibcs-t ibcs-d">` +
        `<title id="ibcs-t">${esc(title)}</title><desc id="ibcs-d">${esc(description)}</desc>` +
        rect(0, 0, width, height, { fill: THEME.surface }) +
        body.join("") +
        `</svg>`;
    return { svg, width, height, description, title, warnings };
}
