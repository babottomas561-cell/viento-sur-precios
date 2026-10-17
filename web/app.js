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
  ["Mover stock y medir el sobrante", p => p.n === 2],
  ["Resolver lo que está en curso", p => p.n === 3 || p.n === 7],
  ["Contar stock y exhibir", p => p.n === 4],
  ["Investigar en el local", p => p.n === 5],
  ["Revisar exhibición o devolver", p => p.n === 6],
  ["Negociar con el proveedor", p => p.n === 8],
  ["Outlet o devolución del excedente", p => p.n === 9],
];
const viaDe = p => VIAS.find(([, f]) => f(p))[0];
// Las 5 causas: los 9 grupos contados por qué no se vende. Las fotos anteriores de la base pueden no traerlas.
const CAUSAS = D.causas || [];
const CAUSA = Object.fromEntries(CAUSAS.map(c => [c.id, c]));
// Debajo de cada gráfico o tabla, siempre en el mismo orden: cómo leerlo, qué se ve (con los datos) y qué significa para la decisión
const interp = (leer, ve, implica) => `<dl class="interp">${leer ? `<dt>Cómo leerlo</dt><dd>${leer}</dd>` : ""}${ve ? `<dt>Qué se ve</dt><dd>${ve}</dd>` : ""}${implica ? `<dt>Qué significa</dt><dd>${implica}</dd>` : ""}</dl>`;
const tipoTxt = t => ({ sabanas: "sábanas" })[t] || t;          // los tipos vienen sin tilde en los datos
const mayus = s => s.charAt(0).toUpperCase() + s.slice(1);
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/ (%|u\b)/g, "\u00a0$1");      // resaltado entre **; el % y la u no se separan del número
const MARCA = ok => ok === true ? '<span class="ok">✓ sí</span>' : ok === false ? '<span class="mal">✗ no</span>' : '<span class="muted">· dato</span>';

// ---------------------------------------------------------------------------------------------- estado (en el link)
const TABS = [["decision", "Decisión"], ["ventas", "Ventas"], ["stock", "Stock y rotación"], ["sucursales", "Sucursales"], ["descuentos", "Descuentos"], ["productos", "Productos"], ["seguimiento", "Seguimiento"], ["datos", "Datos"]];
const DEF = { tab: "decision", desde: F_MIN, hasta: F_MAX, suc: "", rubro: "", tipo: "", causa: "", grupo: "", sku: "", tabla: "lotes", orden: "", dir: "1", rev: "",
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
  if (S.causa && !CAUSA[S.causa]) descartar("causa");
  if (S.grupo && !D.grupos.some(g => String(g.n) === S.grupo)) descartar("grupo");
  if (S.grupo && S.causa && !CAUSA[S.causa].grupos.includes(+S.grupo)) { avisos.push(`El grupo ${S.grupo} no es de la causa "${CAUSA[S.causa].nombre}": se sacó el filtro de grupo.`); S.grupo = ""; }
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
  const y = window.scrollY;
  const main = $("#vista");
  main.style.minHeight = main.offsetHeight + "px";       // mientras se redibuja, la página no se achica (y no salta para arriba)
  Object.assign(S, cambios);
  AVISOS = normalizar();
  escribirHash();
  render();
  if (irArriba) window.scrollTo({ top: 0 });
  else window.scrollTo(0, y);                             // se queda donde estaba quien tocó el selector
  requestAnimationFrame(() => { main.style.minHeight = ""; if (!irArriba) window.scrollTo(0, y); });
}

// ---------------------------------------------------------------------------------------------- filtros
const prodsFiltrados = (ignorarSuc = false, ignorarSku = false) => D.productos.filter(p => (!S.rubro || p.rubro === S.rubro) && (!S.tipo || p.tipo === S.tipo) && (!S.causa || p.causa === S.causa) && (!S.grupo || String(p.n) === S.grupo)
  && (ignorarSku || !S.sku || p.sku === S.sku) && (ignorarSuc || !S.suc || (LOTES_SKU[p.sku] || []).some(l => l.suc === S.suc)));
const ventasDe = skus => { const set = new Set(skus); return VENTAS.filter(v => v.fecha >= S.desde && v.fecha <= S.hasta && (!S.suc || v.suc === S.suc) && set.has(v.sku)); };
const lotesDe = skus => { const set = new Set(skus); return D.lotes.filter(l => set.has(l.sku) && (!S.suc || l.suc === S.suc)); };

// Indicadores de cada lote al corte de la fecha "hasta" y en el período "desde–hasta", con las mismas definiciones del Excel.
// Con las fechas por defecto dan exactamente los valores del Excel (la foto). El stock al corte = el de la foto + lo vendido después.
const VENTAS_LOTE = agrupar(VENTAS, v => v.sku + "|" + v.suc);
const VENTAS_SKU = agrupar(VENTAS, v => v.sku);
let CORTE = { clave: "", lotes: new Map() };
function alCorte(l) {
  const clave = S.desde + "|" + S.hasta;
  if (CORTE.clave !== clave) CORTE = { clave, lotes: new Map() };
  const k = l.sku + "|" + l.suc;
  if (CORTE.lotes.has(k)) return CORTE.lotes.get(k);
  const H = S.hasta, Dd = S.desde, INI = D.inicio.split("/").reverse().join("-");
  const vs = VENTAS_LOTE[k] || [];
  const cuenta = l.ingreso > INI ? l.ingreso : INI, desdeP = l.ingreso > Dd ? l.ingreso : Dd, h30 = masDias(H, -29);
  const sumU = f => suma(vs.filter(f), v => v.u);
  const vendidas = sumU(v => v.fecha >= desdeP && v.fecha <= H);                  // en el período, desde que el lote está
  const stock = l.unidades + sumU(v => v.fecha > H);
  const v30 = sumU(v => v.fecha >= h30 && v.fecha <= H);
  const enPeriodo = vs.filter(v => v.fecha >= Dd && v.fecha <= H);
  const diasObs = difDias(cuenta, H) + 1;
  const ritmoReal = diasObs > 0 ? sumU(v => v.fecha >= cuenta && v.fecha <= H) / diasObs : null;
  const ultima = enPeriodo.reduce((m, v) => v.fecha > m ? v.fecha : m, "");
  const r = { ...l, existe: l.ingreso <= H, stock_foto: l.unidades, unidades: stock, vendidas, stock_inicial: stock + vendidas, pct_vendido: vendidas / ((stock + vendidas) || 1),
    v30, dias_de_stock: v30 ? stock / (v30 / 30) : null, ritmo_real: ritmoReal, dias_observados: diasObs,
    pct_esperado: ritmoReal == null ? null : ritmoReal / l.ritmo_objetivo, vencido: l.limite < H ? "sí" : "no",
    venta_pesos: suma(enPeriodo, v => v.u * v.precio), ultima_venta: ultima || null, dias_sin_vender: ultima ? difDias(ultima, H) : null,
    vendidas_otras: suma((VENTAS_SKU[l.sku] || []).filter(v => v.suc !== l.suc && v.fecha >= Dd && v.fecha <= H), v => v.u),
    rotacion: !enPeriodo.some(v => v.u) ? "Sin ventas" : v30 ? "Vendió en los últimos 30 días" : "Vendió, pero no en los últimos 30 días" };
  CORTE.lotes.set(k, r);
  return r;
}
// Los lotes que ya estaban en el local a la fecha "hasta", con sus indicadores a esa fecha
const lotesAlCorte = skus => lotesDe(skus).map(alCorte).filter(l => l.existe);
const fechasCambiadas = () => S.desde !== DEF.desde || S.hasta !== DEF.hasta;
const notaCorte = () => fechasCambiadas() ? ` <b>Al ${fechaAR(S.hasta)}</b>, con lo vendido del ${fechaAR(S.desde)} al ${fechaAR(S.hasta)}.` : "";

function renderFiltros() {
  const opciones = (vals, sel, todos) => `<option value="">${todos}</option>` + vals.map(([v, t]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(t)}</option>`).join("");
  const rubros = [...new Set(D.catalogo.map(p => p.rubro))].sort().map(r => [r, r]);
  const tipos = [...new Set(D.catalogo.filter(p => !S.rubro || p.rubro === S.rubro).map(p => p.tipo))].sort().map(t => [t, t]);
  const prods = prodsFiltrados(false, true)        // el producto se elige dentro de los demás filtros, sucursal incluida
    .sort((a, b) => a.producto.localeCompare(b.producto, "es")).map(p => [p.sku, p.producto]);
  const n = ["suc", "rubro", "tipo", "causa", "grupo", "sku"].filter(k => S[k]).length + (S.desde !== DEF.desde || S.hasta !== DEF.hasta ? 1 : 0);
  $("#filtros").innerHTML = `<div class="filtros-in">
    <label class="campo" for="f-desde">Desde<input type="date" id="f-desde" value="${S.desde}" min="${F_MIN}" max="${F_MAX}"></label>
    <label class="campo" for="f-hasta">Hasta<input type="date" id="f-hasta" value="${S.hasta}" min="${F_MIN}" max="${F_MAX}"></label>
    <label class="campo" for="f-suc">Sucursal<select id="f-suc">${opciones(SUCS.map(s => [s.id, `${s.id} · ${s.nombre}`]), S.suc, "Todas")}</select></label>
    <label class="campo" for="f-rubro">Rubro<select id="f-rubro">${opciones(rubros, S.rubro, "Todos")}</select></label>
    <label class="campo" for="f-tipo">Tipo<select id="f-tipo">${opciones(tipos, S.tipo, "Todos")}</select></label>
    ${CAUSAS.length ? `<label class="campo" for="f-causa">Causa<select id="f-causa">${opciones(CAUSAS.map(c => [c.id, c.nombre]), S.causa, "Todas")}</select></label>` : ""}
    <label class="campo" for="f-grupo">Grupo<select id="f-grupo">${opciones(D.grupos.filter(g => !S.causa || CAUSA[S.causa].grupos.includes(g.n)).map(g => [String(g.n), `${g.n} · ${g.nombre}`]), S.grupo, "Todos")}</select></label>
    <label class="campo" for="f-sku">Producto<select id="f-sku">${opciones(prods, S.sku, "Todos")}</select></label>
    <button class="btn" type="button" id="f-limpiar"${n ? "" : " disabled"}>Limpiar filtros</button>
    <span class="activos">${n ? `<b>${n}</b> ${n === 1 ? "filtro activo" : "filtros activos"} · ` : ""}${fmt(prodsFiltrados().length)} de ${D.productos.length} productos</span>
    ${AVISOS.map(a => `<span class="aviso" role="status">${esc(a)}</span>`).join("")}
  </div>`;
  const on = (id, k) => $(id).addEventListener("change", e => cambiar({ [k]: e.target.value, ...(k === "rubro" ? { tipo: "", sku: "" } : k === "causa" ? { grupo: "" } : {}) }));
  on("#f-desde", "desde"); on("#f-hasta", "hasta"); on("#f-suc", "suc"); on("#f-rubro", "rubro"); on("#f-tipo", "tipo"); if (CAUSAS.length) on("#f-causa", "causa"); on("#f-grupo", "grupo"); on("#f-sku", "sku");
  $("#f-limpiar").addEventListener("click", () => cambiar({ desde: DEF.desde, hasta: DEF.hasta, suc: "", rubro: "", tipo: "", causa: "", grupo: "", sku: "", rev: "" }));
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
// Qué dice cada columna de los indicadores, para la interpretación debajo de las tablas
const LEER_INDICADORES = "Una fila por producto en cada sucursal (un lote). Objetivo de venta: lo que se esperaba vender antes de la fecha límite. Debería vender y vende: unidades por día que pide el objetivo y las que vende de verdad; su cociente es el % de lo esperado (al día = 90 % o más). Días que le dura el stock: al ritmo del último mes. ¿Rotó?: sin ventas, vendió pero se frenó (nada en 30 días) o sigue vendiendo.";
const COLS_INDICADORES = [
  { k: "producto", t: "producto", cls: "t-prod", f: (v, r) => `<b>${esc(v)}</b><br><span class="sku">${r.sku}</span>` , csv: v => v },
  { k: "suc", t: "sucursal" },
  { k: "n", t: "grupo", r: true },
  { k: "ingreso", t: "llegó al local", f: fechaAR, csv: v => v },
  { k: "limite", t: "fecha límite", f: (v, r) => `${fechaAR(v)}${r.vencido === "sí" ? ' <span class="mal">vencida</span>' : ""}`, csv: v => v },
  { k: "objetivo", t: "objetivo de venta (u)", r: true, sum: true, f: v => fmt(v) },
  { k: "ritmo_objetivo", t: "debería vender (u/día)", r: true, f: v => fmt(v, 2), csv: v => v },
  { k: "ritmo_real", t: "vende (u/día)", r: true, f: v => fmt(v, 2), csv: v => v },
  { k: "pct_esperado", t: "% de lo esperado", r: true, f: v => `<span class="${v >= D.criterios.al_dia ? "ok" : "mal"}">${pct(v)}</span>`, csv: v => v },
  { k: "stock_inicial", t: "stock al empezar (u)", r: true, sum: true, f: v => fmt(v) },
  { k: "vendidas", t: "vendidas (u)", r: true, sum: true, f: v => fmt(v) },
  { k: "unidades", t: "stock (u)", r: true, sum: true, f: v => fmt(v) },
  { k: "pct_vendido", t: "% vendido del stock", r: true, f: v => pct(v), csv: v => v },
  { k: "v30", t: "vendidas el último mes (u)", r: true, sum: true, f: v => fmt(v) },
  { k: "dias_de_stock", t: "días que le dura el stock", r: true, f: v => v == null ? "sin venta" : fmt(v), csv: v => v },
  { k: "venta_pesos", t: "venta ($)", r: true, sum: true, f: v => plata(v), csv: v => v },
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
// Respuesta al descuento por sucursal: por cada tipo, su total (la fila de svgEvidencia) y debajo cada sucursal, con la misma cuenta
function svgPorSucursal(tipos) {
  const ES = D.evidencia_suc || [];
  const filas = tipos.flatMap(e => [{ total: true, lab: `${tipoTxt(e.tipo)} · total`, r: e.respuesta, lo: e.bajo, hi: e.alto, c: e.firme ? "var(--good)" : e.debil ? "var(--warn)" : "var(--muted)" },
    ...ES.filter(x => x.tipo === e.tipo).map(x => ({ lab: `${x.suc} · ${NOM_SUC[x.suc] || ""}`, r: x.respuesta, lo: x.bajo, hi: x.alto, c: x.bajo > 1 ? "var(--good)" : "var(--muted)" }))]);
  const W = 640, left = 200, right = 24, top = 22, rowH = 24, H = top + filas.length * rowH + 26;
  const lo = Math.min(-0.4, ...filas.map(f => f.lo - 1)), hi = Math.max(0.8, ...filas.map(f => f.hi - 1));
  const x = v => left + (v - lo) / (hi - lo) * (W - left - right);
  let s = "";
  for (let t = Math.ceil(lo * 5) / 5; t <= hi + 1e-9; t += 0.2) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 10}" y2="${top + filas.length * rowH - 8}" stroke="var(--line)" stroke-width="${Math.abs(t) < 1e-9 ? 1.6 : 1}"/>`;
    s += `<text x="${x(t)}" y="${top + filas.length * rowH + 8}" text-anchor="middle">${t > 0 ? "+" : ""}${Math.round(t * 100)}%</text>`;
  }
  filas.forEach((f, i) => {
    const y = top + i * rowH + 2;
    if (f.total && i) s += `<line x1="8" x2="${W - right}" y1="${y - 13}" y2="${y - 13}" stroke="var(--line)"/>`;
    s += `<text class="lab" x="${left - 12}" y="${y + 4}" text-anchor="end"${f.total ? ' font-weight="700"' : ""}>${esc(f.lab)}</text>`;
    s += `<line x1="${x(f.lo - 1)}" x2="${x(f.hi - 1)}" y1="${y}" y2="${y}" stroke="${f.c}" stroke-width="${f.total ? 3 : 2}" opacity=".45" stroke-linecap="round"/>`;
    s += `<circle cx="${x(f.r - 1)}" cy="${y}" r="${f.total ? 6 : 4.5}" fill="${f.c}"><title>${esc(f.lab)}: ${sgn(f.r - 1)} (margen de error ${sgn(f.lo - 1)} a ${sgn(f.hi - 1)})</title></circle>`;
    s += `<text x="${x(f.hi - 1) + 6}" y="${y + 4}">${sgn(f.r - 1)}</text>`;
  });
  return `<svg class="evid" viewBox="0 0 ${W} ${H}" role="img" aria-label="Respuesta al descuento por sucursal">${s}</svg>`;
}
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
    s += `<text class="lab" x="${left - 12}" y="${y + 4}" text-anchor="end">${esc(tipoTxt(e.tipo))} · ${pct(e.descuento)}</text>`;
    s += `<line x1="${x(e.bajo - 1)}" x2="${x(e.alto - 1)}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="3" opacity=".45" stroke-linecap="round"/>`;
    s += `<circle cx="${x(e.respuesta - 1)}" cy="${y}" r="6" fill="${c}"><title>${esc(e.tipo)}: ${sgn(e.respuesta - 1)} (margen de error ${sgn(e.bajo - 1)} a ${sgn(e.alto - 1)}), medido en ${esc(e.referencia)}</title></circle>`;
    s += `<text x="${x(e.respuesta - 1)}" y="${y - 10}" text-anchor="middle">${sgn(e.respuesta - 1)}</text>`;
  });
  s += `<text x="${x(D.control.resp - 1)}" y="${H - 4}" text-anchor="middle" fill="var(--warn)">control sin cambios ${sgn(D.control.resp - 1)}</text>`;
  return `<svg class="evid" viewBox="0 0 ${W} ${H}" role="img" aria-label="Respuesta al descuento por tipo de producto">${s}</svg>`;
}

// ---------------------------------------------------------------------------------------------- vista: Decisión
function vistaDecision(main) {
  const P = prodsFiltrados();
  if (!P.length) { main.insertAdjacentHTML("beforeend", `<div class="vacio">Ningún producto cumple estos filtros. Probá con "Limpiar filtros".</div>`); return; }
  const skus = P.map(p => p.sku);
  const L = lotesDe(skus);
  const stock = suma(P, p => p.stock), capital = suma(P, p => p.stock * p.costo);
  if (fechasCambiadas()) main.insertAdjacentHTML("beforeend", `<div class="aviso-foto" role="status">La propuesta usa los datos al ${D.foto}: las fechas del filtro no la cambian. Sí cambian Ventas, Stock y rotación, Sucursales y la ficha de cada producto.</div>`);
  const vencidas = suma(L.filter(l => l.vencido === "sí"), l => l.unidades), stockL = suma(L, l => l.unidades);
  const atrasados = P.filter(p => p.pct_esperado < D.criterios.al_dia).length;
  const ya = P.filter(p => p.nuestro === "ya"), cond = P.filter(p => p.nuestro === "condicional"), sin = P.length - ya.length - cond.length;
  const venc = P.filter(p => p.u_vencidas > 0 && p.salida);
  const E = D.efecto.filter(e => P.some(p => p.producto === e.producto));
  const uB = suma(E, e => e.u_base), uE = suma(E, e => e.u_esp), mB = suma(E, e => e.m_base), mE = suma(E, e => e.m_esp);
  const mPeor = suma(E, e => e.m_bajo), mMejor = suma(E, e => e.m_alto);     // escenarios: peor sucursal y mejor sucursal con el mismo descuento
  const vias = VIAS.map(([nombre, f]) => { const g = P.filter(p => viaDe(p) === nombre); return { via: nombre, productos: g.length, stock: suma(g, p => p.stock), capital: suma(g, p => p.stock * p.costo) }; })
    .filter(v => v.productos);
  const sinPrecio = vias.filter(v => !/^Descuento/.test(v.via)).sort((a, b) => b.stock - a.stock);
  const filtrado = P.length < D.productos.length;
  const porCausa = CAUSAS.map(c => { const ps = P.filter(p => p.causa === c.id);
    return { ...c, ps, productos: ps.length, stock: suma(ps, p => p.stock), vencidas: suma(ps, p => p.u_vencidas), ya: ps.filter(p => p.nuestro === "ya").length,
             cond: ps.filter(p => p.nuestro === "condicional").length }; }).filter(c => c.productos);
  const enPrecio = porCausa.find(c => c.id === "precio");

  // 1 · La respuesta
  const s1 = document.createElement("section");
  s1.className = "sec";
  const cifras = `<div class="cifras">
        <div class="cifra"><b>${fmt(stock)} u</b><span>en stock · ${plata(capital)} a costo</span></div>
        <div class="cifra mala"><b>${pct(vencidas / (stockL || 1))}</b><span>del stock ya pasó su fecha límite</span></div>
        <div class="cifra buena"><b>${ya.length} + ${cond.length}</b><span>con descuento ya + condicionales</span></div>
        <div class="cifra"><b>${sin}</b><span>se resuelven sin tocar el precio</span></div>
        <div class="cifra"><b>${E.length ? sgn(uE / (uB || 1) - 1) : "—"}</b><span>unidades por mes en los que se descuentan</span></div>
        <div class="cifra mala"><b>${P.filter(p => p.consultora.startsWith("descontar")).length}</b><span>descuenta la consultora; coincide en ${P.filter(p => p.coincide === "sí").length}</span></div>
      </div>`;
  if (porCausa.length && porCausa[0].que_pasa) {
    // El problema y la solución en un minuto: el stock repartido por causa y una tarjeta por causa con sus 4 pasos
    const deCien = enPrecio ? Math.round(100 * enPrecio.stock / (stock || 1)) : 0;
    s1.innerHTML = `<div class="sec-cab"><h2>${filtrado ? `El problema y la solución, para ${P.length} productos filtrados` : "El problema y la solución, en un minuto"}</h2><span class="nota">Datos al ${D.foto}</span></div>
      <div class="bloque resumen">
        <p class="titular">${atrasados} de ${P.length} productos venden menos de lo esperado${vencidas ? ` y el ${pct(vencidas / (stockL || 1))} del stock ya pasó su fecha límite` : ""}.
          ${porCausa.length > 1 ? `<b>Pero no es un solo problema${deCien < 30 ? ", y casi nunca es el precio" : deCien < 50 ? ", y la mayor parte no es de precio" : ""}:</b> de cada 100 unidades en stock, ${deCien ? `${deCien < 50 ? "solo " : ""}${deCien} están` : "ninguna está"} en productos donde el precio puede ser la causa.` : ""}</p>
        <div class="barra-causas" role="img" aria-label="Stock por causa: ${porCausa.map(c => `${c.nombre} ${pct(c.stock / (stock || 1))}`).join(", ")}">
          ${porCausa.map(c => `<button type="button" class="seg${c.id === "precio" ? " es-precio" : ""}" data-k="${c.id}" style="flex:${c.stock}"
            title="${esc(c.nombre)}: ${fmt(c.stock)} u (${pct(c.stock / (stock || 1))}) en ${c.productos} productos · tocá para verlos">${c.stock / (stock || 1) >= 0.08 ? pct(c.stock / (stock || 1)) : ""}</button>`).join("")}
        </div>
        <div class="barra-nombres" aria-hidden="true">${porCausa.map(c => `<span style="flex:${c.stock}"${c.id === "precio" ? ' class="es-precio"' : ""}>${esc(c.nombre)}</span>`).join("")}</div>
        <ul class="barra-leyenda">${porCausa.map(c => `<li><i class="${c.id === "precio" ? "es-precio" : ""}"></i><b>${esc(c.nombre)}</b> ${fmt(c.stock)} u · ${pct(c.stock / (stock || 1))}</li>`).join("")}</ul>
        ${(() => { const mayor = [...porCausa].sort((a, b) => b.stock - a.stock)[0];
          return interp(`La barra es todo el stock (${fmt(stock)} u) partido según por qué no se vende. En azul, la parte donde el precio puede ser la causa. Tocá una parte para ver sus productos.`,
            `${enPrecio ? `Solo ${deCien} de cada 100 unidades están donde el precio puede ser la causa.` : "Ninguna unidad está donde el precio pueda ser la causa."} La causa con más stock es <b>${esc(mayor.nombre)}</b> (${pct(mayor.stock / (stock || 1))}).`,
            "Un descuento general no ataca la mayor parte del problema: cada causa tiene su propia solución, explicada en las tarjetas de abajo."); })()}
        ${cifras}
      </div>`;
    s1.querySelectorAll(".seg").forEach(b => b.addEventListener("click", () => cambiar({ tab: "productos", causa: b.dataset.k, grupo: "", sku: "" }, true)));
    const tarjetas = [...porCausa.map((c, i) => ({ ...c, num: String(CAUSAS.findIndex(x => x.id === c.id) + 1) }))];
    const vencP = P.filter(p => p.u_vencidas > 0);
    if (D.vencido && vencP.length) tarjetas.push({ ...D.vencido, id: "vencido", num: "+", productos: vencP.length, stock: suma(vencP, p => p.u_vencidas), precio: "Si lo demás falla" });
    const bK = bloque(`<h3>Cada causa en cuatro pasos: qué pasa, la prueba, qué hacemos y cómo lo medimos</h3>
      <p class="nota" style="margin:4px 0 4px">${filtrado ? "Los conteos siguen los filtros; las pruebas son de los 48 productos. " : ""}Tocá "Ver productos" para ir a la lista; en la ficha de cada producto están sus propios indicadores, con valor y regla.</p>
      <div class="causas-grid">${tarjetas.map(c => `<article class="causa-card${c.id === "precio" ? " es-precio" : ""}">
        <header><span class="causa-num">${c.num}</span><div><h4>${esc(c.nombre)}</h4><span class="muted">${c.productos} ${c.productos === 1 ? "producto" : "productos"} · ${fmt(c.stock)} u${c.id === "vencido" ? " vencidas" : ` · ${pct(c.stock / (stock || 1))} del stock`}</span></div>
          <span class="toca${c.precio === "No" ? "" : " si"}">¿Precio? ${esc(c.precio)}</span></header>
        <dl class="pasos4">
          <dt>Qué pasa</dt><dd>${md(c.que_pasa)}</dd>
          <dt>La prueba</dt><dd><ul>${c.prueba.map(x => `<li>${md(x)}</li>`).join("")}</ul></dd>
          <dt>Qué hacemos</dt><dd>${md(c.hacemos)}<span class="porque"><b>Por qué:</b> ${md(c.por_que)}</span></dd>
          <dt>Cómo lo medimos</dt><dd>${md(c.medimos)}</dd>
        </dl>
        ${c.id === "vencido" ? "" : `<button class="btn" type="button" data-k="${c.id}">Ver los ${c.productos} productos →</button>`}</article>`).join("")}</div>`);
    bK.querySelectorAll(".causa-card .btn").forEach(b => b.addEventListener("click", () => cambiar({ tab: "productos", causa: b.dataset.k, grupo: "", sku: "" }, true)));
    bK.append(verDatos("Productos por causa", [
      { k: "producto", t: "producto", cls: "t-prod" }, { k: "causa_nom", t: "causa" }, { k: "n", t: "grupo", r: true }, { k: "problema", t: "el problema", cls: "t-texto" },
      { k: "accion", t: "acción" }, { k: "stock", t: "stock", r: true, f: v => fmt(v) }, { k: "u_vencidas", t: "ya vencido", r: true, f: v => fmt(v) }],
      P.map(p => ({ ...p, causa_nom: CAUSA[p.causa]?.nombre })), "causas"));
    s1.append(bK);
  } else {
    s1.innerHTML = `<div class="sec-cab"><h2>${filtrado ? `La respuesta para ${P.length} productos filtrados` : "La respuesta"}</h2><span class="nota">Datos al ${D.foto}</span></div>
      <div class="bloque respuesta">
        <ol>
          <li><b>El problema</b><p>${atrasados} de ${P.length} productos venden menos del ${pct(D.criterios.al_dia)} de lo esperado, y el ${pct(vencidas / (stockL || 1))} del stock (${fmt(vencidas)} u) ya pasó su fecha límite.${porCausa.length > 1 && enPrecio ? ` Pero no es un solo problema: hay ${porCausa.length} causas distintas, y solo el ${pct(enPrecio.stock / (stock || 1))} del stock está en productos donde el precio puede ser la causa.` : ""}</p></li>
          <li><b>Qué proponemos</b><p>${porCausa.length ? "Una solución por causa (la tabla de abajo). " : ""}${ya.length ? `Descuento ahora en ${ya.length}, siempre a prueba y medido` : "Ningún descuento inmediato"}${cond.length ? `; en ${cond.length} más, si se cumple una condición` : ""}. Los otros ${sin} se resuelven sin tocar el precio: ${sinPrecio.slice(0, 3).map(v => v.via.split(":")[0].toLowerCase()).join(", ")}.${venc.length ? ` El stock vencido (${fmt(suma(venc, p => p.u_vencidas))} u) tiene fecha de salida: si la primera acción no cumple, se liquida con fechas y piso en el costo, la última salida el ${fechaAR(venc.reduce((m, p) => p.salida > m ? p.salida : m, ""))}.` : ""}</p></li>
          <li><b>Qué esperamos</b><p>${E.length ? `Con los descuentos de ahora, ${fmt(uB)} → ${fmt(uE, 1)} u por mes. En 2 meses dejarían entre ${plataS(mPeor - mB)} y ${plataS(mMejor - mB)} de margen contra no tocar el precio, según cómo respondió antes el mismo descuento: el descuento mueve poco.` : "El precio no cambia en estos productos."} El stock quieto sale sobre todo por las otras vías: ${sinPrecio[0] ? `${sinPrecio[0].via.toLowerCase()} (${fmt(sinPrecio[0].stock)} u)` : "—"}${sinPrecio[1] ? ` y ${sinPrecio[1].via.toLowerCase()} (${fmt(sinPrecio[1].stock)} u)` : ""}.</p></li>
        </ol>
        ${cifras}
      </div>`;
    if (porCausa.length) {
      // Por qué no se vende: los 9 grupos contados en 5 causas, cada una con su solución
      const mxs = Math.max(...porCausa.map(c => c.stock), 1);
      const bC = bloque(`<h3>Por qué no se vende: ${porCausa.length === CAUSAS.length ? "5 causas" : `${porCausa.length} causas`}, una solución para cada una</h3>
        <p class="nota" style="margin:4px 0 10px">Los 9 grupos de la regla, contados por su causa. Tocá una causa para ver sus productos; en la ficha de cada uno están los indicadores que lo ubican ahí.</p>
        <div class="tabla-wrap"><table class="causas"><thead><tr><th>causa</th><th>el problema</th><th>la solución</th><th class="r">productos</th><th>stock</th><th>¿toca el precio?</th></tr></thead><tbody>
        ${porCausa.map(c => `<tr class="clic" data-k="${c.id}"><td><b>${esc(c.nombre)}</b><br><span class="grupos">${c.grupos.filter(n => c.ps.some(p => p.n === n)).map(chip).join(" ")}</span></td>
          <td>${esc(c.problema)}</td><td>${esc(c.solucion)}</td><td class="r num">${c.productos}</td>
          <td><span class="pista" title="${fmt(c.stock)} u, ${fmt(c.vencidas)} ya vencidas"><i style="width:${100 * c.vencidas / mxs}%;background:var(--bad)"></i><i style="width:${100 * (c.stock - c.vencidas) / mxs}%;background:var(--ink-2);opacity:.35"></i></span>
            <span class="num">${fmt(c.stock)} u</span> <span class="muted">· ${pct(c.stock / (stock || 1))}</span></td>
          <td>${c.precio === "No" ? '<span class="muted">No</span>' : `<b>${esc(c.precio)}</b>`}${c.ya + c.cond ? `<br><span class="muted" style="font-size:.78rem">${[c.ya ? `${c.ya} ya` : "", c.cond ? `${c.cond} ${c.cond === 1 ? "condicional" : "condicionales"}` : ""].filter(Boolean).join(" · ")}</span>` : ""}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="leyenda" style="margin-top:8px"><span><i style="background:var(--bad)"></i>stock ya vencido</span><span><i style="background:var(--ink-2);opacity:.35"></i>stock en fecha</span></div>
        ${enPrecio ? `<p class="mensaje"><b>El mensaje central:</b> solo el ${pct(enPrecio.stock / (stock || 1))} del stock (${fmt(enPrecio.stock)} u) está en productos donde el precio puede ser la causa, y aun ahí el descuento pasa los criterios en ${enPrecio.ya + enPrecio.cond} de ${enPrecio.productos}. El resto tiene otra causa, que un descuento no arregla.</p>` : ""}`);
      bC.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => cambiar({ tab: "productos", causa: tr.dataset.k, grupo: "", sku: "" }, true)));
      bC.append(verDatos("Productos por causa", [
        { k: "producto", t: "producto", cls: "t-prod" }, { k: "causa_nom", t: "causa" }, { k: "n", t: "grupo", r: true }, { k: "problema", t: "el problema", cls: "t-texto" },
        { k: "accion", t: "acción" }, { k: "stock", t: "stock", r: true, f: v => fmt(v) }, { k: "u_vencidas", t: "ya vencido", r: true, f: v => fmt(v) }],
        P.map(p => ({ ...p, causa_nom: CAUSA[p.causa]?.nombre })), "causas"));
      s1.append(bC);
    }
  }
  main.append(s1);

  // 2 · El problema
  const quietos = P.filter(p => p.pct_esperado < D.criterios.al_dia && (p.meses == null || p.meses > 12));
  const alDiaP = P.filter(p => p.pct_esperado >= D.criterios.al_dia).length;
  const s2 = seccion("¿Qué productos no rotan?", "Qué tan lejos está cada producto de lo que se esperaba vender, y dónde está el stock.");
  const b2 = bloque(`<div class="dos"><div><h3>Ritmo contra stock, producto por producto</h3><div class="graf alto"><canvas id="g-disp" aria-label="Ritmo contra meses de stock"></canvas></div>
      ${interp("Cada punto es un producto, del color de su grupo. Hacia la derecha vende más de lo que se esperaba (100 % = justo lo esperado); hacia arriba, el stock le dura más meses al ritmo del último mes. Arriba de todo, los que no vendieron nada en 30 días. Tocá un punto para ver su ficha.",
        `<b>${quietos.length} de ${P.length}</b> están arriba a la izquierda: venden menos del ${pct(D.criterios.al_dia)} de lo esperado y tienen stock para más de un año, o no vendieron nada el último mes. ${alDiaP} venden al día.`,
        "El problema no es parejo: hay productos que se venden solos y otros que no se mueven. Por eso se decide producto por producto y no con un descuento general.")}</div>
    <div><h3>Dónde está el stock (claro: total · oscuro: ya vencido)</h3><div class="hbars" id="stock-grupos"></div><div id="interp-grupos"></div></div></div>`);
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
  const gMas = [...porGrupo].sort((a, b) => b.stock - a.stock)[0], gVenc = [...porGrupo].sort((a, b) => b.vencidas - a.vencidas).filter(g => g.vencidas).slice(0, 2);
  $("#interp-grupos").innerHTML = interp("Cada barra es el stock de un grupo. La parte oscura ya pasó su fecha límite; la clara todavía está en fecha.",
    `El grupo con más stock es <b>${esc(gMas.nombre)}</b> (${fmt(gMas.stock)} u). ${vencidas ? `El ${pct(vencidas / (stockL || 1))} del stock ya venció, sobre todo en ${gVenc.map(g => `${esc(g.nombre.toLowerCase())} (${fmt(g.vencidas)} u)`).join(" y ")}.` : "Todavía no venció nada."}`,
    vencidas ? "El stock vencido tiene urgencia: cada producto empieza por la solución de su causa, pero con fecha de salida si no funciona." : "");
  b2.append(verDatos("Productos con su ritmo y stock", [
    { k: "producto", t: "producto", cls: "t-prod" }, { k: "n", t: "grupo", r: true }, { k: "pct_esperado", t: "% de lo esperado", r: true, f: v => pct(v), csv: v => v },
    { k: "v30", t: "vendidas último mes", r: true, f: v => fmt(v) }, { k: "stock", t: "stock", r: true, f: v => fmt(v) },
    { k: "meses", t: "meses de stock", r: true, f: v => v == null ? "sin venta" : fmt(v, 1) }], P, "problema"));

  // 3 · Cómo decidimos
  const s3 = seccion("¿Cómo se decide cada producto?", "Como un embudo: 9 preguntas en orden, y cada producto se queda en la primera que explica por qué no se vende.");
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
  const evalP = P.filter(p => p.evalua_descuento && p.criterios?.descuento != null);
  const evFirmes = D.evidencia.filter(e => e.firme), evDebil = D.evidencia.filter(e => !e.firme && e.debil);
  rec.insertAdjacentHTML("beforeend", `<div class="veredictos"><span class="nota">En el grupo 9, los criterios del descuento deciden:</span>
    ${v9.bajar ? pill(`Bajar: ${v9.bajar.length}`) : ""}${v9.probar ? pill(`Probar 4 semanas: ${v9.probar.length}`) : ""}${v9.no ? `<span class="pill p-no">No bajar: ${v9.no.length}</span>` : ""}</div>`);
  b3.insertAdjacentHTML("beforeend", interp("Cada fila es una pregunta, en orden. La barra oscura son los productos que se quedan en esa pregunta; la clara, los que pasan a la siguiente. Tocá una fila para ver sus productos.",
    `<b>${P.length - en9.length} de ${P.length}</b> productos se explican antes de llegar al precio. ${en9.length} llegan a la última pregunta, y de esos ${(v9.bajar || []).length + (v9.probar || []).length} pasan los criterios del descuento.`,
    "El precio se discute solo cuando nada más explica por qué no se vende. Así no se descuenta un producto que no está a la vista, está en el local equivocado o tiene un descuento aprobado que nunca se cobró."));

  const b3b = bloque(`<div class="dos">
    <div><h3>Los criterios del descuento</h3>
      <table><tbody>
        <tr><td><b>1 · Su tipo responde</b></td><td>Todo su margen de error queda por encima de 0 % (suba clara). Si fue de ${sgn(D.criterios.respuesta_debil - 1)} o más y la venta se sostuvo después, es débil: como mucho se prueba.</td></tr>
        <tr><td><b>2 · Queda margen</b></td><td>Después del descuento queda al menos ${pct(D.criterios.margen_minimo)} de margen.</td></tr>
        <tr><td><b>3 · No es el más barato</b></td><td>Si ya es el más barato de su tipo y no se vende, el problema no es el precio.</td></tr>
        <tr><td><b>4 · No se adelantan compras</b></td><td>En su tipo, la venta después del descuento no cayó debajo de antes. Con el stock vencido no se mira: adelantar compras no es un costo.</td></tr>
        <tr><td><b>Stock vencido</b></td><td>Si la primera acción no cumple: ${D.criterios.escalera.map(d => pct(d)).join(" y después ")}, ${D.criterios.escalon_dias} días cada escalón (se pasa al siguiente si la venta no se duplica), y después devolución u outlet. Nunca debajo del costo.</td></tr>
      </tbody></table>
      ${interp("Las preguntas que se le hacen a un producto antes de bajarle el precio, con el mismo descuento que ya se probó en su tipo. Las dos primeras son obligatorias. Si su tipo responde claro: con las cuatro se baja, y si falla una se prueba 4 semanas. Si la evidencia es débil, solo se prueba y tiene que cumplir todo.",
        (() => { const pasan = evalP.filter(p => ["bajar", "probar"].includes(p.criterios.veredicto)), noTipo = evalP.filter(p => p.criterios.tipo === "no"),
            noMargen = evalP.filter(p => p.criterios.tipo !== "no" && !p.criterios.margen_ok), otros = evalP.length - pasan.length - noTipo.length - noMargen.length,
            aceptados = P.filter(p => p.nuestro !== "no" && !pasan.includes(p));
          return `Se evalúa en ${evalP.length} productos (los que llegan al final del embudo y, como condición, los recién llegados, los que tienen algo en curso y los de descuentos repetidos). <b>Pasan ${pasan.length}.</b> Quedan afuera ${noTipo.length} porque su tipo no responde${noMargen.length ? `, ${noMargen.length} porque no les queda margen` : ""}${otros > 0 ? ` y ${otros} por los otros criterios (ya es el más barato de su tipo, o en su tipo la venta cae después)` : ""}.${aceptados.length ? ` Además, ${aceptados.length === 1 ? "un descuento ya aceptado por el local se aplica" : `${aceptados.length} descuentos ya aceptados por el local se aplican`} con fechas (${aceptados.map(p => esc(p.producto)).join(", ")}).` : ""}`; })(),
        "El descuento queda solo donde hay evidencia de que mueve la venta y no se pierde plata.")}</div>
    <div><h3>¿En qué tipos un descuento mueve la venta?</h3>
      ${svgEvidencia()}
      ${interp(`Los ${D.evidencia.length} descuentos que se cobraron (${D.vigencia}), uno por tipo. El punto es cuánto más vendió por día con descuento; la línea, su margen de error (entre qué valores puede estar el cambio real). Verde: suba clara; ámbar: subió, pero puede ser casualidad; gris: el cambio entra en el margen de error. La franja es lo que hicieron los productos sin cambios.`,
        `${evFirmes.length ? `<b>${mayus(evFirmes.map(e => `${tipoTxt(e.tipo)} ${sgn(e.respuesta - 1)}`).join(" y "))}</b> responden claro.` : "Ningún tipo responde claro."} ${evDebil.length ? `${mayus(evDebil.map(e => tipoTxt(e.tipo)).join(" y "))}: subió, pero puede ser casualidad.` : ""} En los otros ${D.evidencia.length - evFirmes.length - evDebil.length}, la diferencia el cambio entra en el margen de error.`,
        "Solo esos tipos pueden tener descuento, y siempre a prueba. El detalle está en la pestaña Descuentos.")}</div></div>`);
  s3.append(b3b);
  b3b.append(verDatos("Evidencia por tipo", [
    { k: "tipo", t: "tipo" }, { k: "referencia", t: "medido en" }, { k: "descuento", t: "descuento", r: true, f: v => pct(v), csv: v => v },
    { k: "respuesta", t: "respuesta", r: true, f: v => sgn(v - 1), csv: v => v - 1 }, { k: "bajo", t: "margen de error (desde)", r: true, f: v => sgn(v - 1), csv: v => v - 1 },
    { k: "alto", t: "margen de error (hasta)", r: true, f: v => sgn(v - 1), csv: v => v - 1 }, { k: "firme", t: "¿suba clara?", f: (v, r) => v ? "sí" : r.debil ? "débil" : "no", csv: (v, r) => v ? "sí" : r.debil ? "débil" : "no" },
    { k: "despues", t: "después (descontado el movimiento general)", r: true, f: v => sgn(v - 1), csv: v => v - 1 }], D.evidencia, "evidencia_por_tipo"));

  // 4 · Qué esperamos
  const viaDesc = suma(vias.filter(v => /^Descuento/.test(v.via)), v => v.stock);
  const s4 = seccion("¿Qué efecto esperamos?", "Por dónde sale el stock y qué se puede esperar de los descuentos.");
  const mxv = Math.max(...vias.map(v => v.stock), 1);
  const b4 = bloque(`<div class="dos"><div><h3>Stock según la vía por la que sale</h3><div class="hbars">${vias.map(v => `<div class="hbar"><span>${esc(v.via)}<br><span class="muted" style="font-size:.76rem">${v.productos} ${v.productos === 1 ? "producto" : "productos"} · ${plata(v.capital)} a costo</span></span>
      <span class="pista"><i style="width:${100 * v.stock / mxv}%;background:${/^Descuento/.test(v.via) ? "var(--good)" : "var(--accent)"}"></i></span>
      <span class="num r">${fmt(v.stock)} u</span></div>`).join("")}</div>
      ${interp("Cada barra es el stock que sale por una vía: la acción principal de cada producto (cada producto está en una sola). En verde, las vías con descuento.",
        `Solo el <b>${pct(viaDesc / (stock || 1))}</b> del stock está en productos con descuento. Las vías más grandes son ${sinPrecio.slice(0, 2).map(v => `${esc(v.via.toLowerCase())} (${fmt(v.stock)} u)`).join(" y ")}.`,
        "El stock quieto se mueve sobre todo sin tocar el precio: reponiendo, moviendo, exhibiendo, devolviendo o negociando.")}</div>
    <div><h3>Los descuentos de ahora: margen en 2 meses contra no tocar el precio</h3>${E.length ? `<div class="graf bajo"><canvas id="g-efecto"></canvas></div>
      ${interp("Cada producto con descuento ahora, en tres escenarios: si responde como la peor sucursal, como todas juntas o como la mejor, según lo que pasó antes con el mismo descuento (mismo tipo y mismo %). La barra es el margen en 2 meses (4 semanas con descuento y el mes siguiente) contra no tocar el precio: hacia la izquierda, cuesta más de lo que suma.",
        `Venden de ${fmt(uB)} a ${fmt(uE, 1)} unidades por mes entre los ${E.length}. En margen, entre <b>${plataS(mPeor - mB)}</b> y <b>${plataS(mMejor - mB)}</b> en total (${plataS(mE - mB)} si responden como todas juntas). ${E.filter(e => e.escenarios.every(x => x.dif < 0)).length} pierden margen en los tres escenarios.`,
        "El descuento mueve poco y puede costar margen: por eso es una prueba de 4 semanas, medida contra una sucursal sin descuento, que se corta si no funciona.")}` : `<p class="nota">Ninguno de los productos filtrados tiene descuento ahora.</p>`}</div></div>`);
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
  const s5 = seccion("¿Y la consultora?", `Descuenta en ${P.filter(p => p.consultora.startsWith("descontar")).length} de ${P.length} productos; esta propuesta, en ${ya.length} ahora y ${cond.length} condicionales. <b>Tomaríamos solo una parte.</b>`);
  const coinc = D.grupos.map(g => { const ps = P.filter(p => p.n === g.n); return { ...g, ps: ps.length, si: ps.filter(p => p.coincide === "sí").length }; }).filter(g => g.ps);
  const coTodo = coinc.filter(g => g.si === g.ps), coNada = coinc.filter(g => g.si === 0);
  const mxc = Math.max(...D.grupos.map(g => P.filter(p => p.n === g.n).length), 1);
  const b5 = bloque(`<div class="dos"><div><h3>¿Coincide su decisión de precio? Por grupo</h3><div class="hbars">${D.grupos.filter(g => P.some(p => p.n === g.n)).map(g => {
      const ps = P.filter(p => p.n === g.n), si = ps.filter(p => p.coincide === "sí").length;
      return `<div class="hbar"><span>${chip(g.n)} ${esc(g.nombre)}</span><span class="pista" title="${si} coinciden, ${ps.length - si} no"><i style="width:${100 * si / mxc}%;background:var(--good)"></i><i style="width:${100 * (ps.length - si) / mxc}%;background:var(--bad)"></i></span><span class="num r">${si} de ${ps.length}</span></div>`;
    }).join("")}</div><div class="leyenda" style="margin-top:8px"><span><i style="background:var(--good)"></i>coincide</span><span><i style="background:var(--bad)"></i>no coincide</span></div>
      ${interp("Por grupo, en cuántos productos la consultora decide lo mismo que esta propuesta sobre descontar o no (verde) y en cuántos no (rojo).",
        `Coincide en ${P.filter(p => p.coincide === "sí").length} de ${P.length}.${coTodo.length ? ` En todos los productos de: ${coTodo.map(g => `<b>${esc(g.nombre.toLowerCase())}</b>`).join(", ")}.` : ""}${coNada.length ? ` En ninguno de: ${coNada.map(g => `<b>${esc(g.nombre.toLowerCase())}</b>`).join(", ")}.` : ""}`,
        coNada.length ? `Donde no coincide, la consultora descuenta productos que ${coNada.map(g => ({ 1: "se venden solos", 2: "recién llegaron", 3: "tienen algo en curso", 4: "nunca se exhibieron", 5: "se cortaron sin cambiar el precio", 6: "están en el local equivocado", 7: "tienen descuentos aprobados que nunca se cobraron", 8: "venderían bajo costo", 9: "no responden al descuento" })[g.n]).join(", ")}: problemas que el precio no resuelve.` : "")}</div>
    <div><h3>Dónde se aparta, comprobable con las hojas</h3><table><tbody>${D.consultora.chequeos.map(c => `<tr><td>${esc(c.chequeo)}</td><td class="r num">${c.productos}</td></tr>`).join("")}</tbody></table>
      ${interp("Cada fila es un tipo de error, con cuántos productos lo tienen. Todos se comprueban con las hojas de datos.",
        `${[...D.consultora.chequeos].sort((a, b) => b.productos - a.productos).slice(0, 2).map(c => `en <b>${c.productos} productos</b> ${esc(c.chequeo)}`).join("; ")}. Descontar los que venden al día cedería unos ${plata(D.consultora.regalo)} en 30 días sin necesidad.`,
        "Por eso no la usaríamos tal cual: tomamos su \"no descontar\" donde la venta acompaña al stock y su descuento en productos lentos de los tipos que responden, y reemplazamos el resto.")}</div></div>`);
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
  const s = seccion(`Productos <span class="muted" style="font-weight:400;font-size:1rem">(${P.length})</span>`, "Tocá un producto para ver su ficha: qué le pasa y los indicadores que lo deciden, cómo vende en cada sucursal, por qué cayó en su grupo, cómo le fue con los criterios del descuento y su historial de precio. Tocá un encabezado para ordenar.");
  const cols = [
    { k: "producto", t: "producto", cls: "t-prod", f: (v, r) => `<b>${esc(v)}</b><br><span class="sku">${r.sku} · ${esc(r.sucursales)}</span>` },
    { k: "n", t: "grupo", cls: "t-grupo", f: (v, r) => `${chip(v)} <span class="muted">${esc(r.grupo_nombre)}</span>` },
    ...(CAUSAS.length ? [{ k: "problema", t: "qué le pasa", cls: "t-texto", f: (v, r) => `<b>${esc(CAUSA[r.causa]?.nombre || "")}</b><br><span class="muted">${esc(v)}</span>` }] : []),
    { k: "accion", t: "acción", cls: "t-accion", f: v => pill(v) },
    { k: "stock", t: "stock", r: true, f: v => fmt(v) },
    { k: "pct_esperado", t: "% de lo esperado", r: true, f: v => pct(v), csv: v => v },
    { k: "v30", t: "vendidas el último mes (u)", r: true, f: v => fmt(v) },
    { k: "meses", t: "meses que le dura el stock", r: true, f: v => v == null ? "sin venta" : fmt(v, 1) },
    { k: "consultora", t: "la consultora propone" },
    { k: "coincide", t: "¿coincide en descontar o no?", f: v => v === "sí" ? '<span class="ok">sí</span>' : '<span class="mal">no</span>' },
  ];
  const filas = ordenar(P);
  const b = bloque(`<div class="tabla-wrap">${tablaHTML(cols, filas, { ordenable: true, clic: "sku" })}</div>`);
  b.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => cambiar({ sku: tr.dataset.k }, true)));
  conectarOrden(b);
  b.insertAdjacentHTML("beforeend", interp("Una fila por producto: su grupo, qué le pasa (la causa y el problema en una frase), la acción propuesta y sus datos clave. % de lo esperado: ritmo real ÷ objetivo (al día = 90 % o más). Meses que le dura el stock: al ritmo del último mes. Tocá un encabezado para ordenar y una fila para ver la ficha.",
    `${P.filter(p => p.nuestro === "ya").length} con descuento ahora, ${P.filter(p => p.nuestro === "condicional").length} con descuento si se cumple una condición y ${P.filter(p => p.nuestro === "no").length} sin tocar el precio. La consultora coincide en si descontar o no en ${P.filter(p => p.coincide === "sí").length} de ${P.length}.`, ""));
  b.append(verDatos("Productos con su decisión", [
    { k: "sku", t: "sku" }, { k: "producto", t: "producto" }, { k: "rubro", t: "rubro" }, { k: "tipo", t: "tipo" }, { k: "proveedor", t: "proveedor" },
    { k: "n", t: "grupo" }, { k: "causa_nom", t: "causa" }, { k: "problema", t: "el problema", cls: "t-texto" },
    { k: "ind_txt", t: "indicadores que lo deciden", cls: "t-texto" }, { k: "accion", t: "acción" }, { k: "condicion", t: "condición" }, { k: "motivo", t: "motivo", cls: "t-texto" }, { k: "ademas", t: "además", cls: "t-texto" },
    { k: "indicador", t: "indicador" }, { k: "linea_base", t: "línea base" }, { k: "meta", t: "meta" }, { k: "revisar", t: "revisar el" },
    { k: "si_no", t: "si no se cumple" }, { k: "consultora", t: "consultora" }, { k: "coincide", t: "¿coincide?" }], filas.map(p => ({ ...p, causa_nom: CAUSA[p.causa]?.nombre,
      ind_txt: (p.indicadores || []).map(i => `${i.ok === true ? "✓" : i.ok === false ? "✗" : "·"} ${i.nombre}: ${i.valor}`).join(" · ") })), "productos"));
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

  // La decisión en 4 pasos, como en la primera pantalla: qué pasa, la prueba (sus indicadores), qué hacemos y por qué, y cómo lo medimos
  const ca = CAUSA[p.causa];
  const s1 = seccion("Qué le pasa, qué hacemos y cómo lo medimos");
  const paso = (n, titulo, html) => `<li><span class="cuatro-n">${n}</span><div><h3>${titulo}</h3>${html}</div></li>`;
  const b1 = bloque(`<ol class="cuatro">
    ${p.problema ? paso(1, "Qué pasa", `<p class="problema">${ca ? `<span class="causa">${esc(ca.nombre)}</span>` : ""}${esc(p.problema)}</p>`) : ""}
    ${p.indicadores?.length ? paso(2, "La prueba: los indicadores que lo deciden", `
      <div class="tabla-wrap"><table class="indicadores"><thead><tr><th>indicador</th><th class="r">valor</th><th>regla</th><th>¿se cumple?</th></tr></thead><tbody>
      ${p.indicadores.map(i => `<tr><td>${esc(i.nombre)}</td><td class="r num">${esc(i.valor)}</td><td class="muted">${esc(i.regla || "—")}</td><td>${MARCA(i.ok)}</td></tr>`).join("")}
      </tbody></table></div>
      ${(() => { const conRegla = p.indicadores.filter(i => i.ok != null), si = conRegla.filter(i => i.ok);
        return interp("Cada fila es un dato del producto y la regla con la que se compara, escrita como la condición del diagnóstico: ✓ se cumple, ✗ no se cumple, · dato de contexto. Son los mismos de la hoja Propuesta.",
          `Se cumplen ${si.length} de ${conRegla.length} reglas${si.length ? `: ${si.map(i => esc(i.nombre.toLowerCase())).join("; ")}` : ""}.`,
          ca ? `Por eso está en la causa <b>${esc(ca.nombre)}</b>: ${esc(ca.solucion.charAt(0).toLowerCase() + ca.solucion.slice(1))}.` : ""); })()}`) : ""}
    ${paso(3, "Qué hacemos y por qué", `<dl class="pasos4">
      <dt>Acción</dt><dd>${pill(p.accion)}</dd>
      ${p.condicion ? `<dt>Condición</dt><dd>${esc(p.condicion)}</dd>` : ""}
      <dt>Por qué</dt><dd>${esc(p.motivo)}</dd>
      ${p.ademas ? `<dt>Además</dt><dd>${esc(p.ademas)}</dd>` : ""}
      ${ca ? `<dt>Para su causa</dt><dd>${esc(ca.solucion)}</dd>` : ""}</dl>`)}
    ${paso(4, "Cómo lo medimos", `<dl class="pasos4">${p.indicador ? `<dt>Se mide con</dt><dd>${esc(p.indicador)}</dd><dt>Hoy → meta</dt><dd>${esc(p.linea_base)} → <b>${esc(p.meta)}</b></dd>
      <dt>Se revisa el</dt><dd class="num">${esc(p.revisar)}</dd>${p.si_no ? `<dt>Si no se cumple</dt><dd>${esc(p.si_no)}</dd>` : ""}` : ""}
      <dt>La consultora</dt><dd>${esc(p.consultora)} · ${p.coincide === "sí" ? '<span class="ok">coincide</span>' : '<span class="mal">no coincide</span>'}</dd></dl>`)}
  </ol>`);
  s1.append(b1);
  main.append(s1);

  // Seguimiento de su recomendación (si hay fotos anteriores en la base)
  const SGp = (D.seguimiento || []).find(r => r.sku === sku);
  if (SGp) {
    const sS = seccion("¿Se está cumpliendo?", `Recomendación desde el ${fechaAR(SGp.desde)}: <b>${esc(SGp.accion)}</b>. Medida hasta el ${D.foto} (${SGp.dias} días), sumando las sucursales.`);
    const bS = bloque(`<div class="dos"><div><h3>Unidades por semana desde la recomendación</h3><div class="graf bajo"><canvas id="g-seg-prod"></canvas></div></div>
      <div><dl class="seg-dl"><dt>Estado</dt><dd>${estadoHTML(SGp)}</dd>
        <dt>Unidades por semana</dt><dd class="num">${fmt(SGp.u_sem_antes, 1)} antes → <b>${fmt(SGp.u_sem_despues, 1)}</b> desde la recomendación${SGp.meta_u_sem ? ` (meta ${fmt(SGp.meta_u_sem, 1)})` : ""}</dd>
        <dt>Precio cobrado</dt><dd class="num">${SGp.precio_cobrado ? `${plata(SGp.precio_cobrado)} (lista ${plata(SGp.precio_lista)})${SGp.nuestro === "ya" ? ` · ${SGp.aplicado ? '<span class="ok">el descuento se ve en caja</span>' : '<span class="mal">el descuento no se ve en caja</span>'}` : ""}` : "sin ventas"}</dd>
        <dt>Stock en cada Excel</dt><dd class="num">${SGp.stock.map(x => `${fechaAR(x.fecha).slice(0, 5)}: ${fmt(x.u)}`).join(" → ")}</dd>
        ${SGp.accion_nueva && SGp.accion_nueva !== SGp.accion ? `<dt>Con los datos de hoy</dt><dd>cambia a ${pill(SGp.accion_nueva)}</dd>` : ""}</dl></div></div>
      ${interp(`Barras: unidades vendidas por semana desde que se recomendó, sumando las sucursales. Línea gris: lo que vendía antes${SGp.meta_u_sem ? "; verde: la meta" : ""}.`,
        `Vendía ${fmt(SGp.u_sem_antes, 1)} unidades por semana y desde la recomendación vende ${fmt(SGp.u_sem_despues, 1)}${SGp.meta_u_sem ? `, contra una meta de ${fmt(SGp.meta_u_sem, 1)}` : ""}. Estado: ${esc(SGp.estado)}.`,
        SGp.en_curso ? `Todavía está en curso: se revisa el ${fechaAR(SGp.revisar)}.` : "Ya pasó su fecha de revisión: corresponde seguir con lo que dice \"si no se cumple\".")}`);
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
  const ultimo = p.pasos.at(-1);
  const fallan = [cr.tipo !== "firme" && cr.tipo !== "débil" ? "su tipo no responde al descuento" : "", cr.margen_ok === false ? "no le queda margen" : "",
    cr.posicion_ok === false ? "ya es el más barato de su tipo" : "", cr.despues_ok === false ? "en su tipo la venta cayó después del descuento" : ""].filter(Boolean);
  const veredictoTxt = { bajar: "bajar el precio", probar: "probarlo 4 semanas", no: "no descontar" }[cr.veredicto] || "no descontar";
  const s2 = seccion("El detalle: por qué esta causa y por qué este precio", "Las dos cuentas que deciden: en qué grupo cae y si un descuento se justifica.");
  s2.append(bloque(`<div class="dos">
    <div><h3>Por qué cayó en el grupo ${p.n}</h3>
      <ol class="pasos">${p.pasos.map(x => `<li><span class="marca-p ${x.cumple ? "ok" : "muted"}">${x.cumple ? "✓" : "✗"}</span><span>${esc(x.pregunta)}</span><span class="dato">${esc(x.dato)}</span></li>`).join("")}</ol>
      ${interp("Las preguntas del embudo en orden: ✗ no se cumple y pasa a la siguiente; ✓ es la que explica por qué no se vende. A la derecha de cada una, el dato que la decide.",
        `Se queda en la pregunta ${p.pasos.length}: ${esc(ultimo.dato)}.`,
        p.pasos.length > 2 ? `Las ${p.pasos.length - 1} preguntas anteriores descartan otras causas. Por eso la acción es: ${esc(p.accion.toLowerCase())}.` : p.pasos.length === 2 ? `La pregunta anterior descarta otra causa. Por eso la acción es: ${esc(p.accion.toLowerCase())}.` : `Es la primera pregunta: por eso la acción es: ${esc(p.accion.toLowerCase())}.`)}</div>
    <div><h3>Los criterios del descuento</h3>
      ${cr.descuento != null ? `<table class="criterios"><tbody>
        ${filaCrit("Su tipo responde", cr.tipo === "firme" ? true : cr.tipo === "débil" ? null : false, `${({ firme: "suba clara", "débil": "débil", no: "no responde" })[cr.tipo] || esc(cr.tipo)} (${esc(cr.referencia)}: ${sgn(cr.respuesta)})`, "obligatorio")}
        ${filaCrit("Queda margen", cr.margen_ok, pct(cr.margen), `obligatorio · ≥ ${pct(D.criterios.margen_minimo)}`)}
        ${filaCrit("No es el más barato", cr.posicion_ok, `${cr.rank}.º de ${cr.n_tipo} en precio`, "en su tipo")}
        ${cr.despues_ok == null ? `<tr><td><b>No se adelantan compras</b><br><span class="muted" style="font-size:.8rem">en su tipo</span></td><td><span class="muted">no se mira</span></td><td>la mayor parte de su stock ya venció</td></tr>`
          : filaCrit("No se adelantan compras", cr.despues_ok, `después ${sgn(cr.despues)}`, "en su tipo")}</tbody></table>
        ${interp(`Las preguntas que se le hacen antes de bajarle el precio, con el ${pct(cr.descuento)} que ya se probó en su tipo. Las dos primeras son obligatorias; "débil" quiere decir que su tipo subió, pero puede ser casualidad.`,
          p.evalua_descuento ? `Resultado: <b>${veredictoTxt}</b>${fallan.length ? ` (no cumple: ${fallan.join("; ")})` : " (cumple todo)"}.` : `Si se evaluara, el resultado sería: ${veredictoTxt}${fallan.length ? ` (no cumple: ${fallan.join("; ")})` : ""}.`,
          !p.evalua_descuento ? "Su grupo no discute el precio: estos criterios se muestran solo como referencia."
            : ["bajar", "probar"].includes(cr.veredicto) ? "Se prueba con fechas, por 4 semanas, contra una sucursal sin descuento, y se mide también el mes siguiente."
            : "No se le baja el precio: no hay evidencia de que venda más, o perdería margen.")}` : `<p class="nota">No hay evidencia de su tipo.</p>`}</div></div>`));

  // El descuento en su tipo, sucursal por sucursal (la misma cuenta que la pestaña Descuentos): va después del detalle
  let sEsuc = null;
  const evTipo = D.evidencia.find(e => e.tipo === p.tipo), esTipo = (D.evidencia_suc || []).filter(x => x.tipo === p.tipo);
  const esReferencia = esTipo.some(x => x.sku === sku);
  if (evTipo && esTipo.length && (esReferencia || p.evalua_descuento)) {
    const sE = seccion(esReferencia ? "Su descuento, sucursal por sucursal" : "El descuento en su tipo, sucursal por sucursal",
      esReferencia ? `Este producto tuvo un descuento del ${pct(evTipo.descuento)} que se cobró del ${fechaAR(RD.desde)} al ${fechaAR(RD.hasta)}: es con el que se midió cómo responde su tipo.`
        : `Cómo respondió ${esc(evTipo.referencia)}, el producto de su tipo que tuvo un descuento cobrado, en cada sucursal.`);
    const claras = esTipo.filter(x => x.bajo > 1), mias = L.map(l => l.suc), comunes = mias.filter(s => esTipo.some(x => x.suc === s));
    sE.append(bloque(`${svgPorSucursal([evTipo])}
      ${interp("Primero el total y debajo cada sucursal, con la misma cuenta de la pestaña Descuentos: venta por día con descuento contra el resto de la ventana. El punto es el cambio; la línea, su margen de error. Verde: suba clara.",
        `En total, ${sgn(evTipo.respuesta - 1)}. ${esTipo.map(x => `${x.suc}: ${sgn(x.respuesta - 1)}${x.bajo > 1 ? " (clara)" : ""}`).join("; ")}.${esReferencia ? "" : ` Este producto está en ${mias.join(", ") || "ningún local con estos filtros"}${comunes.length ? `; su tipo se midió también en ${comunes.join(", ")}` : ""}.`}`,
        claras.length && claras.length < esTipo.length ? "El mismo descuento funcionó en un local y no en otro. Con pocas unidades por día puede ser casualidad, así que la decisión usa el total; si se prueba, se mide sucursal por sucursal y se mantiene solo donde funciona."
          : claras.length ? "Respondió en todos los locales donde se midió." : "En ningún local la suba sale del margen de error.")}`));
    sEsuc = sE;
  }
  main.append(s2);
  if (sEsuc) main.append(sEsuc);

  // Ritmo del lote (la cuenta de la consigna): objetivo = unidades_objetivo ÷ días de ingreso a fecha límite;
  // real = vendidas desde el ingreso (o desde el inicio de las ventas, si el lote es anterior) ÷ esos días
  const INI = D.inicio.split("/").reverse().join("-");
  const desdeLote = l => l.ingreso > INI ? l.ingreso : INI;
  const alDia = l => l.pct_esperado >= D.criterios.al_dia;
  const sR = seccion("¿Vende lo que se esperaba?", `Si viene vendiendo lo que se esperaba para su fecha límite (la cuenta de la consigna). Hoy: <b>${pct(p.pct_esperado)} de lo esperado</b>.`);
  if (!L.length) sR.append(bloque(`<div class="vacio">Este producto no tiene stock en ${esc(S.suc)}.</div>`));
  else {
    // Escribe el % de lo esperado cumplido en el punto que se le indique de cada lote (verde al día, rojo atrasado)
    const pctCumplido = (id, punto) => ({ id, afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      L.forEach((l, i) => { const el = punto(chart, i); if (!el) return;
        ctx.save(); ctx.font = `600 12px ${tok("--f-num") || "monospace"}`; ctx.fillStyle = tok(alDia(l) ? "--good" : "--bad"); ctx.textBaseline = "middle";
        ctx.fillText(pct(l.pct_esperado), el.x + 6, el.y); ctx.restore(); }); } });
    const totEsp = suma(L, l => l.ritmo_objetivo * (difDias(desdeLote(l), D.foto_iso) + 1)), totVen = suma(L, l => l.ritmo_real * (difDias(desdeLote(l), D.foto_iso) + 1));
    const vencidos = L.filter(l => l.limite < D.foto_iso);
    const bR = bloque(`<div class="dos"><div><h3>Unidades por día: objetivo contra real</h3><div class="graf bajo" style="height:${Math.max(180, 70 * L.length + 70)}px"><canvas id="g-ritmo"></canvas></div>
        ${interp("Barra gris: lo que tendría que vender por día para llegar a su objetivo a la fecha límite. Barra de color: lo que vende de verdad (verde al día, rojo atrasado). El número es el % del objetivo que cumple; al día es 90 % o más.",
          `${L.map(l => `${l.suc}: ${pct(l.pct_esperado)}`).join("; ")}. En total, ${pct(p.pct_esperado)}: <b>${p.pct_esperado >= D.criterios.al_dia ? "está al día" : "está atrasado"}</b>.`,
          p.pct_esperado >= D.criterios.al_dia ? "Vende lo que se esperaba: no hay un problema de venta que resolver." : "No llega a vender lo previsto antes de su fecha límite: va a sobrar stock si no cambia algo.")}</div>
      <div><h3>Vendido acumulado contra lo esperado</h3><div class="graf bajo" style="height:${Math.max(180, 70 * L.length + 70)}px"><canvas id="g-ritmo-acum"></canvas></div>
        ${interp("La línea llena es lo vendido acumulado en cada local; la punteada, lo que se esperaba haber vendido a cada fecha.",
          `Vendió ${fmt(totVen)} de ${fmt(totEsp)} unidades esperadas hasta el ${D.foto}.${vencidos.length ? ` La fecha límite ya pasó en ${vencidos.map(l => l.suc).join(", ")}.` : ""}`,
          totVen >= totEsp ? "Vende por encima de lo esperado: si sigue así, se puede quedar sin stock antes de la fecha límite (hay que mirar la reposición)." : "Cuanto más queda la línea llena por debajo de la punteada, más stock va a sobrar a la fecha límite.")}</div></div>
      <ul class="ritmo-lotes">${L.map(l => {
        const dias = difDias(desdeLote(l), D.foto_iso) + 1, esperadas = l.ritmo_objetivo * dias, vendio = l.ritmo_real * dias, quedan = difDias(D.foto_iso, l.limite);
        return `<li><b>${l.suc}</b> <span class="muted">${esc(NOM_SUC[l.suc])}</span> · vendió ${fmt(vendio)} de ${fmt(esperadas)} esperadas en ${dias} días
          (<span class="${alDia(l) ? "ok" : "mal"}">${pct(l.pct_esperado)} · ${alDia(l) ? "al día" : "atrasado"}</span>) ·
          fecha límite ${fechaAR(l.limite)} ${quedan < 0 ? `<span class="mal">(vencida hace ${-quedan} días)</span>` : `(faltan ${quedan} días; quedan ${fmt(l.unidades)} u)`}</li>`; }).join("")}</ul>
      <p class="nota"><b>Cómo se calcula</b> (la cuenta de la consigna): objetivo = unidades que se esperaba vender ÷ días entre el ingreso y la fecha límite; real = lo vendido desde el ingreso (o desde el ${fechaAR(INI)}, si el lote es anterior) ÷ esos días, hasta el ${D.foto}. No depende del filtro de fechas.</p>`);
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

  // Cómo vende en cada sucursal
  const vendeEn = L.filter(l => V.some(v => v.suc === l.suc)).map(l => l.suc), noVende = L.filter(l => !vendeEn.includes(l.suc)).map(l => l.suc);
  const s3 = seccion("Cómo vende en cada sucursal", `Ventas y stock de cada local, del ${fechaAR(S.desde)} al ${fechaAR(S.hasta)}.`);
  const uPorSuc = L.map(l => [l.suc, suma(V.filter(v => v.suc === l.suc), v => v.u)]);
  const LC = L.map(alCorte).filter(l => l.existe);
  const b3 = bloque(`<div class="dos"><div><h3>Unidades por semana</h3><div class="graf"><canvas id="g-sem"></canvas></div>
      ${interp("Unidades vendidas por semana, apiladas por local (cada color es una sucursal).",
        !L.length ? "No tiene stock con estos filtros." : `${uPorSuc.map(([s, u]) => `${s}: ${fmt(u)} u`).join("; ")} en el período. ${noVende.length && vendeEn.length ? `<b>En ${noVende.join(", ")} no vendió nada.</b>` : vendeEn.length ? "Vende en todos sus locales." : "<b>No vendió en ningún local.</b>"}`,
        noVende.length && vendeEn.length ? "Un local con stock y sin ventas es candidato a mover unidades a donde sí se venden, o a revisar la exhibición." : noVende.length ? "Si no vende en ningún local, la primera pregunta es si está a la vista (o si existe: contar el stock)." : "")}</div>
    <div><h3>Stock día a día</h3><div class="graf"><canvas id="g-stock"></canvas></div>
      ${interp(`El stock de cada local, día a día. Se reconstruye hacia atrás desde el stock del ${D.foto}: supone que no hubo reposiciones ni transferencias.`,
        LC.length ? `Al ${fechaAR(S.hasta)}: ${LC.map(l => `${l.suc} ${fmt(l.unidades)} u`).join("; ")}.` : "",
        "Una línea que no baja es stock que no se está moviendo.")}</div></div>
    <h3>Indicadores en cada sucursal${fechasCambiadas() ? ` al ${fechaAR(S.hasta)}` : ""}</h3>
    <div class="tabla-wrap densa">${tablaHTML(COLS_INDICADORES.filter(c => !["producto", "n"].includes(c.k)).map(c => c.k === "suc" ? { ...c, f: v => `<b>${v}</b> <span class="muted">${esc(NOM_SUC[v])}</span>` } : c), LC)}</div>
    ${interp("Los indicadores de cada local con las mismas cuentas del Excel: ritmo del lote, vendidas, stock y días de stock al ritmo del último mes.",
      LC.length ? LC.map(l => `${l.suc}: ${l.dias_de_stock == null ? "sin venta en 30 días" : `stock para ${fmt(l.dias_de_stock)} días`}`).join("; ") + "." : "",
      "")}`);
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
  const s4 = seccion("Historial de precio", "Sugerencias, campañas y cambios de precio, en orden.");
  const sinFechas = H.filter(h => h.aceptacion === 1 && !h.desde).length;
  s4.append(bloque(`${eventos.length ? `<ol class="linea-tiempo">${eventos.map(e => `<li><span class="num">${fechaAR(e.f)}</span><b>${e.que}</b><span>${esc(e.det)}</span></li>`).join("")}</ol>` : `<p class="nota">Sin sugerencias, campañas ni cambios de precio registrados.</p>`}
    ${interp("Cada línea es un evento de precio con su fecha: una sugerencia (y si se aceptó), una campaña o un cambio de precio de lista.",
      `${rebajadas.length ? `${fmt(suma(rebajadas, v => v.u))} unidades se vendieron por debajo del precio de lista del ${fechaAR(S.desde)} al ${fechaAR(S.hasta)}.` : `Del ${fechaAR(S.desde)} al ${fechaAR(S.hasta)}, todas las ventas fueron a precio de lista.`}${sinFechas ? ` Tiene ${sinFechas} ${sinFechas === 1 ? "descuento aceptado" : "descuentos aceptados"} sin fechas.` : ""}`,
      sinFechas && !rebajadas.length ? "Lo aprobado nunca llegó a caja: el cliente siguió pagando el precio de lista, y no se puede saber si el descuento sirve." : "")}`));
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
    "Cada recomendación se sigue desde el Excel en que se propuso por primera vez (mientras se siga proponiendo lo mismo) hasta los datos que estás viendo.");
  if (!SG.length) {
    s0.append(bloque(`<div class="vacio">${H.length > 1 ? "Ninguno de los productos filtrados tiene una recomendación de un Excel anterior." :
      `Por ahora hay un solo Excel: el de la consigna, con datos al ${D.foto}. Para saber si una recomendación se cumplió hacen falta las ventas de después, así que <b>el seguimiento empieza cuando llegue el Excel de la semana siguiente</b> (${online ? "con <b>Subir Excel</b>, arriba a la derecha" : "con <code>actualizar.py</code>"}). Mientras tanto, abajo está la agenda: qué se revisa, cuándo, con qué indicador y qué hacer si no se cumple.`}</div>`));
    main.append(s0);
  } else {
    // Dos grupos que no se pisan: las que ya llegaron a su fecha de revisión (cumplió o no) y las que siguen en curso (cómo vienen)
    const cumpleDe = r => r.cumple !== undefined ? r.cumple : r.bien;          // los Excel cargados antes de este cambio no traen la regla
    const yaRev = SG.filter(r => r.revisar && r.revisar <= D.foto_iso), curso = SG.filter(r => !(r.revisar && r.revisar <= D.foto_iso));
    const cuenta = xs => ({ si: xs.filter(r => cumpleDe(r) === true).length, no: xs.filter(r => cumpleDe(r) === false).length, fuera: xs.filter(r => cumpleDe(r) == null).length });
    const cR = cuenta(yaRev), cC = cuenta(curso);
    const desc = SG.filter(r => r.nuestro === "ya"), descAp = desc.filter(r => r.aplicado);
    const cambiaron = SG.filter(r => r.accion_nueva && r.accion_nueva !== r.accion);
    const h0 = H[0], hN = H[H.length - 1];
    const desdes = [...new Set(SG.map(r => r.desde))].sort();
    const esDemo = H.every(h => h.fecha <= "2026-03-15");
    s0.append(bloque(`${esDemo ? `<div class="aviso-foto" role="note"><b>Antes de leer:</b> esta base es una demostración. Los datos ${H.slice(0, -1).map(h => `al ${fechaAR(h.fecha)}`).join(" y ")} son recortes del mismo Excel de la consigna: nadie aplicó esas recomendaciones. Lo que sigue muestra <b>cómo funciona la medición</b>, no el efecto de la propuesta. Con un Excel nuevo cada semana, se ve si lo recomendado se hizo y si funcionó.</div>` : ""}
      <div class="respuesta"><ol>
      <li><b>Qué se mide</b><p>Cada recomendación tiene una regla simple que se comprueba con las ventas, según lo que se propuso (columna "qué tiene que pasar" de la tabla). Se mide desde el Excel en que se recomendó (datos al ${desdes.map(fechaAR).join(" o al ")}) hasta los datos al ${D.foto}, sumando las sucursales.</p></li>
      <li><b>Ya llegaron a su revisión</b><p>${yaRev.length ? `${yaRev.length} de ${SG.length}: <b>cumplieron ${cR.si}</b>, no cumplieron ${cR.no}${cR.fuera ? ` y ${cR.fuera} se confirman fuera de las ventas` : ""}.` : "Ninguna llegó todavía a su fecha de revisión."}</p></li>
      <li><b>Todavía en curso</b><p>${curso.length ? `${curso.length} de ${SG.length}: por ahora van bien ${cC.si}, todavía no ${cC.no}${cC.fuera ? ` y ${cC.fuera} se confirman fuera de las ventas` : ""}. Se juzgan en su fecha de revisión.` : "Ninguna sigue en curso."}</p></li>
      <li><b>Descuentos</b><p>${desc.length ? `De ${desc.length} ${desc.length === 1 ? "descuento recomendado" : "descuentos recomendados"}, ${descAp.length} se ${descAp.length === 1 ? "cobra" : "cobran"} en caja.${descAp.length < desc.length ? " Si no se cobra, no hay nada que medir: es lo primero que hay que confirmar con el local." : ""}` : "No había descuentos recomendados en las fotos anteriores."}</p></li>
      <li><b>Qué cambió</b><p>${cambiaron.length ? `Con los datos de hoy, ${cambiaron.length} ${cambiaron.length === 1 ? "producto tiene" : "productos tienen"} una recomendación nueva: ${cambiaron.slice(0, 4).map(r => `${esc(r.producto)} (${esc(r.accion_nueva.toLowerCase())})`).join(", ")}${cambiaron.length > 4 ? "…" : ""}. Desde ahora se sigue la nueva.` : "Ningún producto cambió de recomendación con los datos de hoy."}</p></li>
    </ol>
    <div class="cifras">
      <div class="cifra"><b>${cR.si} de ${yaRev.length}</b><span>cumplieron, de las que ya llegaron a su revisión</span></div>
      <div class="cifra"><b>${curso.length}</b><span>todavía en curso</span></div>
      <div class="cifra${desc.length && descAp.length < desc.length ? " mala" : ""}"><b>${desc.length ? `${descAp.length} de ${desc.length}` : "—"}</b><span>descuentos que se cobran en caja</span></div>
      <div class="cifra"><b>${cR.fuera + cC.fuera}</b><span>se confirman fuera de las ventas</span></div>
    </div></div>`));
    // Por causa (las mismas 5 de la decisión), según el grupo que tenía el producto cuando se recomendó
    const catSeg = r => (CAUSAS.find(c => c.grupos.includes(r.n)) || {}).nombre || catAccion(r.accion);
    const cats = [...new Set(SG.map(catSeg))].sort((a, b) => SG.filter(r => catSeg(r) === b).length - SG.filter(r => catSeg(r) === a).length);
    const porCat = cats.map(k => ({ k, ...cuenta(SG.filter(r => catSeg(r) === k)) }));
    const mejorCat = porCat.filter(c => c.si).sort((a, b) => b.si / (b.si + b.no) - a.si / (a.si + a.no))[0];
    const bG = bloque(`<div class="dos"><div><h3>Cómo viene cada causa</h3><div class="graf" style="height:${Math.max(200, 34 * cats.length + 70)}px"><canvas id="g-seg-cat"></canvas></div>
        ${interp("Cada barra es una de las 5 causas (según el grupo del producto cuando se recomendó), con cuántos productos cumplen su regla (verde), cuántos todavía no (rojo) y cuántos se confirman fuera de las ventas (gris), juntando las que ya llegaron a su revisión y las que siguen en curso.",
          `${mayus(porCat.map(c => `${esc(c.k.toLowerCase())}: ${c.si} de ${c.si + c.no + c.fuera}`).join("; "))}.${mejorCat ? ` Mejor viene: ${esc(mejorCat.k.toLowerCase())}.` : ""}`,
          esDemo ? "Como nadie aplicó estas recomendaciones, lo que se cumple es lo que ya pasaba solo (por ejemplo, los que venden bien siguen vendiendo); lo que pedía una acción en el local no cambió." : "Muestra qué tipo de acción está funcionando y cuál hay que revisar con los locales.")}</div>
      <div><h3>La cadena, Excel por Excel</h3><div class="graf"><canvas id="g-seg-hist"></canvas></div>
        ${interp("Stock total de la cadena (azul) y la parte que ya pasó su fecha límite (rojo), en cada Excel cargado.",
          `Stock: ${fmt(h0.stock)} → ${fmt(hN.stock)} u del ${fechaAR(h0.fecha)} al ${fechaAR(hN.fecha)}. Ya vencido: ${fmt(h0.vencidas)} → ${fmt(hN.vencidas)} u.`,
          `El stock baja con cada venta; el vencido sube a medida que pasan las fechas límite, aunque nada cambie. Lo que hay que mirar es si el vencido empieza a bajar cuando se aplica la escalera de salida.`)}</div></div>`);
    s0.append(bG);
    const colsSG = [{ k: "producto", t: "producto", cls: "t-prod", f: (v, r) => `<b>${esc(v)}</b><br><span class="sku">${r.sku}</span>`, csv: v => v },
      { k: "accion", t: "recomendación", f: (v, r) => `${pill(v)}<br><span class="muted" style="font-size:.78rem">desde el ${fechaAR(r.desde)} (${r.dias} días)</span>`, csv: v => v },
      { k: "regla", t: "qué tiene que pasar", cls: "t-texto", f: v => esc(v || "—"), csv: v => v },
      { k: "estado", t: "cómo viene", f: (v, r) => `<span class="${cumpleDe(r) === true ? "ok" : cumpleDe(r) === false ? "mal" : "muted"}">${esc(v)}</span>`, csv: v => v },
      { k: "revisar", t: "revisión", f: v => !v ? "—" : v <= D.foto_iso ? `<span class="num">${fechaAR(v)}</span><br><span class="muted" style="font-size:.78rem">ya llegó</span>` : `<span class="num">${fechaAR(v)}</span><br><span class="muted" style="font-size:.78rem">en curso</span>`, csv: v => v },
      { k: "u_sem_despues", t: "u/semana antes → ahora", r: true, f: (v, r) => `${fmt(r.u_sem_antes, 1)} → <b>${fmt(v, 1)}</b>${r.meta_u_sem ? `<br><span class="muted">meta ${fmt(r.meta_u_sem, 1)}</span>` : ""}`, csv: v => v },
      { k: "precio_cobrado", t: "precio cobrado", r: true, f: (v, r) => v ? `${plata(v)}<br><span class="muted">lista ${plata(r.precio_lista)}</span>` : "sin ventas", csv: v => v },
      { k: "stock_ahora", t: "stock desde → ahora", r: true, f: (v, r) => `${fmt(r.stock_antes)} → <b>${fmt(v)}</b>`, csv: v => v },
      { k: "accion_nueva", t: "recomendación con los datos de hoy", f: (v, r) => !v ? "—" : v === r.accion ? '<span class="muted">la misma</span>' : pill(v), csv: v => v }];
    s0.append(tablaAuditable(colsSG, SG, "seguimiento", { alto: 560, clic: sku => cambiar({ tab: "productos", sku }, true), claveClic: "sku" }));
    s0.insertAdjacentHTML("beforeend", interp(`Una fila por recomendación. "Qué tiene que pasar" es la regla que se comprueba con las ventas; "cómo viene", el resultado hasta hoy; "revisión", la fecha en que se juzga (si ya llegó o sigue en curso). Tocá una fila para ver la ficha.`,
      `De las ${yaRev.length} que ya llegaron a su revisión, cumplieron ${cR.si}. ${desc.length ? `De los ${desc.length} descuentos, ${descAp.length} se cobran en caja.` : ""}`,
      "Lo que no cumple en su fecha de revisión pasa a lo que dice su plan \"si no se cumple\" (en la ficha), y lo que se confirma fuera de las ventas se chequea con Compras o con el local."));
    main.append(s0);
    grafico($("#g-seg-cat", bG), {
      type: "bar",
      data: { labels: cats, datasets: [["cumple", "--good", r => cumpleDe(r) === true], ["todavía no", "--bad", r => cumpleDe(r) === false], ["fuera de las ventas", "--line-2", r => cumpleDe(r) == null]].map(([t, c, f]) => ({
        label: t, data: cats.map(k => SG.filter(r => catSeg(r) === k && f(r)).length), backgroundColor: tok(c) })) },
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
    s0.append(verDatos("Cada Excel cargado", [{ k: "fecha", t: "datos al", f: fechaAR, csv: v => v }, { k: "stock", t: "stock (u)", r: true, f: v => fmt(v) },
      { k: "capital", t: "a costo", r: true, f: v => plata(v), csv: v => v }, { k: "vencidas", t: "ya vencido (u)", r: true, f: v => fmt(v) },
      { k: "atrasados", t: "productos atrasados", r: true }, { k: "ya", t: "descuento ya", r: true }, { k: "cond", t: "condicionales", r: true }], H, "historia"));
  }

  // 2 · Cuándo revisar las recomendaciones de esta foto
  const s1 = seccion("Cuándo revisar cada recomendación", "Cada producto tiene un indicador con su línea base, una meta, una fecha de revisión y qué hacer si no se cumple. Tocá una fecha para ver solo esos productos.");
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
  const fechasRev = Object.keys(porFecha).sort((a, b) => clave(a).localeCompare(clave(b)));
  b1.insertAdjacentHTML("beforeend", interp("Cada botón es una fecha de revisión con cuántos productos se revisan ese día y qué tipo de acción tienen; la tabla muestra el indicador de cada uno (hoy → meta) y qué hacer si no se cumple.",
    fechasRev.length ? `${fechasRev.length} fechas de revisión, del ${fechasRev[0]} al ${fechasRev.at(-1)}. La primera tiene ${porFecha[fechasRev[0]].length} productos.` : "",
    "Es la agenda para el próximo Excel: en cada fecha se mira el indicador y, si no llegó a la meta, se aplica el plan \"si no se cumple\"."));
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
  lotes: ["Indicadores por producto y sucursal", () => lotesAlCorte(prodsFiltrados().map(p => p.sku)).map(l => ({ ...l, producto: CAT[l.sku].nombre, n: DEC[l.sku].n })),
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
  const s = seccion("Los datos, para auditar", "Las tablas que usa el análisis, con los filtros de arriba aplicados (los indicadores por producto y sucursal, al corte de la fecha «hasta»). Buscá, ordená tocando un encabezado y revisá los totales: cualquier número del tablero se puede rastrear hasta acá.");
  const b = bloque(`<div class="barra-acciones">
      <label class="campo" for="d-tabla">Tabla<select id="d-tabla">${Object.entries(TABLAS).map(([k, [t]]) => `<option value="${k}"${k === S.tabla ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      ${D.archivo_excel ? `<a class="btn" href="${esc(D.archivo_excel)}" download>Descargar el Excel completo</a>` : ""}
    </div>`);
  b.append(tablaAuditable(cols, filas, `viento_sur_${S.tabla}`, { alto: 640, mostrar: 200, ...(cols.some(c => c.k === "sku") ? { clic: k => cambiar({ tab: "productos", sku: k }, true), claveClic: "sku" } : {}) }));
  const LEER_TABLA = { lotes: LEER_INDICADORES, ventas: "Una fila por día, producto y sucursal: unidades, precio cobrado, precio de lista vigente ese día y el descuento que eso implica.",
    decisiones: "La propuesta de cada producto, como en la hoja Propuesta: acción, motivo, indicador, meta y fecha de revisión.", historial: "Las sugerencias de precio anteriores: si se aceptaron y, si tienen fechas de vigencia, cuándo se aplicaron.",
    campanas: "Las promociones cargadas, con su inicio y fin.", cambios: "Los cambios de precio de lista: el precio del catálogo es el de después del cambio.",
    catalogo: "Cada producto con su precio de lista, su costo y el margen que deja (1 − costo ÷ precio).", consultora: "La propuesta de la consultora tal cual vino, con el stock de hoy al lado: su proyección a 30 días es de ellos, no una venta observada.",
    sucursales: "Los locales: propios o franquicia." };
  b.insertAdjacentHTML("beforeend", interp(LEER_TABLA[S.tabla] || "", `${fmt(filas.length)} filas con los filtros de arriba.`, ""));
  s.append(b);
  main.append(s);
  $("#d-tabla", b).addEventListener("change", e => cambiar({ tabla: e.target.value }));

  const s2 = seccion("Cómo se calcula");
  const C = D.criterios;
  s2.append(bloque(`<table><tbody>
    <tr><td><b>Ritmo del lote</b></td><td>Objetivo = unidades_objetivo ÷ días entre ingreso y fecha límite. Real = vendidas desde el ingreso (o desde el ${fechaAR(F_MIN)}) ÷ esos días. % de lo esperado = real ÷ objetivo; al día si es ${pct(C.al_dia)} o más.</td></tr>
    <tr><td><b>Meses de stock</b></td><td>Stock hoy ÷ vendidas en los últimos 30 días.</td></tr>
    <tr><td><b>Efecto de un descuento</b></td><td>Unidades por día durante el descuento ÷ el resto de la ventana, contando solo los días en que el producto estaba en el local. Margen de error: la cuenta se repite 4.000 veces mezclando los días (bootstrap, semilla fija) y se toma entre qué valores cae 9 de cada 10 veces; si todo queda por encima de 0 %, la suba es clara. Control: productos que venden bien sin ningún cambio.</td></tr>
    <tr><td><b>Después del descuento</b></td><td>Venta posterior ÷ venta anterior, corregida por lo que hizo el control en las mismas fechas.</td></tr>
    <tr><td><b>Stock día a día</b></td><td>Stock del ${D.foto} (el del Excel) + lo vendido después de cada día; vacío antes del ingreso. Supone que no hubo reposiciones ni transferencias.</td></tr>
    <tr><td><b>Grupos</b></td><td>${D.grupos.map(g => `${g.n} · ${esc(g.nombre)}: ${esc(g.regla)}`).join("<br>")}</td></tr>
    <tr><td><b>Umbrales</b></td><td>Al día: ${pct(C.al_dia)} o más de lo esperado · se vende solo: stock para menos de ${C.meses_reponer} meses · algo en curso: los últimos ${C.dias_en_curso} días · se cortó: vendía ${fmt(C.corte_u_dia, 1)} u/día o más y cayó a menos del ${pct(C.corte_ratio)} · mal ubicado: más del ${pct(C.mal_ubicado)} del stock donde no vendió · descuentos repetidos: ${C.aceptados_repetidos} o más aceptados · margen mínimo después de un descuento: ${pct(C.margen_minimo)} · el mes siguiente no cae más del ${pct(1 - C.despues_minimo)} · respuesta débil: ${sgn(C.respuesta_debil - 1)} o más · stock vencido: más del ${pct(C.vencido_mayoria)} · escalera: ${C.escalera.map(d => pct(d)).join(" y ")}, ${C.escalon_dias} días cada escalón</td></tr>
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
const UNA = { total: "el total de la cadena", suc: "una sucursal", rubro: "un rubro", tipo: "un tipo", grupo: "un grupo", producto: "un producto" };
const PICO = { dia: ["El día", "el del"], sem: ["La semana", "la del"], mes: ["El mes", "el de"] };
function topN(filas, claveF, medidaF, n) {
  const tot = {};
  filas.forEach(r => { const k = claveF(r); tot[k] = (tot[k] || 0) + medidaF(r); });
  const orden = Object.keys(tot).sort((a, b) => tot[b] - tot[a] || (a < b ? -1 : a > b ? 1 : 0));   // a igual venta, por clave: no depende del orden de los datos
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
  const totSerie = ejes.map((_, j) => suma(series, x => x.data[j])), completas = S.gran === "sem" && difDias(ejes.at(-1), S.hasta) < 6 ? totSerie.slice(0, -1) : totSerie;
  const iPico = totSerie.indexOf(Math.max(...totSerie)), fmtM = v => S.med === "p" ? plata(v) : `${fmt(v)} u`;
  const b1 = bloque(`<h3>${nomMed[0].toUpperCase() + nomMed.slice(1)} por ${GRANOS[S.gran][0]}, por ${nomPor.toLowerCase()}</h3><div class="graf alto"><canvas id="g-serie"></canvas></div>
    ${interp(`Cada línea es ${UNA[S.por] || "una apertura"}: ${nomMed} vendidas por ${GRANOS[S.gran][0]}${resto ? `. Se muestran los ${claves.length} que más venden y el resto junto` : ""}.${S.gran === "sem" ? " La última semana puede estar incompleta." : ""}`,
      `En total, ${fmtM(suma(totSerie, v => v))}. ${PICO[S.gran][0]} de más venta fue ${PICO[S.gran][1]} ${GRANOS[S.gran][2](ejes[iPico])} (${fmtM(totSerie[iPico])}).${completas.length > 2 ? ` Del primer ${GRANOS[S.gran][0]} completo al último: ${fmtM(completas[0])} → ${fmtM(completas.at(-1))}.` : ""}`,
      `Sirve para ver si la venta sube o baja y si un cambio se nota. Los descuentos que se cobraron fueron ${D.vigencia}; las campañas cargadas no se ven en el precio cobrado.`)}`);
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
  const brecha = [...filas].sort((a, b) => (b.pp - b.pu) - (a.pp - a.pu));
  const rk = topN(V, v => v.sku, med, 15), rkOk = rk.claves.filter(k => DEC[k].causa === "ok").length;
  const b2 = bloque(`<div class="dos"><div><h3>Participación por ${nomPor.toLowerCase()}: unidades contra pesos</h3><div class="graf alto"><canvas id="g-part"></canvas></div>
      ${interp(`Para cada ${nomPor === "Total cadena" ? "apertura" : nomPor.toLowerCase()}, qué parte de las unidades vendidas (gris) y qué parte de la venta en pesos (azul) se lleva.`,
        filas.length ? `Pesa más ${esc(filas[0].nombre)}: ${pct(filas[0].pu, 1)} de las unidades y ${pct(filas[0].pp, 1)} de los pesos.${filas.length > 1 && brecha[0].pp > brecha[0].pu ? ` La mayor diferencia a favor de los pesos: ${esc(brecha[0].nombre)}.` : ""}` : "",
        "Si la parte en pesos es mayor que la de unidades, vende productos más caros que el promedio; si es menor, más baratos.")}</div>
    <div><h3>Los 15 productos que más venden (${nomMed})</h3><div class="graf alto"><canvas id="g-rank"></canvas></div>
      ${interp("Los 15 productos que más vendieron en el período, de mayor a menor. Tocá una barra para ver su ficha.",
        rk.claves.length ? `Los tres primeros: ${rk.claves.slice(0, 3).map(k => esc(CAT[k].nombre)).join(", ")}. ${rkOk} de los ${rk.claves.length} son de la causa "no es un problema".` : "",
        "Lo que más vende no necesita descuento: bajarle el precio regala margen.")}</div></div>`);
  s.append(b2);
  grafico($("#g-part", b2), {
    type: "bar",
    data: { labels: vis.map(r => r.nombre), datasets: [{ label: "% de las unidades", data: vis.map(r => r.pu * 100), backgroundColor: tok("--line-2") }, { label: "% de los pesos", data: vis.map(r => r.pp * 100), backgroundColor: tok("--accent") }] },
    options: { indexAxis: "y", maintainAspectRatio: false, scales: { x: { ticks: { callback: v => v + "%" } } },
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 1)} %` } } } }
  });
  grafico($("#g-rank", b2), {
    type: "bar",
    data: { labels: rk.claves.map(k => CAT[k].nombre), datasets: [{ label: nomMed, data: rk.claves.map(k => rk.total[k]), backgroundColor: tok("--accent") }] },
    options: { indexAxis: "y", maintainAspectRatio: false, onClick: (_, els) => { if (els[0]) cambiar({ tab: "productos", sku: rk.claves[els[0].index] }, true); },
      scales: { x: { ticks: { callback: v => S.med === "p" ? plata(v) : fmt(v) } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${S.med === "p" ? plata(c.raw) : fmt(c.raw) + " u"} · ${CAUSA[DEC[rk.claves[c.dataIndex]].causa]?.nombre || `grupo ${DEC[rk.claves[c.dataIndex]].n}`}` } } } }
  });
  b2.append(verDatos(`Participación por ${nomPor.toLowerCase()}`, [
    { k: "nombre", t: nomPor }, { k: "u", t: "unidades", r: true, f: v => fmt(v) }, { k: "pu", t: "% unidades", r: true, f: v => pct(v, 1), csv: v => v },
    { k: "p", t: "venta $", r: true, f: v => plata(v), csv: v => v }, { k: "pp", t: "% pesos", r: true, f: v => pct(v, 1), csv: v => v },
    { k: "precio", t: "precio promedio cobrado", r: true, f: v => plata(v), csv: v => v }], filas, "ventas_participacion"));
}

// ---------------------------------------------------------------------------------------------- vista: Stock y rotación
const MAPAS = { pv: ["% vendido", l => l.vendidas / (l.vendidas + l.unidades || 1), v => pct(v)], pe: ["% de lo esperado", l => l.pct_esperado, v => pct(v)],
  st: ["stock", l => l.unidades, v => fmt(v)], ve: ["vendidas", l => l.vendidas, v => fmt(v)], ds: ["días de stock", l => l.dias_de_stock, v => v == null ? "sin venta" : fmt(v)] };
// Verde = bien, rojo = mal, con el mismo corte que usa la propuesta: al día desde 90 % de lo esperado; vendido desde la mitad del stock;
// el stock dura menos de 3 meses (90 días). La intensidad crece cuanto más lejos está del corte.
const CORTE_MAPA = { pe: [0.9, true, 0.9], pv: [0.5, true, 0.5], ds: [90, false, 275] };
function colorMapa(m, v) {
  if (!(m in CORTE_MAPA)) return "transparent";
  if (v == null) return m === "ds" ? "color-mix(in srgb, var(--bad) 45%, transparent)" : "transparent";
  const [corte, masEsMejor, escala] = CORTE_MAPA[m];
  const bien = masEsMejor ? v >= corte : v <= corte;
  const dist = Math.min(Math.abs(v - corte) / escala, 1);
  return `color-mix(in srgb, ${bien ? "var(--good)" : "var(--bad)"} ${Math.round(dist * 45 + 10)}%, transparent)`;
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
      if (ejes[j] >= l.ingreso) res[k][j] += (l.stock_foto ?? l.unidades) + acum;
    }
  });
  return res;
}
function vistaStock(main) {
  const P = prodsFiltrados(), skus = P.map(p => p.sku);
  const L = lotesAlCorte(skus);                         // al corte de la fecha "hasta"
  const [nomPor, claveF, etiqF] = APERTURAS[S.por] || APERTURAS.suc;
  const stock = suma(L, l => l.unidades), vend = suma(L, l => l.vendidas), venc = suma(L.filter(l => l.vencido === "sí"), l => l.unidades);
  const s = seccion("Stock y rotación", `Qué se movió y qué quedó quieto.${notaCorte()} El stock de cada día se reconstruye hacia atrás desde el stock del ${D.foto} (supone que no hubo reposiciones ni transferencias).`);
  s.append(controles([["por", "Abrir por (gráfico de stock y rotación)", OPC_POR]]));
  const corte = fechaAR(S.hasta), periodo = fechasCambiadas() ? "en el período" : "desde el inicio de la ventana";
  s.append(bloque(cifrasHTML([[fmt(stock) + " u", `en stock al ${corte} · ${plata(suma(L, l => l.unidades * CAT[l.sku].costo))} a costo`], [pct(vend / (vend + stock || 1)), `vendido de lo que había (${periodo})`],
    [pct(venc / (stock || 1)), `del stock ya pasó su fecha límite al ${corte} (${fmt(venc)} u)`, "mala"], [pct(suma(L, ritmoReal) / (suma(L, ritmoObj) || 1)), `de lo esperado al ${corte} (ritmo real ÷ objetivo, sumando lotes)`],
    [String(L.filter(l => l.rotacion === "Sin ventas").length), `lotes sin ninguna venta ${periodo} (de ${L.length})`, "mala"], [String(L.filter(l => l.rotacion.startsWith("Vendió, pero")).length), "lotes que se frenaron (sin ventas en los últimos 30 días)"]])));
  if (!L.length) { s.append(bloque(`<div class="vacio">Ningún lote con estos filtros${fechasCambiadas() ? ` estaba en el local al ${corte}` : ""}.</div>`)); main.append(s); return; }
  main.append(s);
  if (!L.length) return;

  // Stock día a día
  const ejes = []; for (let d = (S.desde > F_MIN ? S.desde : F_MIN); d <= S.hasta; d = masDias(d, 1)) ejes.push(d);
  const st = stockDiario(L, ejes, claveF);
  const claves = Object.keys(st).sort((a, b) => st[b][st[b].length - 1] - st[a][st[a].length - 1]);
  const vis = S.por === "producto" ? claves.slice(0, 10) : claves;
  const tot0 = suma(vis, k => st[k][0]), totN = suma(vis, k => st[k].at(-1));
  const bajo = vis.map(k => ({ k, baja: st[k][0] - st[k].at(-1), rel: st[k][0] ? 1 - st[k].at(-1) / st[k][0] : 0 })).filter(x => st[x.k][0] > 0).sort((a, b) => a.rel - b.rel);
  const b1 = bloque(`<h3>Stock al cierre de cada día, por ${nomPor.toLowerCase()}${S.por === "producto" ? " (los 10 con más stock)" : ""}</h3><div class="graf alto"><canvas id="g-stock-t"></canvas></div>
    ${interp(`${S.por === "producto" ? "Cada línea es un producto" : `Cada franja es ${UNA[S.por] || "una apertura"}, apiladas: la altura total es el stock`}, al cierre de cada día. Se reconstruye desde el stock del ${D.foto} sumando lo vendido después (supone que no hubo reposiciones ni transferencias); antes de que llegue un lote, ese lote no cuenta.`,
      `${fmt(tot0)} → ${fmt(totN)} u del ${fechaAR(ejes[0])} al ${corte} (${tot0 ? sgn(totN / tot0 - 1) : "—"}).${bajo.length > 1 ? ` Bajó menos: ${esc(etiqF(bajo[0].k))} (${sgn(-bajo[0].rel)}).` : ""}`,
      "Una franja que casi no baja es stock quieto: ahí apuntan las acciones de la propuesta.")}`);
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
  const b2 = bloque(`<h3>¿Rotó? Stock al ${corte} según cómo vendió cada lote ${periodo}, por ${nomPor.toLowerCase()}</h3>
    <div class="leyenda">${ROT.map((r, i) => `<span><i style="background:${COLR[i]}"></i>${r}</span>`).join("")}</div>
    <div class="hbars">${filasR.slice(0, 20).map(r => `<div class="hbar"><span>${esc(r.nombre)}<br><span class="muted" style="font-size:.76rem">${pct(r.pv)} vendido · ${pct(r.pe)} de lo esperado</span></span>
      <span class="pista" title="${ROT.map((x, i) => `${x}: ${fmt(r["r" + i])} u`).join(" · ")}">${ROT.map((_, i) => `<i style="width:${100 * r["r" + i] / mx}%;background:${COLR[i]}"></i>`).join("")}</span>
      <span class="num r">${fmt(r.stock)} u</span></div>`).join("")}</div>
    ${(() => { const rojo = suma(filasR, r => r.r0), amar = suma(filasR, r => r.r1), peor = [...filasR].sort((a, b) => (b.r0 + b.r1) / (b.stock || 1) - (a.r0 + a.r1) / (a.stock || 1))[0];
      return interp(`Cada barra es el stock de ${UNA[S.por] || "una apertura"}, partido según cómo vendió cada lote: <span class="mal">rojo</span>, no vendió nada; <span class="medio">amarillo</span>, vendió pero se frenó (nada en los últimos 30 días); <span class="ok">verde</span>, sigue vendiendo. Debajo del nombre, qué parte de lo que había se vendió y el ritmo contra lo esperado.`,
        `${fmt(rojo)} u (${pct(rojo / (stock || 1))}) están en lotes sin ninguna venta y ${fmt(amar)} u (${pct(amar / (stock || 1))}) en lotes que se frenaron.${peor ? ` Más quieto: ${esc(peor.nombre)} (${pct((peor.r0 + peor.r1) / (peor.stock || 1))} de su stock en rojo o amarillo).` : ""}`,
        "El rojo y el amarillo son el stock quieto. Que un lote no venda no dice por qué: eso lo decide la propuesta producto por producto."); })()}`);
  s.append(b2);
  b2.append(verDatos(`Rotación por ${nomPor.toLowerCase()}`, [{ k: "nombre", t: nomPor }, { k: "stock", t: `stock al ${corte}`, r: true, f: v => fmt(v) },
    ...ROT.map((r, i) => ({ k: "r" + i, t: r, r: true, f: v => fmt(v) })), { k: "pv", t: "% vendido", r: true, f: v => pct(v), csv: v => v },
    { k: "pe", t: "% de lo esperado", r: true, f: v => pct(v), csv: v => v }], filasR, "rotacion"));

  // Indicadores por producto y sucursal (los mismos del Excel)
  const b25 = bloque(`<h3>Indicadores por producto y sucursal${fechasCambiadas() ? `, al ${corte}` : ""}</h3>`);
  b25.append(tablaAuditable(COLS_INDICADORES, L.map(l => ({ ...l, producto: CAT[l.sku].nombre, n: DEC[l.sku].n })), "indicadores_producto_sucursal", { mostrar: 60, clic: k => cambiar({ tab: "productos", sku: k }, true), claveClic: "sku" }));
  b25.insertAdjacentHTML("beforeend", interp(LEER_INDICADORES + " Son los mismos del Excel, en cada hoja de sucursal. Buscá, ordená tocando un encabezado y tocá una fila para ir a la ficha.",
    `${L.filter(l => l.pct_esperado >= D.criterios.al_dia).length} de ${L.length} lotes están al día; ${L.filter(l => l.vencido === "sí").length} ya pasaron su fecha límite.`, ""));
  s.append(b25);

  // Mapa producto × sucursal
  const [nomM, valM, fmtM] = MAPAS[S.mapa] || MAPAS.pv;
  const sucsV = SUCS.filter(sc => L.some(l => l.suc === sc.id));
  const lotesSku = agrupar(L, l => l.sku);
  const prods = P.filter(p => lotesSku[p.sku]).sort((a, b) => a.n - b.n || b.stock - a.stock);
  const b3 = bloque(`<h3>Mapa producto × sucursal: ${nomM} al ${corte}</h3>
    <div class="tabla-wrap densa" style="max-height:640px;overflow:auto"><table><thead><tr><th>producto</th><th>grupo</th>${sucsV.map(sc => `<th class="r">${sc.id}</th>`).join("")}</tr></thead><tbody>
    ${prods.map(p => `<tr class="clic" data-k="${p.sku}"><td>${esc(p.producto)}</td><td>${chip(p.n)}</td>${sucsV.map(sc => {
      const l = (lotesSku[p.sku] || []).find(x => x.suc === sc.id);
      if (!l) return `<td></td>`;
      const v = valM(l);
      return `<td class="r num" style="background:${colorMapa(S.mapa, v)}" title="${esc(p.producto)} en ${sc.id}: ${fmt(l.unidades)} u en stock, ${fmt(l.vendidas)} vendidas, ${l.rotacion.toLowerCase()}">${fmtM(v)}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`);
  const mixtos = prods.filter(p => { const ls = (lotesSku[p.sku] || []).filter(l => sucsV.some(sc => sc.id === l.suc)); return ls.some(l => l.vendidas > 0) && ls.some(l => l.vendidas === 0); });
  b3.insertAdjacentHTML("beforeend", interp(`Cada fila es un producto (ordenados por grupo) y cada columna una sucursal; la celda muestra ${nomM} de ese producto en ese local, y queda vacía si no está ahí. ${{ pe: "Verde: al día (90 % o más de lo esperado); rojo: atrasado.", pv: "Verde: vendió la mitad o más de lo que había; rojo: menos de la mitad.", ds: "Verde: el stock dura menos de 90 días; rojo: más, o no vendió nada el último mes." }[S.mapa] || "Sin colores: es una cantidad."} Cuanto más intenso, más lejos del corte. Tocá una fila para ver la ficha.`,
    mixtos.length ? `${mixtos.length} productos venden en un local y en otro no vendieron nada${mixtos.length > 4 ? `, por ejemplo ${mixtos.slice(0, 4).map(p => esc(p.producto)).join(", ")}` : `: ${mixtos.map(p => esc(p.producto)).join(", ")}`}.` : "Ningún producto vende en un local y nada en otro.",
    mixtos.length ? "Si el mismo producto, al mismo precio, se vende en un local y no en otro, el precio no lo explica: lo más probable es la ubicación o la exhibición. La propuesta lo trata así (grupo 6), salvo que otra causa lo explique antes (por ejemplo, un producto recién llegado o con un cambio en curso)." : ""));
  b3.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => cambiar({ tab: "productos", sku: tr.dataset.k }, true)));
  b3.querySelector("h3").after(controles([["mapa", "Mostrar en el mapa", Object.entries(MAPAS).map(([k, [t]]) => [k, t])]]));   // el selector, junto a lo que cambia
  s.append(b3);

}

// ---------------------------------------------------------------------------------------------- vista: Sucursales
function vistaSucursales(main) {
  const P = prodsFiltrados(true), skus = P.map(p => p.sku);   // la comparación muestra todas las sucursales aunque haya una elegida
  const Ltodos = D.lotes.filter(l => skus.includes(l.sku)).map(alCorte).filter(l => l.existe);   // al corte de la fecha "hasta"
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
  const cols = [{ k: "nombre", t: "sucursal", f: (v, r) => `<b>${esc(v)}</b><br><span class="muted" style="font-size:.78rem">${r.tipo}</span>` }, { k: "productos", t: "productos en stock", r: true },
    { k: "stock", t: "stock (u)", r: true, f: v => fmt(v) }, { k: "u", t: "vendidas (u)", r: true, f: v => fmt(v) }, { k: "pesos", t: "venta ($)", r: true, f: v => plata(v), csv: v => v },
    { k: "pv", t: "% vendido de su stock", r: true, f: v => pct(v), csv: v => v }, { k: "pe", t: "% de lo esperado", r: true, f: v => pct(v), csv: v => v },
    { k: "ps", t: "su parte del stock de la cadena", r: true, f: v => pct(v), csv: v => v }, { k: "pu", t: "su parte de las unidades vendidas", r: true, f: v => pct(v), csv: v => v },
    { k: "pp", t: "su parte de la venta en $", r: true, f: v => pct(v), csv: v => v }, { k: "precio", t: "precio promedio cobrado", r: true, f: v => plata(v), csv: v => v },
    { k: "sin", t: "productos sin ninguna venta", r: true }, { k: "venc", t: "stock vencido (u)", r: true, f: v => fmt(v) }];
  const porPe = [...filas].sort((a, b) => b.pe - a.pe), sobra = filas.filter(r => r.ps - (S.med === "p" ? r.pp : r.pu) >= 0.02)   // al menos 2 puntos: menos que eso es redondeo
    .sort((a, b) => (b.ps - (S.med === "p" ? b.pp : b.pu)) - (a.ps - (S.med === "p" ? a.pp : a.pu)));
  const porVenta = [...filas].sort((a, b) => (S.med === "p" ? b.pesos - a.pesos : b.u - a.u));
  const b1 = bloque(`<div class="tabla-wrap densa">${tablaHTML(cols, filas, { clic: "id" })}</div>
    ${interp(`Una fila por sucursal, al ${fechaAR(S.hasta)}. Como cada local tiene un surtido distinto, para compararlos sirven más los porcentajes: "% vendido de su stock" = vendidas ÷ (vendidas + stock); "% de lo esperado" = ritmo real ÷ objetivo, sumando sus lotes; "su parte" = cuánto aporta ese local al total de la cadena. Tocá una fila para ver su detalle.`,
      filas.length > 1 ? `Mejor ritmo: ${esc(porPe[0].nombre)} (${pct(porPe[0].pe)} de lo esperado); peor: ${esc(porPe.at(-1).nombre)} (${pct(porPe.at(-1).pe)}).` : "",
      "")}
    <div class="dos"><div><h3>Su parte del stock contra su parte de las ventas</h3><div class="graf"><canvas id="g-suc-part"></canvas></div>
      ${interp(`Para cada sucursal: gris, qué parte del stock de la cadena tiene; azul, qué parte de las ${S.med === "p" ? "ventas en pesos" : "unidades vendidas"} hace.`,
        sobra.length ? `Tienen bastante más stock que ventas (2 puntos o más): ${sobra.map(r => `${r.id} (${pct(r.ps)} del stock, ${pct(S.med === "p" ? r.pp : r.pu)} de las ventas)`).join("; ")}.` : "Ninguna sucursal tiene bastante más parte del stock que de las ventas.",
        sobra.length ? "Esas sucursales tienen stock de sobra para lo que venden: son las candidatas a mandar unidades a otras." : "")}</div>
    <div><h3>Ventas por semana de cada sucursal (${S.med === "p" ? "pesos" : "unidades"})</h3><div class="graf"><canvas id="g-suc-sem"></canvas></div>
      ${interp("Cada línea es una sucursal: lo que vendió cada semana. La última semana puede estar incompleta.",
        porVenta.length ? `La que más vende es ${esc(porVenta[0].nombre)}${porVenta.length > 1 ? `; la que menos, ${esc(porVenta.at(-1).nombre)}` : ""}.` : "",
        "")}</div></div>`);
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
  const otras = l => l.vendidas_otras;
  const filasL = L.map(l => ({ ...l, producto: CAT[l.sku].nombre, n: DEC[l.sku].n, accion: DEC[l.sku].accion, otras: otras(l) })).sort((a, b) => ROT.indexOf(a.rotacion) - ROT.indexOf(b.rotacion) || b.unidades - a.unidades);
  const noAca = filasL.filter(l => l.rotacion === "Sin ventas" && l.otras > 0);
  const b2 = bloque(`<div class="dos"><div><h3>¿Qué rotó en ${sid}?</h3><table><tbody>${ROT.map((r, i) => {
      const g = filasL.filter(l => l.rotacion === r);
      return `<tr><td><span class="${["mal", "medio", "ok"][i]}">${r}</span></td><td class="r num">${g.length} productos</td><td class="r num">${fmt(suma(g, l => l.unidades))} u</td></tr>`; }).join("")}</tbody></table>
      ${interp(`Los productos de ${sid}, según cómo vendieron en el período: sin ninguna venta, vendieron pero se frenaron (nada en los últimos 30 días) o siguen vendiendo.`,
        noAca.length ? `<b>No venden en ${sid} pero sí en otra sucursal:</b> ${noAca.map(l => `${esc(l.producto)} (${fmt(l.unidades)} u acá; ${fmt(l.otras)} vendidas en otras)`).join(", ")}.` : `Todos los que no venden en ${sid} tampoco venden en otras sucursales.`,
        noAca.length ? "Si se vende en otro local al mismo precio, acá el problema es la ubicación o la exhibición: candidatos a mover." : "")}</div>
    <div><h3>Ventas por semana y rubro en ${sid}</h3><div class="graf"><canvas id="g-suc-rubro"></canvas></div>
      ${interp(`Cada línea es un rubro: lo que vendió ${sid} cada semana.`, "", "")}</div></div>
    <div class="tabla-wrap densa">${tablaHTML([
      { k: "producto", t: "producto", cls: "t-prod" }, { k: "n", t: "grupo", f: v => chip(v) }, { k: "rotacion", t: "¿rotó?", f: v => `<span class="${v === ROT[0] ? "mal" : v === ROT[1] ? "medio" : "ok"}">${esc(v)}</span>` },
      { k: "unidades", t: "stock (u)", r: true, f: v => fmt(v) }, { k: "vendidas", t: "vendidas (u)", r: true, f: v => fmt(v) }, { k: "v30", t: "vendidas el último mes (u)", r: true, f: v => fmt(v) },
      { k: "pct_esperado", t: "% de lo esperado", r: true, f: v => pct(v) }, { k: "dias_de_stock", t: "días que le dura el stock", r: true, f: v => v == null ? "sin venta" : fmt(v) },
      { k: "otras", t: "vendidas en otras sucursales (u)", r: true, f: v => fmt(v) }, { k: "accion", t: "acción propuesta", f: v => pill(v) }], filasL, { clic: "sku" })}</div>
    ${interp(`Una fila por producto en ${sid}, primero los que no venden. "Vendidas en otras sucursales" dice si el mismo producto se vende en otro local. "Acción propuesta" es la decisión para el producto en toda la cadena. Tocá una fila para ver la ficha.`,
      `${filasL.filter(l => l.rotacion === ROT[0]).length} de ${filasL.length} productos no vendieron nada en ${sid}.`, "")}`);
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
// Los cálculos (períodos, márgenes de error, control, netos) salen de la hoja Descuentos del Excel: acá solo se filtran y se muestran.
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
  const tramos = `Antes = ${fechaAR(RD.inicio)} al ${fechaAR(masDias(RD.desde, -1))} (${RD.dias.antes} días) · durante = ${fechaAR(RD.desde)} al ${fechaAR(RD.hasta)} (${RD.dias.durante} días) · después = ${fechaAR(masDias(RD.hasta, 1))} al ${fechaAR(RD.foto)} (${RD.dias["después"]} días)`;
  const netoM = suma(N, n => Math.round(n.m_dur) + Math.round(n.m_desp));
  const adel = N.filter(n => n.extra_dur > 0 && n.extra_desp < 0), ganaron = N.filter(n => n.m_dur + n.m_desp > 0);
  const porEstado = agrupar(A, a => a.estado), cuantos = e => (porEstado[e] || []).length;
  const verif = A.length - cuantos(ESTADOS_CAJA[3]);
  const EV = D.evidencia, firmes = EV.filter(e => e.firme), debiles = EV.filter(e => !e.firme && e.debil), nada = EV.filter(e => !e.firme && !e.debil);
  const lista = xs => xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}` : xs.join("");

  // 0 · En un minuto: las preguntas en orden, cada una con su respuesta y su dato
  const s0 = seccion("Descuentos: ¿bajar el precio vende más? ¿Conviene?",
    `Lo que pasó con los ${EV.length} descuentos que sí se cobraron (del ${fechaAR(RD.desde)} al ${fechaAR(RD.hasta)}, uno por tipo de producto). Es la evidencia con la que se decide a quién descontar.${fechasActivas ? " <b>Los períodos son fijos: el filtro de fechas no cambia esta pestaña.</b>" : ""}`);
  s0.append(bloque(`<div class="respuesta"><ol>
      <li><b>¿Se cobraron?</b><p>${verif ? `Pocos: de las ${verif} sugerencias aceptadas que se pueden verificar, <b>${cuantos(ESTADOS_CAJA[0])} se cobraron en caja</b>. Solo esas se pueden medir.` : "No hay sugerencias aceptadas que se puedan verificar con estos filtros."}</p></li>
      <li><b>¿Vendieron más?</b><p>${firmes.length ? `En ${firmes.length === 1 ? "un tipo" : `${firmes.length} tipos`}, claramente: <b>${lista(firmes.map(e => `${tipoTxt(e.tipo)} ${sgn(e.respuesta - 1)}`))}</b>.` : "En ningún tipo de forma clara."}${debiles.length ? ` ${mayus(lista(debiles.map(e => `${tipoTxt(e.tipo)} ${sgn(e.respuesta - 1)}`)))}: subió, pero puede ser casualidad.` : ""}${nada.length ? ` En ${lista(nada.map(e => tipoTxt(e.tipo)))}, la diferencia el cambio entra en el margen de error.` : ""}</p></li>
      <li><b>¿Pudo ser otra cosa?</b><p>Un movimiento general de la venta, no: productos que no tuvieron ningún cambio vendieron <b>${sgn(D.control.resp - 1)}</b> esas mismas semanas. La temporada propia de cada tipo no se puede descartar, porque no hay datos de otros años: por eso cada descuento se prueba con una sucursal de comparación.</p></li>
      ${N.length ? `<li><b>¿Duró?</b><p>${adel.length ? `En ${adel.length} de ${N.length}, después la venta cayó por debajo de antes: <b>parte de lo vendido de más fue adelantar compras</b>.` : "Lo vendido de más no se perdió después."}</p></li>
      <li><b>¿Convino?</b><p>${ganaron.length === N.length ? "Sí, en todos." : `Casi nunca: sumando el mes siguiente, <b>${N.length - ganaron.length} de ${N.length} dejaron menos margen</b> que no hacer nada (${plataS(netoM)} en total).${ganaron.length ? ` Solo ganó ${ganaron.map(n => esc(n.producto)).join(", ")}.` : ""}`}</p></li>` : ""}
      <li><b>Entonces</b><p>Descuento solo en los tipos que respondieron y solo donde queda margen, siempre <b>a prueba</b>, con fechas y medido: ${D.k.ya} ahora y ${D.k.cond} si se cumple una condición. Los otros ${D.k.sin} se resuelven sin tocar el precio (pestaña Decisión).</p></li>
    </ol>
    <div class="cifras">
      <div class="cifra${cuantos(ESTADOS_CAJA[0]) < verif ? " mala" : ""}"><b>${cuantos(ESTADOS_CAJA[0])} de ${verif}</b><span>aprobados que se cobraron</span></div>
      <div class="cifra buena"><b>${firmes.length} de ${EV.length}</b><span>tipos que responden claro</span></div>
      <div class="cifra"><b>${sgn(D.control.resp - 1)}</b><span>productos sin cambios, mismas semanas</span></div>
      ${N.length ? `<div class="cifra ${netoM < 0 ? "mala" : "buena"}"><b>${plataS(netoM)}</b><span>margen contra no hacer nada</span></div>` : ""}
    </div></div>
    <p class="nota como-se-mide"><b>Cómo se mide, en simple.</b> Se compara cuánto vendía cada producto por día con descuento y sin él. <b>Margen de error:</b> como se venden pocas unidades por día, el resultado se mueve de un día a otro; por eso se repite la cuenta 2.000 veces mezclando los días y se mira entre qué valores cae 9 de cada 10 veces. Si todo ese margen queda por encima de 0 %, la suba es clara. Para no confundir un movimiento general de la venta con efecto, se mira qué hicieron en las mismas semanas productos sin ningún cambio. Lo que no se puede separar es la temporada propia de cada tipo: no hay datos de otros años.</p>`));
  main.append(s0);

  // 1 · Por tipo: la cuenta de la consigna, la que decide
  const s1 = seccion("1 · ¿Vendió más con descuento? Por tipo de producto",
    "La cuenta de la consigna: venta por día con descuento contra el resto de la ventana, a precio de lista, sumando las sucursales. Es la que decide qué tipos pueden tener descuento. No depende de los filtros.");
  const cayeron = firmes.filter(e => e.despues < 0.9);
  const colsE = [{ k: "tipo", t: "tipo", f: v => `<b>${esc(tipoTxt(v))}</b>` }, { k: "referencia", t: "medido en" }, { k: "descuento", t: "descuento", r: true, f: v => pct(v), csv: v => v },
    { k: "u_sin", t: "u/día sin descuento", r: true, f: v => fmt(v, 2), csv: v => v }, { k: "u_con", t: "u/día con descuento", r: true, f: v => fmt(v, 2), csv: v => v },
    { k: "respuesta", t: "cambio", r: true, f: (v, r) => `<span class="${r.firme ? "ok" : r.debil ? "medio" : "muted"}">${sgn(v - 1)}</span>`, csv: v => v - 1 },
    { k: "bajo", t: "margen de error", r: true, f: (v, r) => `${sgn(v - 1)} a ${sgn(r.alto - 1)}`, csv: v => v - 1 },
    { k: "despues", t: "el mes siguiente", r: true, f: v => `<span class="${v < 0.9 ? "mal" : ""}">${sgn(v - 1)}</span>`, csv: v => v - 1 },
    { k: "decision", t: "qué decidimos", cls: "t-texto" }];
  const filasE = EV.map(e => ({ ...e, decision: e.firme ? "Responde: puede tener descuento, a prueba" : e.debil ? "Débil: solo se prueba, si cumple todo" : "No responde: no se descuenta" }));
  const b1 = bloque(`${svgEvidencia()}
    ${interp(`El punto es cuánto más vendió por día con descuento; la línea, su margen de error (entre qué valores puede estar el cambio real). <span class="ok">Verde</span>: todo el margen de error está por encima de 0 %, la suba es clara. <span class="medio">Ámbar</span>: subió, pero puede ser casualidad. Gris: el cambio entra en el margen de error. La franja amarilla es lo que hicieron los productos sin cambios en esas semanas.`,
      `${firmes.length ? `<b>${mayus(lista(firmes.map(e => `${tipoTxt(e.tipo)} ${sgn(e.respuesta - 1)}`)))}</b>: suba clara.` : "Ningún tipo tiene una suba clara."} ${debiles.length ? `${mayus(lista(debiles.map(e => `${tipoTxt(e.tipo)} ${sgn(e.respuesta - 1)}`)))}: subió, pero puede ser casualidad.` : ""} ${nada.length ? `${mayus(lista(nada.map(e => tipoTxt(e.tipo))))}: el cambio entra en el margen de error (camperas, con 30 % de descuento, apenas ${sgn((EV.find(e => e.tipo === "camperas")?.respuesta ?? 1) - 1)}).` : ""} Los productos sin cambios hicieron ${sgn(D.control.resp - 1)}.`,
      "Solo los tipos en verde pueden tener descuento, y siempre a prueba. Al resto, bajarle el precio cede margen sin vender más.")}
    <div class="tabla-wrap densa" style="margin-top:14px">${tablaHTML(colsE, filasE)}</div>
    ${interp("Una fila por tipo: cuánto vendía por día sin descuento y con descuento, el cambio, su margen de error, y cómo vendió el mes siguiente contra antes (descontado el movimiento general).",
      cayeron.length ? `Aun en los que responden, el mes siguiente la venta cayó: ${lista(cayeron.map(e => `${tipoTxt(e.tipo)} ${sgn(e.despues - 1)}`))}.` : "En los que responden, la venta no cayó el mes siguiente.",
      cayeron.length ? "Parte de lo que se vende de más con descuento son compras que igual iban a ocurrir. Por eso cada prueba se mide también el mes siguiente." : "")}`);
  b1.append(verDatos("Respuesta al descuento por tipo", colsE, filasE, "evidencia_por_tipo"));
  s1.append(b1);
  main.append(s1);

  // 1b · El mismo resultado, sucursal por sucursal (solo donde el producto descontado está en más de un local)
  const ES = D.evidencia_suc || [];
  if (ES.length) {
    const sS = seccion("1b · ¿Respondió igual en cada sucursal?", "El mismo resultado, abierto por sucursal: la misma cuenta, en cada local donde estaba el producto descontado.");
    const clarasS = ES.filter(x => x.bajo > 1);
    const concentra = firmes.map(e => { const xs = ES.filter(x => x.tipo === e.tipo).sort((a, b) => b.respuesta - a.respuesta); return xs.length > 1 ? `${tipoTxt(e.tipo)} ${sgn(xs[0].respuesta - 1)} en ${xs[0].suc} contra ${sgn(xs.at(-1).respuesta - 1)} en ${xs.at(-1).suc}` : ""; }).filter(Boolean);
    const sueltas = clarasS.filter(x => !firmes.some(e => e.tipo === x.tipo));
    const colsES = [{ k: "tipo", t: "tipo", f: v => esc(tipoTxt(v)) }, { k: "producto", t: "producto descontado", cls: "t-prod" }, { k: "suc", t: "sucursal", f: v => `<b>${v}</b> <span class="muted">${esc(NOM_SUC[v] || "")}</span>`, csv: v => v },
      { k: "descuento", t: "descuento", r: true, f: v => pct(v), csv: v => v }, { k: "u_sin", t: "u/día sin descuento", r: true, f: v => fmt(v, 2), csv: v => v },
      { k: "u_con", t: "u/día con descuento", r: true, f: v => fmt(v, 2), csv: v => v },
      { k: "respuesta", t: "cambio", r: true, f: (v, r) => `<span class="${r.bajo > 1 ? "ok" : "muted"}">${sgn(v - 1)}</span>`, csv: v => v - 1 },
      { k: "bajo", t: "margen de error", r: true, f: (v, r) => `${sgn(v - 1)} a ${sgn(r.alto - 1)}`, csv: v => v - 1 }];
    const bS = bloque(`${svgPorSucursal(EV)}
      ${interp("Para cada tipo, primero el total (la misma fila del gráfico de arriba) y debajo cada sucursal donde estaba el producto descontado, con la misma cuenta: venta por día con descuento contra el resto de la ventana. Verde: suba clara en esa sucursal.",
        `Suba clara en ${clarasS.length} de ${ES.length} mediciones (un producto en un local): ${lista(clarasS.map(x => `${tipoTxt(x.tipo)} en ${x.suc} (${sgn(x.respuesta - 1)})`))}. ${concentra.length ? `En los tipos que responden, la suba se concentra en un local: ${concentra.join("; ")}.` : ""} ${sueltas.length ? `${mayus(lista(sueltas.map(x => `${tipoTxt(x.tipo)} subió claro en ${x.suc}`)))}, pero en el total del tipo el cambio entra en el margen de error.` : ""}`,
        "Con 1 a 3 unidades por día por local, la diferencia entre sucursales todavía puede ser casualidad, así que la decisión usa el total del tipo. Pero muestra por qué cada prueba se mide por sucursal y con una sucursal de comparación: el mismo descuento puede funcionar en un local y no en otro.")}`);
    bS.append(verDatos("Respuesta al descuento por sucursal", colsES, ES, "evidencia_por_sucursal"));
    sS.append(bS);
    main.append(sS);
  }

  if (!C.length) main.append(bloque(`<div class="vacio">Ninguno de los ${P.length} productos filtrados${S.suc ? ` en ${S.suc}` : ""} tuvo un descuento cobrado en caja: no hay semanas ni margen que medir. Más abajo están sus sugerencias aceptadas y si llegaron al precio cobrado.</div>`));
  if (C.length) {
    // 3 · Semana a semana
    const s3 = seccion("2 · ¿Duró, o solo adelantó compras?", "Cómo vendió cada producto semana a semana, durante el descuento y el mes siguiente.");
    const siguio = N.filter(n => n.desp_idx >= 1.1), apaga = N.filter(n => /apagando/.test(n.lec));
    const filasS = N.map(n => ({ producto: n.producto, sku: n.sku, d: n.d, base: n.base, ...Object.fromEntries(n.idx.map((v, i) => ["s" + i, v])), lectura: n.lec }));
    const colsS = [{ k: "producto", t: "producto", cls: "t-prod" }, { k: "d", t: "descuento", r: true, f: v => pct(v), csv: v => v }, { k: "base", t: "u/día antes", r: true, f: v => fmt(v, 2), csv: v => v },
      ...RD.semanas.map((t, i) => ({ k: "s" + i, t: semCorta(t), r: true, f: v => `<span class="idx" style="background:${tinteIdx(v)}">${fmt(v, 2)}</span>`, csv: v => v })),
      { k: "lectura", t: "lectura", cls: "t-texto" }];
    const b3 = bloque(`<div class="graf alto"><canvas id="g-semanas"></canvas></div>
      ${interp(`Cada línea es un producto, semana a semana. 1,00 = vende igual que antes del descuento; 1,50 = 50 % más; 0,70 = 30 % menos. Las primeras 4 semanas son con descuento; las siguientes, sin. Ya está descontado el movimiento general; la línea punteada es ese movimiento${S.suc ? `. Suma todas las sucursales del producto, no solo ${S.suc}` : ""}.`,
        `${adel.length ? `En <b>${adel.length} de ${N.length}</b>, después del descuento la venta cayó por debajo de antes (${lista(adel.map(n => esc(n.producto)))}).` : "Ninguno cayó por debajo de antes después del descuento."} ${siguio.length ? `Siguieron más altos ${lista(siguio.map(n => esc(n.producto)))}.` : ""}`,
        adel.length ? "Lo vendido de más con descuento se devuelve en parte después: eran compras que igual iban a ocurrir, solo que antes." : "")}
      <div class="tabla-wrap densa" style="margin-top:14px">${tablaHTML(colsS, filasS, { clic: "sku" })}</div>
      ${interp("Una fila por producto con el número de cada semana. Verde: 15 % o más arriba de antes; rojo: 15 % o más abajo. Tocá una fila para ver la ficha.",
        apaga.length ? `En ${apaga.length} de ${N.length} el efecto se fue apagando dentro del mismo mes del descuento.` : "",
        apaga.length ? "Un descuento largo no rinde más: por eso las pruebas duran 4 semanas y se cortan si no funcionan." : "")}`);
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
    const s4 = seccion("3 · ¿Convino? Lo que dejó cada descuento", "Margen y unidades contra no haber hecho nada, sumando el mes del descuento y el siguiente.");
    // Redondeado por producto antes de sumar, así durante + después = neto en cada fila y en el total
    const filasN = N.map(n => { const ed = Math.round(n.extra_dur), ea = Math.round(n.extra_desp), md = Math.round(n.m_dur), ma = Math.round(n.m_desp);
      return { producto: n.producto, sku: n.sku, d: n.d, extra_dur: ed, extra_desp: ea, neto_u: ed + ea,
        devuelto: n.extra_dur > 0 && n.extra_desp < 0 ? -n.extra_desp / n.extra_dur : null, m_dur: md, m_desp: ma, neto_m: md + ma }; });
    const colsN = [{ k: "producto", t: "producto", cls: "t-prod" }, { k: "d", t: "descuento", r: true, f: v => pct(v), csv: v => v },
      { k: "extra_dur", t: "u extra durante", r: true, sum: true, f: signoU, csv: v => v }, { k: "extra_desp", t: "u extra después", r: true, sum: true, f: signoU, csv: v => v },
      { k: "neto_u", t: "u extra netas", r: true, sum: true, f: v => `<span class="${v > 0 ? "ok" : "mal"}">${signoU(v)}</span>`, csv: v => v },
      { k: "devuelto", t: "lo perdido después ÷ lo ganado durante", r: true, f: v => v == null ? "—" : pct(v), csv: v => v },
      { k: "m_dur", t: "margen durante", r: true, sum: true, f: v => plataS(v), csv: v => v }, { k: "m_desp", t: "margen después", r: true, sum: true, f: v => plataS(v), csv: v => v },
      { k: "neto_m", t: "margen neto", r: true, sum: true, f: v => `<span class="${v > 0 ? "ok" : "mal"}">${plataS(v)}</span>`, csv: v => v }];
    const altoN = Math.max(220, 30 * N.length + 70);
    const peor = [...filasN].sort((a, b) => a.neto_m - b.neto_m)[0], devolvieron = filasN.filter(r => r.devuelto != null && r.devuelto >= 1);
    const uDur = suma(filasN, r => r.extra_dur), uDesp = suma(filasN, r => r.extra_desp);
    const b4 = bloque(`<div class="dos"><div><h3>Margen contra seguir igual</h3><div class="graf" style="height:${altoN}px"><canvas id="g-netos"></canvas></div>
        ${interp(`Cada barra compara contra seguir vendiendo como antes. Hacia la derecha, ganó margen; hacia la izquierda, perdió. Azul: el mes del descuento; ámbar: el mes siguiente. Suma todas las sucursales del producto${S.suc ? `, no solo ${S.suc}` : ""}.`,
          `<b>${ganaron.length ? `${N.length - ganaron.length} de ${N.length} perdieron margen` : `Los ${N.length} perdieron margen`}</b>: ${plataS(netoM)} en total. ${ganaron.length ? `Solo ganó ${lista(ganaron.map(n => esc(n.producto)))}.` : ""} El que más perdió: ${esc(peor.producto)} (${plataS(peor.neto_m)}).`,
          "Vender más no alcanza: cada unidad con descuento deja menos margen, y hay que vender muchas más para compensar.")}</div>
      <div><h3>Unidades de más y de menos</h3><div class="graf" style="height:${altoN}px"><canvas id="g-netos-u"></canvas></div>
        ${interp("Las mismas barras, en unidades: cuántas se vendieron de más (o de menos) contra seguir como antes.",
          `Durante el descuento se vendieron ${fmt(Math.abs(uDur))} unidades ${uDur >= 0 ? "de más" : "de menos"}; el mes siguiente, ${fmt(Math.abs(uDesp))} ${uDesp >= 0 ? "de más" : "de menos"}. En total, ${fmt(Math.abs(uDur + uDesp))} ${uDur + uDesp >= 0 ? "de más" : "de menos"} que sin descuento.`,
          "El descuento sí mueve unidades, pero se paga caro: las unidades extra no compensan lo que se deja de cobrar en todas las demás.")}</div></div>`);
    b4.append(tablaAuditable(colsN, filasN, "descuentos_netos", { alto: 420, clic: sku => cambiar({ tab: "productos", sku }, true), claveClic: "sku" }));
    b4.insertAdjacentHTML("beforeend", interp(`Una fila por producto. "Lo perdido después ÷ lo ganado durante" dice qué parte de las unidades vendidas de más se dejaron de vender el mes siguiente: 100 % o más quiere decir que, sumando los dos meses, no vendió más que sin descuento.`,
      devolvieron.length ? `En ${lista(devolvieron.map(r => `${esc(r.producto)} (${pct(r.devuelto)})`))}, el mes siguiente se perdió todo lo ganado o más.` : "Ningún producto perdió después todo lo que ganó durante.",
      "Por eso el efecto se mide también el mes siguiente: mirar solo las 4 semanas del descuento lo hace parecer mejor de lo que fue."));
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

  }

  // 6 · Aceptadas contra aplicadas en caja
  const s6 = seccion("4 · Lo aprobado, ¿llegó a caja?", "Cada sugerencia aceptada, contra el precio que de verdad se cobró.");
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
  if (A.length) b6.insertAdjacentHTML("beforeend", interp(`Cada fila es una sugerencia aceptada${S.suc ? ` (en ${S.suc})` : ""}. Con fechas de vigencia se mira esa vigencia; sin fechas, las 4 semanas siguientes. "Llegó a caja" = se cobró al menos la mitad del descuento aceptado. Las ventas empiezan el ${fechaAR(F_MIN)}: lo anterior no se puede verificar.`,
    verif ? (() => { const llego = A.filter(a => a.estado === ESTADOS_CAJA[0]), sinF = A.filter(a => a.con_fechas === "no" && a.estado !== ESTADOS_CAJA[3]);
      return `De las ${verif} que se pueden verificar, <b>${cuantos(ESTADOS_CAJA[0])} se cobraron</b>, ${cuantos(ESTADOS_CAJA[1])} no se ven en el precio cobrado${cuantos(ESTADOS_CAJA[2]) ? ` y ${cuantos(ESTADOS_CAJA[2])} no tuvo ventas en esas fechas` : ""}. De las que se cobraron, ${llego.filter(a => a.con_fechas === "sí").length} de ${llego.length} tenían fechas de vigencia; de las ${sinF.length} sin fechas, se cobraron ${sinF.filter(a => a.estado === ESTADOS_CAJA[0]).length}.`; })() : "Ninguna se puede verificar con las ventas que tenemos.",
    "Aprobar un descuento no alcanza: si no tiene fechas, no llega al precio y no se puede medir. Por eso la propuesta pide cobrar lo aprobado, con fechas, antes de aprobar otra cosa."));
  s6.append(b6);
  main.append(s6);


  if (C.length) {
    // 2 · Caso por caso
    const s2 = seccion("Para auditar: cada producto en cada sucursal",
      `Lo mismo, separado por local (${C.length} casos), para quien quiera revisar el detalle.`);
    const firmesC = C.filter(c => c.lo > 0), mixtos = [...new Set(C.map(c => c.sku))].filter(s => C.some(c => c.sku === s && c.lo > 0) && C.some(c => c.sku === s && c.lo <= 0));
    const colsC = [{ k: "producto", t: "producto", cls: "t-prod", f: (v, r) => `<b>${esc(v)}</b><br><span class="sku">${r.sku}</span>`, csv: v => v }, { k: "sid", t: "sucursal" },
      { k: "d", t: "descuento", r: true, f: v => pct(v), csv: v => v },
      { k: "u_antes", t: "u/día antes", r: true, f: v => fmt(v, 2), csv: v => v }, { k: "u_durante", t: "u/día durante", r: true, f: v => fmt(v, 2), csv: v => v },
      { k: "u_después", t: "u/día después", r: true, f: v => fmt(v, 2), csv: v => v },
      { k: "dur", t: "durante vs antes", r: true, f: (v, r) => `<span class="${r.lo > 0 ? "ok" : "muted"}">${sgn(v)}</span>`, csv: v => v },
      { k: "lo", t: "margen de error", r: true, f: (v, r) => `${sgn(v)} a ${sgn(r.hi)}`, csv: v => v },
      { k: "desp", t: "después vs antes", r: true, f: v => `<span class="${v < -0.15 ? "mal" : v > 0.15 ? "ok" : ""}">${sgn(v)}</span>`, csv: v => v },
      { k: "m_antes", t: "margen/día antes", r: true, f: v => plata(v), csv: v => v }, { k: "m_durante", t: "margen/día durante", r: true, f: v => plata(v), csv: v => v },
      { k: "mdur", t: "margen durante vs antes", r: true, f: v => `<span class="${v >= 0 ? "ok" : "mal"}">${sgn(v)}</span>`, csv: v => v },
      { k: "lectura", t: "lectura", cls: "t-texto" }];
    const b2 = bloque(`<div class="graf" data-casos="${C.length}" style="height:${Math.max(200, 28 * (C.length + 1) + 70)}px"><canvas id="g-casos"></canvas></div>
      ${interp(`Cada fila es un producto en un local. El punto es cuánto cambió la venta por día durante el descuento contra <b>antes</b> (no contra toda la ventana, por eso los números no son iguales a los del punto 1); la barra, su margen de error. Verde: no toca el 0 %. ${tramos}.`,
        `${firmesC.length} de ${C.length} casos suben de forma clara. ${mixtos.length ? `El mismo producto reaccionó distinto según el local en ${mixtos.length} de ${new Set(C.map(c => c.sku)).size}.` : ""}`,
        "Con 1 a 3 unidades por día en cada local, casi ninguna diferencia sale del margen de error. Por eso la decisión usa el total de cada producto (punto 1) y no cada local por separado.")}
      <div class="tabla-wrap densa" style="margin-top:14px">${tablaHTML(colsC, C, { clic: "sku" })}</div>
      ${interp("Los mismos casos con todas las cuentas: unidades y margen por día antes, durante y después, y la lectura de cada uno. Tocá una fila para ver la ficha.",
        `El margen por día subió en ${C.filter(c => c.mdur >= 0).length} de ${C.length} casos.`,
        "Aun donde se vendió más, en la mayoría de los casos se ganó menos por día: el descuento se come el margen de todas las unidades, no solo de las extra.")}`);
    aFicha(b2);
    s2.append(b2);
    main.append(s2);
    grafico($("#g-casos", b2), {
      data: { labels: [...C.map(c => `${corto(c.producto, 16)} · ${c.sid}`), "Control (sin cambios)"], datasets: [
        { type: "bar", label: "margen de error", data: [...C.map(c => [c.lo * 100, c.hi * 100]), null], barPercentage: .5, borderWidth: 1, order: 2,
          backgroundColor: C.map(c => c.lo > 0 ? tok("--good-soft") : tok("--line-2")), borderColor: C.map(c => c.lo > 0 ? tok("--good") : tok("--muted")) },
        { type: "line", label: "durante vs antes", data: [...C.map(c => c.dur * 100), RD.ctrl_dur * 100], showLine: false, pointRadius: 5, pointHoverRadius: 6, order: 1,
          pointBackgroundColor: [...C.map(c => c.lo > 0 ? tok("--good") : tok("--ink-2")), tok("--warn")], pointBorderColor: tok("--panel"), borderColor: tok("--ink-2"), backgroundColor: tok("--ink-2") }] },
      options: { indexAxis: "y", maintainAspectRatio: false,
        scales: { x: { ticks: { callback: v => (v > 0 ? "+" : "") + v + "%" }, grid: { color: c => c.tick.value === 0 ? tok("--ink-2") : tok("--line") } }, y: { grid: { display: false } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => Array.isArray(c.raw) ? `margen de error: ${sgn(c.raw[0] / 100)} a ${sgn(c.raw[1] / 100)}` : `durante vs antes: ${sgn(c.raw / 100)}` } } } }
    });
    b2.append(verDatos("Cada producto con descuento, en cada sucursal (hoja Descuentos, bloque 1)", [...colsC.slice(0, 8), { k: "hi", t: "margen de error (hasta)", r: true, f: v => sgn(v), csv: v => v }, ...colsC.slice(8)], C, "descuentos_casos"));

    // 5 · Control
    const s5 = seccion("Para auditar: el control (productos sin ningún cambio)",
      "Productos que venden bien y no tuvieron descuentos, campañas ni cambios de precio: la vara para saber si la venta se movió en general esas semanas. No dependen de los filtros.");
    const colsK = [{ k: "producto", t: "producto", cls: "t-prod", f: (v, r) => r.sucursal ? esc(v) : `<b>${esc(v)}</b>` }, { k: "sucursal", t: "sucursal" },
      { k: "u_antes", t: "u/día antes", r: true, f: v => fmt(v, 2) }, { k: "u_durante", t: "u/día durante", r: true, f: v => fmt(v, 2) }, { k: "u_despues", t: "u/día después", r: true, f: v => fmt(v, 2) },
      { k: "dur", t: "durante vs antes", r: true, f: v => sgn(v) }, { k: "desp", t: "después vs antes", r: true, f: v => sgn(v) }];
    s5.append(bloque(`<div class="tabla-wrap densa">${tablaHTML(colsK, RD.control)}</div>
      ${interp("Cada fila es uno de estos productos en un local, con la venta por día antes, durante y después de las fechas de los descuentos. La última fila es el total.",
        `En total hicieron ${sgn(RD.ctrl_dur)} contra antes (${sgn(D.control.resp - 1)} contra el resto de la ventana, el número del punto 1): no subieron.`,
        "La suba de los descontados no vino de un movimiento general de la venta. Lo que no se puede descartar es la temporada propia de cada tipo: son solo 2 productos (una zapatilla y una bota) y no hay datos de otros años. Por eso cada prueba lleva una sucursal de comparación.")}`));
    main.append(s5);
  }

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
const irAFoto = fecha => { location.href = location.pathname + (fecha && fecha !== ULTIMA ? `?datos=${fecha}` : "") + location.hash; };
function cabeceraFoto() {
  const fotos = BASE.fotos || [];
  const cual = BASE.online && fotos.length > 1
    ? `<label class="campo-foto" for="f-foto">Datos al <select id="f-foto">${fotos.map(f => `<option value="${f.fecha}"${f.fecha === D.foto_iso ? " selected" : ""}>${fechaAR(f.fecha)}${f.fecha === ULTIMA ? " · la más nueva" : ""}</option>`).join("")}</select></label>`
    : `<span>Datos al <b>${D.foto}</b></span>`;
  $("#foto").innerHTML = `${cual}<span>ventas del ${fechaAR(F_MIN)} al ${fechaAR(F_MAX)}</span>${BASE.online ? `<button class="btn prim" type="button" id="b-subir">Subir Excel</button>` : ""}`;
  $("#f-foto")?.addEventListener("change", e => irAFoto(e.target.value));
  $("#b-subir")?.addEventListener("click", abrirSubir);
}
function avisoFoto() {
  if (BASE.motivo) return `<div class="aviso-foto" role="status">${esc(BASE.motivo)}</div>`;
  if (BASE.online && ULTIMA && D.foto_iso !== ULTIMA)
    return `<div class="aviso-foto" role="status">Estás viendo los datos al ${D.foto}. Los más nuevos de la base son al ${fechaAR(ULTIMA)}. <button class="btn-link" type="button" data-ir="${ULTIMA}">Ver la más nueva</button></div>`;
  return "";
}
function abrirSubir() {
  const dlg = $("#subir");
  dlg.innerHTML = `<form method="dialog" class="subir-in">
    <h2 id="subir-tit">Subir un Excel a la base</h2>
    <p>Corre el mismo proceso que armó este tablero: propuesta, indicadores y seguimiento contra los Excel anteriores.</p>
    <ul class="subir-lista">
      <li>Tiene que tener las hojas de la consigna (<code>productos</code>, <code>stock_sucursal</code>, <code>ventas</code>…). La fecha de los datos es el último día con ventas.</li>
      <li><b>Actualiza la base para todos.</b> Si son los datos más nuevos, el tablero pasa a mostrarlos; si ya había un Excel con esa fecha, lo reemplaza.</li>
      <li>Tarda entre 15 y 40 segundos. Es una demo: lo que subas queda público.</li>
    </ul>
    <p class="nota">El Excel original de cada fecha cargada se puede descargar: ${(BASE.fotos || []).filter(f => f.original).map(f => `<a href="${esc(f.original)}" download>${fechaAR(f.fecha)}</a>`).join(" · ")}.</p>
    <label class="campo">Archivo .xlsx<input type="file" id="s-archivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
    <div class="subir-estado" id="s-estado" role="status" aria-live="polite"></div>
    <div class="subir-botones"><button class="btn" value="cerrar" id="s-cerrar">Cerrar</button><button class="btn prim" type="button" id="s-enviar">Subir y procesar</button></div>
  </form>`;
  const estado = $("#s-estado", dlg), enviar = $("#s-enviar", dlg);
  let cargada = null;                                     // después de subir, el mismo botón lleva a esos datos
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
      estado.innerHTML = `<p class="ok">Listo: la base tiene los datos al ${fechaAR(j.fecha)} (${j.fotos} Excel en total).</p>
        <p>${j.anterior ? `El seguimiento mide ${j.decisiones_seguidas} recomendaciones desde los Excel anteriores.` : "Es el Excel más viejo de la base: no tiene seguimiento propio."}
        ${j.es_la_mas_nueva ? "Es la más nueva: el tablero pasa a mostrarla." : `No es la más nueva, así que el tablero sigue mostrando la del ${fechaAR(ULTIMA)}; se recalculó el seguimiento de ${j.recalculadas.map(fechaAR).join(", ")}.`}</p>`;
      cargada = j;
      enviar.textContent = `Ver los datos al ${fechaAR(j.fecha)}`;
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
    <span>Excel cargados (datos al): ${(D.historia || []).map(h => fechaAR(h.fecha)).join(", ") || D.foto}.${D.archivo_excel ? ` <a href="${esc(D.archivo_excel)}" download>Descargar el Excel completo</a>.` : ""}</span>`;
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
