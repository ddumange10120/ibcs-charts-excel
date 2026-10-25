/**
 * Task pane controller: pick a chart type, select a table -> preview -> insert/update a picture.
 * While the pane is open, charts re-render when their table changes.
 */
import { MAX_ANNOTATIONS, mergeNeeds, parseColumns, renderChart, scaleNeeds } from "../engine/index.js";
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
    chartType: $("opt-type"),
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
    units: $("opt-units"),
    colMateriality: $("opt-col-materiality"),
    planStyle: $("opt-plan-style"),
    varScale: $("opt-var-scale"),
    axisMax: $("opt-axis-max"),
    pins: $("opt-pins"),
    total: $("opt-total"),
    totalLabel: $("opt-total-label"),
    scaleName: $("opt-scale-name"),
    bars: $("opt-bars"),
    annList: $("ann-list"),
    annType: $("ann-type"),
    annFrom: $("ann-from"),
    annTo: $("ann-to"),
    annLabel: $("ann-label"),
    annAdd: $("ann-add"),
    mode: $("opt-mode"),
    preview: $("preview"),
    status: $("status"),
    error: $("error"),
    insert: $("insert"),
    refreshAll: $("refresh-all"),
    charts: $("charts"),
    form: $("options"),
};
const state = { values: null, address: "", editingId: null, last: null, hashes: new Map(), watched: new Set(), annotations: [], labels: [] };
/** An empty or non-numeric box must fail validation, never silently become 0. */
function tolerance(el) {
    return el.value.trim() === "" || el.validity.badInput ? Number.NaN : Number(el.value);
}
function chartType() {
    return ui.chartType.value === "columns" || ui.chartType.value === "multiples" ? ui.chartType.value : "bridge";
}
function typeOf(o) {
    return o["chartType"] === "columns" || o["chartType"] === "multiples" ? o["chartType"] : "bridge";
}
/** Show only the fields that belong to the selected chart type. */
function showFieldsFor(type) {
    document.querySelectorAll("[data-chart]").forEach((el) => {
        el.hidden = !(el.dataset.chart ?? "").split(" ").includes(type);
    });
}
function readOptions() {
    const type = chartType();
    const common = {
        chartType: type,
        annotations: state.annotations.map((a) => ({ ...a })),
        title: ui.title.value,
        subtitle: ui.subtitle.value,
        decimals: Number(ui.decimals.value),
        scale: Number(ui.scale.value),
        higherIsBetter: ui.higherIsBetter.checked,
    };
    if (type === "columns" || type === "multiples") {
        const o = {
            showTotal: ui.total.checked,
            totalLabel: ui.totalLabel.value,
            scaleName: type === "columns" ? ui.scaleName.value.trim() : "",
            units: ui.units.value,
            materialityPct: tolerance(ui.colMateriality),
            planStyle: ui.planStyle.value,
            varianceScale: ui.varScale.value,
            axisMax: Number(ui.axisMax.value) || 0,
            showPctPins: ui.pins.checked,
            showVarianceBars: ui.bars.checked,
        };
        return { ...common, ...o };
    }
    const orientation = (ui.form.querySelector('input[name="orientation"]:checked')?.value ?? "horizontal");
    const b = {
        orientation,
        prefix: ui.prefix.value,
        suffix: ui.suffix.value,
        materialityPct: tolerance(ui.materiality),
        breakAxis: ui.breakAxis.value,
        showGapArrow: ui.gapArrow.checked,
    };
    return { ...common, ...b };
}
function writeOptions(o) {
    const set = (el, v) => {
        if (v !== undefined && v !== null)
            el.value = String(v);
    };
    const check = (el, v) => {
        if (typeof v === "boolean")
            el.checked = v;
    };
    const type = typeOf(o);
    ui.chartType.value = type;
    showFieldsFor(type);
    state.annotations = Array.isArray(o["annotations"]) ? o["annotations"].map((a) => ({ ...a })) : [];
    renderAnnotations();
    set(ui.title, o["title"]);
    set(ui.subtitle, o["subtitle"]);
    set(ui.decimals, o["decimals"]);
    set(ui.scale, o["scale"]);
    check(ui.higherIsBetter, o["higherIsBetter"]);
    if (type === "columns" || type === "multiples") {
        check(ui.total, o["showTotal"]);
        set(ui.totalLabel, o["totalLabel"]);
        set(ui.scaleName, o["scaleName"]);
        set(ui.units, o["units"]);
        set(ui.colMateriality, o["materialityPct"]);
        set(ui.planStyle, o["planStyle"]);
        set(ui.varScale, o["varianceScale"]);
        set(ui.axisMax, o["axisMax"]);
        check(ui.pins, o["showPctPins"]);
        check(ui.bars, o["showVarianceBars"]);
    }
    else {
        set(ui.prefix, o["prefix"]);
        set(ui.suffix, o["suffix"]);
        set(ui.materiality, o["materialityPct"]);
        set(ui.breakAxis, o["breakAxis"]);
        check(ui.gapArrow, o["showGapArrow"]);
        const radio = ui.form.querySelector(`input[name="orientation"][value="${String(o["orientation"] ?? "horizontal")}"]`);
        if (radio)
            radio.checked = true;
    }
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
    const out = renderChart(typeOf(options), values, withSharedScale(options));
    if (!out.ok)
        return { result: null, error: out.error, warnings: [], labels: [] };
    return { result: out.result, error: "", warnings: out.warnings, labels: out.labels };
}
/* ---------------- shared (named) scales ---------------- */
const SCALES_KEY = "ibcs.scales";
function scaleKey(name) {
    return name.trim().toLowerCase();
}
function loadScales() {
    const raw = Office.context.document.settings.get(SCALES_KEY);
    return raw && typeof raw === "object" ? raw : {};
}
/** Apply the stored ranges of the chart's named scale (preview and redraw use the same numbers). */
function withSharedScale(options) {
    const name = typeof options["scaleName"] === "string" ? options["scaleName"].trim() : "";
    if (!name || typeOf(options) !== "columns")
        return options;
    const needs = loadScales()[scaleKey(name)];
    if (!needs)
        return options;
    const own = Number(options["axisMax"]) || 0;
    return { ...options, axisMax: Math.max(own, needs.max), pinRange: needs.pin, deltaRange: needs.delta };
}
/**
 * Work out the common ranges of every chart that uses this scale name (reading each
 * chart's table), store them, and report whether they changed, in which case the
 * other charts must be redrawn so they stay comparable.
 */
async function refreshScale(name, current) {
    const key = scaleKey(name);
    const records = Object.values(loadRecords()).filter((r) => typeOf(r.options) === "columns" && scaleKey(String(r.options["scaleName"] ?? "")) === key);
    const list = [];
    const members = [];
    const seen = new Set();
    const add = (values, options) => {
        const p = parseColumns(values, { ...options, axisMax: 0, pinRange: null, deltaRange: null });
        if (p.ok)
            list.push(scaleNeeds(p.model));
    };
    if (current) {
        add(current.values, current.options);
        seen.add(current.id);
    }
    for (const r of records) {
        members.push(r.id);
        if (seen.has(r.id))
            continue;
        const data = await readBinding(r.id);
        if (data)
            add(data.values, r.options);
    }
    if (!list.length)
        return { changed: false, members };
    const merged = mergeNeeds(list);
    const scales = loadScales();
    const changed = JSON.stringify(scales[key]) !== JSON.stringify(merged);
    if (changed) {
        scales[key] = merged;
        Office.context.document.settings.set(SCALES_KEY, scales);
        Office.context.document.settings.saveAsync(() => undefined);
    }
    return { changed, members };
}
/* ---------------- annotations ---------------- */
function fillSelect(sel, labels, keep) {
    sel.replaceChildren(...labels.map((l) => new Option(l, l)));
    if (labels.includes(keep))
        sel.value = keep;
}
function renderAnnotations() {
    ui.annList.replaceChildren();
    state.annotations.forEach((a, k) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = `${a.type === "diff" ? "Arrow" : "Bracket"}: ${a.from} \u2192 ${a.to}${a.label ? ` (${a.label})` : ""}`;
        const rm = document.createElement("button");
        rm.type = "button";
        rm.textContent = "Remove";
        rm.setAttribute("aria-label", `Remove ${name.textContent}`);
        rm.addEventListener("click", () => {
            state.annotations.splice(k, 1);
            renderAnnotations();
            updatePreview();
        });
        li.append(name, rm);
        ui.annList.append(li);
    });
    ui.annAdd.disabled = state.labels.length < 2 || state.annotations.length >= MAX_ANNOTATIONS;
}
function addAnnotation() {
    const from = ui.annFrom.value;
    const to = ui.annTo.value;
    if (!from || !to || from === to) {
        fail("Pick two different bars for the arrow or bracket.");
        return;
    }
    const label = ui.annLabel.value.trim();
    state.annotations.push({ type: ui.annType.value === "bracket" ? "bracket" : "diff", from, to, ...(label ? { label } : {}) });
    ui.annLabel.value = "";
    renderAnnotations();
    updatePreview();
    if (state.editingId)
        say("Added. Click Update chart to put it on the sheet.");
}
function updatePreview() {
    if (!state.values) {
        ui.preview.textContent = "No table selected yet.";
        ui.insert.disabled = true;
        return;
    }
    const { result, error, warnings, labels } = render(state.values, readOptions());
    state.last = result;
    if (labels.length) {
        state.labels = labels;
        fillSelect(ui.annFrom, labels, ui.annFrom.value || labels[0]);
        fillSelect(ui.annTo, labels, ui.annTo.value || labels[labels.length - 1]);
    }
    renderAnnotations();
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
async function drawRecord(rec, values, cascade = true) {
    const name = typeOf(rec.options) === "columns" ? String(rec.options["scaleName"] ?? "").trim() : "";
    let others = [];
    if (name) {
        const s = await refreshScale(name, { id: rec.id, values, options: rec.options });
        if (s.changed && cascade)
            others = s.members.filter((id) => id !== rec.id);
    }
    const { result, error, warnings } = render(values, rec.options);
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
    // The shared scale moved: redraw the other charts on it so they stay comparable.
    for (const id of others) {
        const other = loadRecords()[id];
        const data = await readBinding(id);
        if (!other || !data)
            continue;
        await drawRecord(other, data.values, false);
        state.hashes.set(id, JSON.stringify([data.values, other.options, other.mode]));
    }
    return { mode, warnings: others.length ? [...warnings, `Shared scale "${name}" changed, so ${others.length} other chart${others.length > 1 ? "s were" : " was"} redrawn too.`] : warnings };
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
        if (!force && state.hashes.get(id) === hash) {
            // Same data as the chart on the sheet (e.g. an edit was undone): it is valid, so clear any refusal.
            fail("");
            return;
        }
        const drawn = await drawRecord(rec, data.values);
        state.hashes.set(id, hash);
        fail("");
        if (state.editingId === id) {
            state.values = data.values;
            state.address = data.address;
            updatePreview();
        }
        // After the preview, so its "Previewing…" line does not overwrite what happened on the sheet.
        say(`Updated chart from ${data.address}.${drawn.warnings.length ? ` Check: ${drawn.warnings.join(" ")}` : ""}`);
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
        const kind = { bridge: "Bridge", columns: "Columns", multiples: "Multiples" }[typeOf(rec.options)];
        name.textContent = `${kind}: ${String(rec.options["title"] || rec.id)}`;
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
        state.annotations = [];
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
        let drawnWarnings = [];
        try {
            const drawn = await drawRecord(rec, state.values);
            mode = drawn.mode;
            drawnWarnings = drawn.warnings;
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
        say(`Chart ${mode === "svg" ? "inserted as a vector picture" : "inserted as a PNG picture"}. It updates while this pane is open; save the workbook to keep the link.${drawnWarnings.length ? ` Check: ${drawnWarnings.join(" ")}` : ""}`);
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
ui.annAdd.addEventListener("click", addAnnotation);
ui.chartType.addEventListener("change", () => {
    showFieldsFor(chartType());
    // Bar names differ between chart types, so annotations do not carry over.
    state.annotations = [];
    state.labels = [];
    if (state.editingId) {
        // Changing the type of an existing chart would rebind its meaning; start a new chart instead.
        state.editingId = null;
        ui.insert.textContent = "Insert chart";
        ui.source.textContent = `Table: ${state.address} (new chart)`;
    }
    updatePreview();
});
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
    showFieldsFor(chartType());
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
