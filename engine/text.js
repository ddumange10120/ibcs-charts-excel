/**
 * Text measurement without a DOM.
 *
 * The engine must give the same layout in Node (tests), in the task pane and in
 * the PNG fallback, so it cannot ask a browser how wide a string is. Instead it
 * uses Arial's advance widths (units per 1000 em). The chart is drawn in Arial
 * because it is the one font present on Windows, Mac and Excel on the web, and
 * Office's SVG import does not reliably honour a font fallback list.
 */
const ARIAL = {
    " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
    "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
    "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
    "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
    "@": 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
    J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667,
    T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 278, "]": 278,
    _: 556, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
    j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500,
    t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
    "−": 584, // minus sign
    "–": 556, // en dash
    "·": 278, // middle dot
    "≈": 584, // almost equal
    "Δ": 668, // Delta
};
/** Arial Bold is on average about 7% wider than Arial Regular. */
const BOLD_FACTOR = 1.07;
const DEFAULT_ADVANCE = 556;
export function textWidth(text, fontSize, bold = false) {
    let units = 0;
    for (const ch of text)
        units += ARIAL[ch] ?? DEFAULT_ADVANCE;
    return (units / 1000) * fontSize * (bold ? BOLD_FACTOR : 1);
}
/** Greedy word wrap to a pixel width. A single word longer than the width keeps its own line. */
export function wrapText(text, fontSize, maxWidth, bold = false) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && textWidth(candidate, fontSize, bold) > maxWidth) {
            lines.push(line);
            line = word;
        }
        else {
            line = candidate;
        }
    }
    if (line)
        lines.push(line);
    return lines.length ? lines : [""];
}
