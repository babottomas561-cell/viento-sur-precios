"""Lo común a las funciones del servidor: encontrar los módulos del proyecto y responder JSON."""
import json
from pathlib import Path



def responder(h, codigo, datos, extra=None):
    cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
    h.send_response(codigo)
    h.send_header("content-type", "application/json; charset=utf-8")
    h.send_header("cache-control", "no-store")
    for k, v in (extra or {}).items():
        h.send_header(k, v)
    h.end_headers()
    h.wfile.write(cuerpo)
