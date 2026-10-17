// Auditoría de los gráficos de Ventas: compara cada punto de cada serie, la participación y el ranking con esperado_ventas.json
// (que esperado_ventas.py calcula directo del Excel original). Uso, con el tablero abierto:
//   (await import('/salidas/auditoria/auditar_ventas.js')).default()
//   (await import('/auditoria/auditar_ventas.js')).default(await (await fetch('/auditoria/esperado_ventas.json')).json())   // en el sitio
export default async function auditar(E) {
  E = E || await fetch("/salidas/auditoria/esperado_ventas.json?" + Date.now()).then(r => r.json());
  const espera = (ms = 120) => new Promise(r => setTimeout(r, ms));
  const graf = id => window.Chart?.getChart?.(document.querySelector(id));
  const cerca = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  let puntos = 0, graficos = 0;
  const mal = [];
  for (const [nombre, e] of Object.entries(E)) {
    const f = e.filtros;
    for (const gran of ["dia", "sem", "mes"]) for (const por of ["suc", "rubro", "tipo", "grupo", "producto", "total"]) for (const med of ["u", "p"]) {
      location.hash = new URLSearchParams({ ...f, tab: "ventas", gran, por, med }).toString();
      await espera();
      const esp = e[`${gran}|${por}|${med}`], ch = graf("#g-serie");
      graficos++;
      if (!esp.periodos) continue;
      if (!ch) { mal.push(`${nombre} · ${gran}/${por}/${med}: no hay gráfico`); continue; }
      if (ch.data.labels.length !== esp.periodos) mal.push(`${nombre} · ${gran}/${por}/${med}: ${ch.data.labels.length} períodos, deberían ser ${esp.periodos}`);
      const vistas = Object.fromEntries(ch.data.datasets.map(d => [d.label, d.data]));
      const a = Object.keys(vistas).sort().join(" | "), b = Object.keys(esp.serie).sort().join(" | ");
      if (a !== b && !esp.empate_en_el_corte) mal.push(`${nombre} · ${gran}/${por}/${med}: series ${a} ≠ ${b}`);
      for (const [lab, arr] of Object.entries(esp.serie)) {
        if (!vistas[lab]) continue;
        arr.forEach((v, i) => { puntos++; if (!cerca(vistas[lab][i], v)) mal.push(`${nombre} · ${gran}/${por}/${med} · ${lab} · período ${i + 1}: muestra ${vistas[lab][i]}, debería ${v}`); });
      }
      if (gran === "sem") {                                   // participación y ranking no dependen de la granularidad
        const part = graf("#g-part"), ep = e[`part|${por}|${med}`];
        if (part) part.data.labels.forEach((lab, i) => {
          puntos += 2;
          if (!ep[lab]) mal.push(`${nombre} · participación ${por}/${med}: sobra ${lab}`);
          else if (!cerca(part.data.datasets[0].data[i], ep[lab][0]) || !cerca(part.data.datasets[1].data[i], ep[lab][1])) mal.push(`${nombre} · participación ${por}/${med} · ${lab}: no coincide`);
        });
        const rk = graf("#g-rank"), er = e[`rank|${med}`];
        if (rk && por === "suc") rk.data.labels.forEach((lab, i) => { puntos++; if (!(lab in er) || !cerca(rk.data.datasets[0].data[i], er[lab])) mal.push(`${nombre} · ranking ${med} · ${lab}: muestra ${rk.data.datasets[0].data[i]}, debería ${er[lab]}`); });
      }
    }
  }
  location.hash = "";
  return `${graficos} gráficos · ${puntos} puntos · ${mal.length ? mal.length + " diferencias" : "sin diferencias"}` + (mal.length ? "\n  " + mal.slice(0, 30).join("\n  ") : "");
}
