"""Cliente mínimo del almacenamiento de Vercel (Vercel Blob), sin dependencias: subir, listar y leer archivos.

Necesita la variable BLOB_READ_WRITE_TOKEN (en Vercel viene sola; en la computadora, de .env.local).
Los archivos son públicos: cualquiera con el link los puede leer.
"""
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://blob.vercel-storage.com"
VERSION_API = "13"


def _token():
    t = os.environ.get("BLOB_READ_WRITE_TOKEN")
    if not t:
        env = Path(__file__).resolve().parent / ".env.local"
        if env.exists():
            for linea in env.read_text().splitlines():
                if linea.startswith("BLOB_READ_WRITE_TOKEN="):
                    t = linea.split("=", 1)[1].strip().strip('"')
    if not t:
        raise RuntimeError("Falta BLOB_READ_WRITE_TOKEN: el almacenamiento no está configurado.")
    return t


def _pedir(url, metodo="GET", cuerpo=None, encabezados=None):
    req = urllib.request.Request(url, data=cuerpo, method=metodo,
                                 headers={"authorization": f"Bearer {_token()}", "x-api-version": VERSION_API, **(encabezados or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def url_publica(ruta):
    """El link público de un archivo (el id del almacenamiento va dentro del token)."""
    tienda = _token().split("_")[3].lower()
    return f"https://{tienda}.public.blob.vercel-storage.com/{ruta}"


def subir(ruta, contenido, tipo, pisar=False):
    """Sube un archivo con esa ruta exacta. Sin pisar=True, falla si ya existe (así nadie reemplaza lo de otro)."""
    r = _pedir(f"{API}/?{urllib.parse.urlencode({'pathname': ruta})}", "PUT", contenido,
               {"x-vercel-blob-access": "public", "x-add-random-suffix": "0", "x-allow-overwrite": "1" if pisar else "0",
                "x-content-type": tipo, "x-cache-control-max-age": "60"})
    return r["url"]


def listar(prefijo):
    """Todos los archivos bajo un prefijo: [{pathname, url, size, uploadedAt}]."""
    out, cursor = [], None
    while True:
        q = {"prefix": prefijo, "limit": "1000", **({"cursor": cursor} if cursor else {})}
        r = _pedir(f"{API}/?{urllib.parse.urlencode(q)}")
        out += r.get("blobs", [])
        if not r.get("hasMore"):
            return out
        cursor = r["cursor"]


def borrar(urls):
    """Borra archivos por su link."""
    _pedir(f"{API}/delete", "POST", json.dumps({"urls": list(urls)}).encode(), {"content-type": "application/json"})


def leer_url(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def leer_json(ruta):
    return leer_url(url_publica(ruta))
