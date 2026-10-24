/**
 * Task pane controller: select a table -> preview -> insert/update a bridge picture.
 * While the pane is open, charts re-render when their table changes.
 */
import { parseBridge, renderBridge } from "../engine/index.js";
import { bindAddress, deleteBinding, loadRecords, placeChart, pxToPt, readBinding, readSelection, resolveMode, saveRecords, vectorSupported, watchBinding, watchCalculation, } from "./excel.js";
const $ = (id) => {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`#${id} missing`);
    return el;
};
const ui = {
    source: $("source"),
    useSelection: $("use-selection"),
    title: $("opt-title"),
    subtitle: $("opt-subtitle"),
    prefix: $("opt-prefix"),
    suffix: $("opt-suffix"),
    decimals: $("opt-decimals"),
    scale: $("opt-scale"),
    materiality: $("opt-materiality"),
    higherIsBetter: $("opt-higher"),
    breakAxis: $("opt-break"),
    gapArrow: $("opt-gap"),
    mode: $("opt-mode"),
    preview: $("preview"),
    status: $("status"),
    error: $("error"),
    insert: $("insert"),
    refreshAll: $("refresh-all"),
    charts: $("charts"),
    form: $("options"),
};
const state = { values: null, address: "", editingId: null, last: null, hashes: new Map(), watched: new Set() };
/* ---------------- options <-> form ---------------- */
function readOptions() {
    const orientation = (ui.form.querySelector('input[name="orientation"]:checked')?.value ?? "horizontal");
    return {
        orientation,
        title: ui.title.value,
        subtitle: ui.subtitle.value,
        prefix: ui.prefix.value,
        suffix: ui.suffix.value,
        decimals: Number(ui.decimals.value),
        scale: Number(ui.scale.value),
        materialityPct: Number(ui.materiality.value),
        higherIsBetter: ui.higherIsBetter.checked,
        breakAxis: ui.breakAxis.value,
        showGapArrow: ui.gapArrow.checked,
    };
}
function writeOptions(o) {
    const set = (el, v) => {
        if (v !== undefined && v !== null)
            el.value = String(v);
    };
    set(ui.title, o.title);
    set(ui.subtitle, o.subtitle);
    set(ui.prefix, o.prefix);
    set(ui.suffix, o.suffix);
    set(ui.decimals, o.decimals);
    set(ui.scale, o.scale);
    set(ui.materiality, o.materialityPct);
    set(ui.breakAxis, o.breakAxis);
    if (o.higherIsBetter !== undefined)
        ui.higherIsBetter.checked = o.higherIsBetter;
    if (o.showGapArrow !== undefined)
        ui.gapArrow.checked = o.showGapArrow;
    const radio = ui.form.querySelector(`input[name="orientation"][value="${o.orientation ?? "horizontal"}"]`);
    if (radio)
        radio.checked = true;
}
/* ---------------- messages ---------------- */
function say(msg) {
    ui.status.textContent = msg;
}
function fail(msg) {
    ui.error.textContent = msg;
    ui.error.hidden = !msg;
}
async function busy(fn) {
    document.body.dataset.busy = "true";
    try {
        return await fn();
    }
    catch (e) {
        fail(e instanceof Error ? e.message : String(e));
        return undefined;
    }
    finally {
        delete document.body.dataset.busy;
    }
}
/* ---------------- rendering ---------------- */
function render(values, options) {
    const parsed = parseBridge(values, options);
    if (!parsed.ok)
        return { result: null, error: parsed.error, warnings: [] };
    return { result: renderBridge(parsed.model), error: "", warnings: parsed.model.warnings };
}
function updatePreview() {
    if (!state.values) {
        ui.preview.textContent = "No table selected yet.";
        ui.insert.disabled = true;
        return;
    }
    const { result, error, warnings } = render(state.values, readOptions());
    state.last = result;
    fail(error);
    if (!result) {
        ui.preview.textContent = "Fix the table to see the chart.";
        ui.insert.disabled = true;
        return;
    }
    // Parse as SVG (never as HTML) so nothing in a cell can become markup or script.
    const doc = new DOMParser().parseFromString(result.svg, "image/svg+xml");
    ui.preview.replaceChildren(document.importNode(doc.documentElement, true));
    ui.insert.disabled = false;
    say(warnings.length ? `Check: ${warnings.join(" ")}` : `Previewing ${state.address}.`);
}
async function svgToPngBase64(svg, width, height) {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const scale = 2; // sharp on high-DPI screens and when printed
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("Canvas is not available for the PNG fallback.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
}
async function drawRecord(rec, values) {
    const { result, error } = render(values, rec.options);
    if (!result)
        throw new Error(`Chart not updated. ${error}`);
    const mode = await placeChart(rec, {
        svg: result.svg,
        pngBase64: () => svgToPngBase64(result.svg, result.width, result.height),
        widthPx: result.width,
        heightPx: result.height,
        altTitle: result.title,
        altText: result.description,
    });
    return mode;
}
/* ---------------- live refresh ---------------- */
const timers = new Map();
function scheduleRefresh(id) {
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => void refreshOne(id, false), 350));
}
async function refreshOne(id, force) {
    const rec = loadRecords()[id];
    if (!rec)
        return;
    await busy(async () => {
        const data = await readBinding(id);
        if (!data) {
            fail(`The table for ${id} no longer exists.`);
            return;
        }
        const hash = JSON.stringify([data.values, rec.options, rec.mode]);
        if (!force && state.hashes.get(id) === hash)
            return;
        await drawRecord(rec, data.values);
        state.hashes.set(id, hash);
        fail("");
        say(`Updated chart from ${data.address}.`);
        if (state.editingId === id) {
            state.values = data.values;
            state.address = data.address;
            updatePreview();
        }
    });
}
async function watch(id) {
    if (state.watched.has(id))
        return;
    state.watched.add(id);
    await watchBinding(id, () => scheduleRefresh(id));
}
/* ---------------- chart list ---------------- */
function renderList() {
    const recs = Object.values(loadRecords());
    ui.charts.replaceChildren();
    ui.refreshAll.disabled = recs.length === 0;
    if (recs.length === 0) {
        const li = document.createElement("li");
        li.textContent = "No charts in this workbook yet.";
        ui.charts.append(li);
        return;
    }
    for (const rec of recs) {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = String(rec.options["title"] || rec.id);
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Edit";
        edit.setAttribute("aria-label", `Edit chart ${name.textContent}`);
        edit.addEventListener("click", () => void editChart(rec.id));
        li.append(name, edit);
        ui.charts.append(li);
    }
}
async function editChart(id) {
    const rec = loadRecords()[id];
    if (!rec)
        return;
    await busy(async () => {
        const data = await readBinding(id);
        if (!data)
            throw new Error("The table for this chart no longer exists.");
        state.values = data.values;
        state.address = data.address;
        state.editingId = id;
        writeOptions(rec.options);
        ui.mode.value = rec.mode;
        ui.source.textContent = `Editing chart on ${data.address}`;
        ui.insert.textContent = "Update chart";
        updatePreview();
    });
}
/* ---------------- actions ---------------- */
async function useSelection() {
    await busy(async () => {
        const sel = await readSelection();
        state.values = sel.values;
        state.address = sel.address;
        state.editingId = null;
        ui.source.textContent = `Table: ${sel.address}`;
        ui.insert.textContent = "Insert chart";
        updatePreview();
    });
}
async function insertOrUpdate() {
    if (!state.values || !state.last)
        return;
    await busy(async () => {
        const records = loadRecords();
        const isNew = !state.editingId;
        const id = state.editingId ?? `ibcs_bridge_${Date.now().toString(36)}`;
        if (isNew)
            await bindAddress(id, state.address);
        const rec = {
            id,
            options: readOptions(),
            mode: ui.mode.value,
            widthPt: pxToPt(state.last.width),
        };
        let mode;
        try {
            mode = await drawRecord(rec, state.values);
        }
        catch (e) {
            if (isNew)
                await deleteBinding(id).catch(() => undefined); // no orphan bindings
            throw e;
        }
        records[id] = rec;
        await saveRecords(records);
        state.hashes.set(id, JSON.stringify([state.values, rec.options, rec.mode]));
        state.editingId = id;
        ui.insert.textContent = "Update chart";
        await watch(id);
        renderList();
        fail("");
        say(`Chart ${mode === "svg" ? "inserted as a vector picture" : "inserted as a PNG picture"}. It updates while this pane is open; save the workbook to keep the link.`);
    });
}
async function refreshAll() {
    for (const id of Object.keys(loadRecords()))
        await refreshOne(id, true);
}
/* ---------------- boot ---------------- */
let previewTimer;
ui.form.addEventListener("input", () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 150);
});
ui.form.addEventListener("submit", (e) => e.preventDefault());
ui.useSelection.addEventListener("click", () => void useSelection());
ui.insert.addEventListener("click", () => void insertOrUpdate());
ui.refreshAll.addEventListener("click", () => void refreshAll());
Office.onReady(async (info) => {
    if (info.host !== Office.HostType.Excel) {
        fail("Open this add-in from Excel.");
        ui.useSelection.disabled = true;
        return;
    }
    if (!Office.context.requirements.isSetSupported("ExcelApi", "1.9")) {
        fail("This version of Excel is too old for the add-in (needs ExcelApi 1.9).");
        ui.useSelection.disabled = true;
        return;
    }
    const vectorOption = ui.mode.querySelector('option[value="svg"]');
    if (vectorOption && !vectorSupported()) {
        vectorOption.disabled = true;
        vectorOption.textContent += " (not available in this Excel)";
    }
    renderList();
    await busy(async () => {
        for (const id of Object.keys(loadRecords()))
            await watch(id);
        await watchCalculation(() => {
            for (const id of state.watched)
                scheduleRefresh(id);
        });
    });
    say(`Ready. Pictures go in as ${resolveMode("auto") === "svg" ? "vector (SVG)" : "PNG"}. Select a table and press "Use selection".`);
    document.body.dataset.ready = "true";
});
