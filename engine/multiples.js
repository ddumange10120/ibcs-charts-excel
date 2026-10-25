/**
 * Small multiples: one IBCS column chart per entity (channel, market, customer...) from a
 * long-format table, all on ONE shared scale, laid out in a grid on one picture.
 *
 * Input: Entity | Period | AC | FC | PL  (header row required; columns found by name).
 * Every panel uses the same value axis, the same ΔPL scale and the same ΔPL% range, so
 * bar lengths compare honestly across panels (IBCS "Unify"); each panel carries the
 * same scale indicator to show it.
 */
import { mergeNeeds, parseColumns, scaleNeeds } from "./columns.js";
import { F, PAD, header, scenarioLegend, tolerancePct } from "./marks.js";
import { compactSummary, renderColumns } from "./render-columns.js";
import { THEME, esc, rect, text } from "./svg.js";
import { wrapText } from "./text.js";
export const MAX_PANELS = 9;
const PANEL_W = 700;
const GAP = 20;
const ENTITY_WORDS = ["entity", "channel", "market", "customer", "segment", "region", "country", "product", "brand", "bu", "species", "site", "team"];
const PERIOD_WORDS = ["period", "month", "date", "week", "quarter", "year", "time"];
const isBlank = (c) => c === null || c === undefined || (typeof c === "string" && c.trim() === "");
const firstWord = (c) => String(c ?? "").trim().toLowerCase().split(/[^a-z]+/).filter(Boolean)[0] ?? "";
/** Translate the coordinates of Office-safe markup (x/y attributes and points) by (dx, dy). No transforms needed. */
export function translateMarkup(markup, dx, dy) {
    const r1 = (v) => (Math.round(v * 10) / 10).toString();
    return markup
        .replace(/ (x|x1|x2)="(-?[\d.]+)"/g, (_, a, v) => ` ${a}="${r1(Number(v) + dx)}"`)
        .replace(/ (y|y1|y2)="(-?[\d.]+)"/g, (_, a, v) => ` ${a}="${r1(Number(v) + dy)}"`)
        .replace(/ points="([^"]+)"/g, (_, pts) => ` points="${pts
        .trim()
        .split(/\s+/)
        .map((pair) => {
        const [px, py] = pair.split(",").map(Number);
        return `${r1(px + dx)},${r1(py + dy)}`;
    })
        .join(" ")}"`);
}
export function renderMultiples(values, partial = {}) {
    const rows = values.filter((r) => r.some((c) => !isBlank(c)));
    if (rows.length < 3)
        return { ok: false, error: "Small multiples need a header row and data: Entity | Period | AC | FC | PL." };
    const head = rows[0];
    const words = head.map(firstWord);
    const hasHeader = words.some((w) => ["ac", "actual", "fc", "forecast", "le", "outlook", "pl", "plan", "budget"].includes(w));
    if (!hasHeader)
        return { ok: false, error: "Small multiples need a header row naming the columns: Entity | Period | AC | FC | PL." };
    let ent = words.findIndex((w) => ENTITY_WORDS.includes(w));
    if (ent < 0)
        ent = 0;
    let per = words.findIndex((w, i) => i !== ent && PERIOD_WORDS.includes(w));
    if (per < 0)
        per = ent === 0 ? 1 : 0;
    const role = (names) => words.findIndex((w) => names.includes(w));
    const ac = role(["ac", "act", "actual", "actuals"]);
    const fc = role(["fc", "fcst", "forecast", "le", "outlook"]);
    const pl = role(["pl", "plan", "budget", "bu", "op", "target"]);
    if (ac < 0 || fc < 0)
        return { ok: false, error: `Header row: could not find both an AC column and an FC column (found: ${head.map(String).join(" | ")}).` };
    // Group rows by entity, keeping first-seen order and each row's position in the selection.
    const groups = new Map();
    rows.slice(1).forEach((r, k) => {
        const sourceRow = k + 2;
        if (isBlank(r[ent])) {
            groups.set("\u0000blank", { rows: [], sourceRows: [sourceRow] });
            return;
        }
        const name = String(r[ent]).trim();
        const g = groups.get(name) ?? { rows: [["Period", "AC", "FC", ...(pl >= 0 ? ["PL"] : [])]], sourceRows: [] };
        g.rows.push([r[per], r[ac], r[fc], ...(pl >= 0 ? [r[pl]] : [])]);
        g.sourceRows.push(sourceRow);
        groups.set(name, g);
    });
    const blank = groups.get("\u0000blank");
    if (blank)
        return { ok: false, error: `Row ${blank.sourceRows[0]}: the ${String(head[ent])} cell is empty. Every row needs an entity name.` };
    const names = [...groups.keys()];
    if (names.length < 2)
        return { ok: false, error: `Only one ${String(head[ent]).toLowerCase() || "entity"} found ("${names[0] ?? ""}"). Use the Columns chart for a single one.` };
    if (names.length > MAX_PANELS)
        return { ok: false, error: `${names.length} entities is too many for one picture (${MAX_PANELS} at most). Filter the table or split it in two.` };
    // Parse each entity; map row numbers in messages back to the selection.
    const options = { ...partial, annotations: [] };
    const models = [];
    const warnings = [];
    if (Array.isArray(partial.annotations) && partial.annotations.length)
        warnings.push("Arrows and brackets are not drawn on small multiples; they were ignored.");
    for (const name of names) {
        const g = groups.get(name);
        const p = parseColumns(g.rows, { ...options, title: name, subtitle: "" });
        const remap = (msg) => msg.replace(/Row (\d+)/g, (_, k) => `Row ${g.sourceRows[Number(k) - 2] ?? k}`);
        if (!p.ok)
            return { ok: false, error: `${name}: ${remap(p.error)}` };
        warnings.push(...p.model.warnings.map((w) => `${name}: ${remap(w)}`));
        models.push(p.model);
    }
    // One scale for all panels.
    const needs = mergeNeeds(models.map(scaleNeeds));
    for (const m of models) {
        m.options.axisMax = needs.max;
        m.options.pinRange = needs.pin;
        m.options.deltaRange = needs.delta;
        m.options.scaleName = "panels";
    }
    const cols = names.length <= 2 ? names.length : names.length <= 4 ? 2 : 3;
    const width = cols * PANEL_W + (cols - 1) * GAP + 2 * PAD;
    const first = models[0];
    const o = first.options;
    const title = (partial.title ?? "").trim() || `AC + FC vs plan by ${String(head[ent]).toLowerCase() || "entity"}`;
    const subtitle = (partial.subtitle ?? "").trim() || `${o.units ? `${o.units}, ` : ""}one panel per ${String(head[ent]).toLowerCase() || "entity"}, all on the same scale`;
    const h = header(title, subtitle, width);
    const body = [...h.parts];
    const items = [];
    if (models.some((m) => m.periods.some((p) => p.kind === "actual")))
        items.push("actual");
    if (models.some((m) => m.periods.some((p) => p.kind === "forecast")))
        items.push("forecast");
    if (models.some((m) => m.hasPlan))
        items.push("plan");
    body.push(...scenarioLegend(items, PAD, h.bottom + 6, o.planStyle === "marker"));
    let top = h.bottom + 22;
    const panels = models.map((m) => renderColumns(m, { width: PANEL_W, compact: true }));
    for (let r0 = 0; r0 < panels.length; r0 += cols) {
        const row = panels.slice(r0, r0 + cols);
        const rowH = Math.max(...row.map((p) => p.height));
        row.forEach((p, c) => {
            const dx = PAD + c * (PANEL_W + GAP);
            body.push(translateMarkup(p.inner ?? "", dx - PAD + 2, top));
        });
        top += rowH + 6;
    }
    // Footnotes once for the whole picture.
    const notes = [
        `Grey = within ${tolerancePct(o.materialityPct)} of plan. Red/blue = beyond it.`,
        `All panels share one scale (same units per pixel, ${o.units}); the grey bar at each panel's left is the same size everywhere. ΔPL% pins share one range too.`,
    ];
    if (o.showTotal)
        notes.push(`${o.totalLabel || "Total"} columns: the axis is broken; values and variances are labelled in full.`);
    let bottom = top;
    for (const nline of notes) {
        for (const l of wrapText(nline, F.note, width - 2 * PAD)) {
            bottom += F.note + 9;
            body.push(text(PAD, bottom, l, { size: F.note, fill: THEME.muted }));
        }
    }
    const height = Math.ceil(bottom + PAD);
    const description = `Small multiples, ${names.length} panels on one scale. ${models.map((m, k) => `${names[k]}: ${compactSummary(m)}`).join("; ")}.`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="ibcs-t ibcs-d">` +
        `<title id="ibcs-t">${esc(title)}</title><desc id="ibcs-d">${esc(description)}</desc>` +
        rect(0, 0, width, height, { fill: THEME.surface }) +
        body.join("") +
        `</svg>`;
    for (const p of panels)
        warnings.push(...(p.warnings ?? []));
    return { ok: true, result: { svg, width, height, description, title, warnings }, warnings, entities: names };
}
