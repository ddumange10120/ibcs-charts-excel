/**
 * One entry point for every chart type, so the task pane and the offline page
 * dispatch the same way: values + options in, SVG (or a row-named error) out.
 */
import { parseBridge } from "./bridge.js";
import { parseColumns } from "./columns.js";
import { renderBridge } from "./render.js";
import { renderColumns } from "./render-columns.js";
export function renderChart(type, values, options, width) {
    if (type === "columns") {
        const p = parseColumns(values, options);
        if (!p.ok)
            return p;
        const result = renderColumns(p.model, width === undefined ? {} : { width });
        return { ok: true, result, warnings: [...p.model.warnings, ...(result.warnings ?? [])], labels: p.model.periods.map((x) => x.label) };
    }
    const p = parseBridge(values, options);
    if (!p.ok)
        return p;
    const result = renderBridge(p.model, width === undefined ? {} : { width });
    return { ok: true, result, warnings: [...p.model.warnings, ...(result.warnings ?? [])], labels: p.model.rows.map((x) => x.label) };
}
