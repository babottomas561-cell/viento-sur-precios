"""GET /api/fotos · las fotos de la base, de la más nueva a la más vieja: [{fecha, subida}]."""
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parent.parent)]

from _base import responder

import servidor


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            lista = servidor.fotos()
        except Exception as e:
            return responder(self, 503, {"error": f"No se pudo leer el almacenamiento: {e}"})
        return responder(self, 200, {"fotos": lista})
