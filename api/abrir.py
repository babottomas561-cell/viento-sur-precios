"""GET /api/abrir?fecha=<AAAA-MM-DD> · lleva al paquete de esa foto en la base; sin fecha, a la más nueva."""
import urllib.parse
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parent.parent)]

from _base import responder

import servidor


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        fecha = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("fecha", [""])[0]
        todas = servidor.fotos()
        elegida = next((f for f in todas if f["fecha"] == fecha), None) if fecha else (todas[0] if todas else None)
        if not elegida:
            return responder(self, 404, {"error": "Esa foto no está en la base." if fecha else "La base está vacía."})
        self.send_response(302)
        self.send_header("location", elegida["url"])
        self.send_header("cache-control", "no-store")
        self.end_headers()
