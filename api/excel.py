"""GET /api/excel?fecha=<AAAA-MM-DD>&tipo=original|analisis · descarga el Excel guardado en la base."""
import urllib.parse
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parent.parent)]

from _base import responder

import servidor

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        fecha, tipo = q.get("fecha", [""])[0], q.get("tipo", ["analisis"])[0]
        if not servidor.FECHA.match(fecha) or tipo not in ("original", "analisis"):
            return responder(self, 400, {"error": "Pedí ?fecha=AAAA-MM-DD&tipo=original o analisis."})
        contenido = servidor.excel(fecha, tipo)
        if not contenido:
            return responder(self, 404, {"error": "No hay ese Excel en la base."})
        nombre = f"viento_sur_{'original' if tipo == 'original' else 'analisis'}_{fecha}.xlsx"
        self.send_response(200)
        self.send_header("content-type", XLSX)
        self.send_header("content-disposition", f'attachment; filename="{nombre}"')
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(contenido)
