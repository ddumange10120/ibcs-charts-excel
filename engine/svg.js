/**
 * Office-safe SVG primitives.
 *
 * Excel imports SVG through its own renderer, which supports a smaller subset than
 * a browser. Everything here sticks to that subset on purpose: plain rect / line /
 * polygon / text with presentation attributes. No <style>, class, <pattern>,
 * <clipPath>, <marker>, <defs>, filters, transforms or dominant-baseline. Hatching
 * and arrowheads are therefore drawn as explicit geometry.
 * test/svg-safety.test.ts enforces this list.
 */
export const THEME = {
    font: "Arial",
    ink: "#1a1a1a",
    ink2: "#4a4945",
    muted: "#605f59",
    axis: "#8f8e87",
    connector: "#8a8983",
    extension: "#9a9993",
    actual: "#3d3d3a",
    surface: "#ffffff",
    adverse: "#d03b3b",
    favourable: "#2a78d6",
    neutral: "#a3a29c",
};
const r1 = (n) => (Math.round(n * 10) / 10).toString();
export function esc(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
function attrs(a) {
    return Object.entries(a)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ` ${k}="${typeof v === "number" ? r1(v) : esc(String(v))}"`)
        .join("");
}
export function rect(x, y, w, h, a = {}) {
    return `<rect${attrs({ x, y, width: Math.max(0, w), height: Math.max(0, h), ...a })}/>`;
}
export function line(x1, y1, x2, y2, a = {}) {
    return `<line${attrs({ x1, y1, x2, y2, ...a })}/>`;
}
export function polygon(points, a = {}) {
    return `<polygon${attrs({ points: points.map(([x, y]) => `${r1(x)},${r1(y)}`).join(" "), ...a })}/>`;
}
export function polyline(points, a = {}) {
    return `<polyline${attrs({ points: points.map(([x, y]) => `${r1(x)},${r1(y)}`).join(" "), fill: "none", ...a })}/>`;
}
export function text(x, y, content, s) {
    return `<text${attrs({
        x,
        y,
        "font-family": THEME.font,
        "font-size": s.size,
        "font-weight": s.bold ? "bold" : undefined,
        "text-anchor": s.anchor ?? "start",
        fill: s.fill ?? THEME.ink,
    })}>${esc(content)}</text>`;
}
/**
 * 45-degree hatch lines (rising to the right) clipped to a rectangle by geometry,
 * so no <pattern> or <clipPath> is needed. `gap` is the spacing along the x axis.
 */
export function hatchLines(x0, y0, x1, y1, gap, a) {
    const out = [];
    if (x1 - x0 <= 0 || y1 - y0 <= 0)
        return out;
    // Lines satisfy x + y = c in screen coordinates (y grows downwards).
    for (let c = x0 + y0 + gap / 2; c < x1 + y1; c += gap) {
        const xa = Math.max(x0, c - y1);
        const xb = Math.min(x1, c - y0);
        if (xb - xa < 0.5)
            continue;
        out.push(line(xa, c - xa, xb, c - xb, a));
    }
    return out;
}
/** Solid triangle arrowhead with its tip at (x, y), pointing along (dx, dy). */
export function arrowhead(x, y, dx, dy, size, fill) {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const bx = x - ux * size;
    const by = y - uy * size;
    const half = size * 0.45;
    return polygon([
        [x, y],
        [bx - uy * half, by + ux * half],
        [bx + uy * half, by - ux * half],
    ], { fill });
}
