// Auditoría de filtros del tablero. Compara lo que muestra cada pestaña con esperado.json,
// que esperado.py calcula directo del Excel original. Uso, con el tablero abierto en el navegador:
//   (await import('/salidas/auditoria/auditar_filtros.js')).default()
export default async function auditar() {
  const E = await fetch("/salidas/auditoria/esperado.json?" + Date.now()).then(r => r.json());
  const errores = [];
  const oir = e => errores.push(e.message);
  window.addEventListener("error", oir);
  const espera = () => new Promise(r => setTimeout(r, 120));
  const num = s => s == null ? null : +String(s).replace(/[^\d,−-]/g, "").replace(/\./g, "").replace(",", ".").replace("−", "-");
  const ir = async (f, extra) => { location.hash = new URLSearchParams({ ...f, ...extra }).toString(); await espera(); };
  const cifras = () => [...document.querySelectorAll("#vista .cifra")].map(c => [c.querySelector("b").textContent, c.querySelector("span").textContent]);
  const lineas = [];
  let fallas = 0;
  for (const [nombre, e] of Object.entries(E)) {
    const f = e.filtros, mal = [], err0 = errores.length;
    const chk = (que, vio, esp) => { if (vio !== esp) mal.push(`${que}: muestra ${vio}, debería ${esp}`); };
    for (const tab of ["decision", "ventas", "stock", "sucursales", "descuentos", "productos", "seguimiento"]) {
      await ir(f, { tab });
      if (!document.querySelector("#vista").children.length) mal.push(`${tab}: la vista quedó vacía`);
      if (tab === "decision") chk("productos filtrados", num(document.querySelector(".activos").textContent.split("·").at(-1).split(" de ")[0]), e.productos);
      if (tab === "ventas") { const c = cifras(); chk("unidades vendidas", num(c[0]?.[0]), e.ventas_u); chk("venta en pesos", num(c[1]?.[0]), e.ventas_p); chk("productos con venta", num(c[4]?.[0]), e.productos_con_venta); }
      if (tab === "stock") { const c = cifras(); chk("stock", num(c[0]?.[0]), e.stock); chk("lotes", num(c[4]?.[1].split("(de ")[1]), e.lotes); }
      if (tab === "productos" && !f.sku) chk("productos en la pestaña", num(document.querySelector("#vista h2 span")?.textContent), e.productos);
      if (tab === "productos" && f.sku && e.productos) chk("abre la ficha", !!document.querySelector("#vista .pasos, #vista .decision"), true);
    }
    for (const tabla of ["lotes", "ventas"]) {
      await ir(f, { tab: "datos", tabla });
      chk(`Datos › ${tabla} (filas)`, num(document.querySelector(".cuenta")?.textContent.split(" de ")[1]), tabla === "lotes" ? e.lotes : e.filas_ventas);
    }
    if (errores.length > err0) mal.push(...errores.slice(err0).map(m => "error de JavaScript: " + m));
    fallas += mal.length;
    lineas.push(`${mal.length ? "✗" : "✓"} ${nombre}  (${e.productos} productos, ${e.lotes} lotes, ${e.ventas_u} u, $ ${e.ventas_p})${mal.length ? "\n    " + mal.join("\n    ") : ""}`);
  }
  window.removeEventListener("error", oir);
  location.hash = "";
  return `${Object.keys(E).length} combinaciones × 9 vistas · ${fallas ? fallas + " diferencias" : "sin diferencias"}\n` + lineas.join("\n");
}
