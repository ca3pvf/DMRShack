#!/usr/bin/env python3
"""
botc - Bot de concursos APRS (pieza de DMRShack).

Se registra en la pieza APRS (aprs_service.AL_RECIBIR) para recibir cada mensaje, responde por APRS, registra a los
participantes, manda la QSL por correo y ofrece la agenda de actividades, las estadisticas y el registro.
Rutas: /api/aprs/bot, /requisitos, /resumen, /agenda, /agenda/img, /img/<nombre>, /reset, /stats, /registro, /contacto.
Los datos siguen donde estaban: aprs.db (tabla bot_part), aprs_bot.json, aprs_agenda.json y la carpeta bot_img.
"""
import json
import os
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime

from flask import Flask, jsonify, request

import aprs_service as _aprs
from aprs_service import (
    a_ascii,
    CFG,
    db,
    enviar_paquete,
    guardar_mensaje,
    mi_call,
    paquete_mensaje,
    REINTENTOS,
    ST,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = Flask("pcbox_botc")

BOT_PATH = os.environ.get("APRS_BOT", os.path.join(BASE_DIR, "aprs_bot.json"))


# ---------------- bot de concurso (palabra clave -> QSL a la cola) ----------------
BOT_DEFAULTS = {
    "enabled": False,
    "nombre": "Concurso APRS",
    "palabras": [],
    "inicio": "",                      # "AAAA-MM-DDTHH:MM", hora de pcbox; vacio = sin limite
    "fin": "",
    "resp_ok": "Recibido {call}! QSL en camino a tu correo. Gracias, 73 de {op}",
    "resp_ok_manual": "Recibido {call}! Anotado, te enviare la QSL. 73 de {op}",
    "resp_dup": "{call} ya estabas registrado en el concurso. 73 de {op}",
    "resp_mal": "PALABRA INCORRECTA, LA CLAVE ES: {clave}",
    "resp_fuera": "CONCURSO NO DISPONIBLE",
    "resp_pregunta": "Recibido {call}! QSL por mail? Responde MAIL tu@correo.com",
    "resp_mail_ok": "Gracias {call}! QSL enviada a {mail}. 73 de {op}",
    "resp_no": "Ok {call}. Confirmo QSL por APRS el {fecha}. 73 de {op}",
    "max_por_dia": 200,
    "auto": False,                     # generar y enviar la QSL por correo sin intervencion
    "q_freq": "", "q_band": "", "q_mode": "APRS", "q_rst_s": "59", "q_rst_r": "59",
    "q_comments": "Gracias por participar, 73!",
}
_bot_lock = threading.Lock()
_bot_resp = []                         # marcas de tiempo de respuestas, para limitar a 60 por hora
RE_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
BOT_AGENDA = os.environ.get("APRS_AGENDA", os.path.join(BASE_DIR, "aprs_agenda.json"))
BOT_IMG = os.path.join(BASE_DIR, "bot_img")
RE_IMG = re.compile(r"^[a-z0-9_-]{4,40}\.jpg$")
RE_ACT_ID = re.compile(r"^[a-z0-9]{4,12}$")
CAMPOS_ACT = ("nombre", "palabras", "inicio", "fin", "q_freq", "q_band", "q_mode", "q_rst_s", "q_rst_r", "q_comments")


def agenda_leer():
    try:
        with open(BOT_AGENDA) as f:
            lst = json.load(f).get("actividades", [])
        return [a for a in lst if isinstance(a, dict) and a.get("id") and a.get("inicio") and a.get("fin")]
    except Exception:
        return []


def agenda_escribir(lst):
    tmp = BOT_AGENDA + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"actividades": lst}, f, indent=2, ensure_ascii=False)
    os.replace(tmp, BOT_AGENDA)


def _norm(t):
    t = unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode("ascii").lower()
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", t).split())


def bot_cfg():
    c = dict(BOT_DEFAULTS)
    try:
        with open(BOT_PATH) as f:
            c.update(json.load(f))
    except Exception:
        pass
    ag = agenda_leer()
    if ag:      # con agenda: los datos del concurso salen de la actividad vigente (o de la proxima / ultima si hay hueco)
        ahora = datetime.now().strftime("%Y-%m-%dT%H:%M")
        vig = next((a for a in ag if a["inicio"] <= ahora < a["fin"]), None)
        hueco = vig is None
        if hueco:
            fut = [a for a in ag if a["inicio"] > ahora]
            vig = min(fut, key=lambda a: a["inicio"]) if fut else max(ag, key=lambda a: a["fin"])
        for k in CAMPOS_ACT:
            if k in vig and (vig[k] != "" or k in ("q_comments", "q_freq", "q_band")):
                c[k] = vig[k]
        c["img"] = vig.get("img", "")
        c["_act"] = vig["id"]
        c["_hueco"] = hueco
    return c


def bot_guardar(c):
    tmp = BOT_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(c, f, indent=2, ensure_ascii=False)
    os.replace(tmp, BOT_PATH)


def bot_id(c):
    if c.get("_act"):
        return "act:" + str(c["_act"])
    return _norm(c.get("nombre", "")) + "|" + str(c.get("inicio", ""))


def bot_en_ventana(c, ahora=None):
    ahora = ahora or datetime.now()
    if c.get("_hueco"):
        return False
    try:
        if c.get("inicio") and ahora < datetime.strptime(c["inicio"], "%Y-%m-%dT%H:%M"):
            return False
        if c.get("fin") and ahora > datetime.strptime(c["fin"], "%Y-%m-%dT%H:%M"):
            return False
    except ValueError:
        return False
    return True


def _http_json(url, cuerpo=None, timeout=8):
    data = None if cuerpo is None else json.dumps(cuerpo).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def enviar_mensaje(destino, texto):
    """Mensaje APRS saliente con ACK y reintentos (igual que /api/aprs/send)."""
    texto = a_ascii(texto)[:67]
    if not texto or not ST["verificado"]:
        return False
    con = db()
    try:
        n = con.execute("SELECT COALESCE(MAX(CAST(msgid AS INTEGER)),0)+1 FROM messages WHERE dir='out'").fetchone()[0]
    finally:
        con.close()
    msgid = str(n if n < 100000 else 1)
    guardar_mensaje("out", destino, texto, msgid, "pendiente", 1, "bot")
    if enviar_paquete(paquete_mensaje(destino, texto, msgid)):
        con = db()
        try:
            con.execute("UPDATE messages SET intentos=1, prox=? WHERE dir='out' AND msgid=? AND peer=? AND intentos=0",
                        (time.time() + REINTENTOS[0], msgid, destino))
            con.commit()
        finally:
            con.close()
    return True


def _qtxt(b, k, n):
    return re.sub(r"[\x00-\x1f<>]", "", str(b.get(k, "") or "")).strip()[:n]


def bot_marcar(base, cid, estado):
    con = db()
    try:
        con.execute("UPDATE bot_part SET qsl=? WHERE concurso=? AND call=?", (estado[:100], cid, base))
        _bot_evento(con, cid, base, "estado", estado)
        con.commit()
    finally:
        con.close()


def _err_http(e):
    try:
        return json.loads(e.read().decode("utf-8", "replace")).get("error") or str(e)
    except Exception:
        return str(e)


RE_CORREO = re.compile(r"[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+")
RE_CORREO_OK = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")


def _ocultar(mail):
    u, _, d = mail.partition("@")
    return (u[:1] + "***@" + d)[:30]


def _bot_decir(src, plantilla, base, **extra):
    """Responde por APRS respetando el limite de 60 respuestas por hora."""
    ts = time.time()
    with _bot_lock:
        _bot_resp[:] = [t for t in _bot_resp if ts - t < 3600]
        if len(_bot_resp) >= 60:
            return False
        _bot_resp.append(ts)
    txt = plantilla.replace("{call}", base).replace("{op}", CFG["callsign"].upper())
    for k, v in extra.items():
        txt = txt.replace("{%s}" % k, v)
    return enviar_mensaje(src, txt)


def _correo_conocido(base):
    """Busca el correo en la libreta de contactos, luego en la cola QSL y por ultimo en QRZ."""
    try:
        for c in _http_json("http://127.0.0.1:5018/api/contactos"):
            if c.get("call") == base and c.get("email"):
                return c["email"], "libreta"
    except Exception as e:
        print("bot: libreta no disponible: %s" % e, flush=True)
    try:
        for q in _http_json("http://127.0.0.1:5013/api/store/qslcola"):
            if str(q.get("callsign", "")).upper() == base and q.get("email"):
                return q["email"], "cola QSL"
    except Exception as e:
        print("bot: cola QSL no disponible: %s" % e, flush=True)
    try:
        r = _http_json("http://127.0.0.1:5015/api/qrz/lookup?call=%s&fresh=1" % base, timeout=20)
        if r.get("email"):
            return r["email"], "QRZ"
    except Exception as e:
        print("bot: consulta a QRZ fallo: %s" % e, flush=True)
    return None, ""


def _datos_qsl(base, c, ahora):
    return {"call": base, "op": CFG["callsign"].upper(), "time_utc": ahora, "freq": c.get("q_freq", ""),
            "band": c.get("q_band", ""), "mode": c.get("q_mode", "APRS"), "rst_s": c.get("q_rst_s", "59"),
            "rst_r": c.get("q_rst_r", "59"), "comments": c.get("q_comments", ""), "img": c.get("img", "")}


def _url_valida(u):
    return u if isinstance(u, str) and re.fullmatch(r"https?://[A-Za-z0-9.\-]+(:\d+)?/q/[A-Za-z0-9_-]{10}", u) else None


def bot_enviar_qsl(base, cid, c):
    """Dibuja y envia la QSL al correo de la cola QSL. False si fallo; si se envio, la URL temporal (str) o True si no hay URL."""
    bot_marcar(base, cid, "enviando...")
    ahora = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        r = _http_json("http://127.0.0.1:5017/api/mail/auto", _datos_qsl(base, c, ahora), timeout=90)
        bot_marcar(base, cid, "enviada")
        return _url_valida(r.get("url")) or True
    except urllib.error.HTTPError as e:
        bot_marcar(base, cid, "error: " + _err_http(e))
    except Exception as e:
        bot_marcar(base, cid, "error: " + str(e))
    return False


def bot_enlace_solo(base, c):
    """Crea solo el enlace temporal (sin correo). Devuelve la URL o None."""
    ahora = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        r = _http_json("http://127.0.0.1:5017/api/mail/enlace", _datos_qsl(base, c, ahora), timeout=60)
        return _url_valida(r.get("url"))
    except Exception as e:
        print("bot: no se pudo crear el enlace: %s" % e, flush=True)
        return None


def bot_decir_enlace(src, base, url):
    """Segundo mensaje APRS con el enlace temporal. Nunca se recorta (limite 67 caracteres)."""
    for t in ("QSL %s (10 min): %s" % (base, url), "QSL 10 min: " + url, url):
        if len(a_ascii(t)) <= 67:
            return _bot_decir(src, t, base)
    print("bot: el enlace es muy largo para APRS (%d caracteres)" % len(url), flush=True)
    return False


def bot_nuevo_participante(base, cid, src):
    """Participante nuevo: lo agrega a la cola QSL y, segun tenga o no correo, responde y envia o pregunta."""
    c = bot_cfg()
    ahora = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        _http_json("http://127.0.0.1:5013/api/store/qslcola",
                   {"items": [{"uid": "aprs|%s|%s" % (base, cid), "callsign": base, "time_utc": ahora,
                               "target": "", "mode": "APRS", "name": "", "country": "", "duration": 0}]})
    except Exception as e:
        print("bot: no se pudo agregar a la cola QSL: %s" % e, flush=True)
        bot_marcar(base, cid, "error al agregar a la cola")
        return
    email, origen = _correo_conocido(base)
    if not email:
        bot_marcar(base, cid, "esperando correo")
        _bot_decir(src, c["resp_pregunta"], base)
        return
    try:
        _http_json("http://127.0.0.1:5013/api/store/qslcola/email", {"emails": {base: email}})
    except Exception as e:
        print("bot: no se pudo guardar el correo en la cola: %s" % e, flush=True)
    _bot_decir(src, c["resp_ok"] if c.get("auto") else (c.get("resp_ok_manual") or BOT_DEFAULTS["resp_ok_manual"]), base)
    if c.get("auto"):
        url = bot_enviar_qsl(base, cid, c)
        if isinstance(url, str):
            bot_decir_enlace(src, base, url)
    else:
        bot_marcar(base, cid, "en cola")


def bot_respuesta_correo(src, base, texto, c):
    """Atiende la respuesta de un participante al que se le pregunto por su correo. True si el mensaje era para eso."""
    cid = bot_id(c)
    con = db()
    try:
        r = con.execute("SELECT qsl FROM bot_part WHERE concurso=? AND call=?", (cid, base)).fetchone()
    finally:
        con.close()
    if not r or not (r["qsl"].startswith("esperando correo") or r["qsl"].startswith("sin correo")):
        return False
    m = RE_CORREO.search(texto)
    if m and RE_CORREO_OK.match(m.group(0)) and len(m.group(0)) <= 120:
        email = m.group(0)
        try:                                   # libreta de contactos: nunca pisa un correo que ya exista
            lib = next((x for x in _http_json("http://127.0.0.1:5018/api/contactos") if x.get("call") == base), None)
            if lib is None or not lib.get("email"):
                _http_json("http://127.0.0.1:5018/api/contactos",
                           {"call": base, "email": email, "name": (lib or {}).get("name", ""),
                            "country": (lib or {}).get("country", ""),
                            "notes": (lib or {}).get("notes") or "Registrado por APRS"})
        except Exception as e:
            print("bot: no se pudo guardar en la libreta: %s" % e, flush=True)
        try:
            _http_json("http://127.0.0.1:5013/api/store/qslcola/email", {"emails": {base: email}})
        except Exception as e:
            print("bot: no se pudo guardar el correo en la cola: %s" % e, flush=True)
            bot_marcar(base, cid, "error al guardar el correo")
            return True
        if c.get("auto"):
            url = bot_enviar_qsl(base, cid, c)
            if url:
                _bot_decir(src, c["resp_mail_ok"], base, mail=_ocultar(email))
                if isinstance(url, str):
                    bot_decir_enlace(src, base, url)
        else:
            bot_marcar(base, cid, "en cola (correo recibido)")
            _bot_decir(src, "Gracias {call}! Anote tu correo y te enviare la QSL. 73 de {op}", base)
        return True
    if _norm(texto) in ("no", "no gracias", "nop", "nope"):
        bot_marcar(base, cid, "sin correo (prefirio no)")
        _bot_decir(src, c["resp_no"], base, fecha=datetime.now().strftime("%d/%m/%y"))
        if c.get("auto"):
            url = bot_enlace_solo(base, c)
            if url:
                bot_marcar(base, cid, "sin correo (prefirio no; enlace enviado)")
                bot_decir_enlace(src, base, url)
        return True
    return False


_bot_aviso_t = {}


def _fmt_f(v):
    try:
        return datetime.strptime(v, "%Y-%m-%dT%H:%M").strftime("%d/%m %H:%M")
    except (TypeError, ValueError):
        return ""


def _bot_avisar(src, base, plantilla, c):
    """Respuesta de palabra incorrecta / concurso no disponible (max 1 cada 30 s por indicativo)."""
    ahora = time.time()
    clave = a_ascii(" o ".join(str(p) for p in c["palabras"]))
    ex = {"inicio": _fmt_f(c.get("inicio", "")), "fin": _fmt_f(c.get("fin", ""))}
    resto = plantilla.replace("{call}", base).replace("{op}", CFG["callsign"].upper()).replace("{clave}", "")
    for k_, v_ in ex.items():
        resto = resto.replace("{%s}" % k_, v_)
    clave = clave[:max(0, 67 - len(a_ascii(resto)))]
    with _bot_lock:
        if ahora - _bot_aviso_t.get(base, 0) < 30:
            return
        _bot_aviso_t[base] = ahora
        if len(_bot_aviso_t) > 500:
            for k in [k for k, t in _bot_aviso_t.items() if ahora - t > 3600]:
                _bot_aviso_t.pop(k, None)
    if not _bot_aviso_permitido(base):
        return
    _bot_decir(src, plantilla, base, clave=clave, **ex)


def bot_procesar(src, texto, mid=None):
    try:
        c = bot_cfg()
        if not c["enabled"] or not c["palabras"] or src == mi_call().upper():
            return
        base = src.split("-")[0]
        if not re.fullmatch(r"[A-Z0-9]{3,8}", base) or not re.search(r"\d", base) or not re.search(r"[A-Z]", base):
            return
        if _bot_ritmo_excedido(base):
            return
        if bot_respuesta_correo(src, base, texto, c):
            _marcar_origen(mid, "concurso")
            return
        if not bot_en_ventana(c):
            _bot_avisar(src, base, c["resp_fuera"], c)
            return
        n = " " + _norm(texto) + " "
        if not any(" " + _norm(k) + " " in n for k in c["palabras"] if _norm(k)):
            print("bot: ignorado %s: sin palabra clave (%r)" % (src, texto[:40]), flush=True)
            _bot_avisar(src, base, c["resp_mal"], c)
            return
        _marcar_origen(mid, "concurso")
        cid = bot_id(c)
        ts = time.time()
        inicio_dia = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        con = db()
        try:
            hoy = con.execute("SELECT COUNT(*) FROM bot_part WHERE concurso=? AND ts>=?", (cid, inicio_dia)).fetchone()[0]
            ya = con.execute("SELECT aviso FROM bot_part WHERE concurso=? AND call=?", (cid, base)).fetchone()
            if ya is None and hoy >= int(c["max_por_dia"]):
                print("bot: tope diario alcanzado, se ignora %s" % base, flush=True)
                return
            if ya is None:
                con.execute("INSERT INTO bot_part(concurso,call,peer,ts,texto,aviso) VALUES(?,?,?,?,?,?)",
                            (cid, base, src, ts, texto[:67], 0))
                _bot_evento(con, cid, base, "participa", texto[:67])
                plantilla = None      # la respuesta la decide bot_nuevo_participante (con o sin correo)
            elif ts - ya["aviso"] > 3600:
                con.execute("UPDATE bot_part SET aviso=? WHERE concurso=? AND call=?", (ts, cid, base))
                _bot_evento(con, cid, base, "repetido", texto[:67])
                plantilla = c["resp_dup"]
            else:
                plantilla = None
                print("bot: %s ya estaba registrado y ya se le aviso hace menos de 1 hora; sin respuesta" % base, flush=True)
            con.commit()
        finally:
            con.close()
        if ya is None:
            threading.Thread(target=bot_nuevo_participante, args=(base, cid, src), daemon=True).start()
        if plantilla:
            _bot_decir(src, plantilla, base)
    except Exception as e:
        print("bot: error: %s" % e, flush=True)


# BOTB1-INICIO
_REQ = {"t": 0.0, "d": None}


def bot_codigo(q):
    q = str(q or "").lower()
    for pref, cod in (("esperando correo", "esperando_correo"), ("sin correo", "sin_correo"), ("enviando", "enviando"),
                      ("enviada", "enviada"), ("error", "error"), ("en cola", "en_cola")):
        if q.startswith(pref):
            return cod
    return "nuevo" if not q else "otro"


def bot_sync_cola(cid, filas, estados=None):
    # si una QSL se envio a mano desde la cola, el estado del participante lo refleja
    pend = [r for r in filas if bot_codigo(r["qsl"]) in ("en_cola", "error", "enviando")]
    if not pend:
        return {}
    if estados is None:
        try:
            estados = {q.get("uid"): q.get("estado") for q in _http_json("http://127.0.0.1:5013/api/store/qslcola", timeout=3)}
        except Exception:
            return {}
    cambios = {}
    for r in pend:
        if estados.get("aprs|%s|%s" % (r["call"], cid)) == "enviada":
            bot_marcar(r["call"], cid, "enviada (desde la cola)")
            cambios[r["call"]] = "enviada (desde la cola)"
    return cambios


def _req_get(url, timeout=3):
    try:
        return _http_json(url, timeout=timeout)
    except Exception:
        return None


def _es_servicio_enlaces(url):
    # el servicio de enlaces responde 404 con una pagina "Enlace vencido" para un token inexistente
    try:
        urllib.request.urlopen(url + "/q/aaaaaaaaaa", timeout=5)
        return True, ""
    except urllib.error.HTTPError as e:
        try:
            return b"Enlace vencido" in e.read(2000), ""
        except Exception:
            return False, ""
    except Exception as e:
        return False, str(e)


def _req_enlace():
    try:
        with open(os.path.join(BASE_DIR, "qsl_link.json")) as f:
            base = str(json.load(f).get("base", "")).strip().rstrip("/")
    except Exception:
        base = ""
    if not base:
        return "aviso", "sin enlace temporal (opcional): la QSL se envía solo por correo"
    if not re.fullmatch(r"https?://[A-Za-z0-9.\-]+(:\d+)?", base):
        return "error", "qsl_link.json tiene una dirección inválida: %s" % base[:50]
    ok, err = _es_servicio_enlaces(base)
    if ok:
        return "ok", "%s responde" % base[:60]
    if any(k in err for k in ("Name or service", "Temporary failure", "nodename nor servname", "getaddrinfo")):
        return "error", "el dominio %s no existe (¿quedó el nombre de ejemplo en qsl_link.json?)" % base[:60]
    if _es_servicio_enlaces("http://127.0.0.1:5023")[0]:
        return "error", "%s no responde desde internet (revisa Tailscale Funnel)" % base[:60]
    return "error", "el servicio de enlaces (puerto 5023) no está corriendo"


def bot_requisitos():
    ahora = time.time()
    if _REQ["d"] and ahora - _REQ["t"] < 15:
        return _REQ["d"]
    c = bot_cfg()
    out = []

    def add(id_, nombre, nivel, texto, tab=None):
        out.append({"id": id_, "nombre": nombre, "nivel": nivel, "texto": texto, "tab": tab})
    if c["palabras"]:
        add("palabras", "Palabras clave", "ok", "%d definida(s)" % len(c["palabras"]), "bot")
    else:
        add("palabras", "Palabras clave", "error", "no hay ninguna: el bot no atiende a nadie", "bot")
    if not c.get("inicio") and not c.get("fin"):
        add("ventana", "Período del concurso", "aviso", "sin fechas: el bot atiende siempre", "bot")
    elif bot_en_ventana(c):
        add("ventana", "Período del concurso", "ok", "dentro de las fechas", "bot")
    else:
        add("ventana", "Período del concurso", "aviso", "fuera de las fechas: responde \"concurso no disponible\"", "bot")
    if ST["conectado"] and ST["verificado"]:
        add("aprs", "APRS-IS", "ok", "conectado y verificado (%s)" % mi_call(), "aprs")
    elif ST["conectado"]:
        add("aprs", "APRS-IS", "error", "conectado pero sin verificar: no puede responder (revisa indicativo y passcode)", "aprs")
    else:
        add("aprs", "APRS-IS", "error", "sin conexión: no recibe ni responde mensajes", "aprs")
    if _req_get("http://127.0.0.1:5013/api/store/health") is None:
        add("cola", "Cola QSL (almacén)", "error", "el almacén no responde (puerto 5013)")
    else:
        add("cola", "Cola QSL (almacén)", "ok", "disponible")
    m = _req_get("http://127.0.0.1:5017/api/mail/status")
    if m is None:
        add("gmail", "Correo (Gmail)", "error" if c.get("auto") else "aviso", "el servicio de correo no responde (puerto 5017)", "mail")
    elif not m.get("configured"):
        add("gmail", "Correo (Gmail)", "error" if c.get("auto") else "aviso",
            "sin configurar" + ("; el envío automático no puede enviar" if c.get("auto") else ""), "mail")
    elif m.get("ok") is False:
        add("gmail", "Correo (Gmail)", "error", "el último envío falló: %s" % str(m.get("error"))[:80], "mail")
    else:
        add("gmail", "Correo (Gmail)", "ok", "%s · %s de %s envíos hoy" % (m.get("address", ""), m.get("enviados_hoy", 0), m.get("limite_diario", "?")), "mail")
    d = _req_get("http://127.0.0.1:5013/api/store/config/pcbox-qsl-design")
    if d is not None and not d.get("value"):
        add("diseno", "Diseño de la QSL", "aviso", "sin diseño guardado: se usará el diseño por defecto", "qsl")
    elif d is not None:
        add("diseno", "Diseño de la QSL", "ok", "guardado")
    import importlib.util as _ilu
    if _ilu.find_spec("PIL") is None:
        add("pillow", "Dibujo de la QSL (Pillow)", "error", "falta Pillow: sudo apt install -y python3-pil")
    nivel, texto = _req_enlace()
    add("enlace", "Enlace temporal de la QSL", nivel, texto)
    lib = _req_get("http://127.0.0.1:5018/api/contactos")
    if lib is None:
        add("libreta", "Libreta de contactos", "aviso", "no responde (puerto 5018); se usará la cola QSL y QRZ", "contactos")
    else:
        add("libreta", "Libreta de contactos", "ok", "%d contacto(s) con correo" % sum(1 for x in lib if x.get("email")), "contactos")
    q = _req_get("http://127.0.0.1:5015/api/qrz/status")
    if q is None:
        add("qrz", "QRZ.com", "aviso", "el servicio no responde (puerto 5015); el bot igual pregunta el correo por APRS", "qrz")
    elif not q.get("configured"):
        add("qrz", "QRZ.com", "aviso", "sin configurar; el bot igual pregunta el correo por APRS", "qrz")
    elif q.get("ok") is False:
        add("qrz", "QRZ.com", "aviso", "error: %s" % str(q.get("error"))[:60], "qrz")
    else:
        add("qrz", "QRZ.com", "ok", "configurado")
    res = {"checks": out, "errores": sum(1 for x in out if x["nivel"] == "error"),
           "avisos": sum(1 for x in out if x["nivel"] == "aviso")}
    _REQ.update(t=ahora, d=res)
    return res


@app.route("/api/aprs/bot/requisitos")
def api_bot_requisitos():
    return jsonify(bot_requisitos())
# BOTB1-FIN


# BOTB2-INICIO
_bot_ritmo = {}          # indicativo -> marcas de tiempo de los mensajes que ha enviado
_bot_silencio = {}       # indicativo -> hasta cuando se ignora
BOT_RITMO_MAX, BOT_RITMO_VENT, BOT_SILENCIO = 6, 600, 3600
_bot_avisos_h = []       # marcas de tiempo de los avisos (palabra incorrecta / fuera de fecha) de la ultima hora
_bot_avisos_call = {}    # indicativo -> marcas de tiempo de avisos en 24 h
BOT_AVISOS_HORA, BOT_AVISOS_DIA_CALL = 20, 3


def _bot_ritmo_excedido(base):
    # un indicativo que manda mas de 6 mensajes en 10 minutos se ignora 1 hora (posible bucle entre bots o inundacion)
    ahora = time.time()
    with _bot_lock:
        if _bot_silencio.get(base, 0) > ahora:
            return True
        marcas = [t for t in _bot_ritmo.get(base, []) if ahora - t < BOT_RITMO_VENT] + [ahora]
        _bot_ritmo[base] = marcas
        if len(_bot_ritmo) > 500:
            for k in [k for k, v in _bot_ritmo.items() if not v or ahora - v[-1] > BOT_RITMO_VENT]:
                _bot_ritmo.pop(k, None)
        if len(marcas) > BOT_RITMO_MAX:
            _bot_silencio[base] = ahora + BOT_SILENCIO
            print("bot: %s envio %d mensajes en %d min: se ignora %d min (posible bucle entre bots)"
                  % (base, len(marcas), BOT_RITMO_VENT // 60, BOT_SILENCIO // 60), flush=True)
            return True
    return False


def _bot_aviso_permitido(base):
    # los avisos tienen su propio tope: no pueden agotar las 60 respuestas por hora que necesitan los participantes
    ahora = time.time()
    with _bot_lock:
        _bot_avisos_h[:] = [t for t in _bot_avisos_h if ahora - t < 3600]
        propios = [t for t in _bot_avisos_call.get(base, []) if ahora - t < 86400]
        if len(_bot_avisos_h) >= BOT_AVISOS_HORA or len(propios) >= BOT_AVISOS_DIA_CALL:
            _bot_avisos_call[base] = propios
            return False
        _bot_avisos_h.append(ahora)
        _bot_avisos_call[base] = propios + [ahora]
        if len(_bot_avisos_call) > 500:
            for k in [k for k, v in _bot_avisos_call.items() if not v or ahora - v[-1] > 86400]:
                _bot_avisos_call.pop(k, None)
    return True


def _marcar_origen(mid, origen):
    if not mid:
        return
    con = db()
    try:
        con.execute("UPDATE messages SET origen=? WHERE id=?", (origen, mid))
        con.commit()
    finally:
        con.close()


@app.route("/api/aprs/bot/resumen")
def api_bot_resumen():
    c = bot_cfg()
    cid = bot_id(c)
    inicio_dia = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    con = db()
    try:
        filas = con.execute("SELECT call,ts,qsl FROM bot_part WHERE concurso=? ORDER BY ts DESC LIMIT 300", (cid,)).fetchall()
        total = con.execute("SELECT COUNT(*) FROM bot_part WHERE concurso=?", (cid,)).fetchone()[0]
    finally:
        con.close()
    cambios = bot_sync_cola(cid, filas)
    conteo, ultimos = {}, []
    for r in filas:
        q = cambios.get(r["call"], r["qsl"])
        cod = bot_codigo(q)
        conteo[cod] = conteo.get(cod, 0) + 1
        if len(ultimos) < 8:
            ultimos.append({"call": r["call"], "ts": r["ts"], "qsl": q, "cod": cod})
    if not c["enabled"]:
        estado = "apagado"
    elif not c["palabras"]:
        estado = "sin palabras clave"
    elif bot_en_ventana(c):
        estado = "activo"
    else:
        estado = "fuera de fecha"
    rq = bot_requisitos() if c["enabled"] else None
    return jsonify({"nombre": c["nombre"], "estado": estado, "total": total, "hoy": sum(1 for r in filas if r["ts"] >= inicio_dia),
                    "conteo": conteo, "ultimos": ultimos, "errores": rq["errores"] if rq else 0})
# BOTB2-FIN


@app.route("/api/aprs/bot", methods=["GET"])
def api_bot_get():
    c = bot_cfg()
    cid = bot_id(c)
    con = db()
    try:
        total = con.execute("SELECT COUNT(*) FROM bot_part WHERE concurso=?", (cid,)).fetchone()[0]
        filas = con.execute("SELECT call,peer,ts,texto,qsl FROM bot_part WHERE concurso=? ORDER BY ts DESC LIMIT 30",
                            (cid,)).fetchall()
    finally:
        con.close()
    if not c["enabled"]:
        estado = "Desactivado"
    elif not c["palabras"]:
        estado = "Activado, pero faltan palabras clave"
    elif bot_en_ventana(c):
        estado = "Activo: escuchando mensajes APRS" + ("" if ST["verificado"] else " (SIN conexión verificada a APRS-IS)")
    else:
        estado = "Activado, fuera del período del concurso"
    cambios = bot_sync_cola(cid, filas)
    part = []
    for r in filas:
        q = cambios.get(r["call"], r["qsl"])
        part.append({"call": r["call"], "peer": r["peer"], "ts": r["ts"], "texto": r["texto"], "qsl": q, "cod": bot_codigo(q)})
    return jsonify({"config": c, "estado": estado, "total": total, "participantes": part})


@app.route("/api/aprs/bot", methods=["POST"])
def api_bot_post():
    b = request.get_json(silent=True) or {}
    palabras = b.get("palabras", [])
    if isinstance(palabras, str):
        palabras = palabras.splitlines()
    limpias = []
    for p_ in palabras:
        p_ = str(p_).strip()
        if not p_:
            continue
        if len(p_) > 60 or not _norm(p_):
            return jsonify({"error": "palabra o frase inválida: %s" % p_[:30]}), 400
        if p_ not in limpias:
            limpias.append(p_)
    if len(limpias) > 20:
        return jsonify({"error": "máximo 20 palabras o frases"}), 400
    fechas = {}
    for k in ("inicio", "fin"):
        v = str(b.get(k, "") or "").strip()
        if v and not RE_FECHA.match(v):
            return jsonify({"error": "fecha de %s inválida" % k}), 400
        fechas[k] = v
    if fechas["inicio"] and fechas["fin"] and fechas["fin"] <= fechas["inicio"]:
        return jsonify({"error": "el fin debe ser posterior al inicio"}), 400
    try:
        mx = int(b.get("max_por_dia", 200))
        if not 1 <= mx <= 2000:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "máximo por día debe estar entre 1 y 2000"}), 400
    nombre = re.sub(r"[\x00-\x1f<>&\"'|]", "", str(b.get("nombre", "") or "")).strip()[:40]
    if not nombre:
        return jsonify({"error": "falta el nombre del concurso"}), 400
    resp_ok = str(b.get("resp_ok", "") or BOT_DEFAULTS["resp_ok"])[:200]
    resp_ok_manual = str(b.get("resp_ok_manual", "") or BOT_DEFAULTS["resp_ok_manual"])[:200]
    resp_dup = str(b.get("resp_dup", "") or BOT_DEFAULTS["resp_dup"])[:200]
    resp_pregunta = str(b.get("resp_pregunta", "") or BOT_DEFAULTS["resp_pregunta"])[:200]
    resp_mail_ok = str(b.get("resp_mail_ok", "") or BOT_DEFAULTS["resp_mail_ok"])[:200]
    resp_no = str(b.get("resp_no", "") or BOT_DEFAULTS["resp_no"])[:200]
    resp_mal = str(b.get("resp_mal", "") or BOT_DEFAULTS["resp_mal"])[:200]
    resp_fuera = str(b.get("resp_fuera", "") or BOT_DEFAULTS["resp_fuera"])[:200]
    for t_ in (resp_ok, resp_ok_manual, resp_dup, resp_pregunta, resp_mail_ok, resp_no, resp_mal, resp_fuera):
        peor = a_ascii(t_.replace("{call}", "AAAAAA9A").replace("{op}", CFG["callsign"].upper())
                       .replace("{clave}", "").replace("{inicio}", "01/01 00:00").replace("{fin}", "01/01 00:00").replace("{mail}", "j***@gmail.com").replace("{fecha}", "19/10/26"))
        if len(peor) > 67:
            return jsonify({"error": "una respuesta supera los 67 caracteres que permite APRS (%d)" % len(peor)}), 400
    c = {"enabled": bool(b.get("enabled")), "nombre": nombre, "palabras": limpias,
         "inicio": fechas["inicio"], "fin": fechas["fin"],
         "resp_ok": resp_ok, "resp_ok_manual": resp_ok_manual, "resp_dup": resp_dup,
         "resp_pregunta": resp_pregunta, "resp_mail_ok": resp_mail_ok, "resp_no": resp_no,
         "resp_mal": resp_mal, "resp_fuera": resp_fuera,
         "max_por_dia": mx, "auto": bool(b.get("auto")),
         "q_freq": _qtxt(b, "q_freq", 12), "q_band": _qtxt(b, "q_band", 8), "q_mode": _qtxt(b, "q_mode", 10),
         "q_rst_s": _qtxt(b, "q_rst_s", 6), "q_rst_r": _qtxt(b, "q_rst_r", 6),
         "q_comments": _qtxt(b, "q_comments", 120)}
    if agenda_leer():       # con agenda activa, los datos de la actividad no se pisan con los del formulario
        try:
            with open(BOT_PATH) as f:
                raw = json.load(f)
        except Exception:
            raw = {}
        for k in CAMPOS_ACT:
            c[k] = raw.get(k, [] if k == "palabras" else BOT_DEFAULTS.get(k, ""))
    bot_guardar(c)
    return jsonify({"ok": True})


def _agenda_limpiar(entradas):
    if not isinstance(entradas, list) or len(entradas) > 120:
        raise ValueError("máximo 120 actividades")
    out, ids = [], set()
    for i, e in enumerate(entradas, 1):
        if not isinstance(e, dict):
            raise ValueError("formato inválido")
        aid = str(e.get("id") or "")
        if not RE_ACT_ID.match(aid):
            aid = os.urandom(4).hex()
        if aid in ids:
            raise ValueError("id repetido")
        ids.add(aid)
        nombre = re.sub(r"[\x00-\x1f<>&\"'|]", "", str(e.get("nombre") or "")).strip()[:40]
        if not nombre:
            raise ValueError("actividad %d: falta el nombre" % i)
        pal = e.get("palabras", [])
        if isinstance(pal, str):
            pal = pal.splitlines()
        limp = []
        for p_ in pal:
            p_ = str(p_).strip()
            if not p_:
                continue
            if len(p_) > 60 or not _norm(p_):
                raise ValueError("«%s»: palabra inválida: %s" % (nombre, p_[:30]))
            if p_ not in limp:
                limp.append(p_)
        if not limp or len(limp) > 20:
            raise ValueError("«%s»: debe tener entre 1 y 20 palabras clave" % nombre)
        ini, fin = str(e.get("inicio") or ""), str(e.get("fin") or "")
        if not (RE_FECHA.match(ini) and RE_FECHA.match(fin)):
            raise ValueError("«%s»: fechas inválidas" % nombre)
        if fin <= ini:
            raise ValueError("«%s»: el fin debe ser posterior al inicio" % nombre)
        img = str(e.get("img") or "")
        if img and not (RE_IMG.match(img) and os.path.isfile(os.path.join(BOT_IMG, img))):
            img = ""
        out.append({"id": aid, "nombre": nombre, "palabras": limp, "inicio": ini, "fin": fin, "img": img,
                    "q_freq": _qtxt(e, "q_freq", 12), "q_band": _qtxt(e, "q_band", 8), "q_mode": _qtxt(e, "q_mode", 10),
                    "q_rst_s": _qtxt(e, "q_rst_s", 6), "q_rst_r": _qtxt(e, "q_rst_r", 6),
                    "q_comments": _qtxt(e, "q_comments", 120)})
    out.sort(key=lambda a: a["inicio"])
    for a, b in zip(out, out[1:]):
        if b["inicio"] < a["fin"]:
            raise ValueError("se solapan «%s» y «%s»" % (a["nombre"], b["nombre"]))
    return out


@app.route("/api/aprs/bot/agenda", methods=["GET"])
def api_agenda_get():
    ag = agenda_leer()
    c = bot_cfg()
    con = db()
    try:
        cont = {r[0]: r[1] for r in con.execute("SELECT concurso, COUNT(*) FROM bot_part GROUP BY concurso")}
    finally:
        con.close()
    for a in ag:
        a["participantes"] = cont.get("act:" + a["id"], 0)
    return jsonify({"actividades": ag, "vigente": c.get("_act") if ag and not c.get("_hueco") else None})


@app.route("/api/aprs/bot/agenda", methods=["POST"])
def api_agenda_post():
    b = request.get_json(silent=True) or {}
    try:
        lst = _agenda_limpiar(b.get("actividades", []))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    agenda_escribir(lst)
    usadas = {a["img"] for a in lst if a["img"]}
    try:
        for n in os.listdir(BOT_IMG):
            p = os.path.join(BOT_IMG, n)
            if n not in usadas and time.time() - os.path.getmtime(p) > 900:
                os.remove(p)
    except OSError:
        pass
    return jsonify({"ok": True, "total": len(lst)})


@app.route("/api/aprs/bot/agenda/img", methods=["POST"])
def api_agenda_img():
    datos = request.get_data()
    if not datos or len(datos) > 12 * 1024 * 1024:
        return jsonify({"error": "imagen vacía o mayor a 12 MB"}), 400
    try:
        import io
        from PIL import Image
    except ImportError:
        return jsonify({"error": "falta Pillow: sudo apt install -y python3-pil"}), 500
    try:
        im = Image.open(io.BytesIO(datos))
        im.load()
        im = im.convert("RGB")
    except Exception:
        return jsonify({"error": "el archivo no es una imagen válida"}), 400
    w, h = im.size
    if w * 9 > h * 16:
        nw = int(h * 16 / 9)
        x = (w - nw) // 2
        im = im.crop((x, 0, x + nw, h))
    else:
        nh = int(w * 9 / 16)
        y = (h - nh) // 2
        im = im.crop((0, y, w, y + nh))
    im = im.resize((1920, 1080), Image.LANCZOS)
    os.makedirs(BOT_IMG, exist_ok=True)
    name = "i%s.jpg" % os.urandom(5).hex()
    im.save(os.path.join(BOT_IMG, name), "JPEG", quality=90)
    return jsonify({"ok": True, "img": name})


@app.route("/api/aprs/bot/img/<name>")
def api_agenda_img_get(name):
    if not RE_IMG.match(name):
        return jsonify({"error": "no existe"}), 404
    from flask import send_from_directory
    return send_from_directory(BOT_IMG, name, max_age=3600)


@app.route("/api/aprs/bot/reset", methods=["POST"])
def api_bot_reset():
    b = request.get_json(silent=True) or {}
    cid = bot_id(bot_cfg())
    con = db()
    try:
        if b.get("all"):
            con.execute("DELETE FROM bot_part WHERE concurso=?", (cid,))
        else:
            con.execute("DELETE FROM bot_part WHERE concurso=? AND call=?", (cid, str(b.get("call", "")).strip().upper()))
        con.commit()
    finally:
        con.close()
    return jsonify({"ok": True})


# BOTSTATS-INICIO
def _bot_tabla_log(con):
    con.execute("CREATE TABLE IF NOT EXISTS bot_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, "
                "concurso TEXT NOT NULL, call TEXT NOT NULL, evento TEXT NOT NULL, detalle TEXT)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_botlog_call ON bot_log(call)")


def _bot_evento(con, cid, call, evento, detalle=""):
    try:
        _bot_tabla_log(con)
        con.execute("INSERT INTO bot_log(ts,concurso,call,evento,detalle) VALUES(?,?,?,?,?)",
                    (time.time(), cid, call, evento, str(detalle)[:100]))
        con.execute("DELETE FROM bot_log WHERE id < (SELECT MAX(id) FROM bot_log) - 20000")
    except Exception as e:
        print("bot: no se pudo registrar el evento: %s" % e, flush=True)


def _bot_columnas(ids):
    ag = sorted(agenda_leer(), key=lambda a: a["inicio"])
    if ag:
        return [{"cid": "act:" + a["id"], "nombre": a["nombre"], "inicio": a["inicio"], "fin": a["fin"]}
                for a in ag if not ids or a["id"] in ids]
    con = db()
    try:
        filas = con.execute("SELECT concurso, MIN(ts) FROM bot_part GROUP BY concurso ORDER BY MIN(ts)").fetchall()
    finally:
        con.close()
    out = []
    for r in filas:
        p = r[0].split("|")
        out.append({"cid": r[0], "nombre": p[0] or r[0], "inicio": p[1] if len(p) > 1 else "", "fin": ""})
    return out


def _libreta_paises():
    try:
        return {x.get("call"): x.get("country") or "" for x in _http_json("http://127.0.0.1:5018/api/contactos", timeout=3)}
    except Exception:
        return {}


@app.route("/api/aprs/bot/stats")
def api_bot_stats():
    ids = [i for i in request.args.get("ids", "").split(",") if i]
    cols = _bot_columnas(ids)
    cids = [c["cid"] for c in cols]
    con = db()
    try:
        filas = [r for r in con.execute("SELECT concurso,call,ts,qsl FROM bot_part").fetchall() if r["concurso"] in cids]
    finally:
        con.close()
    cambios = {}
    estados_cola = None
    if any(bot_codigo(r["qsl"]) in ("en_cola", "error", "enviando") for r in filas):
        try:
            estados_cola = {q.get("uid"): q.get("estado") for q in _http_json("http://127.0.0.1:5013/api/store/qslcola", timeout=3)}
        except Exception:
            estados_cola = {}
    for cid in cids:
        for call, q in bot_sync_cola(cid, [r for r in filas if r["concurso"] == cid], estados_cola).items():
            cambios[(cid, call)] = q
    paises = _libreta_paises()
    ahora = datetime.now().strftime("%Y-%m-%dT%H:%M")
    for c in cols:
        c["terminada"] = bool(c["fin"]) and c["fin"] <= ahora
    part, estados = {}, {}
    for r in filas:
        q = cambios.get((r["concurso"], r["call"]), r["qsl"])
        cod = bot_codigo(q)
        p = part.setdefault(r["call"], {"call": r["call"], "pais": paises.get(r["call"], ""), "celdas": {}})
        p["celdas"][r["concurso"]] = {"ts": r["ts"], "qsl": q, "cod": cod}
        estados[cod] = estados.get(cod, 0) + 1
    lista = list(part.values())
    for p in lista:
        p["n"] = len(p["celdas"])
        p["completo"] = bool(cols) and p["n"] == len(cols)
    lista.sort(key=lambda p: (not p["completo"], -p["n"], p["call"]))
    por_pais = {}
    for p in lista:
        k = p["pais"] or "Sin dato"
        por_pais[k] = por_pais.get(k, 0) + 1
    todas = _bot_columnas([]) if agenda_leer() else []
    return jsonify({"columnas": cols, "todas": todas, "participantes": lista, "estados": estados, "paises": por_pais,
                    "completos": sum(1 for p in lista if p["completo"]),
                    "cerrada": bool(cols) and all(c["terminada"] for c in cols)})


@app.route("/api/aprs/bot/registro")
def api_bot_registro():
    call = re.sub(r"[^A-Z0-9]", "", request.args.get("call", "").upper())
    try:
        limite = min(500, max(1, int(request.args.get("limit", "200"))))
    except ValueError:
        limite = 200
    pat = "%" + call + "%"
    con = db()
    try:
        _bot_tabla_log(con)
        ev = con.execute("SELECT ts,concurso,call,evento,detalle FROM bot_log WHERE call LIKE ? ORDER BY id DESC LIMIT ?",
                         (pat, limite)).fetchall()
        ms = con.execute("SELECT ts,dir,peer,text,estado,origen FROM messages WHERE origen IN ('bot','concurso') "
                         "AND peer LIKE ? ORDER BY id DESC LIMIT ?", (pat, limite)).fetchall()
        con.commit()
    finally:
        con.close()
    return jsonify({"eventos": [dict(r) for r in ev], "mensajes": [dict(r) for r in ms]})
# BOTMAIL-INICIO
RE_MAIL_PANEL = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")


def _cfg_de(cid):
    c = bot_cfg()
    if str(cid).startswith("act:"):
        a = next((x for x in agenda_leer() if "act:" + x["id"] == cid), None)
        if a:
            c = dict(c)
            for k in CAMPOS_ACT:
                if k in a and (a[k] != "" or k in ("q_comments", "q_freq", "q_band")):
                    c[k] = a[k]
            c["img"] = a.get("img", "")
    return c


def _enviar_pendientes(call, cids):
    for cid in cids:
        try:
            bot_enviar_qsl(call, cid, _cfg_de(cid))
        except Exception as e:
            print("bot: envio desde el panel fallo (%s, %s): %s" % (call, cid, e), flush=True)


def _libreta(call):
    try:
        return next((x for x in _http_json("http://127.0.0.1:5018/api/contactos", timeout=4) if x.get("call") == call), None)
    except Exception:
        return None


@app.route("/api/aprs/bot/contacto", methods=["GET"])
def api_bot_contacto_get():
    call = re.sub(r"[^A-Z0-9]", "", request.args.get("call", "").upper())
    return jsonify(_libreta(call) or {"call": call})


@app.route("/api/aprs/bot/contacto", methods=["POST"])
def api_bot_contacto_post():
    b = request.get_json(silent=True) or {}
    call = re.sub(r"[^A-Z0-9]", "", str(b.get("call", "")).upper())
    mail = str(b.get("email", "")).strip()
    if not re.fullmatch(r"[A-Z0-9]{3,10}", call):
        return jsonify({"error": "indicativo inválido"}), 400
    if not RE_MAIL_PANEL.match(mail) or len(mail) > 120:
        return jsonify({"error": "correo inválido"}), 400
    lib = _libreta(call) or {}
    name = re.sub(r"[\x00-\x1f<>]", "", str(b.get("name", ""))).strip()[:80] or lib.get("name", "")
    country = re.sub(r"[\x00-\x1f<>]", "", str(b.get("country", ""))).strip()[:60] or lib.get("country", "")
    try:
        _http_json("http://127.0.0.1:5018/api/contactos", {"call": call, "email": mail, "name": name, "country": country,
                                                           "notes": lib.get("notes") or "Registrado por APRS"})
    except urllib.error.HTTPError as e:
        return jsonify({"error": "libreta: " + _err_http(e)}), 409
    except Exception as e:
        return jsonify({"error": "no se pudo guardar en la libreta: %s" % e}), 502
    try:
        _http_json("http://127.0.0.1:5013/api/store/qslcola/email", {"emails": {call: mail}})
    except Exception as e:
        return jsonify({"error": "no se pudo guardar el correo en la cola QSL: %s" % e}), 502
    con = db()
    try:
        cids = [r[0] for r in con.execute("SELECT concurso FROM bot_part WHERE call=? AND qsl LIKE 'esperando correo%'", (call,))]
        for cid in cids:
            _bot_evento(con, cid, call, "correo", "anotado desde el panel")
        con.commit()
    finally:
        con.close()
    auto = []
    for cid in cids:
        if b.get("enviar", True) and _cfg_de(cid).get("auto"):
            auto.append(cid)
        else:
            bot_marcar(call, cid, "en cola (correo recibido)")
    if auto:
        threading.Thread(target=_enviar_pendientes, args=(call, auto), daemon=True).start()
    return jsonify({"ok": True, "actividades": len(cids), "enviando": len(auto)})


def iniciar_botc():
    """Crea la tabla de participantes y se registra en APRS para recibir cada mensaje."""
    con = db()
    try:
        con.execute("""CREATE TABLE IF NOT EXISTS bot_part (
            concurso TEXT NOT NULL, call TEXT NOT NULL, peer TEXT, ts REAL NOT NULL, texto TEXT,
            aviso REAL NOT NULL DEFAULT 0, PRIMARY KEY (concurso, call))""")
        if "qsl" not in [r[1] for r in con.execute("PRAGMA table_info(bot_part)")]:
            con.execute("ALTER TABLE bot_part ADD COLUMN qsl TEXT NOT NULL DEFAULT ''")
        con.commit()
    finally:
        con.close()
    if bot_procesar not in _aprs.AL_RECIBIR:
        _aprs.AL_RECIBIR.append(bot_procesar)
