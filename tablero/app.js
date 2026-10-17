"use strict";
/* Tablero Viento Sur. Lee window.DATOS (lo genera actualizar.py desde la base) y arma las vistas en el navegador. */
const D = window.DATOS;

// ---------------------------------------------------------------------------------------------- utilidades
const $ = (s, el = document) => el.querySelector(s);
const fmt = (x, d = 0) => x == null || Number.isNaN(+x) ? "—" : Number(x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 0) => x == null || Number.isNaN(+x) ? "—" : fmt(x * 100, d) + "\u00a0%";
const sgn = x => x == null || Number.isNaN(+x) ? "—" : Math.abs(x) < 0.005 ? "0 %" : (x > 0 ? "+" : "−") + pct(Math.abs(x));
const plata = x => x == null || Number.isNaN(+x) ? "—" : (x < 0 ? "−\u2060" : "") + "$\u00a0" + fmt(Math.abs(x));
const plataS = x => (x > 0 ? "+" : "") + plata(x);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fechaAR = iso => iso ? iso.split("-").reverse().join("/") : "—";
const tok = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const gvar = n => `var(--g${n})`;
const suma = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const agrupar = (arr, f) => arr.reduce((m, x) => ((m[f(x)] ??= []).push(x), m), {});
const pillClase = a => /^(Bajar|Probar|Aplicar)/.test(a) ? "p-desc" : /^Dejar/.test(a) ? "p-dejar" : /^(Esperar|Confirmar)/.test(a) ? "p-esperar" : /^No tocar/.test(a) ? "p-gris" : "p-no";
const pill = a => `<span class="pill ${pillClase(a)}">${esc(a)}</span>`;
const chip = n => `<span class="chip" style="--c:${gvar(n)}">${n}</span>`;
const masDias = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const difDias = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);

// ---------------------------------------------------------------------------------------------- índices
const CAT = Object.fromEntries(D.catalogo.map(p => [p.sku, p]));
const DEC = Object.fromEntries(D.productos.map(p => [p.sku, p]));
const LOTES_SKU = agrupar(D.lotes, l => l.sku);
const VENTAS = D.ventas.map(([fecha, sku, suc, u, precio]) => ({ fecha, sku, suc, u, precio }));
// Precio de lista vigente un día: antes de un cambio de lista regía el precio anterior
const CAMBIOS_SKU = agrupar(D.cambios, c => c.sku);
const listaVigente = (sku, fecha) => { const cs = (CAMBIOS_SKU[sku] || []).filter(c => fecha < c.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha)); return cs.length ? cs[0].anterior : CAT[sku].precio; };
const rebajada = v => v.precio < listaVigente(v.sku, v.fecha) * 0.99;
const SUCS = D.sucursales.filter(s => D.lotes.some(l => l.suc === s.id));
const NOM_SUC = Object.fromEntries(D.sucursales.map(s => [s.id, s.nombre]));
const F_MIN = VENTAS.reduce((m, v) => v.fecha < m ? v.fecha : m, "9999"), F_MAX = VENTAS.reduce((m, v) => v.fecha > m ? v.fecha : m, "0000");
const ORDEN_REGLAS = [3, 1, 2, 4, 5, 6, 7, 8, 9];
const COL_SUC = ["#2a6f97", "#c9a227", "#2e7d4f", "#b3402e", "#7a4a9a", "#5a6a74"];
const VIAS = [
  ["Descuento ahora (a prueba)", p => p.nuestro === "ya"],
  ["Descuento si se cumple una condición", p => p.nuestro === "condicional"],
  ["Reponer: se vende solo", p => p.n === 1],
  ["Esperar la temporada y mover stock", p => p.n === 2],
  ["Resolver lo que está en curso", p => p.n === 3 || p.n === 7],
  ["Contar stock y exhibir", p => p.n === 4],
  ["Investigar en el local", p => p.n === 5],
  ["Revisar exhibición o devolver", p => p.n === 6],
  ["Negociar con el proveedor", p => p.n === 8],
  ["Outlet o devolución del excedente", p => p.n === 9],
];
const viaDe = p => VIAS.find(([, f]) => f(p))[0];

// ---------------------------------------------------------------------------------------------- estado (en el link)
const TABS = [["decision", "Decisión"], ["ventas", "Ventas"], ["stock", "Stock y rotación"], ["sucursales", "Sucursales"], ["descuentos", "Descuentos"], ["productos", "Productos"], ["seguimiento", "Seguimiento"], ["datos", "Datos"]];
const DEF = { tab: "decision", desde: F_MIN, hasta: F_MAX, suc: "", rubro: "", tipo: "", grupo: "", sku: "", tabla: "lotes", orden: "", dir: "1", rev: "",
  med: "u", gran: "sem", por: "suc", mapa: "pe" };
const S = { ...DEF };
// Deja el estado siempre coherente, venga de un link o de un selector: valores que no existen se descartan,
// las fechas se acotan a la ventana (y se dan vuelta si están invertidas), y un filtro hijo que ya no entra en sus padres se limpia.
const esFecha = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
function normalizar() {
  const avisos = [], ignorados = [];
  const descartar = k => { ignorados.push(`${k}=${S[k]}`); S[k] = DEF[k]; };
  if (!TABS.some(([t]) => t === S.tab)) descartar("tab");
  for (const k of ["desde", "hasta"]) {
    if (!esFecha(S[k])) descartar(k);
    S[k] = S[k] < F_MIN ? F_MIN : S[k] > F_MAX ? F_MAX : S[k];
  }
  if (S.desde > S.hasta) { [S.desde, S.hasta] = [S.hasta, S.desde]; avisos.push("Las fechas estaban invertidas: se dieron vuelta."); }
  if (S.suc && !SUCS.some(s => s.id === S.suc)) descartar("suc");
  if (S.rubro && !D.catalogo.some(p => p.rubro === S.rubro)) descartar("rubro");
  if (S.tipo && !D.catalogo.some(p => p.tipo === S.tipo)) descartar("tipo");
  if (S.tipo && !D.catalogo.some(p => p.tipo === S.tipo && (!S.rubro || p.rubro === S.rubro))) { avisos.push(`No hay ${S.tipo} en ${S.rubro}: se sacó el filtro de tipo.`); S.tipo = ""; }
  if (S.grupo && !D.grupos.some(g => String(g.n) === S.grupo)) descartar("grupo");
  if (S.sku && !DEC[S.sku]) descartar("sku");
  if (S.sku && !prodsFiltrados(false, true).some(p => p.sku === S.sku)) { avisos.push(`${DEC[S.sku].producto} no entra en los filtros elegidos: se sacó el filtro de producto.`); S.sku = ""; }
  if (!(S.tabla in TABLAS)) descartar("tabla");
  if (!(S.med in MEDIDAS)) descartar("med");
  if (!(S.gran in GRANOS)) descartar("gran");
  if (!(S.por in APERTURAS)) descartar("por");
  if (!(S.mapa in MAPAS)) descartar("mapa");
  if (S.dir !== "1" && S.dir !== "-1") descartar("dir");
  if (ignorados.length) avisos.unshift(`Se ignoraron valores del link que no existen: ${ignorados.join(", ")}.`);
  return avisos;
}
let AVISOS = [];
function leerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const k of Object.keys(DEF)) S[k] = p.has(k) ? p.get(k) : DEF[k];
  AVISOS = normalizar();
  escribirHash();                 // el link queda limpio, con lo que de verdad se está mostrando
}
function escribirHash() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(S)) if (v !== DEF[k] && v !== "") p.set(k, v);
  history.replaceState(null, "", "#" + p.toString());
}
function cambiar(cambios, irArriba = false) {
  Object.assign(S, cambios);
  AVISOS = normalizar();
  escribirHash();
  render();
  if (irArriba) window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------------------------- filtros
const prodsFiltrados = (ignorarSuc = false, ignorarSku = false) => D.productos.filter(p => (!S.rubro || p.rubro === S.rubro) && (!S.tipo || p.tipo === S.tipo) && (!S.grupo || String(p.n) === S.grupo)
  && (ignorarSku || !S.sku || p.sku === S.sku) && (ignorarSuc || !S.suc || (LOTES_SKU[p.sku] || []).some(l => l.suc === S.suc)));
const ventasDe = skus => { const set = new Set(skus); return VENTAS.filter(v => v.fecha >= S.desde && v.fecha <= S.hasta && (!S.suc || v.suc === S.suc) && set.has(v.sku)); };
const lotesDe = skus => { const set = new Set(skus); return D.lotes.filter(l => set.has(l.sku) && (!S.suc || l.suc === S.suc)); };

function renderFiltros() {
  const opciones = (vals, sel, todos) => `<option value="">${todos}</option>` + vals.map(([v, t]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(t)}</option>`).join("");
  const rubros = [...new Set(D.catalogo.map(p => p.rubro))].sort().map(r => [r, r]);
  const tipos = [...new Set(D.catalogo.filter(p => !S.rubro || p.rubro === S.rubro).map(p => p.tipo))].sort().map(t => [t, t]);
  const prods = prodsFiltrados(false, true)        // el producto se elige dentro de los demás filtros, sucursal incluida
    .sort((a, b) => a.producto.localeCompare(b.producto, "es")).map(p => [p.sku, p.producto]);
  const n = ["suc", "rubro", "tipo", "grupo", "sku"].filter(k => S[k]).length + (S.desde !== DEF.desde || S.hasta !== DEF.hasta ? 1 : 0);
  $("#filtros").innerHTML = `<div class="filtros-in">
    <label class="campo" for="f-desde">Desde<input type="date" id="f-desde" value="${S.desde}" min="${F_MIN}" max="${F_MAX}"></label>
    <label class="campo" for="f-hasta">Hasta<input type="date" id="f-hasta" value="${S.hasta}" min="${F_MIN}" max="${F_MAX}"></label>
    <label class="campo" for="f-suc">Sucursal<select id="f-suc">${opciones(SUCS.map(s => [s.id, `${s.id} · ${s.nombre}`]), S.suc, "Todas")}</select></label>
    <label class="campo" for="f-rubro">Rubro<select id="f-rubro">${opciones(rubros, S.rubro, "Todos")}</select></label>
    <label class="campo" for="f-tipo">Tipo<select id="f-tipo">${opciones(tipos, S.tipo, "Todos")}</select></label>
    <label class="campo" for="f-grupo">Grupo<select id="f-grupo">${opciones(D.grupos.map(g => [String(g.n), `${g.n} · ${g.nombre}`]), S.grupo, "Todos")}</select></label>
    <label class="campo" for="f-sku">Producto<select id="f-sku">${opciones(prods, S.sku, "Todos")}</select></label>
    <button class="btn" type="button" id="f-limpiar"${n ? "" : " disabled"}>Limpiar filtros</button>
    <span class="activos">${n ? `<b>${n}</b> ${n === 1 ? "filtro activo" : "filtros activos"} · ` : ""}${fmt(prodsFiltrados().length)} de ${D.productos.length} productos</span>
    ${AVISOS.map(a => `<span class="aviso" role="status">${esc(a)}</span>`).join("")}
  </div>`;
  const on = (id, k) => $(id).addEventListener("change", e => cambiar({ [k]: e.target.value, ...(k === "rubro" ? { tipo: "", sku: "" } : {}) }));
  on("#f-desde", "desde"); on("#f-hasta", "hasta"); on("#f-suc", "suc"); on("#f-rubro", "rubro"); on("#f-tipo", "tipo"); on("#f-grupo", "grupo"); on("#f-sku", "sku");
  $("#f-limpiar").addEventListener("click", () => cambiar({ desde: DEF.desde, hasta: DEF.hasta, suc: "", rubro: "", tipo: "", grupo: "", sku: "", rev: "" }));
}

// ---------------------------------------------------------------------------------------------- tablas, "ver los datos" y CSV
function tablaHTML(cols, filas, opts = {}) {
  const cab = cols.map(c => {
    const ord = opts.ordenable ? ` data-orden="${c.k}"` : "";
    const cls = [c.r ? "r" : "", opts.ordenable && S.orden === c.k ? (S.dir === "1" ? "asc" : "desc") : ""].filter(Boolean).join(" ");
    return `<th${ord}${cls ? ` class="${cls}"` : ""}>${esc(c.t)}</th>`;
  }).join("");
  const cuerpo = filas.map(r => `<tr${opts.clic ? ` class="clic" data-k="${esc(r[opts.clic])}"` : ""}>` +
    cols.map(c => `<td${c.r ? ' class="r num"' : c.cls ? ` class="${c.cls}"` : ""}>${c.f ? c.f(r[c.k], r) : esc(r[c.k])}</td>`).join("") + "</tr>").join("");
  return `<table><thead><tr>${cab}</tr></thead><tbody>${cuerpo || `<tr><td colspan="${cols.length}" class="muted">Sin filas con estos filtros.</td></tr>`}</tbody></table>`;
}
function ordenar(filas) {
  if (!S.orden) return filas;
  const k = S.orden, d = S.dir === "1" ? 1 : -1;
  return [...filas].sort((a, b) => {
    const x = a[k], y = b[k];
    if (x == null) return 1; if (y == null) return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es")) * d;
  });
}
function conectarOrden(raiz) {
  raiz.querySelectorAll("th[data-orden]").forEach(th => th.addEventListener("click", () =>
    cambiar({ orden: th.dataset.orden, dir: S.orden === th.dataset.orden && S.dir === "1" ? "-1" : "1" })));
}
function csvValor(v) {
  if (v == null) return "";
  if (typeof v === "number") return String(v).replace(".", ",");
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function descargarCSV(nombre, cols, filas) {
  const lineas = [cols.map(c => csvValor(c.t)).join(";"), ...filas.map(r => cols.map(c => csvValor(c.csv ? c.csv(r[c.k], r) : r[c.k])).join(";"))];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + lineas.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${nombre}.csv`;
  document.body.append(a); a.click(); a.remove();
}
function verDatos(titulo, cols, filas, nombre) {
  const det = document.createElement("details");
  det.className = "datos";
  det.innerHTML = `<summary>Ver y auditar los datos (${fmt(filas.length)} ${filas.length === 1 ? "fila" : "filas"})</summary>`;
  det.addEventListener("toggle", () => {
    if (!det.open || det.dataset.listo) return;
    det.dataset.listo = "1";
    const cuerpo = document.createElement("div");
    cuerpo.className = "datos-in";
    cuerpo.innerHTML = `<p class="nota">${esc(titulo)}. Son las filas exactas que arman este gráfico o tabla, con los filtros de arriba.</p>`;
    cuerpo.append(tablaAuditable(cols, filas, nombre, { alto: 380 }));
    det.append(cuerpo);
  });
  return det;
}

// Indicadores de cada producto en cada sucursal: los mismos que calcula el Excel
const COLS_INDICADORES = [
  { k: "producto", t: "producto", cls: "t-prod", f: (v, r) => `<b>${esc(v)}</b><br><span class="sku">${r.sku}</span>` , csv: v => v },
  { k: "suc", t: "sucursal" },
  { k: "n", t: "grupo", r: true },
  { k: "ingreso", t: "ingreso", f: fechaAR, csv: v => v },
  { k: "limite", t: "fecha límite", f: (v, r) => `${fechaAR(v)}${r.vencido === "sí" ? ' <span class="mal">vencida</span>' : ""}`, csv: v => v },
  { k: "objetivo", t: "objetivo (u)", r: true, sum: true, f: v => fmt(v) },
  { k: "ritmo_objetivo", t: "ritmo objetivo (u/día)", r: true, f: v => fmt(v, 2), csv: v => v },
  { k: "ritmo_real", t: "ritmo real (u/día)", r: true, f: v => fmt(v, 2), csv: v => v },
  { k: "pct_esperado", t: "% de lo esperado", r: true, f: v => `<span class="${v >= D.criterios.al_dia ? "ok" : "mal"}">${pct(v)}</span>`, csv: v => v },
  { k: "stock_inicial", t: "stock al inicio", r: true, sum: true, f: v => fmt(v) },
  { k: "vendidas", t: "vendidas", r: true, sum: true, f: v => fmt(v) },
  { k: "unidades", t: "stock hoy", r: true, sum: true, f: v => fmt(v) },
  { k: "pct_vendido", t: "% vendido", r: true, f: v => pct(v), csv: v => v },
  { k: "v30", t: "vendidas últimos 30 días", r: true, sum: true, f: v => fmt(v) },
  { k: "dias_de_stock", t: "días de stock", r: true, f: v => v == null ? "sin venta" : fmt(v), csv: v => v },
  { k: "venta_pesos", t: "venta $", r: true, sum: true, f: v => plata(v), csv: v => v },
  { k: "ultima_venta", t: "última venta", f: v => v ? fechaAR(v) : "—", csv: v => v },
  { k: "vendidas_otras", t: "vendidas en otras sucursales", r: true, f: v => fmt(v) },
  { k: "rotacion", t: "¿rotó?", f: v => `<span class="${v === "Sin ventas" ? "mal" : v.startsWith("Vendió, pero") ? "medio" : "ok"}">${esc(v)}</span>`, csv: v => v },
  { k: "descuento", t: "¿tuvo descuento?" },
];

// Tabla para auditar en la página: búsqueda, orden por columna, totales y "mostrar más". El CSV es opcional.
function tablaAuditable(cols, filas, nombre, opts = {}) {
  const cont = document.createElement("div");
  cont.className = "auditable";
  let q = "", orden = "", dir = 1, mostrar = opts.mostrar || 100;
  cont.innerHTML = `<div class="barra-acciones">
      <label class="campo">Buscar en estos datos<input type="search" placeholder="cualquier texto o número"></label>
      <span class="nota cuenta"></span>
      <button class="btn-link" type="button">Bajar en CSV</button>
    </div>
    <div class="tabla-wrap densa aud-tabla" style="max-height:${opts.alto || 520}px;overflow:auto"></div>
    <button class="btn mas" type="button" hidden>Mostrar más</button>`;
  const texto = (c, r) => { const v = r[c.k]; return v == null ? "" : String(v); };
  const filtradas = () => {
    let fs = q ? filas.filter(r => cols.some(c => texto(c, r).toLowerCase().includes(q) || (c.f ? String(c.f(r[c.k], r)).replace(/<[^>]+>/g, "").toLowerCase().includes(q) : false))) : filas;
    if (orden) fs = [...fs].sort((a, b) => { const x = a[orden], y = b[orden]; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es")) * dir; });
    return fs;
  };
  const pintar = () => {
    const fs = filtradas();
    const tot = cols.some(c => c.sum) ? Object.fromEntries(cols.filter(c => c.sum).map(c => [c.k, suma(fs, r => r[c.k])])) : null;
    const cab = cols.map(c => `<th data-k="${c.k}" class="${[c.r ? "r" : "", orden === c.k ? (dir === 1 ? "asc" : "desc") : ""].join(" ")}" style="cursor:pointer">${esc(c.t)}</th>`).join("");
    const cuerpo = fs.slice(0, mostrar).map(r => `<tr${opts.clic ? ` class="clic" data-k="${esc(r[opts.claveClic])}"` : ""}>` +
      cols.map(c => `<td${c.r ? ' class="r num"' : c.cls ? ` class="${c.cls}"` : ""}>${c.f ? c.f(r[c.k], r) : esc(r[c.k])}</td>`).join("") + "</tr>").join("");
    const pie = tot ? `<tfoot><tr>${cols.map((c, i) => `<td class="${c.r ? "r num" : ""}"><b>${i === 0 ? `Total (${fmt(fs.length)} filas)` : c.k in tot ? (c.f ? c.f(tot[c.k], {}) : fmt(tot[c.k])) : ""}</b></td>`).join("")}</tr></tfoot>` : "";
    cont.querySelector(".aud-tabla").innerHTML = `<table><thead><tr>${cab}</tr></thead><tbody>${cuerpo || `<tr><td colspan="${cols.length}" class="muted">Sin filas con estos filtros.</td></tr>`}</tbody>${pie}</table>`;
    cont.querySelector(".cuenta").textContent = `${fmt(Math.min(mostrar, fs.length))} de ${fmt(fs.length)} filas${q ? ` (de ${fmt(filas.length)})` : ""}`;
    const mas = cont.querySelector(".mas");
    mas.hidden = fs.length <= mostrar;
    mas.textContent = `Mostrar ${fmt(Math.min(100, fs.length - mostrar))} filas más`;
    cont.querySelectorAll("th[data-k]").forEach(th => th.addEventListener("click", () => { dir = orden === th.dataset.k ? -dir : 1; orden = th.dataset.k; pintar(); }));
    if (opts.clic) cont.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => opts.clic(tr.dataset.k)));
  };
  let t;
  cont.querySelector("input").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim().toLowerCase(); mostrar = opts.mostrar || 100; pintar(); }, 200); });
  cont.querySelector(".mas").addEventListener("click", () => { mostrar += 100; pintar(); });
  cont.querySelector(".btn-link").addEventListener("click", () => descargarCSV(nombre, cols, filtradas()));
  pintar();
  return cont;
}

const seccion = (titulo, bajada) => {
  const s = document.createElement("section");
  s.className = "sec";
  s.innerHTML = `<div class="sec-cab"><h2>${titulo}</h2></div>${bajada ? `<p class="nota" style="max-width:80ch;color:var(--ink-2)">${bajada}</p>` : ""}`;
  return s;
};
const bloque = (html = "") => { const b = document.createElement("div"); b.className = "bloque"; b.innerHTML = html; return b; };

// ---------------------------------------------------------------------------------------------- gráficos
let CHARTS = [];
function grafico(canvas, cfg) { const c = new Chart(canvas, cfg); CHARTS.push(c); return c; }
function limpiarGraficos() { CHARTS.forEach(c => c.destroy()); CHARTS = []; }
function estiloGraficos() {
  if (!window.Chart) return;
  Chart.defaults.font.family = tok("--f-ui") || "system-ui";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = tok("--muted");
  Chart.defaults.borderColor = tok("--line");
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.tooltip.backgroundColor = tok("--ink");
  Chart.defaults.plugins.tooltip.titleColor = tok("--panel");
  Chart.defaults.plugins.tooltip.bodyColor = tok("--panel");
  Chart.defaults.animation.duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250;
}
function semanas(desde, hasta) {
  const out = [];
  for (let d = desde; d <= hasta; d = masDias(d, 7)) out.push(d);
  return out;
}
const semanaDe = (fecha, desde) => Math.floor(difDias(desde, fecha) / 7);
function svgEvidencia() {
  const ev = D.evidencia, W = 640, left = 200, right = 24, top = 24, rowH = 30, H = top + ev.length * rowH + 36;
  const lo = Math.min(-0.3, ...ev.map(e => e.bajo - 1)), hi = Math.max(0.8, ...ev.map(e => e.alto - 1));
  const x = v => left + (v - lo) / (hi - lo) * (W - left - right);
  let s = `<rect x="${x(D.control.bajo - 1)}" y="${top - 10}" width="${x(D.control.alto - 1) - x(D.control.bajo - 1)}" height="${ev.length * rowH}" fill="var(--warn)" opacity=".1"/>`;
  for (let t = Math.ceil(lo * 5) / 5; t <= hi + 1e-9; t += 0.2) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 10}" y2="${top + ev.length * rowH - 10}" stroke="var(--line)" stroke-width="${Math.abs(t) < 1e-9 ? 1.6 : 1}"/>`;
    s += `<text x="${x(t)}" y="${top + ev.length * rowH + 6}" text-anchor="middle">${t > 0 ? "+" : ""}${Math.round(t * 100)}%</text>`;
  }
  ev.forEach((e, i) => {
    const y = top + i * rowH + 4, c = e.firme ? "var(--good)" : e.debil ? "var(--warn)" : "var(--muted)";
    s += `<text class="lab" x="${left - 12}" y="${y + 4}" text-anchor="end">${esc(e.tipo)} · ${pct(e.descuento)}</text>`;
    s += `<line x1="${x(e.bajo - 1)}" x2="${x(e.alto - 1)}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="3" opacity=".45" stroke-linecap="round"/>`;
    s += `<circle cx="${x(e.respuesta - 1)}" cy="${y}" r="6" fill="${c}"><title>${esc(e.tipo)}: ${sgn(e.respuesta - 1)} (rango ${sgn(e.bajo - 1)} a ${sgn(e.alto - 1)}), medido en ${esc(e.referencia)}</title></circle>`;
    s += `<text x="${x(e.respuesta - 1)}" y="${y - 10}" text-anchor="middle">${sgn(e.respuesta - 1)}</text>`;
  });
  s += `<text x="${x(D.control.resp - 1)}" y="${H - 4}" text-anchor="middle" fill="var(--warn)">control sin cambios ${sgn(D.control.resp - 1)}</text>`;
  return `<svg class="evid" viewBox="0 0 ${W} ${H}" role="img" aria-label="Respuesta al descuento por tipo de producto">${s}</svg>`;
}

// ---------------------------------------------------------------------------------------------- vista: Decisión
function vistaDecision(main) {
  const P = prodsFiltrados();
  if (!P.length) { main.innerHTML = `<div class="vacio">Ningún producto cumple estos filtros. Probá con "Limpiar filtros".</div>`; return; }
  const skus = P.map(p => p.sku);
  const L = lotesDe(skus);
  const stock = suma(P, p => p.stock), capital = suma(P, p => p.stock * p.costo);
  const vencidas = suma(L.filter(l => l.vencido === "sí"), l => l.unidades), stockL = suma(L, l => l.unidades);
  const atrasados = P.filter(p => p.pct_esperado < D.criterios.al_dia).length;
  const ya = P.filter(p => p.nuestro === "ya"), cond = P.filter(p => p.nuestro === "condicional"), sin = P.length - ya.length - cond.length;
  const E = D.efecto.filter(e => P.some(p => p.producto === e.producto));
  const uB = suma(E, e => e.u_base), uE = suma(E, e => e.u_esp), mB = suma(E, e => e.m_base), mE = suma(E, e => e.m_esp);
  const mPeor = suma(E, e => e.m_bajo), mMejor = suma(E, e => e.m_alto);     // escenarios: peor sucursal y mejor sucursal con el mismo descuento
  const vias = VIAS.map(([nombre, f]) => { const g = P.filter(p => viaDe(p) === nombre); return { via: nombre, productos: g.length, stock: suma(g, p => p.stock), capital: suma(g, p => p.stock * p.costo) }; })
    .filter(v => v.productos);
  const sinPrecio = vias.filter(v => !/^Descuento/.test(v.via)).sort((a, b) => b.stock - a.stock);
  const filtrado = P.length < D.productos.length;

  // 1 · La respuesta
  const s1 = document.createElement("section");
  s1.className = "sec";
  s1.innerHTML = `<div class="sec-cab"><h2>${filtrado ? `La respuesta para ${P.length} productos filtrados` : "La respuesta"}</h2><span class="nota">Foto del ${D.foto}</span></div>
    <div class="bloque respuesta">
      <ol>
        <li><b>El problema</b><p>${atrasados} de ${P.length} productos venden menos del ${pct(D.criterios.al_dia)} de lo esperado, y el ${pct(vencidas / (stockL || 1))} del stock (${fmt(vencidas)} u) ya pasó su fecha límite.</p></li>
        <li><b>Qué proponemos</b><p>${ya.length ? `Descuento ahora en ${ya.length}, siempre a prueba y medido` : "Ningún descuento inmediato"}${cond.length ? `; en ${cond.length} más, si se cumple una condición` : ""}. Los otros ${sin} se resuelven sin tocar el precio: ${sinPrecio.slice(0, 3).map(v => v.via.split(":")[0].toLowerCase()).join(", ")}.</p></li>
        <li><b>Qué esperamos</b><p>${E.length ? `Con los descuentos de ahora, ${fmt(uB)} → ${fmt(uE, 1)} u por mes. En 2 meses dejarían entre ${plataS(mPeor - mB)} y ${plataS(mMejor - mB)} de margen contra no tocar el precio, según cómo respondió antes el mismo descuento: el descuento mueve poco.` : "El precio no cambia en estos productos."} El stock quieto sale sobre todo por las otras vías: ${sinPrecio[0] ? `${sinPrecio[0].via.toLowerCase()} (${fmt(sinPrecio[0].stock)} u)` : "—"}${sinPrecio[1] ? ` y ${sinPrecio[1].via.toLowerCase()} (${fmt(sinPrecio[1].stock)} u)` : ""}.</p></li>
      </ol>
      <div class="cifras">
        <div class="cifra"><b>${fmt(stock)} u</b><span>en stock · ${plata(capital)} a costo</span></div>
        <div class="cifra mala"><b>${pct(vencidas / (stockL || 1))}</b><span>del stock ya pasó su fecha límite</span></div>
        <div class="cifra buena"><b>${ya.length} + ${cond.length}</b><span>con descuento ya + condicionales</span></div>
        <div class="cifra"><b>${sin}</b><span>se resuelven sin tocar el precio</span></div>
        <div class="cifra"><b>${E.length ? sgn(uE / (uB || 1) - 1) : "—"}</b><span>unidades por mes en los que se descuentan</span></div>
        <div class="cifra mala"><b>${P.filter(p => p.consultora.startsWith("descontar")).length}</b><span>descuenta la consultora; coincide en ${P.filter(p => p.coincide === "sí").length}</span></div>
      </div>
    </div>`;
  main.append(s1);

  // 2 · El problema
  const s2 = seccion("El problema", "Cada punto es un producto: qué tan al día vende (ritmo del lote, la cuenta de la consigna) y cuántos meses tardaría en vender su stock al ritmo del último mes. Arriba a la izquierda está lo que no rota.");
  const b2 = bloque(`<div class="dos"><div><h3>Ritmo contra stock, producto por producto</h3><div class="graf alto"><canvas id="g-disp" aria-label="Ritmo contra meses de stock"></canvas></div></div>
    <div><h3>Dónde está el stock (claro: total · oscuro: ya vencido)</h3><div class="hbars" id="stock-grupos"></div></div></div>`);
  s2.append(b2);
  main.append(s2);
  const techo = 190;   // los que no vendieron en el último mes se dibujan arriba de todo, en la franja "sin venta"
  grafico($("#g-disp"), {
    type: "scatter",
    data: { datasets: D.grupos.filter(g => P.some(p => p.n === g.n)).map(g => ({
      label: `${g.n} · ${g.nombre}`, backgroundColor: tok(`--g${g.n}`), pointRadius: 5, pointHoverRadius: 7,
      data: P.filter(p => p.n === g.n).map(p => ({ x: p.pct_esperado * 100, y: p.meses == null ? techo : Math.min(p.meses, 150), p })) })) },
    options: {
      maintainAspectRatio: false, onClick: (_, els) => { if (els[0]) { const p = els[0].element.$context.raw.p; cambiar({ tab: "productos", sku: p.sku }, true); } },
      scales: { x: { title: { display: true, text: "% de lo esperado (ritmo real ÷ objetivo)" }, ticks: { callback: v => v + "%" } },
                y: { type: "logarithmic", min: 0.3, max: 200, title: { display: true, text: "meses de stock al ritmo del último mes" },
                     ticks: { autoSkip: false, callback: v => v === 200 ? "sin venta" : [0.5, 1, 3, 10, 30, 100].includes(v) ? String(v).replace(".", ",") : null } } },
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => { const p = c.raw.p; return `${p.producto}: ${pct(p.pct_esperado)} de lo esperado, ${p.meses == null ? "sin venta" : fmt(p.meses, 1) + " meses de stock"} · ${p.accion}`; } } } }
    }
  });
  const porGrupo = D.grupos.map(g => { const ps = P.filter(p => p.n === g.n), ls = L.filter(l => ps.some(p => p.sku === l.sku));
    return { n: g.n, nombre: g.nombre, productos: ps.length, stock: suma(ls, l => l.unidades), vencidas: suma(ls.filter(l => l.vencido === "sí"), l => l.unidades) }; }).filter(g => g.productos);
  const mx = Math.max(...porGrupo.map(g => g.stock), 1);
  $("#stock-grupos").innerHTML = porGrupo.map(g => `<div class="hbar"><span>${chip(g.n)} ${esc(g.nombre)}</span>
    <span class="pista" title="${fmt(g.stock)} u, ${fmt(g.vencidas)} vencidas"><i style="width:${100 * g.vencidas / mx}%;background:${gvar(g.n)}"></i><i style="width:${100 * (g.stock - g.vencidas) / mx}%;background:${gvar(g.n)};opacity:.35"></i></span>
    <span class="num r">${fmt(g.stock)} u</span></div>`).join("");
  b2.append(verDatos("Productos con su ritmo y stock", [
    { k: "producto", t: "producto", cls: "t-prod" }, { k: "n", t: "grupo", r: true }, { k: "pct_esperado", t: "% de lo esperado", r: true, f: v => pct(v), csv: v => v },
    { k: "v30", t: "vendidas último mes", r: true, f: v => fmt(v) }, { k: "stock", t: "stock", r: true, f: v => fmt(v) },
    { k: "meses", t: "meses de stock", r: true, f: v => v == null ? "sin venta" : fmt(v, 1) }], P, "problema"));

  // 3 · Cómo decidimos
  const s3 = seccion("Cómo decidimos", "Cada producto pasa por estas preguntas en orden y se queda en la primera que se cumple. El descuento recién se discute al final: antes se descarta todo lo que tiene otra explicación. Tocá un paso para ver sus productos.");
  const b3 = bloque(`<div class="recorrido" id="recorrido"></div>`);
  s3.append(b3);
  main.append(s3);
  let quedan = P.length;
  const rec = $("#recorrido", b3);
  ORDEN_REGLAS.forEach((g, i) => {
    const llegan = P.filter(p => p.pasos.length > i), sequedan = llegan.filter(p => p.pasos[i].cumple);
    const pregunta = (llegan[0]?.pasos[i]?.pregunta) || D.grupos.find(x => x.n === g).regla;
    const info = D.grupos.find(x => x.n === g);
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "paso"; btn.style.setProperty("--c", gvar(g));
    btn.innerHTML = `<span class="n">${g}</span><span class="q">${esc(pregunta)}<small>${esc(info.nombre)} → ${esc(info.palanca)}</small></span>
      <span class="barra"><span class="pista"><i style="width:${100 * sequedan.length / P.length}%"></i><i style="width:${100 * (llegan.length - sequedan.length) / P.length}%"></i></span>
      <span><b class="num" style="color:var(--ink)">${sequedan.length}</b> se quedan · ${llegan.length - sequedan.length} siguen</span></span>`;
    btn.addEventListener("click", () => cambiar({ tab: "productos", grupo: String(g), sku: "" }, true));
    rec.append(btn);
    quedan -= sequedan.length;
  });
  const en9 = P.filter(p => p.n === 9), v9 = agrupar(en9, p => p.criterios?.veredicto || "no");
  rec.insertAdjacentHTML("beforeend", `<div class="veredictos"><span class="nota">En el grupo 9, los criterios del descuento deciden:</span>
    ${v9.bajar ? pill(`Bajar: ${v9.bajar.length}`) : ""}${v9.probar ? pill(`Probar 4 semanas: ${v9.probar.length}`) : ""}${v9.no ? `<span class="pill p-no">No bajar: ${v9.no.length}</span>` : ""}</div>`);

  const b3b = bloque(`<div class="dos">
    <div><h3>Los criterios del descuento</h3>
      <p class="nota" style="margin:6px 0 10px">Se aplican con el descuento que ya se probó en su tipo. Los dos primeros son obligatorios; los otros tres suman: con los tres se baja, con dos se prueba 4 semanas.</p>
      <table><tbody>
        <tr><td><b>1 · Su tipo responde</b></td><td>El rango del efecto no cruza el cero (firme). Si fue de ${sgn(D.criterios.respuesta_debil - 1)} o más y la venta se sostuvo después, es débil: como mucho se prueba.</td></tr>
        <tr><td><b>2 · Queda margen</b></td><td>Después del descuento queda al menos ${pct(D.criterios.margen_minimo)} de margen.</td></tr>
        <tr><td><b>3 · El ahorro se nota</b></td><td>El cliente ahorra ${plata(D.criterios.ahorro_minimo)} o más por unidad.</td></tr>
        <tr><td><b>4 · No es el más barato</b></td><td>Si ya es el más barato de su tipo, bajarlo no cambia la elección.</td></tr>
        <tr><td><b>5 · No se adelantan compras</b></td><td>En su tipo, la venta después del descuento no cayó debajo de antes.</td></tr>
      </tbody></table></div>
    <div><h3>¿En qué tipos un descuento mueve la venta?</h3>
      <p class="nota" style="margin:6px 0 4px">Los ${D.evidencia.length} descuentos aplicados (${D.vigencia}), uno por tipo: venta por día con descuento contra el resto de la ventana. Verde: firme; ámbar: débil; gris: sin respuesta. La banda es el control sin cambios.</p>
      ${svgEvidencia()}</div></div>`);
  s3.append(b3b);
  b3b.append(verDatos("Evidencia por tipo", [
    { k: "tipo", t: "tipo" }, { k: "referencia", t: "medido en" }, { k: "descuento", t: "descuento", r: true, f: v => pct(v), csv: v => v },
    { k: "respuesta", t: "respuesta", r: true, f: v => sgn(v - 1), csv: v => v - 1 }, { k: "bajo", t: "rango bajo", r: true, f: v => sgn(v - 1), csv: v => v - 1 },
    { k: "alto", t: "rango alto", r: true, f: v => sgn(v - 1), csv: v => v - 1 }, { k: "firme", t: "¿firme?", f: (v, r) => v ? "sí" : r.debil ? "débil" : "no", csv: (v, r) => v ? "sí" : r.debil ? "débil" : "no" },
    { k: "despues", t: "después (corregido por temporada)", r: true, f: v => sgn(v - 1), csv: v => v - 1 }], D.evidencia, "evidencia_por_tipo"));

  // 4 · Qué esperamos
  const s4 = seccion("Qué esperamos", "Por qué vía sale el stock de cada producto. El descuento es una vía chica: la mayor parte del stock quieto se mueve reponiendo, moviendo, exhibiendo, devolviendo o negociando.");
  const mxv = Math.max(...vias.map(v => v.stock), 1);
  const b4 = bloque(`<div class="dos"><div><h3>Stock según la vía por la que sale</h3><div class="hbars">${vias.map(v => `<div class="hbar"><span>${esc(v.via)}<br><span class="muted" style="font-size:.76rem">${v.productos} ${v.productos === 1 ? "producto" : "productos"} · ${plata(v.capital)} a costo</span></span>
      <span class="pista"><i style="width:${100 * v.stock / mxv}%;background:${/^Descuento/.test(v.via) ? "var(--good)" : "var(--accent)"}"></i></span>
      <span class="num r">${fmt(v.stock)} u</span></div>`).join("")}</div>
      <p class="nota" style="margin-top:8px">Cada producto está en una sola vía: la de su acción principal.</p></div>
    <div><h3>Los descuentos de ahora: margen en 2 meses contra no tocar el precio</h3>${E.length ? `<div class="graf bajo"><canvas id="g-efecto"></canvas></div>
      <p class="nota">Cada escenario es lo que pasó antes con el mismo descuento (mismo tipo y mismo %) en una sucursal, corregido por temporada: 4 semanas con descuento y el mes siguiente. En total: ${plataS(mPeor - mB)} si responden como la peor sucursal, ${plataS(mE - mB)} como todas juntas, ${plataS(mMejor - mB)} como la mejor.</p>` : `<p class="nota">Ninguno de los productos filtrados tiene descuento ahora.</p>`}</div></div>`);
  s4.append(b4);
  main.append(s4);
  if (E.length) grafico($("#g-efecto"), {
    type: "bar",
    data: { labels: E.map(e => corto(e.producto, 18)), datasets: [["Peor sucursal", "--bad"], ["Todas juntas", "--ink-2"], ["Mejor sucursal", "--good"]].map(([t, col], i) => ({
      label: t, data: E.map(e => e.escenarios[i].dif), backgroundColor: tok(col) })) },
    options: { indexAxis: "y", maintainAspectRatio: false,
      scales: { x: { ticks: { callback: v => plataS(v), maxTicksLimit: innerWidth < 560 ? 4 : 7 }, grid: { color: c => c.tick.value === 0 ? tok("--ink-2") : tok("--line") } }, y: { grid: { display: false } } },
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: {
        title: c => E[c[0].dataIndex].producto,
        label: c => { const x = E[c.dataIndex].escenarios[c.datasetIndex]; return `${x.escenario}: ${plataS(x.dif)}`; },
        afterLabel: c => { const e = E[c.dataIndex], x = e.escenarios[c.datasetIndex];
          return [`como ${x.medido_en}: venta ${sgn(x.dur)} durante, ${sgn(x.desp)} el mes siguiente`, `para empatar tiene que vender ${sgn(e.equilibrio)}`]; } } } } }
  });
  if (E.length) b4.append(verDatos("Escenarios de cada descuento (hoja Propuesta, al final)", [
    { k: "producto", t: "producto", cls: "t-prod" }, { k: "escenario", t: "escenario" }, { k: "medido_en", t: "medido en" },
    { k: "dur", t: "venta durante vs antes", r: true, f: v => sgn(v), csv: v => v }, { k: "desp", t: "venta el mes siguiente", r: true, f: v => sgn(v), csv: v => v },
    { k: "u_dur", t: "u durante (4 sem)", r: true, f: v => fmt(v, 1), csv: v => v }, { k: "u_desp", t: "u mes siguiente", r: true, f: v => fmt(v, 1), csv: v => v },
    { k: "margen", t: "margen 2 meses", r: true, f: v => plata(v), csv: v => v }, { k: "sin", t: "sin descuento", r: true, f: v => plata(v), csv: v => v },
    { k: "dif", t: "diferencia", r: true, sum: true, f: v => `<span class="${v >= 0 ? "ok" : "mal"}">${plataS(v)}</span>`, csv: v => v },
    { k: "equilibrio", t: "para empatar tiene que vender", r: true, f: v => sgn(v), csv: v => v }],
    E.flatMap(e => e.escenarios.map(x => ({ ...x, producto: e.producto, sin: e.m_base, equilibrio: e.equilibrio }))), "escenarios_descuentos"));
  b4.append(verDatos("Vía por producto", [
    { k: "producto", t: "producto", cls: "t-prod" }, { k: "via", t: "vía" }, { k: "accion", t: "acción" }, { k: "stock", t: "stock", r: true, f: v => fmt(v) },
    { k: "capital", t: "a costo", r: true, f: v => plata(v), csv: v => v }], P.map(p => ({ ...p, via: viaDe(p), capital: p.stock * p.costo })), "vias"));

  // 5 · La consultora
  const s5 = seccion("La consultora", `Descuenta en ${P.filter(p => p.consultora.startsWith("descontar")).length} de ${P.length} productos; esta propuesta, en ${ya.length} ahora y ${cond.length} condicionales. Tomaríamos solo una parte: su "no descontar" cuando la venta acompaña al stock y su descuento en productos lentos de los tipos que responden, con el porcentaje que se probó.`);
  const mxc = Math.max(...D.grupos.map(g => P.filter(p => p.n === g.n).length), 1);
  const b5 = bloque(`<div class="dos"><div><h3>¿Coincide su decisión de precio? Por grupo</h3><div class="hbars">${D.grupos.filter(g => P.some(p => p.n === g.n)).map(g => {
      const ps = P.filter(p => p.n === g.n), si = ps.filter(p => p.coincide === "sí").length;
      return `<div class="hbar"><span>${chip(g.n)} ${esc(g.nombre)}</span><span class="pista" title="${si} coinciden, ${ps.length - si} no"><i style="width:${100 * si / mxc}%;background:var(--good)"></i><i style="width:${100 * (ps.length - si) / mxc}%;background:var(--bad)"></i></span><span class="num r">${si} de ${ps.length}</span></div>`;
    }).join("")}</div><div class="leyenda" style="margin-top:8px"><span><i style="background:var(--good)"></i>coincide</span><span><i style="background:var(--bad)"></i>no coincide</span></div></div>
    <div><h3>Dónde se aparta, comprobable con las hojas</h3><table><tbody>${D.consultora.chequeos.map(c => `<tr><td>${esc(c.chequeo)}</td><td class="r num">${c.productos}</td></tr>`).join("")}</tbody></table>
      <p class="nota" style="margin-top:8px">Descontar los productos que venden al día cedería unos ${plata(D.consultora.regalo)} en 30 días sin necesidad. De ${D.consultora.aceptadas} sugerencias aceptadas, solo ${D.consultora.aplicadas} llegaron al precio cobrado.</p></div></div>`);
  s5.append(b5);
  main.append(s5);
  b5.append(verDatos("Consultora contra esta propuesta", [
    { k: "producto", t: "producto", cls: "t-prod" }, { k: "n", t: "grupo", r: true }, { k: "consultora", t: "consultora" }, { k: "accion", t: "esta propuesta" },
    { k: "coincide", t: "¿coincide?" }], P, "consultora"));
}

// ---------------------------------------------------------------------------------------------- vista: Productos (lista y ficha)
function vistaProductos(main) {
  if (S.sku && DEC[S.sku]) { vistaFicha(main, S.sku); return; }
  const P = prodsFiltrados().map(p => ({ ...p, via: viaDe(p) }));
  const s = seccion(`Productos <span class="muted" style="font-weight:400;font-size:1rem">(${P.length})</span>`, "Tocá un producto para ver su ficha: qué le pasa en cada sucursal, por qué cayó en su grupo, cómo le fue con los criterios del descuento y su historial de precio. Tocá un encabezado para ordenar.");
  const cols = [
    { k: "producto", t: "producto", cls: "t-prod", f: (v, r) => `<b>${esc(v)}</b><br><span class="sku">${r.sku} · ${esc(r.sucursales)}</span>` },
    { k: "n", t: "grupo", cls: "t-grupo", f: (v, r) => `${chip(v)} <span class="muted">${esc(r.grupo_nombre)}</span>` },
    { k: "accion", t: "acción", cls: "t-accion", f: v => pill(v) },
    { k: "stock", t: "stock", r: true, f: v => fmt(v) },
    { k: "pct_esperado", t: "% de lo esperado", r: true, f: v => pct(v), csv: v => v },
    { k: "v30", t: "vendidas último mes", r: true, f: v => fmt(v) },
    { k: "meses", t: "meses de stock", r: true, f: v => v == null ? "sin venta" : fmt(v, 1) },
    { k: "consultora", t: "consultora" },
    { k: "coincide", t: "¿coincide?", f: v => v === "sí" ? '<span class="ok">sí</span>' : '<span class="mal">no</span>' },
  ];
  const filas = ordenar(P);
  const b = bloque(`<div class="tabla-wrap">${tablaHTML(cols, filas, { ordenable: true, clic: "sku" })}</div>`);
  b.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => cambiar({ sku: tr.dataset.k }, true)));
  conectarOrden(b);
  b.append(verDatos("Productos con su decisión", [
    { k: "sku", t: "sku" }, { k: "producto", t: "producto" }, { k: "rubro", t: "rubro" }, { k: "tipo", t: "tipo" }, { k: "proveedor", t: "proveedor" },
    { k: "n", t: "grupo" }, { k: "accion", t: "acción" }, { k: "condicion", t: "condición" }, { k: "motivo", t: "motivo", cls: "t-texto" }, { k: "ademas", t: "además", cls: "t-texto" },
    { k: "indicador", t: "indicador" }, { k: "linea_base", t: "línea base" }, { k: "meta", t: "meta" }, { k: "revisar", t: "revisar el" },
    { k: "si_no", t: "si no se cumple" }, { k: "consultora", t: "consultora" }, { k: "coincide", t: "¿coincide?" }], filas, "productos"));
  s.append(b);
  main.append(s);
}

function vistaFicha(main, sku) {
  const p = DEC[sku], c = CAT[sku], L = (LOTES_SKU[sku] || []).filter(l => !S.suc || l.suc === S.suc);
  const V = VENTAS.filter(v => v.sku === sku && v.fecha >= S.desde && v.fecha <= S.hasta && (!S.suc || v.suc === S.suc));
  const cab = document.createElement("section");
  cab.className = "sec";
  cab.innerHTML = `<button class="btn volver" type="button">← Todos los productos</button>
    <div class="ficha-cab"><div><h2>${esc(p.producto)}</h2>
      <div class="meta"><span class="sku">${sku}</span><span>${esc(c.rubro)} · ${esc(c.tipo)}</span><span>proveedor ${esc(c.proveedor)}</span>
      <span>precio ${plata(c.precio)} · costo ${plata(c.costo)} · margen ${pct(p.margen)}</span></div></div>
      <div style="text-align:right">${chip(p.n)} <span class="muted">${esc(p.grupo_nombre)}</span><div style="margin-top:6px">${pill(p.accion)}</div></div></div>`;
  cab.querySelector(".volver").addEventListener("click", () => cambiar({ sku: "" }, true));
  main.append(cab);

  // La decisión
  const s1 = seccion("La decisión");
  s1.append(bloque(`<div class="decision"><dl>
      <dt>Acción</dt><dd>${pill(p.accion)}</dd>
      ${p.condicion ? `<dt>Condición</dt><dd>${esc(p.condicion)}</dd>` : ""}
      <dt>Por qué</dt><dd>${esc(p.motivo)}</dd>
      ${p.ademas ? `<dt>Además</dt><dd>${esc(p.ademas)}</dd>` : ""}</dl>
    <dl>${p.indicador ? `<dt>Indicador</dt><dd>${esc(p.indicador)}</dd><dt>Línea base → meta</dt><dd>${esc(p.linea_base)} → ${esc(p.meta)}</dd>
      <dt>Revisar el</dt><dd class="num">${esc(p.revisar)}</dd>${p.si_no ? `<dt>Si no se cumple</dt><dd>${esc(p.si_no)}</dd>` : ""}` : ""}
      <dt>Consultora</dt><dd>${esc(p.consultora)} · ${p.coincide === "sí" ? '<span class="ok">coincide</span>' : '<span class="mal">no coincide</span>'}</dd></dl></div>`));
  main.append(s1);

  // Seguimiento de su recomendación (si hay fotos anteriores en la base)
  const SGp = (D.seguimiento || []).find(r => r.sku === sku);
  if (SGp) {
    const sS = seccion("¿Se está cumpliendo?", `Recomendación desde el ${fechaAR(SGp.desde)}: <b>${esc(SGp.accion)}</b>. Medida hasta la foto del ${D.foto} (${SGp.dias} días), sumando las sucursales.`);
    const bS = bloque(`<div class="dos"><div><h3>Unidades por semana desde la recomendación</h3><div class="graf bajo"><canvas id="g-seg-prod"></canvas></div></div>
      <div><dl class="seg-dl"><dt>Estado</dt><dd>${estadoHTML(SGp)}</dd>
        <dt>Unidades por semana</dt><dd class="num">${fmt(SGp.u_sem_antes, 1)} antes → <b>${fmt(SGp.u_sem_despues, 1)}</b> desde la recomendación${SGp.meta_u_sem ? ` (meta ${fmt(SGp.meta_u_sem, 1)})` : ""}</dd>
        <dt>Precio cobrado</dt><dd class="num">${SGp.precio_cobrado ? `${plata(SGp.precio_cobrado)} (lista ${plata(SGp.precio_lista)})${SGp.nuestro === "ya" ? ` · ${SGp.aplicado ? '<span class="ok">el descuento se ve en caja</span>' : '<span class="mal">el descuento no se ve en caja</span>'}` : ""}` : "sin ventas"}</dd>
        <dt>Stock por foto</dt><dd class="num">${SGp.stock.map(x => `${fechaAR(x.fecha).slice(0, 5)}: ${fmt(x.u)}`).join(" → ")}</dd>
        ${SGp.accion_nueva && SGp.accion_nueva !== SGp.accion ? `<dt>En esta foto</dt><dd>cambia a ${pill(SGp.accion_nueva)}</dd>` : ""}</dl></div></div>`);
    sS.append(bS);
    main.append(sS);
    const sem = SGp.semanas, ref = [["antes", SGp.u_sem_antes, "--muted"], ...(SGp.meta_u_sem ? [["meta", SGp.meta_u_sem, "--good"]] : [])];
    grafico($("#g-seg-prod", bS), {
      data: { labels: sem.map(w => fechaAR(w.desde).slice(0, 5) + (w.dias < 7 ? ` (${w.dias} d)` : "")), datasets: [
        { type: "bar", label: "unidades por semana", data: sem.map(w => w.u / w.dias * 7), backgroundColor: tok("--accent"), order: 2 },
        ...ref.map(([t, v, c]) => ({ type: "line", label: t, data: sem.map(() => v), borderColor: tok(c), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, order: 1 }))] },
      options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: "unidades por semana" } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 1)} u/semana` } } } }
    });
  }

  // Por qué cayó en su grupo y criterios
  const cr = p.criterios || {};
  const filaCrit = (nombre, ok, valor, regla) => `<tr><td><b>${nombre}</b><br><span class="muted" style="font-size:.8rem">${regla}</span></td><td>${ok == null ? '<span class="medio">~ débil</span>' : ok ? '<span class="ok">✓ sí</span>' : '<span class="mal">✗ no</span>'}</td><td>${valor}</td></tr>`;
  const s2 = seccion("Por qué esta decisión");
  s2.append(bloque(`<div class="dos">
    <div><h3>Por qué cayó en el grupo ${p.n}</h3><p class="nota" style="margin:4px 0 6px">Las preguntas en orden, hasta la primera que se cumple.</p>
      <ol class="pasos">${p.pasos.map(x => `<li><span class="marca-p ${x.cumple ? "ok" : "muted"}">${x.cumple ? "✓" : "✗"}</span><span>${esc(x.pregunta)}</span><span class="dato">${esc(x.dato)}</span></li>`).join("")}</ol></div>
    <div><h3>Los criterios del descuento</h3><p class="nota" style="margin:4px 0 6px">${p.evalua_descuento ? `Con el ${pct(cr.descuento)} que se probó en su tipo. Veredicto: <b>${esc(cr.veredicto || "—")}</b>.` : "Su grupo no evalúa descuento: se muestran como referencia."}</p>
      ${cr.descuento != null ? `<table class="criterios"><tbody>
        ${filaCrit("Su tipo responde", cr.tipo === "firme" ? true : cr.tipo === "débil" ? null : false, `${esc(cr.tipo)} (${esc(cr.referencia)}: ${sgn(cr.respuesta)})`, "obligatorio")}
        ${filaCrit("Queda margen", cr.margen_ok, pct(cr.margen), `obligatorio · ≥ ${pct(D.criterios.margen_minimo)}`)}
        ${filaCrit("El ahorro se nota", cr.ahorro_ok, plata(cr.ahorro), `≥ ${plata(D.criterios.ahorro_minimo)}`)}
        ${filaCrit("No es el más barato", cr.posicion_ok, `${cr.rank}.º de ${cr.n_tipo} en precio`, "en su tipo")}
        ${filaCrit("No se adelantan compras", cr.despues_ok, `después ${sgn(cr.despues)}`, "en su tipo")}</tbody></table>` : `<p class="nota">No hay evidencia de su tipo.</p>`}</div></div>`));
  main.append(s2);

  // Ritmo del lote (la cuenta de la consigna): objetivo = unidades_objetivo ÷ días de ingreso a fecha límite;
  // real = vendidas desde el ingreso (o desde el inicio de las ventas, si el lote es anterior) ÷ esos días
  const INI = D.inicio.split("/").reverse().join("-");
  const desdeLote = l => l.ingreso > INI ? l.ingreso : INI;
  const alDia = l => l.pct_esperado >= D.criterios.al_dia;
  const sR = seccion("¿Viene al día? Ritmo del lote",
    `Ritmo objetivo = unidades que se esperaba vender ÷ días entre el ingreso y la fecha límite. Ritmo real = lo vendido desde el ingreso (o desde el ${fechaAR(INI)}, si el lote es anterior) ÷ esos días, hasta la foto del ${D.foto}. Al día = ${pct(D.criterios.al_dia)} o más de lo esperado. No depende del filtro de fechas.`);
  if (!L.length) sR.append(bloque(`<div class="vacio">Este producto no tiene stock en ${esc(S.suc)}.</div>`));
  else {
    // Escribe el % de lo esperado cumplido en el punto que se le indique de cada lote (verde al día, rojo atrasado)
    const pctCumplido = (id, punto) => ({ id, afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      L.forEach((l, i) => { const el = punto(chart, i); if (!el) return;
        ctx.save(); ctx.font = `600 12px ${tok("--f-num") || "monospace"}`; ctx.fillStyle = tok(alDia(l) ? "--good" : "--bad"); ctx.textBaseline = "middle";
        ctx.fillText(pct(l.pct_esperado), el.x + 6, el.y); ctx.restore(); }); } });
    const bR = bloque(`<div class="dos"><div><h3>Unidades por día: objetivo contra real</h3><div class="graf bajo" style="height:${Math.max(180, 70 * L.length + 70)}px"><canvas id="g-ritmo"></canvas></div></div>
      <div><h3>Vendido acumulado contra lo esperado</h3><div class="graf bajo" style="height:${Math.max(180, 70 * L.length + 70)}px"><canvas id="g-ritmo-acum"></canvas></div></div></div>
      <p class="nota" style="margin-top:6px">El número al final de cada barra y de cada línea es el <b>% de lo esperado cumplido</b> (ritmo real ÷ ritmo objetivo).</p>
      <ul class="ritmo-lotes">${L.map(l => {
        const dias = difDias(desdeLote(l), D.foto_iso) + 1, esperadas = l.ritmo_objetivo * dias, vendio = l.ritmo_real * dias, quedan = difDias(D.foto_iso, l.limite);
        return `<li><b>${l.suc}</b> <span class="muted">${esc(NOM_SUC[l.suc])}</span> · vendió ${fmt(vendio)} de ${fmt(esperadas)} esperadas en ${dias} días
          (<span class="${alDia(l) ? "ok" : "mal"}">${pct(l.pct_esperado)} · ${alDia(l) ? "al día" : "atrasado"}</span>) ·
          fecha límite ${fechaAR(l.limite)} ${quedan < 0 ? `<span class="mal">(vencida hace ${-quedan} días)</span>` : `(faltan ${quedan} días; quedan ${fmt(l.unidades)} u)`}</li>`; }).join("")}</ul>`);
    sR.append(bR);
    main.append(sR);
    grafico($("#g-ritmo"), {
      type: "bar",
      data: { labels: L.map(l => `${l.suc} · ${NOM_SUC[l.suc]}`), datasets: [
        { label: "ritmo objetivo", data: L.map(l => l.ritmo_objetivo), backgroundColor: tok("--line-2") },
        { label: "ritmo real", data: L.map(l => l.ritmo_real), backgroundColor: L.map(l => tok(alDia(l) ? "--good" : "--bad")) }] },
      plugins: [pctCumplido("pct-ritmo", (ch, i) => ch.getDatasetMeta(1).data[i])],
      options: { indexAxis: "y", maintainAspectRatio: false, layout: { padding: { right: 44 } },
        scales: { x: { beginAtZero: true, title: { display: true, text: "unidades por día" } }, y: { grid: { display: false } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 2)} u/día`,
          afterBody: c => { const l = L[c[0].dataIndex]; return `${pct(l.pct_esperado)} de lo esperado · ${alDia(l) ? "al día" : "atrasado"}`; } } } } }
    });
    const diasA = []; for (let d = INI; d <= D.foto_iso; d = masDias(d, 1)) diasA.push(d);
    grafico($("#g-ritmo-acum"), {
      type: "line",
      data: { labels: diasA.map(d => fechaAR(d).slice(0, 5)), datasets: L.flatMap((l, i) => {
        const col = COL_SUC[i % COL_SUC.length], ini = desdeLote(l), vl = VENTAS.filter(v => v.sku === sku && v.suc === l.suc && v.fecha >= ini);
        return [
          { label: `${l.suc} vendido`, borderColor: col, backgroundColor: col, pointRadius: 0, borderWidth: 2, tension: 0,
            data: diasA.map(d => d < ini ? null : suma(vl.filter(v => v.fecha <= d), v => v.u)) },
          { label: `${l.suc} esperado`, borderColor: col, backgroundColor: col, borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, tension: 0,
            data: diasA.map(d => d < ini ? null : l.ritmo_objetivo * (difDias(ini, d) + 1)) }]; }) },
      plugins: [pctCumplido("pct-acum", (ch, i) => ch.getDatasetMeta(2 * i).data.at(-1))],
      options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { right: 44 } },
        scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true, title: { display: true, text: "unidades acumuladas" } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 1)} u` } } } }
    });
  }

  // Qué le pasa
  const s3 = seccion("Qué le pasa", `Ventas por semana y stock día a día en cada sucursal, del ${fechaAR(S.desde)} al ${fechaAR(S.hasta)}. El stock se reconstruye hacia atrás desde la foto: supone que no hubo reposiciones ni transferencias.`);
  const b3 = bloque(`<div class="dos"><div><h3>Unidades por semana</h3><div class="graf"><canvas id="g-sem"></canvas></div></div>
    <div><h3>Stock día a día</h3><div class="graf"><canvas id="g-stock"></canvas></div></div></div>
    <h3>Indicadores en cada sucursal</h3>
    <div class="tabla-wrap densa">${tablaHTML(COLS_INDICADORES.filter(c => !["producto", "n"].includes(c.k)).map(c => c.k === "suc" ? { ...c, f: v => `<b>${v}</b> <span class="muted">${esc(NOM_SUC[v])}</span>` } : c), L)}</div>`);
  s3.append(b3);
  main.append(s3);
  const sem = semanas(S.desde, S.hasta);
  const porSuc = L.map(l => l.suc);
  grafico($("#g-sem"), {
    type: "bar",
    data: { labels: sem.map(d => fechaAR(d).slice(0, 5)), datasets: porSuc.map((sid, i) => {
      const arr = sem.map(() => 0);
      V.filter(v => v.suc === sid).forEach(v => { const k = semanaDe(v.fecha, S.desde); if (k < arr.length) arr[k] += v.u; });
      return { label: sid, data: arr, backgroundColor: COL_SUC[i % COL_SUC.length] }; }) },
    options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: "unidades" } } }, plugins: { legend: { position: "bottom" } } }
  });
  const diasR = []; for (let d = S.desde; d <= S.hasta; d = masDias(d, 1)) diasR.push(d);
  grafico($("#g-stock"), {
    type: "line",
    data: { labels: diasR.map(d => fechaAR(d).slice(0, 5)), datasets: L.map((l, i) => {
      const vl = VENTAS.filter(v => v.sku === sku && v.suc === l.suc);
      return { label: l.suc, borderColor: COL_SUC[i % COL_SUC.length], backgroundColor: COL_SUC[i % COL_SUC.length], pointRadius: 0, borderWidth: 2, tension: 0,
        data: diasR.map(d => d < l.ingreso ? null : l.unidades + suma(vl.filter(v => v.fecha > d), v => v.u)) }; }) },
    options: { maintainAspectRatio: false, scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true, title: { display: true, text: "unidades en stock" } } }, plugins: { legend: { position: "bottom" } } }
  });

  // Historial de precio
  const H = D.historial.filter(h => h.sku === sku), Cp = D.campanas.filter(x => x.sku === sku), Cb = D.cambios.filter(x => x.sku === sku);
  const rebajadas = V.filter(rebajada);
  const eventos = [
    ...H.map(h => ({ f: h.fecha, que: "Sugerencia", det: `${h.descuento} % · ${["sin respuesta", "aceptada", "rechazada"][h.aceptacion]}${h.desde ? `, aplicada del ${fechaAR(h.desde)} al ${fechaAR(h.hasta)}` : h.aceptacion === 1 ? ", sin fechas: no se ve en las ventas" : ""}` })),
    ...Cp.map(x => ({ f: x.desde, que: "Campaña", det: `${x.tipo.toLowerCase()} hasta el ${fechaAR(x.hasta)} · ${x.observacion}` })),
    ...Cb.map(x => ({ f: x.fecha, que: "Cambio de precio", det: `${plata(x.anterior)} → ${plata(x.nuevo)} (${sgn(x.nuevo / x.anterior - 1)}) · ${x.origen.replace(/_/g, " ")}` })),
  ].sort((a, b) => a.f.localeCompare(b.f));
  const s4 = seccion("Historial de precio");
  s4.append(bloque(`${eventos.length ? `<ol class="linea-tiempo">${eventos.map(e => `<li><span class="num">${fechaAR(e.f)}</span><b>${e.que}</b><span>${esc(e.det)}</span></li>`).join("")}</ol>` : `<p class="nota">Sin sugerencias, campañas ni cambios de precio registrados.</p>`}
    <p class="nota">${rebajadas.length ? `${fmt(suma(rebajadas, v => v.u))} unidades se vendieron por debajo del precio de lista en el período filtrado.` : "En el período filtrado todas las ventas fueron a precio de lista."}</p>`));
  main.append(s4);
  const bd = bloque("");
  bd.append(verDatos("Ventas de este producto con los filtros", [
    { k: "fecha", t: "fecha", f: fechaAR, csv: v => v }, { k: "suc", t: "sucursal" }, { k: "u", t: "unidades", r: true, f: v => fmt(v) },
    { k: "precio", t: "precio cobrado", r: true, f: v => plata(v), csv: v => v }], [...V].sort((a, b) => a.fecha.localeCompare(b.fecha)), `ventas_${sku}`));
  s4.append(bd);
}

// ---------------------------------------------------------------------------------------------- vista: Seguimiento
// Estado de cada recomendación: verde si se está cumpliendo, ámbar si no se movió, rojo si va mal
const clsEstado = r => r.bien ? "ok" : /^Sin (movimiento|ventas)/.test(r.estado) ? "medio" : "mal";
const catAccion = a => /^(Bajar|Probar|Aplicar)/.test(a) ? "Descuento" : a.split(" ·")[0];
const estadoHTML = r => `<span class="${clsEstado(r)}">${esc(r.estado)}</span>${r.en_curso ? `<br><span class="muted" style="font-size:.78rem">en curso · se revisa el ${fechaAR(r.revisar)}</span>` : ""}`;

function vistaSeguimiento(main) {
  const P = prodsFiltrados(), set = new Set(P.map(p => p.sku));
  const H = D.historia || [], SG = (D.seguimiento || []).filter(r => set.has(r.sku));
  const online = window.BASE && window.BASE.online;

  // 1 · La respuesta: ¿se está cumpliendo?
  const s0 = seccion("¿Se está cumpliendo lo que recomendamos?",
    "Cada recomendación se sigue desde la primera foto en que se propuso (mientras se haya seguido proponiendo lo mismo) hasta la foto que estás viendo. Se mide por producto, sumando sus sucursales.");
  if (!SG.length) {
    s0.append(bloque(`<div class="vacio">${H.length > 1 ? "Ninguno de los productos filtrados tiene una recomendación de una foto anterior." :
      `Por ahora la base tiene una sola foto (${D.foto}): el seguimiento empieza cuando se carga la siguiente. ${online ? "Subí el Excel de una semana posterior con <b>Subir Excel</b>, arriba a la derecha." : "Cargá el Excel de una semana posterior con <code>actualizar.py</code>."}`}</div>`));
    main.append(s0);
  } else {
    const bien = SG.filter(r => r.bien), curso = SG.filter(r => r.en_curso), desc = SG.filter(r => r.nuestro === "ya"), descAp = desc.filter(r => r.aplicado);
    const descMeta = desc.filter(r => r.estado === "Cumple la meta"), cambiaron = SG.filter(r => r.accion_nueva && r.accion_nueva !== r.accion);
    const h0 = H[0], hN = H[H.length - 1];
    s0.append(bloque(`<div class="respuesta"><ol>
      <li><b>En total</b><p>${bien.length} de ${SG.length} recomendaciones se están cumpliendo (${pct(bien.length / SG.length)}). ${curso.length ? `${curso.length} todavía no llegaron a su fecha de revisión: van en curso.` : "Todas ya pasaron su fecha de revisión."}</p></li>
      <li><b>Descuentos</b><p>${desc.length ? `De ${desc.length} ${desc.length === 1 ? "descuento recomendado" : "descuentos recomendados"}, ${descAp.length} se ${descAp.length === 1 ? "ve" : "ven"} en el precio cobrado y ${descMeta.length} ${descMeta.length === 1 ? "cumple" : "cumplen"} su meta.${descAp.length < desc.length ? " Lo primero es que lo aprobado llegue a caja." : ""}` : "Ninguno de estos productos tenía un descuento recomendado."}</p></li>
      <li><b>Stock quieto</b><p>Del ${fechaAR(h0.fecha)} al ${fechaAR(hN.fecha)}, en toda la cadena: stock ${fmt(h0.stock)} → ${fmt(hN.stock)} u y productos atrasados ${h0.atrasados} → ${hN.atrasados}. El stock que ya pasó su fecha límite fue de ${fmt(h0.vencidas)} a ${fmt(hN.vencidas)} u: crece solo a medida que pasan las fechas límite, por eso importa que lo vencido salga rápido.</p></li>
      <li><b>Qué cambió</b><p>${cambiaron.length ? `En esta foto, ${cambiaron.length} ${cambiaron.length === 1 ? "producto tiene" : "productos tienen"} una recomendación nueva: ${cambiaron.slice(0, 4).map(r => `${esc(r.producto)} (${esc(r.accion_nueva.toLowerCase())})`).join(", ")}${cambiaron.length > 4 ? "…" : ""}.` : "Esta foto mantiene todas las recomendaciones."}</p></li>
    </ol>
    <div class="cifras">
      <div class="cifra ${bien.length / SG.length >= .5 ? "buena" : "mala"}"><b>${bien.length} de ${SG.length}</b><span>recomendaciones que se están cumpliendo</span></div>
      <div class="cifra${desc.length && descAp.length < desc.length ? " mala" : ""}"><b>${desc.length ? `${descAp.length} de ${desc.length}` : "—"}</b><span>descuentos que se ven en caja</span></div>
      <div class="cifra ${hN.stock < h0.stock ? "buena" : "mala"}"><b>${hN.stock > h0.stock ? "+" : hN.stock < h0.stock ? "−" : ""}${fmt(Math.abs(hN.stock - h0.stock))} u</b><span>de stock desde el ${fechaAR(h0.fecha)}</span></div>
      <div class="cifra"><b>${curso.length}</b><span>todavía en curso</span></div>
    </div></div>`));
    const cats = [...new Set(SG.map(r => catAccion(r.accion)))].sort((a, b) => SG.filter(r => catAccion(r.accion) === b).length - SG.filter(r => catAccion(r.accion) === a).length);
    const bG = bloque(`<div class="dos"><div><h3>Cómo viene cada tipo de recomendación</h3><div class="graf" style="height:${Math.max(200, 34 * cats.length + 70)}px"><canvas id="g-seg-cat"></canvas></div></div>
      <div><h3>La cadena, foto a foto</h3><div class="graf"><canvas id="g-seg-hist"></canvas></div></div></div>`);
    s0.append(bG);
    const colsSG = [{ k: "producto", t: "producto", cls: "t-prod", f: (v, r) => `<b>${esc(v)}</b><br><span class="sku">${r.sku}</span>`, csv: v => v },
      { k: "accion", t: "recomendación", f: (v, r) => `${pill(v)}<br><span class="muted" style="font-size:.78rem">desde el ${fechaAR(r.desde)} (${r.dias} días)</span>`, csv: v => v },
      { k: "estado", t: "¿se está cumpliendo?", f: (v, r) => estadoHTML(r), csv: v => v },
      { k: "u_sem_despues", t: "u/semana antes → ahora", r: true, f: (v, r) => `${fmt(r.u_sem_antes, 1)} → <b>${fmt(v, 1)}</b>${r.meta_u_sem ? `<br><span class="muted">meta ${fmt(r.meta_u_sem, 1)}</span>` : ""}`, csv: v => v },
      { k: "precio_cobrado", t: "precio cobrado", r: true, f: (v, r) => v ? `${plata(v)}<br><span class="muted">lista ${plata(r.precio_lista)}</span>` : "sin ventas", csv: v => v },
      { k: "stock_ahora", t: "stock desde → ahora", r: true, f: (v, r) => `${fmt(r.stock_antes)} → <b>${fmt(v)}</b>`, csv: v => v },
      { k: "accion_nueva", t: "recomendación en esta foto", f: (v, r) => !v ? "—" : v === r.accion ? '<span class="muted">la misma</span>' : pill(v), csv: v => v }];
    s0.append(tablaAuditable(colsSG, SG, "seguimiento", { alto: 560, clic: sku => cambiar({ tab: "productos", sku }, true), claveClic: "sku" }));
    main.append(s0);
    grafico($("#g-seg-cat", bG), {
      type: "bar",
      data: { labels: cats, datasets: [["se está cumpliendo", "--good", r => r.bien], ["todavía no", "--bad", r => !r.bien]].map(([t, c, f]) => ({
        label: t, data: cats.map(k => SG.filter(r => catAccion(r.accion) === k && f(r)).length), backgroundColor: tok(c) })) },
      options: { indexAxis: "y", maintainAspectRatio: false, scales: { x: { stacked: true, ticks: { precision: 0 }, title: { display: true, text: "productos" } }, y: { stacked: true, grid: { display: false } } },
        plugins: { legend: { position: "bottom" } } }
    });
    grafico($("#g-seg-hist", bG), {
      type: "line",
      data: { labels: H.map(h => fechaAR(h.fecha).slice(0, 5)), datasets: [
        { label: "stock (u)", data: H.map(h => h.stock), borderColor: tok("--accent"), backgroundColor: tok("--accent"), tension: 0, pointRadius: 3 },
        { label: "ya vencido (u)", data: H.map(h => h.vencidas), borderColor: tok("--bad"), backgroundColor: tok("--bad"), tension: 0, pointRadius: 3 }] },
      options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, ticks: { callback: v => fmt(v) } } }, plugins: { legend: { position: "bottom" } } }
    });
    s0.append(verDatos("Cada foto de la base", [{ k: "fecha", t: "foto", f: fechaAR, csv: v => v }, { k: "stock", t: "stock (u)", r: true, f: v => fmt(v) },
      { k: "capital", t: "a costo", r: true, f: v => plata(v), csv: v => v }, { k: "vencidas", t: "ya vencido (u)", r: true, f: v => fmt(v) },
      { k: "atrasados", t: "productos atrasados", r: true }, { k: "ya", t: "descuento ya", r: true }, { k: "cond", t: "condicionales", r: true }], H, "historia"));
  }

  // 2 · Cuándo revisar las recomendaciones de esta foto
  const s1 = seccion("Cuándo revisar las recomendaciones de esta foto", "Cada producto tiene un indicador con su línea base, una meta, una fecha de revisión y qué hacer si no se cumple. Tocá una fecha para ver solo esos productos.");
  const porFecha = agrupar(P.filter(p => p.revisar), p => p.revisar);
  const clave = d => d.split("/").reverse().join("");
  const revs = document.createElement("div");
  revs.className = "revs";
  Object.keys(porFecha).sort((a, b) => clave(a).localeCompare(clave(b))).forEach(d => {
    const acc = agrupar(porFecha[d], p => /^(Bajar|Probar|Aplicar)/.test(p.accion) ? "con descuento" : p.accion.split(" ·")[0].toLowerCase());
    const b = document.createElement("button");
    b.type = "button"; b.className = "rev"; b.setAttribute("aria-pressed", String(S.rev === d));
    b.innerHTML = `<b>${d}</b><span>${porFecha[d].length} productos</span><span>${Object.entries(acc).map(([a, xs]) => `${xs.length} ${a}`).join(" · ")}</span>`;
    b.addEventListener("click", () => cambiar({ rev: S.rev === d ? "" : d }));
    revs.append(b);
  });
  const filas = P.filter(p => !S.rev || p.revisar === S.rev);
  const b1 = bloque("");
  b1.append(revs);
  b1.insertAdjacentHTML("beforeend", `<div class="tabla-wrap">${tablaHTML([
    { k: "producto", t: "producto", cls: "t-prod", f: (v, r) => `<b>${esc(v)}</b><br><span class="sku">${r.sku}</span>` },
    { k: "accion", t: "acción", f: (v, r) => pill(v) + (r.condicion ? `<br><span class="muted" style="font-size:.8rem">${esc(r.condicion)}</span>` : "") },
    { k: "indicador", t: "indicador", f: (v, r) => v ? `${esc(v)}<br><span class="muted">${esc(r.linea_base)} → ${esc(r.meta)}</span>` : "—" },
    { k: "revisar", t: "revisar el", f: v => `<span class="num">${esc(v)}</span>` }, { k: "si_no", t: "si no se cumple" }], filas, { clic: "sku" })}</div>`);
  b1.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => cambiar({ tab: "productos", sku: tr.dataset.k }, true)));
  s1.append(b1);
  main.append(s1);

}

// ---------------------------------------------------------------------------------------------- vista: Datos (auditar)
const TABLAS = {
  ventas: ["Ventas diarias", () => { const skus = prodsFiltrados().map(p => p.sku); return ventasDe(skus).map(v => ({ ...v, producto: CAT[v.sku].nombre, monto: v.u * v.precio, lista: listaVigente(v.sku, v.fecha), desc: 1 - v.precio / listaVigente(v.sku, v.fecha) })); },
    [{ k: "fecha", t: "fecha", f: fechaAR, csv: v => v }, { k: "sku", t: "sku" }, { k: "producto", t: "producto" }, { k: "suc", t: "sucursal" }, { k: "u", t: "unidades", r: true },
     { k: "precio", t: "precio cobrado", r: true, f: v => plata(v), csv: v => v }, { k: "lista", t: "precio de lista ese día", r: true, f: v => plata(v), csv: v => v },
     { k: "desc", t: "descuento", r: true, f: v => v > 0.005 ? pct(v) : "—", csv: v => v },
     { k: "monto", t: "venta $", r: true, f: v => plata(v), csv: v => v }]],
  lotes: ["Indicadores por producto y sucursal", () => lotesDe(prodsFiltrados().map(p => p.sku)).map(l => ({ ...l, producto: CAT[l.sku].nombre, n: DEC[l.sku].n })),
    [{ k: "sku", t: "sku" }, ...COLS_INDICADORES.map(c => c.k === "producto" ? { k: "producto", t: "producto", cls: "t-prod" } : c)]],
  decisiones: ["Propuesta por producto", () => prodsFiltrados(),
    [{ k: "sku", t: "sku" }, { k: "producto", t: "producto" }, { k: "n", t: "grupo", r: true }, { k: "accion", t: "acción" }, { k: "condicion", t: "condición" },
     { k: "motivo", t: "motivo", cls: "t-texto" }, { k: "ademas", t: "además", cls: "t-texto" }, { k: "indicador", t: "indicador" }, { k: "linea_base", t: "línea base" },
     { k: "meta", t: "meta" }, { k: "revisar", t: "revisar el" }, { k: "consultora", t: "consultora" }, { k: "coincide", t: "¿coincide?" }]],
  historial: ["Historial de sugerencias", () => { const set = new Set(prodsFiltrados().map(p => p.sku)); return D.historial.filter(h => set.has(h.sku)).map(h => ({ ...h, producto: CAT[h.sku].nombre, estado: ["sin respuesta", "aceptada", "rechazada"][h.aceptacion] })); },
    [{ k: "fecha", t: "fecha", f: fechaAR, csv: v => v }, { k: "sku", t: "sku" }, { k: "producto", t: "producto" }, { k: "descuento", t: "descuento %", r: true }, { k: "estado", t: "estado" },
     { k: "desde", t: "vigencia desde", f: fechaAR, csv: v => v }, { k: "hasta", t: "vigencia hasta", f: fechaAR, csv: v => v }, { k: "comentario", t: "comentario" }]],
  campanas: ["Campañas", () => { const set = new Set(prodsFiltrados().map(p => p.sku)); return D.campanas.filter(x => set.has(x.sku)).map(x => ({ ...x, producto: CAT[x.sku].nombre })); },
    [{ k: "sku", t: "sku" }, { k: "producto", t: "producto" }, { k: "tipo", t: "tipo" }, { k: "desde", t: "desde", f: fechaAR, csv: v => v }, { k: "hasta", t: "hasta", f: fechaAR, csv: v => v }, { k: "observacion", t: "observación" }]],
  cambios: ["Cambios de precio de lista", () => { const set = new Set(prodsFiltrados().map(p => p.sku)); return D.cambios.filter(x => set.has(x.sku)).map(x => ({ ...x, producto: CAT[x.sku].nombre })); },
    [{ k: "fecha", t: "fecha", f: fechaAR, csv: v => v }, { k: "sku", t: "sku" }, { k: "producto", t: "producto" }, { k: "anterior", t: "precio anterior", r: true, f: v => plata(v), csv: v => v },
     { k: "nuevo", t: "precio nuevo", r: true, f: v => plata(v), csv: v => v }, { k: "origen", t: "origen" }]],
  catalogo: ["Catálogo", () => { const set = new Set(prodsFiltrados().map(p => p.sku)); return D.catalogo.filter(x => set.has(x.sku)).map(x => ({ ...x, margen: 1 - x.costo / x.precio })); },
    [{ k: "sku", t: "sku" }, { k: "nombre", t: "producto" }, { k: "rubro", t: "rubro" }, { k: "tipo", t: "tipo" }, { k: "proveedor", t: "proveedor" },
     { k: "precio", t: "precio de lista", r: true, f: v => plata(v), csv: v => v }, { k: "costo", t: "costo", r: true, f: v => plata(v), csv: v => v }, { k: "margen", t: "margen", r: true, f: v => pct(v), csv: v => v }]],
  consultora: ["Propuesta de la consultora (hoja original)", () => { const set = new Set(prodsFiltrados().map(p => p.sku)); return D.consultora_cruda.filter(x => set.has(x.sku)).map(x => ({ ...x, producto: CAT[x.sku].nombre, stock: DEC[x.sku].stock })); },
    [{ k: "sku", t: "sku" }, { k: "producto", t: "producto" }, { k: "decision", t: "decisión" }, { k: "descuento", t: "descuento %", r: true }, { k: "proyeccion", t: "proyección 30 días", r: true },
     { k: "stock", t: "stock hoy", r: true }, { k: "comentario", t: "comentario" }]],
  sucursales: ["Sucursales", () => D.sucursales, [{ k: "id", t: "sucursal" }, { k: "nombre", t: "nombre" }, { k: "ciudad", t: "ciudad" }, { k: "tipo", t: "tipo" }]],
};
function vistaDatos(main) {
  const [titulo, fuente, cols] = TABLAS[S.tabla] || TABLAS.lotes;
  const filas = fuente();
  const s = seccion("Los datos, para auditar", "Las tablas que usa el análisis, con los filtros de arriba aplicados. Buscá, ordená tocando un encabezado y revisá los totales: cualquier número del tablero se puede rastrear hasta acá.");
  const b = bloque(`<div class="barra-acciones">
      <label class="campo" for="d-tabla">Tabla<select id="d-tabla">${Object.entries(TABLAS).map(([k, [t]]) => `<option value="${k}"${k === S.tabla ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      ${D.archivo_excel ? `<a class="btn" href="${esc(D.archivo_excel)}" download>Descargar el Excel completo</a>` : ""}
    </div>`);
  b.append(tablaAuditable(cols, filas, `viento_sur_${S.tabla}`, { alto: 640, mostrar: 200, ...(cols.some(c => c.k === "sku") ? { clic: k => cambiar({ tab: "productos", sku: k }, true), claveClic: "sku" } : {}) }));
  s.append(b);
  main.append(s);
  $("#d-tabla", b).addEventListener("change", e => cambiar({ tabla: e.target.value }));

  const s2 = seccion("Cómo se calcula");
  const C = D.criterios;
  s2.append(bloque(`<table><tbody>
    <tr><td><b>Ritmo del lote</b></td><td>Objetivo = unidades_objetivo ÷ días entre ingreso y fecha límite. Real = vendidas desde el ingreso (o desde el ${fechaAR(F_MIN)}) ÷ esos días. % de lo esperado = real ÷ objetivo; al día si es ${pct(C.al_dia)} o más.</td></tr>
    <tr><td><b>Meses de stock</b></td><td>Stock hoy ÷ vendidas en los últimos 30 días.</td></tr>
    <tr><td><b>Efecto de un descuento</b></td><td>Unidades por día durante el descuento ÷ el resto de la ventana, contando solo los días en que el producto estaba en el local. Rango del 5 % al 95 % por bootstrap (4.000 repeticiones, semilla fija). Control: productos que venden bien sin ningún cambio.</td></tr>
    <tr><td><b>Después del descuento</b></td><td>Venta posterior ÷ venta anterior, corregida por lo que hizo el control en las mismas fechas.</td></tr>
    <tr><td><b>Stock día a día</b></td><td>Stock de la foto + lo vendido después de cada día; vacío antes del ingreso. Supone que no hubo reposiciones ni transferencias.</td></tr>
    <tr><td><b>Grupos</b></td><td>${D.grupos.map(g => `${g.n} · ${esc(g.nombre)}: ${esc(g.regla)}`).join("<br>")}</td></tr>
    <tr><td><b>Umbrales</b></td><td>${Object.entries(C).map(([k, v]) => `${k.replace(/_/g, " ")} = ${String(v).replace(".", ",")}`).join(" · ")}</td></tr>
  </tbody></table>`));
  main.append(s2);
}

// ---------------------------------------------------------------------------------------------- tanda 2: utilidades de BI
const PALETA = ["#2a6f97", "#c9a227", "#2e7d4f", "#b3402e", "#7a4a9a", "#cc6a22", "#4f97ba", "#6f7d84", "#9c5b8f", "#5a8a3a"];
const COL_RUBRO = { calzado: "#2a6f97", deportes: "#c9a227", hogar: "#2e7d4f", indumentaria: "#b3402e" };
const nombreGrupo = n => (D.grupos.find(g => g.n === +n) || {}).nombre || "";
const APERTURAS = {
  total: ["Total cadena", () => "Total", () => "Total"],
  suc: ["Sucursal", r => r.suc, k => `${k} · ${NOM_SUC[k] || ""}`],
  rubro: ["Rubro", r => CAT[r.sku].rubro, k => k],
  tipo: ["Tipo", r => CAT[r.sku].tipo, k => k],
  grupo: ["Grupo", r => String(DEC[r.sku].n), k => `${k} · ${nombreGrupo(k)}`],
  producto: ["Producto", r => r.sku, k => CAT[k] ? CAT[k].nombre : k],
};
function colorDe(por, k, i) {
  if (por === "suc") return COL_SUC[Math.max(0, SUCS.findIndex(s => s.id === k)) % COL_SUC.length];
  if (por === "grupo") return tok(`--g${k}`) || PALETA[i % PALETA.length];
  if (por === "rubro") return COL_RUBRO[k] || PALETA[i % PALETA.length];
  if (por === "total") return tok("--accent");
  return PALETA[i % PALETA.length];
}
const MEDIDAS = { u: ["unidades", v => v.u], p: ["pesos", v => v.u * v.precio] };
const GRANOS = {
  dia: ["día", f => f, d => fechaAR(d).slice(0, 5)],
  sem: ["semana", f => masDias(S.desde, 7 * semanaDe(f, S.desde)), d => fechaAR(d).slice(0, 5)],
  mes: ["mes", f => f.slice(0, 7), d => ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][+d.slice(5, 7) - 1] + " " + d.slice(2, 4)],
};
function ejesTiempo(gran) {
  const out = new Set();
  for (let d = S.desde; d <= S.hasta; d = masDias(d, 1)) out.add(GRANOS[gran][1](d));
  return [...out];
}
function controles(defs) {
  // defs: [[clave del estado, etiqueta, [[valor, texto], ...]], ...]
  const div = document.createElement("div");
  div.className = "barra-acciones";
  div.innerHTML = defs.map(([k, t, ops]) => `<label class="campo" for="c-${k}">${t}<select id="c-${k}">${ops.map(([v, x]) => `<option value="${v}"${S[k] === v ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label>`).join("");
  defs.forEach(([k]) => div.querySelector(`#c-${k}`).addEventListener("change", e => cambiar({ [k]: e.target.value })));
  return div;
}
const OPC_POR = Object.entries(APERTURAS).map(([k, [t]]) => [k, t]);
function topN(filas, claveF, medidaF, n) {
  const tot = {};
  filas.forEach(r => { const k = claveF(r); tot[k] = (tot[k] || 0) + medidaF(r); });
  const orden = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
  return { claves: orden.slice(0, n), resto: orden.length > n, total: tot };
}
const cifrasHTML = items => `<div class="cifras cifras-linea">${items.map(([v, t, c]) => `<div class="cifra${c ? " " + c : ""}"><b>${v}</b><span>${t}</span></div>`).join("")}</div>`;
// Ritmo del lote (la cuenta de la consigna), para sumar por sucursal o por rubro
const ritmoObj = l => l.ritmo_objetivo;
const ritmoReal = l => l.ritmo_real;

// ---------------------------------------------------------------------------------------------- vista: Ventas
function vistaVentas(main) {
  const P = prodsFiltrados(), skus = P.map(p => p.sku);
  const V = ventasDe(skus);
  const [nomMed, med] = MEDIDAS[S.med] || MEDIDAS.u;
  const [nomPor, claveF, etiqF] = APERTURAS[S.por] || APERTURAS.suc;
  const totU = suma(V, v => v.u), totP = suma(V, v => v.u * v.precio);
  const dias = difDias(S.desde, S.hasta) + 1;
  const s = seccion("Ventas", `Del ${fechaAR(S.desde)} al ${fechaAR(S.hasta)}, con los filtros de arriba. Elegí qué medir, cada cuánto y cómo abrirlo.`);
  s.append(controles([["med", "Medir en", [["u", "Unidades"], ["p", "Pesos (precio cobrado)"]]], ["gran", "Cada", [["dia", "Día"], ["sem", "Semana"], ["mes", "Mes"]]],
    ["por", "Abrir por", OPC_POR]]));
  const b0 = bloque(cifrasHTML([[fmt(totU), "unidades vendidas"], [plata(totP), "venta en pesos"], [plata(totP / (totU || 1)), "precio promedio cobrado"],
    [fmt(totU / dias, 1), "unidades por día"], [String(new Set(V.map(v => v.sku)).size), `productos con venta (de ${P.length})`],
    [pct(suma(V.filter(rebajada), v => v.u) / (totU || 1)), "de las unidades se vendieron con descuento"]]));
  s.append(b0);
  main.append(s);
  if (!V.length) { s.append(bloque(`<div class="vacio">No hay ventas con estos filtros.</div>`)); return; }

  // Serie en el tiempo
  const ejes = ejesTiempo(S.gran);
  const { claves, resto } = topN(V, claveF, med, S.por === "producto" ? 8 : 12);
  const series = claves.map((k, i) => {
    const arr = ejes.map(() => 0);
    V.filter(v => claveF(v) === k).forEach(v => { const j = ejes.indexOf(GRANOS[S.gran][1](v.fecha)); if (j >= 0) arr[j] += med(v); });
    return { k, label: etiqF(k), data: arr, color: colorDe(S.por, k, i) };
  });
  if (resto) {
    const arr = ejes.map(() => 0);
    V.filter(v => !claves.includes(claveF(v))).forEach(v => { const j = ejes.indexOf(GRANOS[S.gran][1](v.fecha)); if (j >= 0) arr[j] += med(v); });
    series.push({ k: "resto", label: "Resto", data: arr, color: tok("--muted") });
  }
  const b1 = bloque(`<h3>${nomMed[0].toUpperCase() + nomMed.slice(1)} por ${GRANOS[S.gran][0]}, por ${nomPor.toLowerCase()}</h3><div class="graf alto"><canvas id="g-serie"></canvas></div>
    <p class="nota">${S.gran === "sem" ? "La última semana puede estar incompleta. " : ""}Los descuentos aplicados fueron ${D.vigencia}; las campañas cargadas no se ven en el precio cobrado.</p>`);
  s.append(b1);
  grafico($("#g-serie", b1), {
    type: "line",
    data: { labels: ejes.map(GRANOS[S.gran][2]), datasets: series.map(x => ({ label: x.label, data: x.data, borderColor: x.color, backgroundColor: x.color, pointRadius: S.gran === "dia" ? 0 : 2, borderWidth: 2, tension: 0.2 })) },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      scales: { y: { beginAtZero: true, ticks: { callback: v => S.med === "p" ? plata(v) : fmt(v) } }, x: { ticks: { maxTicksLimit: 14 } } },
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${S.med === "p" ? plata(c.raw) : fmt(c.raw)}` } } } }
  });
  b1.append(verDatos(`${nomMed} por ${GRANOS[S.gran][0]} y ${nomPor.toLowerCase()}`, [{ k: "periodo", t: GRANOS[S.gran][0] }, ...series.map(x => ({ k: x.k, t: x.label, r: true, f: v => S.med === "p" ? plata(v) : fmt(v), csv: v => v }))],
    ejes.map((e, j) => Object.fromEntries([["periodo", GRANOS[S.gran][2](e)], ...series.map(x => [x.k, x.data[j]])])), "ventas_serie"));

  // Participación: unidades contra pesos
  const grupos = agrupar(V, claveF);
  const filas = Object.entries(grupos).map(([k, vs]) => ({ k, nombre: etiqF(k), u: suma(vs, v => v.u), p: suma(vs, v => v.u * v.precio) }))
    .map(r => ({ ...r, pu: r.u / (totU || 1), pp: r.p / (totP || 1), precio: r.p / (r.u || 1) })).sort((a, b) => (S.med === "p" ? b.p - a.p : b.u - a.u));
  const vis = filas.slice(0, 15);
  const b2 = bloque(`<div class="dos"><div><h3>Participación por ${nomPor.toLowerCase()}: unidades contra pesos</h3><div class="graf alto"><canvas id="g-part"></canvas></div>
      <p class="nota">Cuando el % de pesos supera al de unidades, se venden productos más caros que el promedio.</p></div>
    <div><h3>Ranking de productos (${nomMed})</h3><div class="graf alto"><canvas id="g-rank"></canvas></div><p class="nota">Tocá una barra para ver la ficha del producto.</p></div></div>`);
  s.append(b2);
  grafico($("#g-part", b2), {
    type: "bar",
    data: { labels: vis.map(r => r.nombre), datasets: [{ label: "% de las unidades", data: vis.map(r => r.pu * 100), backgroundColor: tok("--line-2") }, { label: "% de los pesos", data: vis.map(r => r.pp * 100), backgroundColor: tok("--accent") }] },
    options: { indexAxis: "y", maintainAspectRatio: false, scales: { x: { ticks: { callback: v => v + "%" } } },
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 1)} %` } } } }
  });
  const rk = topN(V, v => v.sku, med, 15);
  grafico($("#g-rank", b2), {
    type: "bar",
    data: { labels: rk.claves.map(k => CAT[k].nombre), datasets: [{ label: nomMed, data: rk.claves.map(k => rk.total[k]), backgroundColor: rk.claves.map(k => tok(`--g${DEC[k].n}`)) }] },
    options: { indexAxis: "y", maintainAspectRatio: false, onClick: (_, els) => { if (els[0]) cambiar({ tab: "productos", sku: rk.claves[els[0].index] }, true); },
      scales: { x: { ticks: { callback: v => S.med === "p" ? plata(v) : fmt(v) } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${S.med === "p" ? plata(c.raw) : fmt(c.raw) + " u"} · grupo ${DEC[rk.claves[c.dataIndex]].n}` } } } }
  });
  b2.append(verDatos(`Participación por ${nomPor.toLowerCase()}`, [
    { k: "nombre", t: nomPor }, { k: "u", t: "unidades", r: true, f: v => fmt(v) }, { k: "pu", t: "% unidades", r: true, f: v => pct(v, 1), csv: v => v },
    { k: "p", t: "venta $", r: true, f: v => plata(v), csv: v => v }, { k: "pp", t: "% pesos", r: true, f: v => pct(v, 1), csv: v => v },
    { k: "precio", t: "precio promedio", r: true, f: v => plata(v), csv: v => v }], filas, "ventas_participacion"));
}

// ---------------------------------------------------------------------------------------------- vista: Stock y rotación
const MAPAS = { pv: ["% vendido", l => l.vendidas / (l.vendidas + l.unidades || 1), v => pct(v)], pe: ["% de lo esperado", l => l.pct_esperado, v => pct(v)],
  st: ["stock hoy", l => l.unidades, v => fmt(v)], ve: ["vendidas", l => l.vendidas, v => fmt(v)], ds: ["días de stock", l => l.dias_de_stock, v => v == null ? "sin venta" : fmt(v)] };
function colorMapa(m, v) {
  if (v == null) return "transparent";
  const t = m === "pe" ? Math.min(v / 1.3, 1) : m === "pv" ? v : m === "ds" ? 1 - Math.min(v / 365, 1) : null;
  if (t == null) return "transparent";
  return `color-mix(in srgb, ${t >= 0.5 ? "var(--good)" : "var(--bad)"} ${Math.round(Math.abs(t - 0.5) * 2 * 55 + 6)}%, transparent)`;
}
function stockDiario(lotes, ejes, claveF) {
  // stock al cierre de cada día = stock de la foto + lo vendido después; vacío antes del ingreso
  const porLote = agrupar(VENTAS, v => v.sku + "|" + v.suc);
  const res = {};
  lotes.forEach(l => {
    const vs = (porLote[l.sku + "|" + l.suc] || []).slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
    const k = claveF(l);
    res[k] ??= ejes.map(() => 0);
    let acum = 0, i = 0;
    for (let j = ejes.length - 1; j >= 0; j--) {
      while (i < vs.length && vs[i].fecha > ejes[j]) { acum += vs[i].u; i++; }
      if (ejes[j] >= l.ingreso) res[k][j] += l.unidades + acum;
    }
  });
  return res;
}
function vistaStock(main) {
  const P = prodsFiltrados(), skus = P.map(p => p.sku);
  const L = lotesDe(skus);
  const [nomPor, claveF, etiqF] = APERTURAS[S.por] || APERTURAS.suc;
  const stock = suma(L, l => l.unidades), vend = suma(L, l => l.vendidas), venc = suma(L.filter(l => l.vencido === "sí"), l => l.unidades);
  const s = seccion("Stock y rotación", `Qué se movió y qué quedó quieto. El stock día a día se reconstruye hacia atrás desde la foto del ${D.foto} (supone que no hubo reposiciones ni transferencias).`);
  s.append(controles([["por", "Abrir por", OPC_POR], ["mapa", "Mapa: mostrar", Object.entries(MAPAS).map(([k, [t]]) => [k, t])]]));
  s.append(bloque(cifrasHTML([[fmt(stock) + " u", `en stock · ${plata(suma(L, l => l.unidades * CAT[l.sku].costo))} a costo`], [pct(vend / (vend + stock || 1)), "vendido de lo que había (desde el inicio de la ventana)"],
    [pct(venc / (stock || 1)), `del stock ya pasó su fecha límite (${fmt(venc)} u)`, "mala"], [pct(suma(L, ritmoReal) / (suma(L, ritmoObj) || 1)), "de lo esperado (ritmo real ÷ objetivo, sumando lotes)"],
    [String(L.filter(l => l.rotacion === "Sin ventas").length), `lotes sin ninguna venta (de ${L.length})`, "mala"], [String(L.filter(l => l.rotacion.startsWith("Vendió, pero")).length), "lotes que se frenaron"]])));
  main.append(s);
  if (!L.length) return;

  // Stock día a día
  const ejes = []; for (let d = (S.desde > F_MIN ? S.desde : F_MIN); d <= S.hasta; d = masDias(d, 1)) ejes.push(d);
  const st = stockDiario(L, ejes, claveF);
  const claves = Object.keys(st).sort((a, b) => st[b][st[b].length - 1] - st[a][st[a].length - 1]);
  const vis = S.por === "producto" ? claves.slice(0, 10) : claves;
  const b1 = bloque(`<h3>Stock al cierre de cada día, por ${nomPor.toLowerCase()}${S.por === "producto" ? " (los 10 con más stock)" : ""}</h3><div class="graf alto"><canvas id="g-stock-t"></canvas></div>`);
  s.append(b1);
  grafico($("#g-stock-t", b1), {
    type: "line",
    data: { labels: ejes.map(d => fechaAR(d).slice(0, 5)), datasets: vis.map((k, i) => ({ label: etiqF(k), data: st[k], borderColor: colorDe(S.por, k, i), backgroundColor: colorDe(S.por, k, i) + "55", fill: S.por !== "producto", pointRadius: 0, borderWidth: 1.5, tension: 0 })) },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { y: { stacked: S.por !== "producto", beginAtZero: true, title: { display: true, text: "unidades" } }, x: { ticks: { maxTicksLimit: 12 } } },
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw)} u` } } } }
  });
  b1.append(verDatos(`Stock al cierre de cada día por ${nomPor.toLowerCase()}`, [{ k: "dia", t: "día", f: fechaAR, csv: v => v }, ...vis.map(k => ({ k, t: etiqF(k), r: true, f: v => fmt(v) }))],
    ejes.map((d, j) => Object.fromEntries([["dia", d], ...vis.map(k => [k, st[k][j]])])), "stock_diario"));

  // Rotación por apertura
  const ROT = ["Sin ventas", "Vendió, pero no en los últimos 30 días", "Vendió en los últimos 30 días"], COLR = ["var(--bad)", "var(--warn)", "var(--good)"];
  const porK = agrupar(L, claveF);
  const filasR = Object.entries(porK).map(([k, ls]) => ({ k, nombre: etiqF(k), stock: suma(ls, l => l.unidades), ...Object.fromEntries(ROT.map((r, i) => ["r" + i, suma(ls.filter(l => l.rotacion === r), l => l.unidades)])),
    pv: suma(ls, l => l.vendidas) / (suma(ls, l => l.vendidas + l.unidades) || 1), pe: suma(ls, ritmoReal) / (suma(ls, ritmoObj) || 1) })).sort((a, b) => b.stock - a.stock);
  const mx = Math.max(...filasR.map(r => r.stock), 1);
  const b2 = bloque(`<h3>¿Rotó? Stock de hoy según cómo vendió cada lote, por ${nomPor.toLowerCase()}</h3>
    <div class="leyenda">${ROT.map((r, i) => `<span><i style="background:${COLR[i]}"></i>${r}</span>`).join("")}</div>
    <div class="hbars">${filasR.slice(0, 20).map(r => `<div class="hbar"><span>${esc(r.nombre)}<br><span class="muted" style="font-size:.76rem">${pct(r.pv)} vendido · ${pct(r.pe)} de lo esperado</span></span>
      <span class="pista" title="${ROT.map((x, i) => `${x}: ${fmt(r["r" + i])} u`).join(" · ")}">${ROT.map((_, i) => `<i style="width:${100 * r["r" + i] / mx}%;background:${COLR[i]}"></i>`).join("")}</span>
      <span class="num r">${fmt(r.stock)} u</span></div>`).join("")}</div>`);
  s.append(b2);
  b2.append(verDatos(`Rotación por ${nomPor.toLowerCase()}`, [{ k: "nombre", t: nomPor }, { k: "stock", t: "stock hoy", r: true, f: v => fmt(v) },
    ...ROT.map((r, i) => ({ k: "r" + i, t: r, r: true, f: v => fmt(v) })), { k: "pv", t: "% vendido", r: true, f: v => pct(v), csv: v => v },
    { k: "pe", t: "% de lo esperado", r: true, f: v => pct(v), csv: v => v }], filasR, "rotacion"));

  // Indicadores por producto y sucursal (los mismos del Excel)
  const b25 = bloque(`<h3>Indicadores por producto y sucursal</h3><p class="nota">Los mismos que calcula el Excel en cada hoja de sucursal: objetivo y ritmo del lote, ventas, stock y rotación. Buscá, ordená tocando un encabezado y tocá una fila para ir a la ficha.</p>`);
  b25.append(tablaAuditable(COLS_INDICADORES, L.map(l => ({ ...l, producto: CAT[l.sku].nombre, n: DEC[l.sku].n })), "indicadores_producto_sucursal", { mostrar: 60, clic: k => cambiar({ tab: "productos", sku: k }, true), claveClic: "sku" }));
  s.append(b25);

  // Mapa producto × sucursal
  const [nomM, valM, fmtM] = MAPAS[S.mapa] || MAPAS.pv;
  const sucsV = SUCS.filter(sc => L.some(l => l.suc === sc.id));
  const lotesSku = agrupar(L, l => l.sku);
  const prods = P.filter(p => lotesSku[p.sku]).sort((a, b) => a.n - b.n || b.stock - a.stock);
  const b3 = bloque(`<h3>Mapa producto × sucursal: ${nomM}</h3>
    <p class="nota">Vacío: el producto no está en esa sucursal. ${["pv", "pe", "ds"].includes(S.mapa) ? "Verde: mejor; rojo: peor." : ""} Tocá una fila para ver la ficha.</p>
    <div class="tabla-wrap densa" style="max-height:640px;overflow:auto"><table><thead><tr><th>producto</th><th>grupo</th>${sucsV.map(sc => `<th class="r">${sc.id}</th>`).join("")}</tr></thead><tbody>
    ${prods.map(p => `<tr class="clic" data-k="${p.sku}"><td>${esc(p.producto)}</td><td>${chip(p.n)}</td>${sucsV.map(sc => {
      const l = (lotesSku[p.sku] || []).find(x => x.suc === sc.id);
      if (!l) return `<td></td>`;
      const v = valM(l);
      return `<td class="r num" style="background:${colorMapa(S.mapa, v)}" title="${esc(p.producto)} en ${sc.id}: ${fmt(l.unidades)} u en stock, ${fmt(l.vendidas)} vendidas, ${l.rotacion.toLowerCase()}">${fmtM(v)}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`);
  b3.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => cambiar({ tab: "productos", sku: tr.dataset.k }, true)));
  s.append(b3);

}

// ---------------------------------------------------------------------------------------------- vista: Sucursales
function vistaSucursales(main) {
  const P = prodsFiltrados(true), skus = P.map(p => p.sku);   // la comparación muestra todas las sucursales aunque haya una elegida
  const Ltodos = D.lotes.filter(l => skus.includes(l.sku));
  const Vtodas = VENTAS.filter(v => v.fecha >= S.desde && v.fecha <= S.hasta && skus.includes(v.sku));
  const totStock = suma(Ltodos, l => l.unidades), totU = suma(Vtodas, v => v.u), totP = suma(Vtodas, v => v.u * v.precio);
  const filas = SUCS.map(sc => {
    const L = Ltodos.filter(l => l.suc === sc.id), V = Vtodas.filter(v => v.suc === sc.id);
    const u = suma(V, v => v.u), pesos = suma(V, v => v.u * v.precio), stock = suma(L, l => l.unidades);
    return { id: sc.id, nombre: `${sc.id} · ${sc.nombre}`, tipo: sc.tipo, productos: L.length, stock, costo: suma(L, l => l.unidades * CAT[l.sku].costo), u, pesos,
      ps: stock / (totStock || 1), pu: u / (totU || 1), pp: pesos / (totP || 1), precio: pesos / (u || 1), pv: suma(L, l => l.vendidas) / (suma(L, l => l.vendidas + l.unidades) || 1),
      pe: suma(L, ritmoReal) / (suma(L, ritmoObj) || 1), sin: L.filter(l => l.rotacion === "Sin ventas").length, venc: suma(L.filter(l => l.vencido === "sí"), l => l.unidades) };
  }).filter(r => r.productos);
  const s = seccion("Sucursales", "Cada sucursal tiene un surtido distinto (ningún producto está en todas): para compararlas sirven más los porcentajes que las unidades. Tocá una sucursal para ver su detalle.");
  const cols = [{ k: "nombre", t: "sucursal", f: (v, r) => `<b>${esc(v)}</b><br><span class="muted" style="font-size:.78rem">${r.tipo}</span>` }, { k: "productos", t: "productos", r: true },
    { k: "stock", t: "stock", r: true, f: v => fmt(v) }, { k: "u", t: "vendidas", r: true, f: v => fmt(v) }, { k: "pesos", t: "venta $", r: true, f: v => plata(v), csv: v => v },
    { k: "pv", t: "% vendido", r: true, f: v => pct(v), csv: v => v }, { k: "pe", t: "% de lo esperado", r: true, f: v => pct(v), csv: v => v },
    { k: "ps", t: "% del stock", r: true, f: v => pct(v), csv: v => v }, { k: "pu", t: "% de las unidades", r: true, f: v => pct(v), csv: v => v },
    { k: "pp", t: "% de los pesos", r: true, f: v => pct(v), csv: v => v }, { k: "precio", t: "precio promedio", r: true, f: v => plata(v), csv: v => v },
    { k: "sin", t: "lotes sin ventas", r: true }, { k: "venc", t: "u vencidas", r: true, f: v => fmt(v) }];
  const b1 = bloque(`<div class="tabla-wrap densa">${tablaHTML(cols, filas, { clic: "id" })}</div>
    <div class="dos"><div><h3>% del stock contra % de las ventas</h3><div class="graf"><canvas id="g-suc-part"></canvas></div>
      <p class="nota">Una sucursal con más % de stock que de ventas tiene stock de sobra para lo que vende.</p></div>
    <div><h3>Ventas por semana de cada sucursal (${S.med === "p" ? "pesos" : "unidades"})</h3><div class="graf"><canvas id="g-suc-sem"></canvas></div></div></div>`);
  b1.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => cambiar({ suc: S.suc === tr.dataset.k ? "" : tr.dataset.k })));
  b1.querySelectorAll("tr.clic").forEach(tr => { if (tr.dataset.k === S.suc) tr.querySelectorAll("td").forEach(td => td.style.background = "var(--accent-soft)"); });
  s.append(controles([["med", "Medir en", [["u", "Unidades"], ["p", "Pesos"]]]]));
  s.append(b1);
  main.append(s);
  grafico($("#g-suc-part", b1), {
    type: "bar",
    data: { labels: filas.map(r => r.id), datasets: [{ label: "% del stock", data: filas.map(r => r.ps * 100), backgroundColor: tok("--line-2") },
      { label: S.med === "p" ? "% de los pesos" : "% de las unidades", data: filas.map(r => (S.med === "p" ? r.pp : r.pu) * 100), backgroundColor: tok("--accent") }] },
    options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: v => v + "%" } } }, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 1)} %` } } } }
  });
  const ejes = ejesTiempo("sem"), med = (MEDIDAS[S.med] || MEDIDAS.u)[1];
  grafico($("#g-suc-sem", b1), {
    type: "line",
    data: { labels: ejes.map(d => fechaAR(d).slice(0, 5)), datasets: filas.map((r, i) => {
      const arr = ejes.map(() => 0);
      Vtodas.filter(v => v.suc === r.id).forEach(v => { const j = semanaDe(v.fecha, S.desde); if (j < arr.length) arr[j] += med(v); });
      return { label: r.id, data: arr, borderColor: colorDe("suc", r.id, i), backgroundColor: colorDe("suc", r.id, i), pointRadius: 2, borderWidth: 2, tension: 0.2 }; }) },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, ticks: { callback: v => S.med === "p" ? plata(v) : fmt(v) } } },
      plugins: { legend: { position: "bottom" } } }
  });
  b1.append(verDatos("Sucursales comparadas", cols, filas, "sucursales"));

  // Detalle de la sucursal elegida
  const sid = S.suc;
  if (!sid) { main.append(bloque(`<div class="vacio">Elegí una sucursal (en la tabla o en el filtro de arriba) para ver qué rotó, qué no vende ahí pero sí en otra, y sus ventas por rubro.</div>`)); return; }
  const L = Ltodos.filter(l => l.suc === sid), V = Vtodas.filter(v => v.suc === sid);
  const s2 = seccion(`${sid} · ${esc(NOM_SUC[sid])}`, `${L.length} productos, ${fmt(suma(L, l => l.unidades))} u en stock, ${fmt(suma(V, v => v.u))} vendidas en el período.`);
  const ROT = ["Sin ventas", "Vendió, pero no en los últimos 30 días", "Vendió en los últimos 30 días"];
  const otras = l => suma(D.lotes.filter(x => x.sku === l.sku && x.suc !== sid), x => x.vendidas);
  const filasL = L.map(l => ({ ...l, producto: CAT[l.sku].nombre, n: DEC[l.sku].n, accion: DEC[l.sku].accion, otras: otras(l) })).sort((a, b) => ROT.indexOf(a.rotacion) - ROT.indexOf(b.rotacion) || b.unidades - a.unidades);
  const noAca = filasL.filter(l => l.rotacion === "Sin ventas" && l.otras > 0);
  const b2 = bloque(`<div class="dos"><div><h3>¿Qué rotó en ${sid}?</h3><table><tbody>${ROT.map((r, i) => {
      const g = filasL.filter(l => l.rotacion === r);
      return `<tr><td><span class="${["mal", "medio", "ok"][i]}">${r}</span></td><td class="r num">${g.length} productos</td><td class="r num">${fmt(suma(g, l => l.unidades))} u</td></tr>`; }).join("")}</tbody></table>
      ${noAca.length ? `<p class="nota" style="margin-top:10px"><b>No venden en ${sid} pero sí en otra sucursal:</b> ${noAca.map(l => `${esc(l.producto)} (${fmt(l.unidades)} u acá; ${fmt(l.otras)} vendidas en otras)`).join(", ")}.</p>` : ""}</div>
    <div><h3>Ventas por semana y rubro en ${sid}</h3><div class="graf"><canvas id="g-suc-rubro"></canvas></div></div></div>
    <div class="tabla-wrap densa">${tablaHTML([
      { k: "producto", t: "producto", cls: "t-prod" }, { k: "n", t: "grupo", f: v => chip(v) }, { k: "rotacion", t: "¿rotó?", f: v => `<span class="${v === ROT[0] ? "mal" : v === ROT[1] ? "medio" : "ok"}">${esc(v)}</span>` },
      { k: "unidades", t: "stock", r: true, f: v => fmt(v) }, { k: "vendidas", t: "vendidas", r: true, f: v => fmt(v) }, { k: "v30", t: "último mes", r: true, f: v => fmt(v) },
      { k: "pct_esperado", t: "% de lo esperado", r: true, f: v => pct(v) }, { k: "dias_de_stock", t: "días de stock", r: true, f: v => v == null ? "sin venta" : fmt(v) },
      { k: "otras", t: "vendidas en otras sucursales", r: true, f: v => fmt(v) }, { k: "accion", t: "acción", f: v => pill(v) }], filasL, { clic: "sku" })}</div>`);
  b2.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => cambiar({ tab: "productos", sku: tr.dataset.k }, true)));
  s2.append(b2);
  main.append(s2);
  const rubros = [...new Set(L.map(l => CAT[l.sku].rubro))].sort();
  grafico($("#g-suc-rubro", b2), {
    type: "line",
    data: { labels: ejes.map(d => fechaAR(d).slice(0, 5)), datasets: rubros.map(rb => {
      const arr = ejes.map(() => 0);
      V.filter(v => CAT[v.sku].rubro === rb).forEach(v => { const j = semanaDe(v.fecha, S.desde); if (j < arr.length) arr[j] += med(v); });
      return { label: rb, data: arr, borderColor: COL_RUBRO[rb], backgroundColor: COL_RUBRO[rb], pointRadius: 2, borderWidth: 2, tension: 0.2 }; }) },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, ticks: { callback: v => S.med === "p" ? plata(v) : fmt(v) } } }, plugins: { legend: { position: "bottom" } } }
  });
  b2.append(verDatos(`Indicadores de cada producto en ${sid}`, COLS_INDICADORES, filasL, `indicadores_${sid}`));
}

// ---------------------------------------------------------------------------------------------- vista: Descuentos
// Los cálculos (períodos, rangos por azar, control, netos) salen de la hoja Descuentos del Excel: acá solo se filtran y se muestran.
const RD = D.descuentos;
const tinteIdx = v => v >= 1.15 ? "var(--good-soft)" : v <= 0.85 ? "var(--bad-soft)" : "transparent";
const signoU = v => (v > 0.5 ? "+" : v < -0.5 ? "−" : "") + fmt(Math.abs(v));
// Descuento cobrado en caja: lo cobrado contra el precio de lista vigente ese día, ponderado por unidades
function cobradoEn(sku, desde, hasta, suc) {
  const V = VENTAS.filter(v => v.sku === sku && v.fecha >= desde && v.fecha <= hasta && (!suc || v.suc === suc));
  const lista = suma(V, v => v.u * listaVigente(v.sku, v.fecha)), cobrado = suma(V, v => v.u * v.precio);
  return { u: suma(V, v => v.u), desc: lista ? 1 - cobrado / lista : null, rebajadas: suma(V.filter(rebajada), v => v.u) };
}
const ESTADOS_CAJA = ["Llegó a caja", "No se ve en el precio cobrado", "Sin ventas en esas fechas", "Anterior a las ventas: no se puede verificar"];
// Cada sugerencia aceptada: ¿se ve en el precio cobrado? Con fechas: su vigencia. Sin fechas: las 4 semanas siguientes a la sugerencia.
function aceptadasEnCaja(set) {
  return D.historial.filter(h => h.aceptacion === 1 && set.has(h.sku)).map(h => {
    const desde = h.desde || (h.fecha >= F_MIN ? h.fecha : null);
    const hasta = h.hasta || (desde ? [masDias(desde, 27), F_MAX].sort()[0] : null);
    const c = desde ? cobradoEn(h.sku, desde, hasta, S.suc) : { u: null, desc: null, rebajadas: null };
    const estado = !desde ? ESTADOS_CAJA[3] : !c.u ? ESTADOS_CAJA[2] : c.desc >= h.descuento / 100 * 0.5 ? ESTADOS_CAJA[0] : ESTADOS_CAJA[1];
    return { ...h, producto: CAT[h.sku].nombre, con_fechas: h.desde ? "sí" : "no", mira_desde: desde, mira_hasta: hasta, u: c.u, cobrado: c.desc, rebajadas: c.rebajadas, estado };
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.producto.localeCompare(b.producto, "es"));
}
// En pantallas chicas los nombres largos no entran en el eje: se acortan (el nombre completo sigue en el tooltip y la tabla)
const corto = (t, n) => innerWidth >= 560 || t.length <= n ? t : t.slice(0, n - 1) + "…";
const semCorta = t => t.replace("durante · ", "dur. ").replace("después · ", "desp. ");
const aFicha = raiz => raiz.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => cambiar({ tab: "productos", sku: tr.dataset.k }, true)));

function vistaDescuentos(main) {
  const P = prodsFiltrados(), set = new Set(P.map(p => p.sku));
  const C = RD.casos.filter(c => set.has(c.sku) && (!S.suc || c.sid === S.suc));
  const skusC = new Set(C.map(c => c.sku));
  const N = RD.netos.filter(n => skusC.has(n.sku));
  const A = aceptadasEnCaja(set);
  const fechasActivas = S.desde !== DEF.desde || S.hasta !== DEF.hasta;
  const tramos = `Antes = ${fechaAR(RD.inicio)} al ${fechaAR(masDias(RD.desde, -1))} (${RD.dias.antes} días) · durante = ${fechaAR(RD.desde)} al ${fechaAR(RD.hasta)} (${RD.dias.durante} días) · después = ${fechaAR(masDias(RD.hasta, 1))} al ${fechaAR(RD.foto)} (${RD.dias["después"]} días).`;

  // 1 · La respuesta
  const firmes = C.filter(c => c.lo > 0), netoU = suma(N, n => n.extra_dur + n.extra_desp), netoM = suma(N, n => n.m_dur + n.m_desp);
  const adel = N.filter(n => n.extra_dur > 0 && n.extra_desp < 0), siguio = N.filter(n => n.desp_idx >= 1.1), ganaron = N.filter(n => n.m_dur + n.m_desp > 0);
  const porEstado = agrupar(A, a => a.estado), cuantos = e => (porEstado[e] || []).length;
  const s1 = seccion("Descuentos: qué pasó cuando se bajó el precio",
    `${tramos} Todo en promedio por día, para comparar períodos de distinto largo, y solo los días en que el lote ya estaba en el local.${fechasActivas ? " <b>Los períodos son fijos: el filtro de fechas no cambia esta pestaña.</b>" : ""}`);
  if (!C.length) {
    s1.append(bloque(`<div class="vacio">Ninguno de los ${P.length} productos filtrados${S.suc ? ` en ${S.suc}` : ""} tuvo un descuento aplicado en caja. Más abajo están sus sugerencias aceptadas y si llegaron al precio cobrado.</div>`));
  } else {
    s1.append(bloque(`<div class="respuesta"><ol>
      <li><b>¿Vendieron más?</b><p>${firmes.length} de ${C.length} casos (un producto en una sucursal) subieron de forma firme${firmes.length ? `: ${firmes.map(c => `${esc(c.producto)} en ${c.sid} (${sgn(c.dur)})`).join(", ")}` : ""}. En el resto, la variación entra en lo que cambia por azar. El control, sin cambios, hizo ${sgn(RD.ctrl_dur)} en las mismas fechas: la suba no fue temporada.</p></li>
      <li><b>¿Duró?</b><p>${siguio.length} de ${N.length} productos siguieron más altos después; en ${adel.length}, parte de lo vendido de más se perdió después (se adelantaron compras).</p></li>
      <li><b>¿Convino?</b><p>Sumando durante y después: ${signoU(netoU)} u y ${plataS(netoM)} de margen contra seguir igual. ${ganaron.length ? `Solo ${ganaron.length} de ${N.length} dejó más margen (${ganaron.map(n => esc(n.producto)).join(", ")}).` : `Ninguno de los ${N.length} dejó más margen.`}</p></li>
      <li><b>¿Se aplicó?</b><p>De ${A.length} sugerencias aceptadas, ${cuantos(ESTADOS_CAJA[0])} se ven en el precio cobrado, ${cuantos(ESTADOS_CAJA[1])} no se ven y ${cuantos(ESTADOS_CAJA[3])} son anteriores a las ventas que tenemos.</p></li>
    </ol>
    <div class="cifras">
      <div class="cifra"><b>${firmes.length} de ${C.length}</b><span>casos con suba firme</span></div>
      <div class="cifra ${netoM < 0 ? "mala" : "buena"}"><b>${plataS(netoM)}</b><span>margen neto contra seguir igual${S.suc ? " (todas las sucursales del producto)" : ""}</span></div>
      <div class="cifra"><b>${sgn(RD.ctrl_dur)}</b><span>el control en las mismas fechas</span></div>
      <div class="cifra${cuantos(ESTADOS_CAJA[0]) < A.length ? " mala" : ""}"><b>${cuantos(ESTADOS_CAJA[0])} de ${A.length}</b><span>aceptadas que llegaron a caja</span></div>
    </div></div>`));
  }
  main.append(s1);

  if (C.length) {
    // 2 · Caso por caso
    const s2 = seccion("Caso por caso: cada producto en cada sucursal",
      "El punto es cuánto cambió la venta por día durante el descuento contra antes. La barra es el rango por azar (se recalcula 2.000 veces tomando días al azar): si no cruza el 0 %, la suba es firme. Tocá una fila para abrir la ficha del producto.");
    const colsC = [{ k: "producto", t: "producto", cls: "t-prod", f: (v, r) => `<b>${esc(v)}</b><br><span class="sku">${r.sku}</span>`, csv: v => v }, { k: "sid", t: "sucursal" },
      { k: "d", t: "descuento", r: true, f: v => pct(v), csv: v => v },
      { k: "u_antes", t: "u/día antes", r: true, f: v => fmt(v, 2), csv: v => v }, { k: "u_durante", t: "u/día durante", r: true, f: v => fmt(v, 2), csv: v => v },
      { k: "u_después", t: "u/día después", r: true, f: v => fmt(v, 2), csv: v => v },
      { k: "dur", t: "durante vs antes", r: true, f: (v, r) => `<span class="${r.lo > 0 ? "ok" : "muted"}">${sgn(v)}</span>`, csv: v => v },
      { k: "lo", t: "rango por azar", r: true, f: (v, r) => `${sgn(v)} a ${sgn(r.hi)}`, csv: v => v },
      { k: "desp", t: "después vs antes", r: true, f: v => `<span class="${v < -0.15 ? "mal" : v > 0.15 ? "ok" : ""}">${sgn(v)}</span>`, csv: v => v },
      { k: "m_antes", t: "margen/día antes", r: true, f: v => plata(v), csv: v => v }, { k: "m_durante", t: "margen/día durante", r: true, f: v => plata(v), csv: v => v },
      { k: "mdur", t: "margen durante vs antes", r: true, f: v => `<span class="${v >= 0 ? "ok" : "mal"}">${sgn(v)}</span>`, csv: v => v },
      { k: "lectura", t: "lectura", cls: "t-texto" }];
    const b2 = bloque(`<div class="graf" style="height:${Math.max(200, 28 * (C.length + 1) + 70)}px"><canvas id="g-casos"></canvas></div>
      <div class="tabla-wrap densa">${tablaHTML(colsC, C, { clic: "sku" })}</div>`);
    aFicha(b2);
    s2.append(b2);
    main.append(s2);
    grafico($("#g-casos", b2), {
      data: { labels: [...C.map(c => `${corto(c.producto, 16)} · ${c.sid}`), "Control (sin cambios)"], datasets: [
        { type: "bar", label: "rango por azar (5 % a 95 %)", data: [...C.map(c => [c.lo * 100, c.hi * 100]), null], barPercentage: .5, borderWidth: 1, order: 2,
          backgroundColor: C.map(c => c.lo > 0 ? tok("--good-soft") : tok("--line-2")), borderColor: C.map(c => c.lo > 0 ? tok("--good") : tok("--muted")) },
        { type: "line", label: "durante vs antes", data: [...C.map(c => c.dur * 100), RD.ctrl_dur * 100], showLine: false, pointRadius: 5, pointHoverRadius: 6, order: 1,
          pointBackgroundColor: [...C.map(c => c.lo > 0 ? tok("--good") : tok("--ink-2")), tok("--warn")], pointBorderColor: tok("--panel"), borderColor: tok("--ink-2"), backgroundColor: tok("--ink-2") }] },
      options: { indexAxis: "y", maintainAspectRatio: false,
        scales: { x: { ticks: { callback: v => (v > 0 ? "+" : "") + v + "%" }, grid: { color: c => c.tick.value === 0 ? tok("--ink-2") : tok("--line") } }, y: { grid: { display: false } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => Array.isArray(c.raw) ? `rango por azar: ${sgn(c.raw[0] / 100)} a ${sgn(c.raw[1] / 100)}` : `durante vs antes: ${sgn(c.raw / 100)}` } } } }
    });
    b2.append(verDatos("Cada producto con descuento, en cada sucursal (hoja Descuentos, bloque 1)", [...colsC.slice(0, 8), { k: "hi", t: "rango (alto)", r: true, f: v => sgn(v), csv: v => v }, ...colsC.slice(8)], C, "descuentos_casos"));

    // 3 · Semana a semana
    const s3 = seccion("¿El efecto duró? Semana a semana",
      `Índice = venta por día de esa semana ÷ venta por día de antes del descuento, sumando las sucursales del producto${S.suc ? ` (<b>incluye todas, no solo ${S.suc}</b>)` : ", para tener menos ruido"}. 1,00 = igual que antes. Está corregido por temporada: se divide por lo que hizo el control esa misma semana.`);
    const filasS = N.map(n => ({ producto: n.producto, sku: n.sku, d: n.d, base: n.base, ...Object.fromEntries(n.idx.map((v, i) => ["s" + i, v])), lectura: n.lec }));
    const colsS = [{ k: "producto", t: "producto", cls: "t-prod" }, { k: "d", t: "descuento", r: true, f: v => pct(v), csv: v => v }, { k: "base", t: "u/día antes", r: true, f: v => fmt(v, 2), csv: v => v },
      ...RD.semanas.map((t, i) => ({ k: "s" + i, t: semCorta(t), r: true, f: v => `<span class="idx" style="background:${tinteIdx(v)}">${fmt(v, 2)}</span>`, csv: v => v })),
      { k: "lectura", t: "lectura", cls: "t-texto" }];
    const b3 = bloque(`<div class="graf alto"><canvas id="g-semanas"></canvas></div>
      <div class="tabla-wrap densa">${tablaHTML(colsS, filasS, { clic: "sku" })}</div>
      <p class="nota">Verde: 15 % o más arriba de antes. Rojo: 15 % o más abajo. La línea punteada es el control sin corregir: cómo se movió la venta en general esas semanas.</p>`);
    aFicha(b3);
    s3.append(b3);
    main.append(s3);
    grafico($("#g-semanas", b3), {
      type: "line",
      data: { labels: RD.semanas.map(semCorta), datasets: [
        ...N.map((n, i) => ({ label: n.producto, data: n.idx, borderColor: PALETA[i % PALETA.length], backgroundColor: PALETA[i % PALETA.length], pointRadius: 2, borderWidth: 2, tension: .2 })),
        { label: "Control (sin corregir)", data: RD.ctrl_idx, borderColor: tok("--ink-2"), backgroundColor: tok("--ink-2"), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5 }] },
      options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        scales: { y: { ticks: { callback: v => fmt(v, 1) }, grid: { color: c => Math.abs(c.tick.value - 1) < 1e-9 ? tok("--ink-2") : tok("--line") } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 2)}` } } } }
    });
    b3.append(verDatos("Índice semanal por producto (hoja Descuentos, bloque 5)", colsS, filasS, "descuentos_semanal"));

    // 4 · Netos
    const s4 = seccion("Lo que dejó cada descuento",
      `Contra seguir vendiendo igual que antes (corregido por temporada), sumando durante y después${S.suc ? ` y todas las sucursales del producto, no solo ${S.suc}` : ""}. El margen de durante ya descuenta lo que se dejó de cobrar.`);
    const filasN = N.map(n => ({ producto: n.producto, sku: n.sku, d: n.d, extra_dur: n.extra_dur, extra_desp: n.extra_desp, neto_u: n.extra_dur + n.extra_desp,
      devuelto: n.extra_dur > 0 && n.extra_desp < 0 ? -n.extra_desp / n.extra_dur : null, m_dur: n.m_dur, m_desp: n.m_desp, neto_m: n.m_dur + n.m_desp }));
    const colsN = [{ k: "producto", t: "producto", cls: "t-prod" }, { k: "d", t: "descuento", r: true, f: v => pct(v), csv: v => v },
      { k: "extra_dur", t: "u extra durante", r: true, sum: true, f: signoU, csv: v => v }, { k: "extra_desp", t: "u extra después", r: true, sum: true, f: signoU, csv: v => v },
      { k: "neto_u", t: "u extra netas", r: true, sum: true, f: v => `<span class="${v > 0 ? "ok" : "mal"}">${signoU(v)}</span>`, csv: v => v },
      { k: "devuelto", t: "lo perdido después ÷ lo ganado durante", r: true, f: v => v == null ? "—" : pct(v), csv: v => v },
      { k: "m_dur", t: "margen durante", r: true, sum: true, f: v => plataS(v), csv: v => v }, { k: "m_desp", t: "margen después", r: true, sum: true, f: v => plataS(v), csv: v => v },
      { k: "neto_m", t: "margen neto", r: true, sum: true, f: v => `<span class="${v > 0 ? "ok" : "mal"}">${plataS(v)}</span>`, csv: v => v }];
    const altoN = Math.max(220, 30 * N.length + 70);
    const b4 = bloque(`<div class="dos"><div><h3>Margen contra seguir igual</h3><div class="graf" style="height:${altoN}px"><canvas id="g-netos"></canvas></div></div>
      <div><h3>Unidades de más y de menos</h3><div class="graf" style="height:${altoN}px"><canvas id="g-netos-u"></canvas></div></div></div>`);
    b4.append(tablaAuditable(colsN, filasN, "descuentos_netos", { alto: 420, clic: sku => cambiar({ tab: "productos", sku }, true), claveClic: "sku" }));
    s4.append(b4);
    main.append(s4);
    const barras = (id, fa, fb, fmtF) => grafico($(id, b4), {
      type: "bar",
      data: { labels: filasN.map(r => corto(r.producto, 18)), datasets: [{ label: "durante", data: filasN.map(fa), backgroundColor: tok("--accent") }, { label: "después", data: filasN.map(fb), backgroundColor: tok("--warn") }] },
      options: { indexAxis: "y", maintainAspectRatio: false,
        scales: { x: { stacked: true, ticks: { callback: fmtF, maxTicksLimit: innerWidth < 560 ? 4 : 8, maxRotation: 0 }, grid: { color: c => c.tick.value === 0 ? tok("--ink-2") : tok("--line") } }, y: { stacked: true, grid: { display: false } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtF(c.raw)}` } } } }
    });
    barras("#g-netos", r => r.m_dur, r => r.m_desp, v => Math.abs(v) >= 1e5 ? `${v > 0 ? "+" : v < 0 ? "−" : ""}$\u00a0${fmt(Math.abs(v) / 1e6, 1)}\u00a0M` : plataS(v));
    barras("#g-netos-u", r => r.extra_dur, r => r.extra_desp, signoU);

    // 5 · Control
    const s5 = seccion("El control: venden bien y no tuvieron ningún cambio",
      "Si estos también hubieran subido en las mismas fechas, la suba de los descontados sería temporada y no descuento. No dependen de los filtros: son la vara para todos.");
    const colsK = [{ k: "producto", t: "producto", cls: "t-prod", f: (v, r) => r.sucursal ? esc(v) : `<b>${esc(v)}</b>` }, { k: "sucursal", t: "sucursal" },
      { k: "u_antes", t: "u/día antes", r: true, f: v => fmt(v, 2) }, { k: "u_durante", t: "u/día durante", r: true, f: v => fmt(v, 2) }, { k: "u_despues", t: "u/día después", r: true, f: v => fmt(v, 2) },
      { k: "dur", t: "durante vs antes", r: true, f: v => sgn(v) }, { k: "desp", t: "después vs antes", r: true, f: v => sgn(v) }];
    s5.append(bloque(`<div class="tabla-wrap densa">${tablaHTML(colsK, RD.control)}</div>`));
    main.append(s5);
  }

  // 6 · Aceptadas contra aplicadas en caja
  const s6 = seccion("Lo aprobado, ¿llegó a caja?",
    `Cada sugerencia aceptada, contra el precio que de verdad se cobró${S.suc ? ` en ${S.suc}` : ""}. Con fechas de vigencia se mira esa vigencia; sin fechas, las 4 semanas siguientes a la sugerencia. "Llegó a caja" = en promedio se cobró al menos la mitad del descuento aceptado. Las ventas que tenemos empiezan el ${fechaAR(F_MIN)}.`);
  const colsA = [{ k: "fecha", t: "sugerida", f: fechaAR, csv: v => v }, { k: "producto", t: "producto", cls: "t-prod", f: (v, r) => `<b>${esc(v)}</b><br><span class="sku">${r.sku}</span>`, csv: v => v },
    { k: "descuento", t: "descuento aceptado", r: true, f: v => fmt(v) + " %" }, { k: "con_fechas", t: "¿con fechas?" },
    { k: "mira_desde", t: "se mira", f: (v, r) => v ? `${fechaAR(v)} al ${fechaAR(r.mira_hasta)}` : "—", csv: v => v },
    { k: "u", t: "u vendidas", r: true, sum: true, f: v => v == null ? "—" : fmt(v) }, { k: "rebajadas", t: "u con precio rebajado", r: true, sum: true, f: v => v == null ? "—" : fmt(v) },
    { k: "cobrado", t: "descuento cobrado", r: true, f: v => v == null ? "—" : pct(v, 1), csv: v => v },
    { k: "estado", t: "¿llegó a caja?", f: v => `<span class="${v === ESTADOS_CAJA[0] ? "ok" : v === ESTADOS_CAJA[1] ? "mal" : "muted"}">${esc(v)}</span>`, csv: v => v },
    { k: "comentario", t: "comentario", cls: "t-texto" }];
  const b6 = bloque(A.length ? cifrasHTML(ESTADOS_CAJA.filter(cuantos).map((e, i) => [fmt(cuantos(e)), e.toLowerCase(), e === ESTADOS_CAJA[0] ? "buena" : e === ESTADOS_CAJA[1] ? "mala" : ""]))
    : `<div class="vacio">Ningún producto filtrado tiene sugerencias aceptadas.</div>`);
  if (A.length) b6.append(tablaAuditable(colsA, A, "aceptadas_vs_caja", { alto: 460, clic: sku => cambiar({ tab: "productos", sku }, true), claveClic: "sku" }));
  b6.insertAdjacentHTML("beforeend", `<p class="nota" style="margin-top:10px">Por qué importa: si lo aprobado no llega al precio, no se puede medir si el descuento sirve. Antes de cualquier cambio de precio hay que verificar que el local cobre lo que se aprobó.</p>`);
  s6.append(b6);
  main.append(s6);

  // Conclusiones del script, tal cual (son de los 8 productos, por eso solo sin filtros)
  if (P.length === D.productos.length && !S.suc)
    main.append(bloque(`<h3>Qué muestran los datos (el mismo texto que la hoja Descuentos)</h3><ul class="conclusiones">${RD.conclusiones.map(t => `<li>${esc(t.replace(/^•\s*/, ""))}</li>`).join("")}</ul>`));
}

// ---------------------------------------------------------------------------------------------- armado
const VISTAS = { decision: vistaDecision, ventas: vistaVentas, stock: vistaStock, sucursales: vistaSucursales, descuentos: vistaDescuentos, productos: vistaProductos, seguimiento: vistaSeguimiento, datos: vistaDatos };
function render() {
  limpiarGraficos();
  $("#tabs").innerHTML = TABS.map(([k, t]) => `<button type="button" role="tab" aria-selected="${S.tab === k}" data-tab="${k}">${t}</button>`).join("");
  $("#tabs").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { cambiar({ tab: b.dataset.tab, orden: "", ...(b.dataset.tab !== "productos" ? {} : {}) }, true); }));
  renderFiltros();
  const main = $("#vista");
  main.innerHTML = avisoFoto();
  main.querySelector("[data-ir]")?.addEventListener("click", e => irAFoto(e.target.dataset.ir));
  VISTAS[S.tab](main);
}
// ---------------------------------------------------------------------------------------------- la base: fotos y subida
const BASE = window.BASE || { online: false };
const ULTIMA = (BASE.fotos || [])[0]?.fecha;
const irAFoto = fecha => { location.href = location.pathname + (fecha && fecha !== ULTIMA ? `?foto=${fecha}` : "") + location.hash; };
function cabeceraFoto() {
  const fotos = BASE.fotos || [];
  const cual = BASE.online && fotos.length > 1
    ? `<label class="campo-foto" for="f-foto">Foto <select id="f-foto">${fotos.map(f => `<option value="${f.fecha}"${f.fecha === D.foto_iso ? " selected" : ""}>${fechaAR(f.fecha)}${f.fecha === ULTIMA ? " · la más nueva" : ""}</option>`).join("")}</select></label>`
    : `<span>Foto del <b>${D.foto}</b></span>`;
  $("#foto").innerHTML = `${cual}<span>ventas del ${fechaAR(F_MIN)} al ${fechaAR(F_MAX)}</span>${BASE.online ? `<button class="btn prim" type="button" id="b-subir">Subir Excel</button>` : ""}`;
  $("#f-foto")?.addEventListener("change", e => irAFoto(e.target.value));
  $("#b-subir")?.addEventListener("click", abrirSubir);
}
function avisoFoto() {
  if (BASE.motivo) return `<div class="aviso-foto" role="status">${esc(BASE.motivo)}</div>`;
  if (BASE.online && ULTIMA && D.foto_iso !== ULTIMA)
    return `<div class="aviso-foto" role="status">Estás viendo la foto del ${D.foto}. La más nueva de la base es la del ${fechaAR(ULTIMA)}. <button class="btn-link" type="button" data-ir="${ULTIMA}">Ver la más nueva</button></div>`;
  return "";
}
function abrirSubir() {
  const dlg = $("#subir");
  dlg.innerHTML = `<form method="dialog" class="subir-in">
    <h2 id="subir-tit">Subir un Excel a la base</h2>
    <p>Corre el mismo proceso que armó este tablero: propuesta, indicadores y seguimiento contra las fotos anteriores.</p>
    <ul class="subir-lista">
      <li>Tiene que tener las hojas de la consigna (<code>productos</code>, <code>stock_sucursal</code>, <code>ventas</code>…). La foto es del último día con ventas.</li>
      <li><b>Actualiza la base para todos.</b> Si es la foto más nueva, el tablero pasa a mostrarla; si ya había una de esa fecha, la reemplaza.</li>
      <li>Tarda entre 15 y 40 segundos. Es una demo: lo que subas queda público.</li>
    </ul>
    <p class="nota">Para probar, las fotos de la base: ${(BASE.fotos || []).filter(f => f.original).map(f => `<a href="${esc(f.original)}" download>${fechaAR(f.fecha)}</a>`).join(" · ")} (la del 15/03 es la de la consigna; las anteriores son recortes armados con <code>recortar_foto.py</code>).</p>
    <label class="campo">Archivo .xlsx<input type="file" id="s-archivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
    <div class="subir-estado" id="s-estado" role="status" aria-live="polite"></div>
    <div class="subir-botones"><button class="btn" value="cerrar" id="s-cerrar">Cerrar</button><button class="btn prim" type="button" id="s-enviar">Subir y procesar</button></div>
  </form>`;
  const estado = $("#s-estado", dlg), enviar = $("#s-enviar", dlg);
  let cargada = null;                                     // después de subir, el mismo botón lleva a la foto
  enviar.addEventListener("click", async () => {
    if (cargada) return irAFoto(cargada.es_la_mas_nueva ? "" : cargada.fecha);
    const f = $("#s-archivo", dlg).files[0];
    if (!f) { estado.innerHTML = '<p class="mal">Elegí un archivo .xlsx.</p>'; return; }
    if (f.size > 4e6) { estado.innerHTML = '<p class="mal">El archivo pesa más de 4 MB.</p>'; return; }
    enviar.disabled = true;
    const t0 = Date.now();
    const reloj = setInterval(() => { const sg = $("#s-seg", dlg); if (sg) sg.textContent = Math.round((Date.now() - t0) / 1000); }, 1000);
    estado.innerHTML = `<p><span class="girando" aria-hidden="true"></span> Procesando ${esc(f.name)}… <span id="s-seg" class="num">0</span> s</p>`;
    try {
      const r = await fetch("/api/subir", { method: "POST", headers: { "content-type": "application/octet-stream", "x-nombre": encodeURIComponent(f.name) }, body: f });
      const j = await r.json().catch(() => ({ error: `El servidor no respondió bien (${r.status}).` }));
      if (!r.ok) {
        estado.innerHTML = `<p class="mal">${esc(j.error)}</p>${j.problemas ? `<ul class="subir-lista">${j.problemas.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
        enviar.disabled = false;
        return;
      }
      estado.innerHTML = `<p class="ok">Listo: la base tiene la foto del ${fechaAR(j.fecha)} (${j.fotos} ${j.fotos === 1 ? "foto" : "fotos"} en total).</p>
        <p>${j.anterior ? `El seguimiento mide ${j.decisiones_seguidas} recomendaciones desde las fotos anteriores.` : "Es la foto más vieja de la base: no tiene seguimiento propio."}
        ${j.es_la_mas_nueva ? "Es la más nueva: el tablero pasa a mostrarla." : `No es la más nueva, así que el tablero sigue mostrando la del ${fechaAR(ULTIMA)}; se recalculó el seguimiento de ${j.recalculadas.map(fechaAR).join(", ")}.`}</p>`;
      cargada = j;
      enviar.textContent = `Ver la foto del ${fechaAR(j.fecha)}`;
      enviar.disabled = false;
    } catch (e) {
      estado.innerHTML = `<p class="mal">No se pudo conectar con el servidor. Probá de nuevo.</p>`;
      enviar.disabled = false;
    } finally { clearInterval(reloj); }
  });
  dlg.showModal();
}

function iniciar() {
  cabeceraFoto();
  const fuente = BASE.online ? `la base del tablero (cada Excel que se sube la actualiza)` : `<code>datos/viento_sur.xlsx</code>, con la base de datos <code>datos/viento_sur.db</code>`;
  $("#pie").innerHTML = `<span>Generado por <code>armar_excel.py</code> desde ${fuente}. Todas las cifras salen del mismo proceso.</span>
    <span>Fotos cargadas: ${(D.historia || []).map(h => fechaAR(h.fecha)).join(", ") || D.foto}.${D.archivo_excel ? ` <a href="${esc(D.archivo_excel)}" download>Descargar el Excel completo</a>.` : ""}</span>`;
  estiloGraficos();
  leerHash();
  render();
  window.addEventListener("hashchange", () => { leerHash(); render(); });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { estiloGraficos(); render(); });
}
if (!window.Chart) {
  window.Chart = function () { return { destroy() {} }; };
  window.Chart.defaults = { font: {}, plugins: { legend: { labels: {} }, tooltip: {} }, animation: {} };
}
iniciar();
