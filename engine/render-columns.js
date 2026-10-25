/**
 * IBCS column chart -> Office-safe SVG.
 *
 * Stacked panels sharing one x axis (IBCS "integrated variances"), top to bottom:
 *   ΔPL%  pin chart (relative variance)
 *   ΔPL   variance bars (absolute variance, same scale as the main chart by default)
 *   band  difference arrows and brackets (Stage B), in lanes
 *   main  AC solid / FC hatched columns, PL as an outlined column behind (or a tick)
 * Optional total column at the right, drawn with an axis break (Stage C), and a scale
 * indicator when the chart shares a named scale with other charts.
 * Colour marks exceptions only: red adverse, blue favourable beyond ±tolerance, grey within.
 */
import { pctToneOf } from "./columns.js";
import { assignLanes } from "./annotations.js";
import { formatPct, roundTo } from "./bridge.js";
import { F, PAD, annotationColour, breakMarkV, clampLabel, header, labelBox, niceStep, scenarioBar, scenarioLegend, tolerancePct, toneColour, } from "./marks.js";
import { THEME, arrowhead, esc, line, polygon, polyline, rect, text } from "./svg.js";
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
/** One-line summary used as the panel subtitle in small multiples. */
export function compactSummary(m) {
    const o = m.options;
    const t = m.totals;
    if (t.plan === null || t.delta === null)
        return `${num(t.value, o.decimals)} ${o.units}`.trim();
    return `${num(t.value, o.decimals)} vs PL ${num(t.plan, o.decimals)}: ${num(t.delta, o.decimals, true)} (${t.deltaPct === null ? "n/a" : formatPct(t.deltaPct)})`;
}
export function describeColumns(m) {
    const o = m.options;
    const bars = [...m.periods, ...(m.total ? [m.total] : [])];
    const parts = bars.map((p) => {
        const base = `${p.label} ${p.kind === "actual" ? "AC" : "FC"} ${num(p.value, o.decimals)}`;
        return p.plan === null ? base : `${base}, PL ${num(p.plan, o.decimals)}, ${p.deltaPct === null ? "" : formatPct(p.deltaPct)}`.replace(/, $/, "");
    });
    return `Column chart, ${o.units}. ${parts.join("; ")}.`;
}
/** Horizontal break mark across a thin variance bar (zig-zag gap). */
function breakMarkBar(xLeft, xRight, y) {
    return [
        polygon([[xLeft - 3, y + 3], [xRight + 3, y - 3], [xRight + 3, y - 9], [xLeft - 3, y - 3]], { fill: THEME.surface }),
        line(xLeft - 3, y + 3, xRight + 3, y - 3, { stroke: THEME.ink, "stroke-width": 1.4 }),
        line(xLeft - 3, y - 3, xRight + 3, y - 9, { stroke: THEME.ink, "stroke-width": 1.4 }),
    ];
}
export function renderColumns(m, r = {}) {
    const width = Math.max(compactMin(r), Math.round(r.width ?? 960));
    const o = m.options;
    const compact = r.compact === true;
    const bars = [...m.periods, ...(m.total ? [m.total] : [])];
    const nP = m.periods.length;
    const n = bars.length;
    const hasTotal = m.total !== null;
    const title = o.title.trim() || (compact ? "" : defaultColumnTitle(m));
    const subtitle = o.subtitle.trim() || (compact ? compactSummary(m) : defaultColumnSubtitle(m));
    const notes = [];
    const warnings = [];
    const body = [];
    // ---- header
    let y;
    if (compact) {
        // Panel header: entity name + one-line summary.
        let ty = 6 + F.subtitle;
        for (const l of wrapText(title, F.subtitle, width - 2 * PAD, true)) {
            body.push(text(PAD, ty, l, { size: F.subtitle, bold: true }));
            ty += F.subtitle + 5;
        }
        body.push(text(PAD, ty + 1, subtitle, { size: F.note, fill: THEME.ink2 }));
        y = ty + 12;
    }
    else {
        const head = header(title, subtitle, width);
        body.push(...head.parts);
        y = head.bottom + 6; // legend baseline, clear of the subtitle
        const items = [];
        if (m.periods.some((p) => p.kind === "actual"))
            items.push("actual");
        if (m.periods.some((p) => p.kind === "forecast"))
            items.push("forecast");
        if (m.hasPlan)
            items.push("plan");
        body.push(...scenarioLegend(items, PAD, y, o.planStyle === "marker"));
        y += 22;
    }
    // ---- horizontal geometry (the total column sits after a half-slot gap)
    const gutter = 76; // panel names on the left
    const x0 = PAD + gutter;
    const x1 = width - PAD - 6;
    const slotW = (x1 - x0) / (n + (hasTotal ? 0.5 : 0));
    const colW = Math.min(64, slotW * (o.planStyle === "column" && m.hasPlan ? 0.5 : 0.62));
    const planOffset = colW * 0.34;
    const groupW = o.planStyle === "column" && m.hasPlan ? colW + planOffset : colW;
    const slotX = (i) => x0 + i * slotW + (hasTotal && i === nP ? slotW * 0.5 : 0);
    const colX = (i) => slotX(i) + (slotW - groupW) / 2; // AC/FC column left edge
    const centre = (i) => colX(i) + colW / 2;
    const dense = slotW < 58;
    const labelSize = slotW < 44 ? 15 : slotW < 58 ? 17 : 19;
    // Label polish: shrink the variance labels (down to 15 px) before dropping a decimal, then shrink further (to 13 px).
    let pctDecimals = dense ? 0 : 1;
    const pctTexts = (d) => bars.filter((p) => p.deltaPct !== null).map((p) => formatPct(p.deltaPct, d));
    // A coloured variance that rounds to 0 ("0.0") says nothing: show one more decimal for the ΔPL labels.
    let deltaDecimals = o.decimals;
    while (deltaDecimals < 3 && bars.some((p) => p.delta !== null && p.tone !== "neutral" && roundTo(p.delta, deltaDecimals) === 0))
        deltaDecimals++;
    const varTexts = (d) => [...pctTexts(d), ...bars.filter((p) => p.delta !== null).map((p) => num(p.delta, deltaDecimals, true))];
    const widest = (d, size) => Math.max(0, ...varTexts(d).map((t) => textWidth(t, size, true)));
    let varSize = labelSize - 1;
    while (varSize > 15 && widest(pctDecimals, varSize) > slotW - 4)
        varSize--;
    if (pctDecimals === 1 && widest(1, varSize) > slotW - 4)
        pctDecimals = 0;
    // Never let a coloured % round onto the tolerance (+2.2% shown as "+2%" with ±2% would read as within it).
    if (pctDecimals === 0 && bars.some((p) => p.deltaPct !== null && p.tone !== "neutral" && Math.abs(roundTo(p.deltaPct, 0)) <= o.materialityPct))
        pctDecimals = 1;
    while (varSize > 13 && widest(pctDecimals, varSize) > slotW - 4)
        varSize--;
    const labelAll = slotW >= 46; // narrow slots: label exceptions only (IBCS: emphasise what matters)
    // ---- value scale of the main chart (periods only: the total is drawn broken)
    const values = m.periods.flatMap((p) => (p.plan === null ? [p.value] : [p.value, p.plan]));
    const dataMax = Math.max(0, ...values);
    const dataMin = Math.min(0, ...values);
    let vMax = dataMax;
    const shared = o.scaleName.trim();
    if (o.axisMax > 0) {
        if (o.axisMax < dataMax)
            notes.push(`Axis maximum ${o.axisMax} is below the data (${num(dataMax, o.decimals)}); the data maximum is used.`);
        else {
            vMax = o.axisMax;
            if (!shared)
                notes.push(`Value axis fixed at ${num(dataMin, o.decimals)} to ${num(o.axisMax, o.decimals)} ${o.units} so charts can be compared.`.replace(/ +\./, "."));
        }
    }
    const mainH = 250;
    const ppuMain = mainH / (vMax - dataMin || 1);
    const withPct = bars.filter((p) => p.deltaPct !== null);
    const pinsOn = o.showPctPins && withPct.length > 0;
    const barsOn = o.showVarianceBars && bars.some((p) => p.delta !== null);
    const labelPad = labelSize + 10;
    const panelLabel = (yMid, label) => {
        body.push(text(x0 - 14, yMid + F.note * 0.35, label, { size: F.note, bold: true, anchor: "end", fill: THEME.ink2 }));
    };
    // ---- ΔPL% pins (the total's % is comparable with the months, so it shares the scale)
    const pinTop = y + 8;
    let pinBottom = pinTop;
    const pinMarks = [];
    if (pinsOn) {
        let hi = Math.max(0, ...withPct.map((p) => p.deltaPct));
        let lo = Math.min(0, ...withPct.map((p) => p.deltaPct));
        if (o.pinRange) {
            lo = Math.min(lo, o.pinRange[0]);
            hi = Math.max(hi, o.pinRange[1]);
        }
        const pinH = 84;
        const ppu = pinH / (hi - lo || 1);
        const zeroY = pinTop + labelPad + hi * ppu;
        pinBottom = zeroY + -lo * ppu + labelPad;
        pinMarks.push(line(x0, zeroY, x1, zeroY, { stroke: THEME.axis, "stroke-width": 1.6 }));
        bars.forEach((p, i) => {
            if (p.deltaPct === null)
                return;
            const cx = centre(i);
            const yEnd = zeroY - p.deltaPct * ppu;
            const c = toneColour(p.tone);
            pinMarks.push(line(cx, zeroY, cx, yEnd, { stroke: c, "stroke-width": 3 }));
            pinMarks.push(rect(cx - 5, yEnd - 5, 10, 10, { fill: c }));
            // Label exceptions and the total always; in-tolerance pins only when there is room and the value is not 0.
            if (p.tone !== "neutral" || p.isTotal || (labelAll && roundTo(p.deltaPct, pctDecimals) !== 0)) {
                const ly = p.deltaPct >= 0 ? yEnd - 10 : yEnd + labelSize + 6;
                pinMarks.push(text(cx, ly, formatPct(p.deltaPct, pctDecimals), { size: varSize, anchor: "middle", bold: p.tone !== "neutral" || p.isTotal === true }));
            }
        });
        panelLabel(zeroY, "ΔPL%");
    }
    // ---- ΔPL bars (periods set the scale; a total that does not fit is drawn broken)
    const barTop = pinsOn ? pinBottom + 6 : y + 8;
    let barBottom = barTop;
    const barMarks = [];
    if (barsOn) {
        const deltas = m.periods.filter((p) => p.delta !== null).map((p) => p.delta);
        let hi = Math.max(0, ...deltas);
        let lo = Math.min(0, ...deltas);
        if (o.deltaRange) {
            lo = Math.min(lo, o.deltaRange[0]);
            hi = Math.max(hi, o.deltaRange[1]);
        }
        if (m.total?.delta != null && deltas.length === 0) {
            hi = Math.max(hi, m.total.delta);
            lo = Math.min(lo, m.total.delta);
        }
        let ppu = ppuMain;
        if (o.varianceScale === "own") {
            ppu = 84 / (hi - lo || 1);
            const k = ppu / ppuMain;
            if (k > 1.05)
                notes.push(`ΔPL bars are magnified ×${k >= 10 ? Math.round(k) : k.toFixed(1)} against the main chart.`);
        }
        // Room for a broken total bar: at least 26 px beyond the range on its side.
        const totalDelta = m.total?.delta ?? null;
        const extraUp = totalDelta !== null && totalDelta > hi ? 26 : 0;
        const extraDown = totalDelta !== null && totalDelta < lo ? 26 : 0;
        const zeroY = barTop + labelPad + extraUp + hi * ppu;
        barBottom = zeroY + -lo * ppu + extraDown + labelPad;
        barMarks.push(line(x0, zeroY, x1, zeroY, { stroke: THEME.axis, "stroke-width": 1.6 }));
        bars.forEach((p, i) => {
            if (p.delta === null)
                return;
            const xa = colX(i);
            const limit = p.delta >= 0 ? hi * ppu + extraUp : -lo * ppu + extraDown;
            const full = Math.abs(p.delta) * ppu;
            const broken = full > limit + 0.5;
            const h = broken ? limit : full;
            const yA = p.delta >= 0 ? zeroY - h : zeroY;
            barMarks.push(rect(xa, h < 2 ? zeroY - 1 : yA, colW, Math.max(2, h), { fill: toneColour(p.tone) }));
            if (broken)
                barMarks.push(...breakMarkBar(xa, xa + colW, p.delta >= 0 ? zeroY - h * 0.45 : zeroY + h * 0.55));
            if (p.tone !== "neutral" || p.isTotal || (labelAll && roundTo(p.delta, deltaDecimals) !== 0)) {
                const ly = p.delta >= 0 ? zeroY - h - 8 : zeroY + h + labelSize + 4;
                barMarks.push(text(centre(i), ly, num(p.delta, deltaDecimals, true), { size: varSize, anchor: "middle", bold: p.tone !== "neutral" || p.isTotal === true }));
            }
        });
        panelLabel(zeroY, "ΔPL");
    }
    // ---- annotation band: between the variance panels and the columns, so arrows and
    // brackets never cross a panel, the legend or a value label. Lanes stack upwards.
    const annTop = (barsOn ? barBottom : pinsOn ? pinBottom : y) + 4;
    const annSize = F.note + 1;
    const anns = m.annotations.map((a) => {
        const lo = Math.min(a.i, a.j);
        const hi = Math.max(a.i, a.j);
        let txt;
        let tone = "neutral";
        let xa;
        let xb;
        if (a.spec.type === "diff") {
            const pa = bars[a.i];
            const pb = bars[a.j];
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
            txt = `${a.spec.label ?? `${run[0].label}–${run[run.length - 1].label}`}: ${num(sum, o.decimals)}${pct === null ? "" : ` (${formatPct(pct)} vs PL)`}`;
            xa = colX(lo) - 2;
            xb = colX(hi) + groupW + 2;
        }
        const lw = textWidth(txt, annSize, true) + 12;
        const cx = Math.min(width - PAD - lw / 2, Math.max(PAD + lw / 2, (xa + xb) / 2));
        return { a, txt, tone, xa, xb, cx, span: { lo: Math.min(xa, xb, cx - lw / 2), hi: Math.max(xa, xb, cx + lw / 2) } };
    });
    const MAX_LANES = 4;
    const order = anns.map((_, k) => k).sort((p, q) => anns[p].span.hi - anns[p].span.lo - (anns[q].span.hi - anns[q].span.lo));
    const laneSorted = assignLanes(order.map((k) => anns[k].span), MAX_LANES, 12);
    const lane = new Array(anns.length).fill(null);
    order.forEach((k, idx) => (lane[k] = laneSorted[idx]));
    lane.forEach((l, k) => {
        if (l === null)
            warnings.push(`No room for annotation ${anns[k].a.n} (${anns[k].txt}); it was left out. Remove one or use fewer overlapping annotations.`);
    });
    // Leaders of arrows in higher lanes drop through the lanes below, and a label box there
    // would hide them. Fix each conflict by (1) sliding the box sideways, staying over its own
    // line, or (2) moving that annotation up above the arrow whose leader it hits. Warn if neither works.
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
    // Label polish: shrink value labels to fit the slot (down to 13 px); if they still collide, label every other period.
    // Small values (all below 1) get one more decimal, so 0.30 and 0.34 do not both read "0.3".
    const valueDecimals = o.decimals < 2 && m.periods.every((p) => Math.abs(p.value) < 1) ? o.decimals + 1 : o.decimals;
    const valueText = bars.map((p) => num(p.value, p.isTotal ? o.decimals : valueDecimals));
    let mainLabelSize = labelSize;
    while (mainLabelSize > 13 && Math.max(...valueText.map((t) => textWidth(t, mainLabelSize))) > slotW - 4)
        mainLabelSize--;
    const thin = Math.max(...valueText.map((t) => textWidth(t, mainLabelSize))) > slotW - 4;
    if (thin)
        notes.push("Every other period is labelled: the columns are too narrow for all values. Widen the picture or show fewer periods for all of them.");
    const mainTop = annTop - 4 + bandH + mainLabelSize + 14;
    const yv = (v) => mainTop + (vMax - v) * ppuMain;
    const zero = yv(0);
    const mainMarks = [];
    const clearTop = []; // highest ink above each column (value label, column or plan), for annotation leaders
    const totalLabels = [];
    bars.forEach((p, i) => {
        const xa = colX(i);
        let shownValue = p.value;
        let shownPlan = p.plan;
        let broken = false;
        if (p.isTotal) {
            // Total column: cut the same amount from AC+FC and PL so the top part (their difference) stays to scale.
            const top = Math.max(p.value, p.plan ?? p.value);
            if (top > vMax * 0.98) {
                const cut = top - vMax * 0.95;
                shownValue = Math.max(vMax * 0.12, p.value - cut);
                shownPlan = p.plan === null ? null : Math.max(vMax * 0.12, p.plan - cut);
                broken = true;
            }
        }
        if (shownPlan !== null && o.planStyle === "column") {
            // Plan behind, shifted right (IBCS overlapping columns: the reference scenario sits in the background).
            const top = yv(Math.max(0, shownPlan));
            mainMarks.push(...scenarioBar("plan", xa + planOffset, top, colW, Math.abs(yv(shownPlan) - zero)));
            if (broken)
                mainMarks.push(...breakMarkV(xa + planOffset, xa + planOffset + colW, zero - 26));
        }
        const top = yv(Math.max(0, shownValue));
        const h = Math.abs(yv(shownValue) - zero);
        mainMarks.push(...scenarioBar(p.kind, xa, top, colW, h));
        if (broken)
            mainMarks.push(...breakMarkV(xa, xa + colW, zero - 26));
        if (shownPlan !== null && o.planStyle === "marker") {
            mainMarks.push(line(xa - 5, yv(shownPlan), xa + colW + 5, yv(shownPlan), { stroke: THEME.ink, "stroke-width": 3 }));
        }
        if (p.isTotal && shownPlan !== null && shownValue >= 0) {
            // Total: the value goes right above its own (broken) column and the plan above the plan column,
            // so a reader never attributes one number to the other bar.
            const pTop = yv(Math.max(0, shownPlan));
            const vy = top - 8;
            const py = Math.min(pTop - 8, vy - mainLabelSize - 6);
            totalLabels.push(...labelBox(centre(i), vy, valueText[i], mainLabelSize, true));
            totalLabels.push(...labelBox(xa + planOffset + colW / 2, py, `PL ${num(p.plan, o.decimals)}`, mainLabelSize - 2, false, "middle", THEME.ink2));
            clearTop[i] = Math.min(pTop, py - mainLabelSize) - 6;
            return;
        }
        // Label above whichever is taller, AC/FC or the plan behind it, so it never sits on the plan outline.
        const vy = shownValue >= 0 ? Math.min(top, shownPlan !== null ? yv(Math.max(0, shownPlan)) : top) - 8 : yv(shownValue) + mainLabelSize + 4;
        const show = !thin || i % 2 === 0 || i === nP - 1 || p.isTotal;
        if (show)
            mainMarks.push(text(centre(i), vy, valueText[i], { size: mainLabelSize, anchor: "middle", bold: p.isTotal === true }));
        clearTop[i] = Math.min(top, shownPlan !== null ? yv(Math.max(0, shownPlan)) : top, shownValue >= 0 ? vy - mainLabelSize : top) - 6;
    });
    mainMarks.push(line(x0, zero, x1, zero, { stroke: THEME.axis, "stroke-width": 2 }));
    const mainBottom = yv(Math.min(0, dataMin));
    panelLabel((mainTop + zero) / 2 - (shared || o.axisMax > 0 ? 20 : 0), "AC/FC");
    // ---- scale indicator (IBCS): identical in every chart that shares the scale
    if (shared || o.axisMax > 0) {
        const unit = niceStep((vMax - dataMin) / 4);
        const h = unit * ppuMain;
        const ix = PAD + 6;
        mainMarks.push(rect(ix, zero - h, 12, h, { fill: THEME.neutral }));
        mainMarks.push(text(ix + 18, zero - 4, num(unit, unit < 1 ? Math.max(o.decimals, 1) : o.decimals), { size: F.note, fill: THEME.ink2 }));
        if (shared) {
            notes.push(`Shared scale “${shared}”: same units per pixel in every chart that uses it. The grey bar at the left is ${num(unit, unit < 1 ? Math.max(o.decimals, 1) : o.decimals)} ${o.units} in each of them.`.replace(/ +\./, "."));
        }
    }
    // ---- AC | FC separator across all panels, and a solid one before the total
    if (m.firstForecast > 0) {
        const sx = slotX(m.firstForecast);
        body.push(line(sx, y + 4, sx, mainBottom + 4, { stroke: THEME.extension, "stroke-width": 1.4, "stroke-dasharray": "5 4" }));
    }
    if (hasTotal) {
        const sx = slotX(nP) - slotW * 0.25;
        body.push(line(sx, y + 4, sx, mainBottom + 4, { stroke: THEME.axis, "stroke-width": 1.4 }));
        notes.push(`${m.total.label} column: the axis is broken; its value and its variance are labelled in full.`);
    }
    body.push(...pinMarks, ...barMarks, ...mainMarks, ...totalLabels);
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
    // ---- period labels (wrapped to two lines; thinned like the values when they cannot fit)
    let catBottom = mainBottom;
    const catSize = Math.min(F.category - 2, labelSize);
    const catLines = bars.map((p) => clampLabel(wrapText(p.label, catSize, slotW - 4), 2));
    const catThin = catLines.some((ls) => ls.some((l) => textWidth(l, catSize, false) > slotW + 2));
    bars.forEach((p, i) => {
        if (catThin && i % 2 === 1 && !p.isTotal && i !== nP - 1)
            return;
        let ty = mainBottom + 12 + catSize;
        for (const l of catLines[i]) {
            body.push(text(slotX(i) + slotW / 2, ty, l, { size: catSize, anchor: "middle", bold: p.isTotal === true }));
            catBottom = Math.max(catBottom, ty);
            ty += catSize + 3;
        }
    });
    // ---- footnotes (drawn here, or handed to the small-multiples frame in compact mode)
    if (m.hasPlan)
        notes.unshift(`Grey = within ${tolerancePct(o.materialityPct)} of plan. Red/blue = beyond it.`);
    let bottom = catBottom + 8;
    if (!compact) {
        for (const nline of notes) {
            for (const l of wrapText(nline, F.note, width - 2 * PAD)) {
                bottom += F.note + 9;
                body.push(text(PAD, bottom, l, { size: F.note, fill: THEME.muted }));
            }
        }
    }
    const height = Math.ceil(bottom + (compact ? 10 : PAD));
    const description = describeColumns(m);
    const inner = body.join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="ibcs-t ibcs-d">` +
        `<title id="ibcs-t">${esc(title || subtitle)}</title><desc id="ibcs-d">${esc(description)}</desc>` +
        rect(0, 0, width, height, { fill: THEME.surface }) +
        inner +
        `</svg>`;
    return { svg, width, height, description, title, warnings, inner, notes };
}
function compactMin(r) {
    return r.compact ? 360 : 560;
}
