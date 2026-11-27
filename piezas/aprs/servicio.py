#!/usr/bin/env python3
"""
aprs_service.py - Monitor, baliza y mensajes APRS-IS para el dashboard de pcbox.
Puerto 5014. Configuracion en aprs_config.json (se crea sola la primera vez).

  GET  /api/aprs/status      estado de la conexion, baliza y mensajes sin leer
  GET  /api/aprs/stations    estaciones escuchadas (dentro del radio configurado)
  GET  /api/aprs/messages    ultimos mensajes enviados y recibidos
  POST /api/aprs/send        {"to": "CALL-SSID", "text": "..."}
  POST /api/aprs/beacon      {"enabled": true, "interval_min": 30, "send_now": true}
  POST /api/aprs/messages/read
"""
import json
import math
import os
import re
import socket
import sqlite3
import threading
import time
import unicodedata

from flask import Flask, jsonify, request

try:
    import aprslib  # opcional: mejora la lectura de posiciones (Mic-E, etc.)
except ImportError:
    aprslib = None

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.environ.get("APRS_CONFIG", os.path.join(BASE_DIR, "aprs_config.json"))
CORE_CFG = os.path.join(os.path.dirname(CONFIG_PATH), "config.json")   # ubicación de la estación (núcleo)
DB_PATH = os.environ.get("APRS_DB", os.path.join(BASE_DIR, "aprs.db"))
PORT = int(os.environ.get("APRS_PORT", "5014"))
VERSION = "1.0"
TOCALL = "APZPCB"                      # APZ = experimental
MAX_ESTACIONES = 500
ESTACION_TTL = 6 * 3600                # segundos
REINTENTOS = [30, 60, 120, 240, 480]   # espera entre reintentos de un mensaje sin ACK
MIN_BALIZA_MIN = 10

DEFAULTS = {
    "callsign": "@@CALL@@",
    "ssid": "10",
    "passcode": "",                    # vacio = se calcula desde el indicativo
    "server": "rotate.aprs2.net",
    "port": 14580,
    "lat": 0.0,
    "lon": 0.0,
    "radius_km": 100,
    "beacon_enabled": False,
    "beacon_interval_min": 30,
    "beacon_comment": "pcbox dashboard @@CALL@@",
    "symbol_table": "/",
    "symbol": "-",
    "ambiguity": 0,
    "station_ttl_h": 6,
    "ui_refresh_s": 15,
}

app = Flask(__name__)


@app.after_request
def add_cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


_lock = threading.Lock()
_sock_lock = threading.Lock()
_sock = None
CFG = dict(DEFAULTS)
ESTACIONES = {}
ST = {"conectado": False, "verificado": False, "error": None, "servidor": None,
      "paquetes": 0, "ultimo_paquete": None, "ultima_baliza": 0.0, "desde": None, "nodo": None}


# ---------------- configuracion ----------------
def cargar_config():
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_PATH) as f:
            cfg.update(json.load(f))
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"aprs_config.json ilegible, uso valores por defecto: {e}", flush=True)
    nuc = _ubicacion_nucleo()
    if nuc:
        cfg["lat"], cfg["lon"] = nuc
    with _lock:
        CFG.clear()
        CFG.update(cfg)
    if not os.path.exists(CONFIG_PATH):
        guardar_config()


def guardar_config():
    with _lock:
        datos = dict(CFG)
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(datos, f, indent=2)
    os.replace(tmp, CONFIG_PATH)


def _ubicacion_nucleo():
    # La ubicación de la estación vive en config.json (núcleo); aprs_config.json solo la refleja
    try:
        with open(CORE_CFG, encoding="utf-8") as f:
            n = json.load(f)
        la, lo = float(n["lat"]), float(n["lon"])
        return (la, lo) if (la or lo) else None
    except Exception:
        return None


def _guardar_ubicacion_nucleo(lat, lon):
    try:
        with open(CORE_CFG, encoding="utf-8") as f:
            n = json.load(f)
    except Exception:
        return          # sin config.json del núcleo (instalación antigua): no se crea
    n["lat"], n["lon"] = lat, lon
    tmp = CORE_CFG + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(n, f, indent=2, ensure_ascii=False)
    os.replace(tmp, CORE_CFG)


def mi_call():
    ssid = str(CFG.get("ssid", "")).strip()
    base = CFG["callsign"].upper()
    return base if ssid in ("", "0") else f"{base}-{ssid}"


def calcular_passcode(call):
    call = call.split("-")[0].upper()
    h = 0x73E2
    for i in range(0, len(call), 2):
        h ^= ord(call[i]) << 8
        if i + 1 < len(call):
            h ^= ord(call[i + 1])
    return h & 0x7FFF


# ---------------- utilidades de posicion ----------------
def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def _mascara(s, posiciones, amb):
    s = list(s)
    if amb > 0:
        for i in posiciones[-amb:]:
            s[i] = " "
    return "".join(s)


def fmt_lat(lat, amb=0):
    cent = round(abs(lat) * 6000)
    d, mm = divmod(cent, 6000)
    s = f"{d:02d}{mm // 100:02d}.{mm % 100:02d}"
    return _mascara(s, [0, 1, 2, 3, 5, 6], amb) + ("N" if lat >= 0 else "S")


def fmt_lon(lon, amb=0):
    cent = round(abs(lon) * 6000)
    d, mm = divmod(cent, 6000)
    s = f"{d:03d}{mm // 100:02d}.{mm % 100:02d}"
    return _mascara(s, [0, 1, 2, 3, 4, 6, 7], amb) + ("E" if lon >= 0 else "W")


POS_RE = re.compile(r"^(\d{2})([\d ]{2}\.[\d ]{2})([NS])(.)(\d{3})([\d ]{2}\.[\d ]{2})([EW])(.)(.*)$", re.S)


def _num(s):
    return float(s.replace(" ", "0"))


def _b91(s):
    v = 0
    for c in s:
        v = v * 91 + (ord(c) - 33)
    return v


def parse_posicion(payload):
    """(lat, lon, simbolo, comentario) o None. Soporta posicion normal y comprimida."""
    if not payload:
        return None
    t = payload[0]
    if t in "!=":
        body = payload[1:]
    elif t in "/@":
        body = payload[8:]
    else:
        return None
    m = POS_RE.match(body)
    if m:
        lat = int(m.group(1)) + _num(m.group(2)) / 60
        lon = int(m.group(5)) + _num(m.group(6)) / 60
        if m.group(3) == "S":
            lat = -lat
        if m.group(7) == "W":
            lon = -lon
        return lat, lon, m.group(4) + m.group(8), m.group(9)
    if len(body) >= 13 and body[0] in "/\\ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij":
        try:
            lat = 90 - _b91(body[1:5]) / 380926.0
            lon = -180 + _b91(body[5:9]) / 190463.0
            return lat, lon, body[0] + body[9], body[13:]
        except Exception:
            return None
    return None


def parse_con_aprslib(raw):
    if aprslib is None:
        return None
    try:
        d = aprslib.parse(raw)
        if d.get("latitude") is not None and d.get("longitude") is not None:
            return (d["latitude"], d["longitude"],
                    (d.get("symbol_table") or "/") + (d.get("symbol") or "?"),
                    d.get("comment") or "")
    except Exception:
        pass
    return None


# ---------------- base de datos de mensajes ----------------
def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    con = db()
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("""CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, dir TEXT NOT NULL,
        peer TEXT NOT NULL, text TEXT NOT NULL, msgid TEXT, estado TEXT NOT NULL,
        intentos INTEGER NOT NULL DEFAULT 0, prox REAL NOT NULL DEFAULT 0,
        leido INTEGER NOT NULL DEFAULT 0)""")
    con.execute("CREATE INDEX IF NOT EXISTS idx_msg_ts ON messages(ts)")
    if "origen" not in [r[1] for r in con.execute("PRAGMA table_info(messages)")]:
        con.execute("ALTER TABLE messages ADD COLUMN origen TEXT NOT NULL DEFAULT ''")
    con.commit()
    con.close()


# ---------------- envio de paquetes ----------------
def enviar_paquete(txt):
    global _sock
    with _sock_lock:
        if _sock is None or not ST["verificado"]:
            return False
        try:
            _sock.sendall((txt + "\r\n").encode("ascii", "replace"))
            return True
        except Exception as e:
            ST["error"] = f"error enviando: {e}"
            try:
                _sock.close()
            except Exception:
                pass
            return False


def a_ascii(texto):
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    t = re.sub(r"[\r\n\t]+", " ", t)
    return re.sub(r"[{|~]", " ", t).strip()


def paquete_baliza():
    c = CFG
    amb = max(0, min(4, int(c.get("ambiguity", 0))))
    comentario = a_ascii(str(c.get("beacon_comment", "")))[:43]
    return (f"{mi_call()}>{TOCALL},TCPIP*:={fmt_lat(c['lat'], amb)}{c['symbol_table']}"
            f"{fmt_lon(c['lon'], amb)}{c['symbol']}{comentario}")


def enviar_baliza():
    if enviar_paquete(paquete_baliza()):
        ST["ultima_baliza"] = time.time()
        return True
    return False


def paquete_mensaje(destino, texto, msgid=None):
    pkt = f"{mi_call()}>{TOCALL},TCPIP*::{destino.ljust(9)[:9]}:{texto}"
    return pkt + (f"{{{msgid}" if msgid else "")


# ---------------- procesamiento de paquetes recibidos ----------------
def registrar_estacion(src, pos):
    lat, lon, simbolo, comentario = pos
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return
    dist = haversine_km(CFG["lat"], CFG["lon"], lat, lon)
    ahora = time.time()
    with _lock:
        e = ESTACIONES.get(src)
        n = (e["paquetes"] + 1) if e else 1
        ESTACIONES[src] = {"call": src, "lat": round(lat, 5), "lon": round(lon, 5),
                           "dist_km": round(dist, 1), "simbolo": simbolo,
                           "comentario": comentario.strip()[:80], "ts": ahora, "paquetes": n}
        if len(ESTACIONES) > MAX_ESTACIONES:
            for k, _ in sorted(ESTACIONES.items(), key=lambda kv: kv[1]["ts"])[:50]:
                ESTACIONES.pop(k, None)


def guardar_mensaje(direccion, peer, texto, msgid, estado, leido, origen=""):
    con = db()
    try:
        cur = con.execute(
            "INSERT INTO messages(ts,dir,peer,text,msgid,estado,leido,origen) VALUES(?,?,?,?,?,?,?,?)",
            (time.time(), direccion, peer, texto, msgid, estado, leido, origen))
        con.execute("DELETE FROM messages WHERE id < (SELECT MAX(id) FROM messages) - 2000")
        con.commit()
        return cur.lastrowid
    finally:
        con.close()


# Otras piezas se registran aqui: se llama fn(src, texto, mid) en un hilo por cada mensaje recibido para este indicativo.
AL_RECIBIR = []


def procesar_mensaje(src, payload):
    if len(payload) < 11 or payload[10] != ":":
        return
    destino = payload[1:10].strip().upper()
    if destino != mi_call().upper():
        return
    texto = payload[11:]
    bajo = texto.lower()
    if bajo.startswith("ack") or bajo.startswith("rej"):
        msgid = texto[3:].split("}")[0].strip()
        con = db()
        try:
            nuevo = "entregado" if bajo.startswith("ack") else "fallido"
            con.execute("UPDATE messages SET estado=? WHERE dir='out' AND peer=? AND msgid=? AND estado='pendiente'",
                        (nuevo, src, msgid))
            con.commit()
        finally:
            con.close()
        return
    msgid = None
    if "{" in texto:
        texto, msgid = texto.rsplit("{", 1)
        msgid = msgid.split("}")[0].strip()[:5] or None
    if msgid:
        enviar_paquete(paquete_mensaje(src, f"ack{msgid}"))
        con = db()
        try:
            dup = con.execute("SELECT 1 FROM messages WHERE dir='in' AND peer=? AND msgid=? AND ts>?",
                              (src, msgid, time.time() - 3600)).fetchone()
        finally:
            con.close()
        if dup:
            print("bot: ignorado %s: mensaje repetido (mismo numero {%s} en la ultima hora)" % (src, msgid), flush=True)
            return
    mid = guardar_mensaje("in", src, texto.strip(), msgid, "recibido", 0)
    for fn in list(AL_RECIBIR):          # otras piezas (ej. el bot de concursos) reciben cada mensaje
        threading.Thread(target=fn, args=(src, texto.strip(), mid), daemon=True).start()


def procesar(linea):
    linea = linea.rstrip("\r\n")
    if not linea:
        return
    if linea.startswith("#"):
        if "logresp" in linea:
            ST["verificado"] = (" verified" in linea) and ("unverified" not in linea)
            _m = re.search(r"server\s+([A-Za-z0-9_.\-]+)", linea)
            if _m:
                ST["nodo"] = _m.group(1)
        return
    ST["paquetes"] += 1
    ST["ultimo_paquete"] = time.time()
    if ":" not in linea:
        return
    cab, payload = linea.split(":", 1)
    if not payload:
        return
    src = cab.split(">", 1)[0].strip().upper()
    if payload[0] == ":":
        procesar_mensaje(src, payload)
        return
    if src == mi_call().upper():
        return
    pos = parse_posicion(payload) or parse_con_aprslib(linea)
    if pos:
        registrar_estacion(src, pos)


# ---------------- hilos ----------------
def conectar_loop():
    global _sock
    espera = 5
    while True:
        s = None
        try:
            s = socket.create_connection((CFG["server"], int(CFG["port"])), timeout=15)
            s.settimeout(90)
            f = s.makefile("rb")
            f.readline()  # banner del servidor
            call = mi_call()
            pc = str(CFG.get("passcode") or "").strip() or str(calcular_passcode(call))
            filtro = f"r/{CFG['lat']:.4f}/{CFG['lon']:.4f}/{int(CFG['radius_km'])} g/{CFG['callsign'].upper()}*"
            s.sendall(f"user {call} pass {pc} vers pcbox-dashboard {VERSION} filter {filtro}\r\n".encode())
            with _sock_lock:
                _sock = s
            ST.update(conectado=True, verificado=False, nodo=None, error=None, desde=time.time(),
                      servidor=f"{CFG['server']}:{CFG['port']}")
            espera = 5
            for raw in f:
                try:
                    procesar(raw.decode("utf-8", "replace"))
                except Exception as e:
                    print(f"error procesando paquete: {e}", flush=True)
        except Exception as e:
            ST["error"] = str(e)
        finally:
            with _sock_lock:
                _sock = None
            ST.update(conectado=False, verificado=False, nodo=None)
            if s is not None:
                try:
                    s.close()
                except Exception:
                    pass
        time.sleep(espera)
        espera = min(espera * 2, 120)


def reintentos_loop():
    while True:
        time.sleep(5)
        try:
            if not ST["verificado"]:
                continue
            con = db()
            try:
                filas = con.execute(
                    "SELECT * FROM messages WHERE dir='out' AND estado='pendiente' AND prox<=?",
                    (time.time(),)).fetchall()
                for m in filas:
                    if m["intentos"] > len(REINTENTOS):
                        con.execute("UPDATE messages SET estado='fallido' WHERE id=?", (m["id"],))
                        continue
                    if enviar_paquete(paquete_mensaje(m["peer"], m["text"], m["msgid"])):
                        k = m["intentos"] + 1
                        prox = time.time() + REINTENTOS[min(k - 1, len(REINTENTOS) - 1)]
                        con.execute("UPDATE messages SET intentos=?, prox=? WHERE id=?", (k, prox, m["id"]))
                con.commit()
            finally:
                con.close()
        except Exception as e:
            print(f"error en reintentos: {e}", flush=True)


def baliza_loop():
    while True:
        time.sleep(10)
        try:
            if CFG.get("beacon_enabled") and ST["verificado"]:
                intervalo = max(MIN_BALIZA_MIN, int(CFG.get("beacon_interval_min", 30))) * 60
                if time.time() - ST["ultima_baliza"] >= intervalo:
                    enviar_baliza()
        except Exception as e:
            print(f"error en baliza: {e}", flush=True)


# ---------------- API ----------------
@app.route("/api/aprs/status")
def api_status():
    con = db()
    try:
        sin_leer = con.execute("SELECT COUNT(*) FROM messages WHERE dir='in' AND leido=0").fetchone()[0]
    finally:
        con.close()
    with _lock:
        n_est = len(ESTACIONES)
    return jsonify({
        "indicativo": mi_call(), "conectado": ST["conectado"], "verificado": ST["verificado"],
        "servidor": ST["servidor"], "nodo": ST.get("nodo"), "error": ST["error"], "paquetes": ST["paquetes"],
        "ultimo_paquete": ST["ultimo_paquete"], "estaciones": n_est, "radio_km": CFG["radius_km"],
        "sin_leer": sin_leer,
        "baliza": {"activa": bool(CFG.get("beacon_enabled")),
                   "intervalo_min": max(MIN_BALIZA_MIN, int(CFG.get("beacon_interval_min", 30))),
                   "ultima": ST["ultima_baliza"] or None},
    })


@app.route("/api/aprs/stations")
def api_stations():
    try:
        limite = min(200, max(1, int(request.args.get("limit", "50"))))
    except ValueError:
        limite = 50
    ahora = time.time()
    with _lock:
        for k in [k for k, e in ESTACIONES.items() if ahora - e["ts"] > int(CFG.get("station_ttl_h", 6)) * 3600]:
            ESTACIONES.pop(k, None)
        radio = CFG["radius_km"]
        lista = [e for e in ESTACIONES.values() if e["dist_km"] <= radio]
        q = re.sub(r"[^A-Z0-9/\-]", "", request.args.get("q", "").upper())
        if q:
            lista = [e for e in lista if q in e["call"]]
        lista = sorted(lista, key=lambda e: -e["ts"])[:limite]
        out = [dict(e, hace_s=int(ahora - e["ts"])) for e in lista]
    return jsonify(out)


@app.route("/api/aprs/messages")
def api_messages():
    con = db()
    try:
        filas = con.execute(
            "SELECT id, ts, dir, peer, text, estado, intentos, origen FROM messages ORDER BY id DESC LIMIT 100").fetchall()
    finally:
        con.close()
    return jsonify([dict(r) for r in reversed(filas)])


@app.route("/api/aprs/messages/read", methods=["POST"])
def api_read():
    con = db()
    try:
        con.execute("UPDATE messages SET leido=1 WHERE dir='in' AND leido=0")
        con.commit()
    finally:
        con.close()
    return jsonify({"ok": True})


@app.route("/api/aprs/messages/delete", methods=["POST"])
def api_messages_delete():
    body = request.get_json(silent=True) or {}
    con = db()
    try:
        if body.get("all"):
            n = con.execute("DELETE FROM messages").rowcount
        else:
            n = 0
            for x in (body.get("ids") or [])[:200]:
                try:
                    n += con.execute("DELETE FROM messages WHERE id=?", (int(x),)).rowcount
                except (TypeError, ValueError):
                    pass
        con.commit()
    finally:
        con.close()
    return jsonify({"ok": True, "borrados": n})


@app.route("/api/aprs/send", methods=["POST"])
def api_send():
    body = request.get_json(silent=True) or {}
    destino = str(body.get("to", "")).strip().upper()
    texto = a_ascii(str(body.get("text", "")))[:67]
    if not re.fullmatch(r"[A-Z0-9]{1,6}(-\d{1,2})?", destino):
        return jsonify({"error": "indicativo destino invalido"}), 400
    if destino == mi_call().upper():
        return jsonify({"error": "no puedes enviarte mensajes a ti mismo"}), 400
    if not texto:
        return jsonify({"error": "mensaje vacio"}), 400
    if not ST["verificado"]:
        return jsonify({"error": "sin conexion verificada a APRS-IS"}), 503
    con = db()
    try:
        n = con.execute("SELECT COALESCE(MAX(CAST(msgid AS INTEGER)),0)+1 FROM messages WHERE dir='out'").fetchone()[0]
    finally:
        con.close()
    msgid = str(n if n < 100000 else 1)
    guardar_mensaje("out", destino, texto, msgid, "pendiente", 1)
    # el primer envio lo hace el hilo de reintentos en <5 s; lo adelantamos aqui
    if enviar_paquete(paquete_mensaje(destino, texto, msgid)):
        con = db()
        try:
            con.execute("UPDATE messages SET intentos=1, prox=? WHERE dir='out' AND msgid=? AND peer=? AND intentos=0",
                        (time.time() + REINTENTOS[0], msgid, destino))
            con.commit()
        finally:
            con.close()
    return jsonify({"ok": True, "msgid": msgid})


@app.route("/api/aprs/radius", methods=["POST"])
def api_radius():
    body = request.get_json(silent=True) or {}
    try:
        km = int(body.get("radius_km"))
    except (TypeError, ValueError):
        return jsonify({"error": "radio invalido"}), 400
    if not 5 <= km <= 500:
        return jsonify({"error": "el radio debe estar entre 5 y 500 km"}), 400
    with _lock:
        CFG["radius_km"] = km
    guardar_config()
    filtro = f"r/{CFG['lat']:.4f}/{CFG['lon']:.4f}/{km} g/{CFG['callsign'].upper()}*"
    enviar_paquete("#filter " + filtro)   # cambia el filtro en la conexion activa (si no hay, aplica al reconectar)
    return jsonify({"ok": True, "radio_km": km})


@app.route("/api/aprs/config", methods=["GET"])
def api_config_get():
    with _lock:
        c = dict(CFG)
    c["passcode_set"] = bool(str(c.pop("passcode", "") or "").strip())
    c["indicativo_completo"] = mi_call()
    return jsonify(c)


def _validar_config(b):
    """Devuelve (cambios_validos, error)."""
    out = {}
    if "callsign" in b:
        v = str(b["callsign"]).strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{3,9}", v):
            return None, "indicativo invalido (3 a 9 letras/numeros, sin SSID)"
        out["callsign"] = v
    if "ssid" in b:
        v = str(b["ssid"]).strip()
        if v not in [""] + [str(i) for i in range(16)]:
            return None, "SSID debe estar entre 0 y 15"
        out["ssid"] = v
    if "passcode" in b and b["passcode"] is not None:
        v = str(b["passcode"]).strip()
        if v and not (v.isdigit() and len(v) <= 5):
            return None, "passcode invalido (solo numeros)"
        out["passcode"] = v
    if "server" in b:
        v = str(b["server"]).strip()
        if not re.fullmatch(r"[A-Za-z0-9]([A-Za-z0-9.\-]{0,251}[A-Za-z0-9])?", v):
            return None, "servidor invalido"
        out["server"] = v
    try:
        if "port" in b:
            v = int(b["port"])
            if not 1 <= v <= 65535:
                return None, "puerto invalido"
            out["port"] = v
        if "lat" in b:
            v = float(b["lat"])
            if not -90 <= v <= 90:
                return None, "latitud fuera de rango"
            out["lat"] = v
        if "lon" in b:
            v = float(b["lon"])
            if not -180 <= v <= 180:
                return None, "longitud fuera de rango"
            out["lon"] = v
        if "radius_km" in b:
            v = int(b["radius_km"])
            if not 5 <= v <= 500:
                return None, "el radio debe estar entre 5 y 500 km"
            out["radius_km"] = v
        if "beacon_interval_min" in b:
            out["beacon_interval_min"] = max(MIN_BALIZA_MIN, min(1440, int(b["beacon_interval_min"])))
        if "ambiguity" in b:
            v = int(b["ambiguity"])
            if not 0 <= v <= 4:
                return None, "ambiguedad entre 0 y 4"
            out["ambiguity"] = v
        if "station_ttl_h" in b:
            v = int(b["station_ttl_h"])
            if not 1 <= v <= 48:
                return None, "horas de memoria de estaciones: 1 a 48"
            out["station_ttl_h"] = v
        if "ui_refresh_s" in b:
            v = int(b["ui_refresh_s"])
            if not 5 <= v <= 300:
                return None, "actualizacion del panel: 5 a 300 s"
            out["ui_refresh_s"] = v
    except (TypeError, ValueError):
        return None, "hay un valor numerico invalido"
    if "beacon_enabled" in b:
        out["beacon_enabled"] = bool(b["beacon_enabled"])
    if "beacon_comment" in b:
        out["beacon_comment"] = a_ascii(str(b["beacon_comment"]))[:43]
    if "symbol_table" in b:
        v = str(b["symbol_table"])
        if v not in ("/", "\\"):
            return None, "tabla de simbolos: / o \\"
        out["symbol_table"] = v
    if "symbol" in b:
        v = str(b["symbol"])
        if not (len(v) == 1 and 33 <= ord(v) <= 126):
            return None, "simbolo invalido (1 caracter ASCII)"
        out["symbol"] = v
    return out, None


@app.route("/api/aprs/config", methods=["POST"])
def api_config_post():
    body = request.get_json(silent=True) or {}
    cambios, err = _validar_config(body)
    if err:
        return jsonify({"error": err}), 400
    claves_conexion = ("callsign", "ssid", "passcode", "server", "port", "lat", "lon")
    with _lock:
        reconectar = any(k in cambios and cambios[k] != CFG.get(k) for k in claves_conexion)
        radio_nuevo = "radius_km" in cambios and cambios["radius_km"] != CFG.get("radius_km")
        CFG.update(cambios)
    guardar_config()
    if "lat" in cambios or "lon" in cambios:
        _guardar_ubicacion_nucleo(CFG["lat"], CFG["lon"])
    if reconectar:
        with _sock_lock:
            if _sock is not None:
                try:
                    _sock.close()      # conectar_loop reconecta solo con la configuracion nueva
                except Exception:
                    pass
    elif radio_nuevo:
        enviar_paquete(f"#filter r/{CFG['lat']:.4f}/{CFG['lon']:.4f}/{int(CFG['radius_km'])} g/{CFG['callsign'].upper()}*")
    return jsonify({"ok": True, "reconectando": reconectar, "indicativo_completo": mi_call()})


@app.route("/api/aprs/beacon", methods=["POST"])
def api_beacon():
    body = request.get_json(silent=True) or {}
    with _lock:
        if "enabled" in body:
            CFG["beacon_enabled"] = bool(body["enabled"])
        if "interval_min" in body:
            try:
                CFG["beacon_interval_min"] = max(MIN_BALIZA_MIN, min(1440, int(body["interval_min"])))
            except (TypeError, ValueError):
                return jsonify({"error": "intervalo invalido"}), 400
    guardar_config()
    enviado = None
    if body.get("send_now"):
        enviado = enviar_baliza()
        if not enviado:
            return jsonify({"error": "sin conexion verificada a APRS-IS"}), 503
    return jsonify({"ok": True, "enviado": enviado, "paquete": paquete_baliza() if enviado else None})
# BOTMAIL-FIN
# BOTSTATS-FIN


if __name__ == "__main__":
    init_db()
    cargar_config()
    for fn in (conectar_loop, reintentos_loop, baliza_loop):
        threading.Thread(target=fn, daemon=True).start()
    app.run(host="0.0.0.0", port=PORT)
