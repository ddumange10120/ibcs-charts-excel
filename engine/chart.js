/**
 * One entry point for every chart type, so the task pane and the offline page
 * dispatch the same way: values + options in, SVG (or a row-named error) out.
 */
import { parseBridge } from "./bridge.js";
import { parseColumns } from "./columns.js";
import { renderBridge } from "./render.js";
import { renderColumns } from "./render-columns.js";
import { renderMultiples } from "./multiples.js";
export function renderChart(type, values, options, width) {
    if (type === "multiples") {
        const out = renderMultiples(values, options);
        if (!out.ok)
            return out;
        return { ok: true, result: out.result, warnings: out.warnings, labels: [] };
    }
    if (type === "columns") {
        const p = parseColumns(values, options);
        if (!p.ok)
            return p;
        const result = renderColumns(p.model, width === undefined ? {} : { width });
        return { ok: true, result, warnings: [...p.model.warnings, ...(result.warnings ?? [])], labels: [...p.model.periods.map((x) => x.label), ...(p.model.total ? [p.model.total.label] : [])] };
    }
    const p = parseBridge(values, options);
    if (!p.ok)
        return p;
    const result = renderBridge(p.model, width === undefined ? {} : { width });
    return { ok: true, result, warnings: [...p.model.warnings, ...(result.warnings ?? [])], labels: p.model.rows.map((x) => x.label) };
}
