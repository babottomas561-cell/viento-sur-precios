// Auditoría completa del tablero. Para cada combinación de filtros de esperado.json (que esperado.py calcula directo del
// Excel original) recorre todas las pestañas y compara cada cifra con lo esperado. También anota errores de JavaScript.
// Uso, con el tablero abierto en el navegador:
//   (await import('/salidas/auditoria/auditar_filtros.js')).default()          → lee /salidas/auditoria/esperado.json
//   (await import('<url>/auditar_filtros.js')).default(esperado)                → con el JSON pasado a mano (por ejemplo, en el sitio publicado)
export default async function auditar(E) {
  E = E || await fetch("/salidas/auditoria/esperado.json?" + Date.now()).then(r => r.json());
  const errores = [];
  const oir = e => errores.push(e.message);
  window.addEventListener("error", oir);
  const espera = (ms = 140) => new Promise(r => setTimeout(r, ms));
  const num = s => s == null ? null : +String(s).replace(/[^\d,−-]/g, "").replace(/\./g, "").replace(",", ".").replace("−", "-");
  const ir = async (f, extra) => { location.hash = new URLSearchParams({ ...f, ...extra }).toString(); await espera(); };
  const vista = () => document.querySelector("#vista");
  const cifras = () => [...vista().querySelectorAll(".cifra")].map(c => [c.querySelector("b").textContent, c.querySelector("span").textContent]);
  const cuentas = () => [...vista().querySelectorAll(".cuenta")].map(c => num(c.textContent.split(" de ")[1]));
  const pctN = s => Math.round(num(s));                       // "27 %" → 27
  const lineas = [];
  let fallas = 0, chequeos = 0;
  for (const [nombre, e] of Object.entries(E)) {
    const f = e.filtros, mal = [], err0 = errores.length;
    const chk = (que, vio, esp) => { chequeos++; if (vio !== esp) mal.push(`${que}: muestra ${vio}, debería ${esp}`); };
    const fechas = "desde" in f || "hasta" in f;

    // Decisión
    await ir(f, { tab: "decision" });
    chk("Decisión · productos filtrados", num(document.querySelector(".activos").textContent.split("·").at(-1).split(" de ")[0]), e.productos);
    if (e.productos) chk("Decisión · aviso de que las fechas no cambian la propuesta", !!vista().querySelector(".aviso-foto:not([data-foto])") && fechas, fechas);

    // Ventas
    await ir(f, { tab: "ventas" });
    let c = cifras();
    chk("Ventas · unidades", num(c[0]?.[0]), e.ventas.u);
    chk("Ventas · pesos", num(c[1]?.[0]), e.ventas.pesos);
    chk("Ventas · unidades por día", num(c[3]?.[0]), e.ventas.u_dia);
    chk("Ventas · productos con venta", num(c[4]?.[0]), e.ventas.productos_con_venta);
    chk("Ventas · % con descuento", pctN(c[5]?.[0]), Math.round(e.ventas.pct_descuento * 100));

    // Stock y rotación (al corte de la fecha "hasta"), y el gráfico de stock por cada apertura
    await ir(f, { tab: "stock" });
    c = cifras();
    chk("Stock · stock al corte", num(c[0]?.[0]), e.stock.stock);
    chk("Stock · a costo", num(c[0]?.[1].split("·")[1]), e.stock.costo);
    chk("Stock · % vendido", pctN(c[1]?.[0]), Math.round(e.stock.pct_vendido * 100));
    chk("Stock · % vencido", pctN(c[2]?.[0]), Math.round(e.stock.pct_vencido * 100));
    chk("Stock · % de lo esperado", pctN(c[3]?.[0]), Math.round(e.stock.pct_esperado * 100));
    chk("Stock · lotes sin ventas", num(c[4]?.[0]), e.stock.sin_ventas);
    chk("Stock · lotes", num(c[4]?.[1].split("(de ")[1]), e.stock.lotes);
    chk("Stock · lotes frenados", num(c[5]?.[0]), e.stock.frenados);
    if (e.stock.lotes) for (const por of ["suc", "rubro", "grupo", "tipo", "total"]) {
      await ir(f, { tab: "stock", por });
      const ch = window.Chart?.getChart?.(document.querySelector("#g-stock-t"));
      chk(`Stock · gráfico por ${por}: último día = stock`, ch ? ch.data.datasets.reduce((a, d) => a + (d.data.at(-1) || 0), 0) : null, e.stock.stock);
    }

    // Sucursales (la comparación muestra todas, aunque haya una elegida)
    await ir(f, { tab: "sucursales" });
    const filasSuc = Object.fromEntries([...vista().querySelectorAll(".tabla-wrap tr.clic")].filter(tr => /^[SF]\d\d$/.test(tr.dataset.k))
      .map(tr => [tr.dataset.k, [...tr.children].map(td => td.textContent)]));
    chk("Sucursales · cuáles aparecen", Object.keys(filasSuc).sort().join(","), Object.keys(e.sucursales).sort().join(","));
    for (const [s, x] of Object.entries(e.sucursales)) {
      if (!filasSuc[s]) continue;
      chk(`Sucursales · ${s} stock`, num(filasSuc[s][2]), x.stock);
      chk(`Sucursales · ${s} unidades`, num(filasSuc[s][3]), x.u);
      chk(`Sucursales · ${s} pesos`, num(filasSuc[s][4]), x.pesos);
    }

    // Descuentos
    await ir(f, { tab: "descuentos" });
    if (e.descuentos.casos) {
      chk("Descuentos · casos", num(vista().querySelector("[data-casos]")?.dataset.casos), e.descuentos.casos);
      chk("Descuentos · productos en 'lo que dejó cada descuento'", cuentas()[0], e.descuentos.productos);
    } else chk("Descuentos · sin casos", !!vista().querySelector(".vacio"), true);
    chk("Descuentos · sugerencias aceptadas", e.descuentos.aceptadas ? cuentas().at(-1) : vista().textContent.includes("no tiene sugerencias aceptadas") || vista().textContent.includes("Ningún producto filtrado tiene sugerencias aceptadas") ? 0 : -1, e.descuentos.aceptadas);

    // Productos y Seguimiento
    if (!f.sku) {
      await ir(f, { tab: "productos" });
      chk("Productos · cantidad", num(vista().querySelector("h2 span")?.textContent), e.productos);
    } else if (e.productos) {
      await ir(f, { tab: "productos" });
      chk("Productos · abre la ficha", !!vista().querySelector(".pasos, .decision"), true);
    }
    await ir(f, { tab: "seguimiento" });
    if ((window.DATOS.seguimiento || []).length && e.productos) chk("Seguimiento · recomendaciones seguidas", cuentas()[0], e.productos);

    // Datos: cada tabla
    for (const [tabla, esp] of Object.entries(e.datos)) {
      await ir(f, { tab: "datos", tabla });
      chk(`Datos · ${tabla} (filas)`, cuentas()[0], esp);
    }
    if (errores.length > err0) mal.push(...errores.slice(err0).map(m => "error de JavaScript: " + m));
    fallas += mal.length;
    lineas.push(`${mal.length ? "✗" : "✓"} ${nombre}${mal.length ? "\n    " + mal.join("\n    ") : ""}`);
  }
  window.removeEventListener("error", oir);
  location.hash = "";
  return `${Object.keys(E).length} combinaciones · ${chequeos} chequeos · ${fallas ? fallas + " diferencias" : "sin diferencias"}\n` + lineas.join("\n");
}
