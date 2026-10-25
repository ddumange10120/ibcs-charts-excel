/**
 * Everything that talks to Excel lives here, behind small async functions, so the
 * task pane controller stays testable and the Office-specific risks are in one file.
 *
 * Requirement sets used:
 *  - ExcelApi 1.9: bindings, events, shapes, Shape.addImage (Windows, Mac, web)
 *  - ImageCoercion 1.2: setSelectedDataAsync(XmlSvg) for vector charts
 *    (Excel on Windows and Mac only; Excel on the web falls back to PNG)
 */
const SETTINGS_KEY = "ibcs.charts";
const PX_TO_PT = 0.75;
export function vectorSupported() {
    return Office.context.requirements.isSetSupported("ImageCoercion", "1.2");
}
export function resolveMode(mode) {
    if (mode === "svg" || mode === "png")
        return mode;
    return vectorSupported() ? "svg" : "png";
}
/* ---------------- settings (stored inside the workbook) ---------------- */
export function loadRecords() {
    const raw = Office.context.document.settings.get(SETTINGS_KEY);
    return raw && typeof raw === "object" ? raw : {};
}
export function saveRecords(records) {
    Office.context.document.settings.set(SETTINGS_KEY, records);
    return new Promise((resolve, reject) => {
        Office.context.document.settings.saveAsync((r) => r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error(r.error?.message ?? "Could not save settings")));
    });
}
/* ---------------- reading data ---------------- */
/**
 * Labels (first column) are read as the text Excel DISPLAYS, so a month stored as a
 * date shows "Jan-26", not the serial number 46023. Numbers stay as values.
 */
export function withTextLabels(values, text) {
    return values.map((row, i) => (row.length ? [text[i]?.[0] ?? row[0] ?? null, ...row.slice(1)] : row));
}
export async function readSelection() {
    return Excel.run(async (ctx) => {
        const r = ctx.workbook.getSelectedRange();
        r.load("values,text,address");
        await ctx.sync();
        return { values: withTextLabels(r.values, r.text), address: r.address };
    });
}
export async function readBinding(id) {
    return Excel.run(async (ctx) => {
        const b = ctx.workbook.bindings.getItemOrNullObject(id);
        await ctx.sync();
        if (b.isNullObject)
            return null;
        const r = b.getRange();
        r.load("values,text,address");
        await ctx.sync();
        return { values: withTextLabels(r.values, r.text), address: r.address };
    });
}
/** Split "Sheet1!A1:D8" or "'My sheet'!A1:D8" into sheet name and local address. */
export function splitAddress(address) {
    const at = address.lastIndexOf("!");
    if (at < 0)
        throw new Error(`Not a sheet address: ${address}`);
    let sheet = address.slice(0, at);
    if (sheet.startsWith("'") && sheet.endsWith("'"))
        sheet = sheet.slice(1, -1).replace(/''/g, "'");
    return { sheet, local: address.slice(at + 1) };
}
/**
 * Bind the table by its address (not the live selection, which the vector insert
 * moves), so the chart follows the table when rows are inserted above it.
 */
export async function bindAddress(id, address) {
    const { sheet, local } = splitAddress(address);
    await Excel.run(async (ctx) => {
        const r = ctx.workbook.worksheets.getItem(sheet).getRange(local);
        ctx.workbook.bindings.add(r, Excel.BindingType.range, id);
        await ctx.sync();
    });
}
export async function deleteBinding(id) {
    await Excel.run(async (ctx) => {
        const b = ctx.workbook.bindings.getItemOrNullObject(id);
        await ctx.sync();
        if (!b.isNullObject) {
            b.delete();
            await ctx.sync();
        }
    });
}
/* ---------------- events (live refresh while the pane is open) ---------------- */
export async function watchBinding(id, onChange) {
    await Excel.run(async (ctx) => {
        const b = ctx.workbook.bindings.getItemOrNullObject(id);
        await ctx.sync();
        if (b.isNullObject)
            return;
        b.onDataChanged.add(async () => onChange());
        await ctx.sync();
    });
}
/** Formula results change without a data-changed event on the binding; listen to recalcs too. */
export async function watchCalculation(onCalc) {
    await Excel.run(async (ctx) => {
        ctx.workbook.worksheets.onCalculated.add(async () => onCalc());
        await ctx.sync();
    });
}
function setSelectedSvg(svg, widthPt) {
    return new Promise((resolve, reject) => {
        Office.context.document.setSelectedDataAsync(svg, { coercionType: Office.CoercionType.XmlSvg, imageWidth: widthPt }, (r) => (r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error(r.error?.message ?? "SVG insert failed"))));
    });
}
/**
 * Insert or replace the chart picture for a binding. A replaced picture keeps the
 * position and size the user gave it; a new one goes two columns right of the table.
 */
export async function placeChart(rec, picture) {
    const mode = resolveMode(rec.mode);
    // Step 1: find the table, remove any previous picture, remember where it was.
    const prep = await Excel.run(async (ctx) => {
        const binding = ctx.workbook.bindings.getItem(rec.id);
        const range = binding.getRange();
        range.load("rowIndex,columnIndex,columnCount");
        const ws = range.worksheet;
        ws.load("name");
        const shapes = ws.shapes;
        shapes.load("items/id,items/name");
        await ctx.sync();
        let geom = null;
        const old = shapes.items.find((s) => s.name === rec.id);
        if (old) {
            old.load("left,top,width,height");
            await ctx.sync();
            geom = { left: old.left, top: old.top, width: old.width, height: old.height };
        }
        const anchor = ws.getCell(range.rowIndex, range.columnIndex + range.columnCount + 1);
        anchor.load("left,top,address");
        const before = ws.shapes;
        before.load("items/id");
        await ctx.sync();
        return {
            sheet: ws.name,
            anchorAddress: anchor.address,
            anchor: { left: anchor.left, top: anchor.top },
            geom,
            oldId: old?.id ?? null,
            beforeIds: new Set(before.items.map((s) => s.id)),
        };
    });
    const widthPt = prep.geom?.width ?? rec.widthPt;
    const heightPt = prep.geom ? prep.geom.height : (rec.widthPt * picture.heightPx) / picture.widthPx;
    const left = prep.geom?.left ?? prep.anchor.left;
    const top = prep.geom?.top ?? prep.anchor.top;
    if (mode === "svg") {
        // XmlSvg goes in at the selection: select the anchor, insert, then restore nothing
        // (the picture stays selected, which is what a user expects after Insert).
        await Excel.run(async (ctx) => {
            ctx.workbook.worksheets.getItem(prep.sheet).getRange(prep.anchorAddress.split("!").pop()).select();
            await ctx.sync();
        });
        await setSelectedSvg(picture.svg, widthPt);
    }
    // Step 2: name and position the new picture (or add it, for PNG).
    await Excel.run(async (ctx) => {
        const ws = ctx.workbook.worksheets.getItem(prep.sheet);
        let shape;
        if (mode === "png") {
            shape = ws.shapes.addImage(await picture.pngBase64());
        }
        else {
            const after = ws.shapes;
            after.load("items/id");
            await ctx.sync();
            const added = after.items.filter((s) => !prep.beforeIds.has(s.id));
            if (added.length !== 1) {
                throw new Error(`The vector chart went in, but Excel did not return it as a shape (${added.length} new shapes), so it cannot be updated. Delete that picture by hand, switch "Picture format" to PNG and insert again.`);
            }
            shape = added[0];
        }
        // Remove the previous picture only once the new one exists, so a failed
        // insert never leaves the sheet without a chart.
        if (prep.oldId)
            ws.shapes.getItem(prep.oldId).delete();
        shape.name = rec.id;
        shape.altTextTitle = picture.altTitle;
        shape.altTextDescription = picture.altText;
        shape.lockAspectRatio = true;
        shape.left = left;
        shape.top = top;
        shape.width = widthPt;
        shape.height = heightPt;
        await ctx.sync();
    });
    return mode;
}
export function pxToPt(px) {
    return px * PX_TO_PT;
}
