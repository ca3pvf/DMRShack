/* DMRShack, pieza APRS: tarjeta, configuración y monitor. Se ejecuta con eval global (las funciones quedan globales). */
/* ---------- APRS: radio de cobertura ---------- */
const APRS_RAD_API = location.origin + '/api/aprs';
function aprsRadMsg(t){ const m = document.getElementById('aprs-rad-msg'); m.textContent = t; setTimeout(() => { if(m.textContent === t) m.textContent = ''; }, 4000); }
async function aprsRadCargar(){
  try{
    const r = await fetch(APRS_RAD_API + '/status');
    const d = await r.json();
    const inp = document.getElementById('aprs-rad');
    if(d.radio_km && document.activeElement !== inp) inp.value = d.radio_km;
  }catch(e){}
}
document.getElementById('aprs-rad').addEventListener('change', async e => {
  const km = parseInt(e.target.value, 10);
  if(!(km >= 5 && km <= 500)){ aprsRadMsg('5 a 500'); aprsRadCargar(); return; }
  try{
    const r = await fetch(APRS_RAD_API + '/radius', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({radius_km: km})});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    aprsRadMsg('guardado');
  }catch(err){ aprsRadMsg('error: ' + err.message); aprsRadCargar(); }
});
aprsRadCargar();

/* ---------- CONFIGURACIÓN APRS ---------- */
const APC_API = location.origin + '/api/aprs/config';
const APC_SIMBOLOS = [
  ['/-', '🏠', 'Casa (QTH)'], ['/>', '🚗', 'Auto'], ['/#', '📡', 'Digipeater'], ['/r', '📻', 'Antena / repetidor'],
  ['/_', '🌦️', 'Estación meteorológica'], ['/<', '🏍️', 'Moto'], ['/k', '🚚', 'Camión'], ['/b', '🚲', 'Bicicleta'],
  ['/[', '🚶', 'Persona'], ["/'", '✈️', 'Avión pequeño'], ['/Y', '⛵', 'Velero'], ['/O', '🎈', 'Globo']
];
var aprsRefreshMs = 5000;
var apcIcono = '';
var apcPassTocado = false;
function aprsIcono(){ return apcIcono ? apcIcono + ' ' : ''; }
function apcMsg(t){ const m = document.getElementById('apc-msg'); m.textContent = t; setTimeout(() => { if(m.textContent === t) m.textContent = ''; }, 6000); }
(function(){
  const sel = document.getElementById('apc-preset');
  sel.innerHTML = APC_SIMBOLOS.map(x => '<option value="' + x[0] + '">' + x[1] + ' ' + x[2] + '</option>').join('') +
    '<option value="otro">Otro (tabla y símbolo manual)</option>';
})();
function apcPresetSync(){
  const clave = document.getElementById('apc-tabla').value + document.getElementById('apc-simbolo').value;
  const f = APC_SIMBOLOS.find(x => x[0] === clave);
  document.getElementById('apc-preset').value = f ? f[0] : 'otro';
  apcIcono = f ? f[1] : '';
}
document.getElementById('apc-preset').addEventListener('change', e => {
  if(e.target.value === 'otro') return;
  document.getElementById('apc-tabla').value = e.target.value[0];
  document.getElementById('apc-simbolo').value = e.target.value[1];
  apcPresetSync();
});
document.getElementById('apc-tabla').addEventListener('change', apcPresetSync);
document.getElementById('apc-simbolo').addEventListener('input', apcPresetSync);
document.getElementById('apc-passcode').addEventListener('input', () => { apcPassTocado = true; });
function apcAplicar(c){
  const v = (id, x) => { document.getElementById(id).value = (x == null ? '' : x); };
  v('apc-callsign', c.callsign); v('apc-ssid', c.ssid); v('apc-server', c.server); v('apc-port', c.port);
  v('apc-lat', c.lat); v('apc-lon', c.lon); v('apc-radius', c.radius_km); v('apc-amb', c.ambiguity);
  v('apc-bint', c.beacon_interval_min); v('apc-bcom', c.beacon_comment);
  v('apc-tabla', c.symbol_table); v('apc-simbolo', c.symbol);
  v('apc-refresh', c.ui_refresh_s); v('apc-ttl', c.station_ttl_h);
  document.getElementById('apc-ben').checked = !!c.beacon_enabled;
  const pw = document.getElementById('apc-passcode');
  pw.value = ''; apcPassTocado = false;
  pw.placeholder = c.passcode_set ? 'guardado (vacío = no cambiar)' : 'automático';
  aprsRefreshMs = Math.max(5, parseInt(c.ui_refresh_s, 10) || 5) * 1000;
  apcPresetSync();
}
async function apcCargar(){
  try{
    const r = await fetch(APC_API);
    if(!r.ok) throw new Error('HTTP ' + r.status);
    apcAplicar(await r.json());
  }catch(e){ apcMsg('Sin conexión con el servicio APRS'); }
}
document.getElementById('apc-guardar').addEventListener('click', async () => {
  const g = id => document.getElementById(id).value.trim();
  const body = {
    callsign: g('apc-callsign'), ssid: g('apc-ssid'), server: g('apc-server'), port: g('apc-port'),
    lat: g('apc-lat'), lon: g('apc-lon'), radius_km: g('apc-radius'), ambiguity: g('apc-amb'),
    beacon_enabled: document.getElementById('apc-ben').checked, beacon_interval_min: g('apc-bint'),
    beacon_comment: g('apc-bcom'), symbol_table: document.getElementById('apc-tabla').value,
    symbol: document.getElementById('apc-simbolo').value, ui_refresh_s: g('apc-refresh'), station_ttl_h: g('apc-ttl')
  };
  if(apcPassTocado) body.passcode = g('apc-passcode');
  try{
    const r = await fetch(APC_API, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    apcMsg(d.reconectando ? 'Guardado. Reconectando a APRS-IS como ' + d.indicativo_completo + '...' : 'Guardado');
    await apcCargar();
    if(typeof aprsRadCargar === 'function') aprsRadCargar();
    if(typeof cargarAprs === 'function') cargarAprs();
  }catch(e){ apcMsg('Error: ' + e.message); }
});
document.querySelector('[data-cfg="aprs"]').addEventListener('click', apcCargar);
apcCargar();

function aprsLink(t){
  return aprsEsc(t).replace(/https?:\/\/[^\s<>"']+/g, function(u){
    var fin = (u.match(/[.,;:!?)]+$/) || [''])[0];
    var url = fin ? u.slice(0, -fin.length) : u;
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color:#4fc3f7;text-decoration:underline">' + url + '</a>' + fin;
  });
}
/* ---------- APRS: monitor, baliza y mensajes ---------- */
let aprsTab = localStorage.getItem('pcbox-aprs-tab') || 'est';
let aprsEstado = null;
function aprsEsc(t){
  return String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function aprsHace(s){
  return s < 90 ? s + ' s' : (s < 5400 ? Math.round(s/60) + ' min' : (s/3600).toFixed(1) + ' h');
}
async function aprsPost(ruta, cuerpo){
  const r = await fetch(EP.aprs + ruta, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(cuerpo || {})});
  const d = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(d.error || ('error ' + r.status));
  return d;
}
function aprsMarcarTab(){
  document.querySelectorAll('[data-aprs-tab]').forEach(b => b.classList.toggle('on', b.dataset.aprsTab === aprsTab));
  document.getElementById('aprs-est').style.display = aprsTab === 'est' ? '' : 'none';
  document.getElementById('aprs-msg').style.display = aprsTab === 'msg' ? '' : 'none';
}
document.querySelectorAll('[data-aprs-tab]').forEach(b => b.addEventListener('click', () => {
  aprsTab = b.dataset.aprsTab;
  localStorage.setItem('pcbox-aprs-tab', aprsTab);
  aprsMarcarTab(); cargarAprs();
}));
document.getElementById('aprs-bal').addEventListener('click', async () => {
  if(!aprsEstado) return;
  try{ await aprsPost('/beacon', {enabled: !aprsEstado.baliza.activa}); }catch(e){ alert(e.message); }
  cargarAprs();
});
document.getElementById('aprs-ahora').addEventListener('click', async function(){
  const b = this, t0 = b.dataset.txt || (b.dataset.txt = b.textContent);
  try{
    await aprsPost('/beacon', {send_now: true});
    b.textContent = '✓ Enviada ' + new Date().toLocaleTimeString('es-CL', {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
  }catch(e){ alert('No se pudo enviar la baliza: ' + e.message); }
  setTimeout(() => { b.textContent = t0; }, 5000);
  cargarAprs();
});
async function aprsEnviar(){
  const to = document.getElementById('aprs-to'), txt = document.getElementById('aprs-txt');
  if(!to.value.trim() || !txt.value.trim()) return;
  try{
    await aprsPost('/send', {to: to.value, text: txt.value});
    txt.value = '';
    cargarAprs();
  }catch(e){ alert('No se pudo enviar: ' + e.message); }
}
document.getElementById('aprs-send').addEventListener('click', aprsEnviar);
document.getElementById('aprs-txt').addEventListener('keydown', e => { if(e.key === 'Enter') aprsEnviar(); });
document.getElementById('aprs-msglist').addEventListener('click', e => {
  const p = e.target.closest('.aprs-peer');
  if(p){ document.getElementById('aprs-to').value = p.dataset.call; document.getElementById('aprs-txt').focus(); }
});
/* ---- APRS: orden de la tabla de estaciones ---- */
let aprsEstLista = [];
let aprsBusq = '';
let aprsMapa = 'osm';
try{ aprsMapa = localStorage.getItem('pcbox-aprs-mapa') || 'osm'; }catch(e){}
function aprsUrlMapa(e){
  if(aprsMapa === 'aprsfi') return 'https://aprs.fi/#!call=a%2F' + encodeURIComponent(e.call);
  if(aprsMapa === 'google') return 'https://www.google.com/maps?q=' + e.lat + ',' + e.lon;
  return 'https://www.openstreetmap.org/?mlat=' + e.lat + '&amp;mlon=' + e.lon + '#map=14/' + e.lat + '/' + e.lon;
}
let aprsOrden = (function(){
  try{
    const o = JSON.parse(localStorage.getItem('pcbox-aprs-orden'));
    if(o && ['call','dist','hace'].includes(o.k) && ['asc','desc'].includes(o.d)) return o;
  }catch(e){}
  return {k: 'hace', d: 'asc'};
})();
function aprsFlechas(){
  document.querySelectorAll('[data-aprs-sort]').forEach(th => {
    th.querySelector('.aprs-flecha').textContent =
      th.dataset.aprsSort === aprsOrden.k ? (aprsOrden.d === 'asc' ? ' ▲' : ' ▼') : '';
  });
}
function aprsPintarEst(){
  const k = aprsOrden.k, f = aprsOrden.d === 'asc' ? 1 : -1;
  const lista = aprsEstLista.slice().sort((a, b) => {
    if(k === 'call') return f * a.call.localeCompare(b.call);
    if(k === 'dist') return f * (a.dist_km - b.dist_km);
    return f * (a.hace_s - b.hace_s);
  });
  aprsFlechas();
  document.getElementById('aprs-est-body').innerHTML = lista.length ? lista.map(e =>
    '<tr><td class="lh-call"><a href="' + aprsUrlMapa(e) + '" class="aprs-ver" data-call="' + aprsEsc(e.call) + '" data-lat="' + e.lat + '" data-lon="' + e.lon + '" data-dist="' + e.dist_km + '" title="Ver la ubicación en un recuadro (Cmd/Ctrl + clic: pestaña nueva)" style="color:inherit;text-decoration:underline dotted">' + aprsEsc(e.call) + '</a></td><td>' + e.dist_km + ' km</td><td>' +
    aprsHace(e.hace_s) + '</td><td>' + aprsEsc(e.comentario) + '</td></tr>').join('')
    : '<tr><td colspan="4" class="lh-empty">' + (aprsBusq ? 'Sin estaciones con ese indicativo (dentro del radio y de las últimas horas)' : 'Sin estaciones escuchadas todavía') + '</td></tr>';
}
document.querySelectorAll('[data-aprs-sort]').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.aprsSort;
  aprsOrden = {k: k, d: (aprsOrden.k === k && aprsOrden.d === 'asc') ? 'desc' : 'asc'};
  localStorage.setItem('pcbox-aprs-orden', JSON.stringify(aprsOrden));
  aprsPintarEst();
}));
aprsFlechas();
(function(){
  const inp = document.getElementById('aprs-q'); let t = null;
  inp.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if(aprsTab !== 'est'){ aprsTab = 'est'; localStorage.setItem('pcbox-aprs-tab', aprsTab); aprsMarcarTab(); }
      cargarAprs();
    }, 300);
  });
})();

(function(){
  const b = document.getElementById('apc-desde-clima');
  if(!b) return;
  b.addEventListener('click', () => {
    let o = null;
    try{ o = JSON.parse(localStorage.getItem('pcbox-sys-wx-loc') || 'null'); }catch(e){}
    if(!o || !isFinite(o.lat) || !isFinite(o.lon)){ alert('Primero define la ciudad del clima en la Configuración (Sistema).'); return; }
    document.getElementById('apc-lat').value = Number(o.lat).toFixed(5);
    document.getElementById('apc-lon').value = Number(o.lon).toFixed(5);
  });
})();

(function(){
  const sel = document.getElementById('aprs-mapa');
  if(!sel) return;
  sel.value = aprsMapa;
  sel.addEventListener('change', () => {
    aprsMapa = sel.value;
    try{ localStorage.setItem('pcbox-aprs-mapa', aprsMapa); }catch(e){}
    aprsPintarEst();
  });
})();

/* ---- APRS: borrar mensajes ---- */
document.getElementById('aprs-msglist').addEventListener('click', async e => {
  const x = e.target.closest('.aprs-del');
  if(!x) return;
  try{ await aprsPost('/messages/delete', {ids: [parseInt(x.dataset.id, 10)]}); }
  catch(err){ alert('No se pudo borrar: ' + err.message); }
  cargarAprs();
});
document.getElementById('aprs-borrar-todo').addEventListener('click', async () => {
  if(!confirm('¿Borrar todos los mensajes APRS (enviados y recibidos)?')) return;
  try{ await aprsPost('/messages/delete', {all: true}); }
  catch(err){ alert('No se pudo borrar: ' + err.message); }
  cargarAprs();
});

async function cargarAprs(){
  const meta = document.getElementById('aprs-meta');
  try{
    const s = await getJSON(EP.aprs + '/status');
    aprsEstado = s;
    const ok = s.conectado && s.verificado;
    const color = ok ? '#39ff14' : (s.conectado ? '#ffb300' : '#ff1744');
    const texto = ok ? 'CONECTADO' : (s.conectado ? 'SIN VERIFICAR' : 'DESCONECTADO');
    meta.innerHTML = '<span style="color:' + color + ';font-weight:700">' + texto + '</span> · ' +
      aprsIcono() + aprsEsc(s.indicativo) + ' · ' + s.estaciones + ' estaciones (' + s.radio_km + ' km)' +
      (s.nodo ? ' · nodo <b class="aprs-nodo">' + aprsEsc(s.nodo) + '</b>' : '');
    const nd = meta.querySelector('.aprs-nodo'), tit = document.querySelector('#aprs .card-title');
    if(nd && tit) nd.style.fontSize = getComputedStyle(tit).fontSize;
    const bal = document.getElementById('aprs-bal');
    bal.textContent = 'Baliza: ' + (s.baliza.activa ? 'ON · cada ' + s.baliza.intervalo_min + ' min' : 'OFF') +
      (s.baliza.ultima ? ' · última ' + new Date(s.baliza.ultima * 1000).toLocaleTimeString('es-CL', {hour: '2-digit', minute: '2-digit', hour12: false}) : '');
    bal.classList.toggle('on', s.baliza.activa);
    document.getElementById('aprs-badge').textContent = s.sin_leer ? '(' + s.sin_leer + ')' : '';
    const nav = document.querySelector('[data-view="aprs"]');
    if(nav) nav.textContent = 'APRS' + (s.sin_leer ? ' (' + s.sin_leer + ')' : '');
    if(document.getElementById('aprs').classList.contains('hidden')) return;
    if(aprsTab === 'est'){
      const qb = (document.getElementById('aprs-q').value || '').trim().toUpperCase();
      aprsBusq = qb;
      aprsEstLista = await getJSON(EP.aprs + '/stations?limit=200' + (qb ? '&q=' + encodeURIComponent(qb) : ''));
      aprsPintarEst();
    }else{
      const ms = await getJSON(EP.aprs + '/messages');
      const lista = document.getElementById('aprs-msglist');
      const abajo = lista.scrollTop + lista.clientHeight >= lista.scrollHeight - 20;
      lista.innerHTML = ms.length ? ms.map(m => {
        const hora = (typeof aprsFechaHora === 'function') ? aprsFechaHora(m.ts) : new Date(m.ts * 1000).toLocaleTimeString('es-CL', {hour: '2-digit', minute: '2-digit'});
        const est = m.dir === 'out'
          ? ' <span style="opacity:.6">(' + aprsEsc(m.estado) + (m.estado === 'pendiente' ? ' ' + m.intentos + '/6' : '') + ')</span>' : '';
        return '<div style="padding:3px 0"><span style="opacity:.6">' + hora + '</span> ' + (m.dir === 'in' ? '←' : '→') + aprsOrigen(m) +
          ' <b class="aprs-peer" data-call="' + aprsEsc(m.peer) + '" style="cursor:pointer">' + aprsEsc(m.peer) + '</b>: ' +
          aprsLink(m.text) + est + ' <span class="aprs-del" data-id="' + m.id + '" title="Borrar" style="cursor:pointer;opacity:.5;margin-left:6px">✕</span></div>';
      }).join('') : '<div class="lh-empty">Sin mensajes</div>';
      if(abajo) lista.scrollTop = lista.scrollHeight;
      if(s.sin_leer) aprsPost('/messages/read').catch(() => {});
    }
  }catch(e){
    meta.innerHTML = '<span style="color:#ff1744;font-weight:700">SIN SERVICIO</span>';
  }
}
aprsMarcarTab();
cargarAprs();
(function aprsLoop(){ setTimeout(() => { if(!document.hidden) cargarAprs(); aprsLoop(); }, aprsRefreshMs); })();

/* ---- APRS: ubicación de la estación en un recuadro (como Sismos, Satélites y RadioID), no en una pestaña nueva ---- */
(function(){
  var box = null;
  function armar(){
    box = document.createElement('div');
    box.id = 'aprs-modal';
    box.style.cssText = 'display:none;position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.65);align-items:center;justify-content:center';
    box.innerHTML = '<div style="position:relative;width:min(94vw,900px);height:min(86vh,640px);background:#101418;border:2px solid #4d7cff;border-radius:10px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.6)">' +
      '<div style="position:absolute;left:10px;top:8px;z-index:2;color:#fff;font:13px system-ui;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:4px" id="aprs-ttl"></div>' +
      '<div style="position:absolute;right:8px;top:6px;z-index:2;display:flex;gap:8px;align-items:center">' +
      '<a id="aprs-tab" target="_blank" rel="noopener" title="Abrir en una pestaña nueva" style="color:#fff;font:13px system-ui;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:4px;text-decoration:none;cursor:pointer">↗ pestaña</a>' +
      '<button type="button" id="aprs-x" title="Cerrar (Esc)" style="background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:4px;cursor:pointer;padding:2px 9px;font-size:15px">✕</button></div>' +
      '<iframe id="aprs-if" style="width:100%;height:100%;border:0"></iframe></div>';
    document.body.appendChild(box);
    box.addEventListener('click', function(e){ if(e.target === box || e.target.id === 'aprs-x') cerrar(); });
  }
  function cerrar(){ if(!box) return; box.style.display = 'none'; box.querySelector('#aprs-if').removeAttribute('srcdoc'); box.querySelector('#aprs-if').src = 'about:blank'; }
  function leafletDoc(lat, lon, call){
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">' +
      '<style>html,body,#m{height:100%;margin:0}</style></head><body><div id="m"></div>' +
      '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><' + '/script><script>' +
      'var m=L.map("m",{zoomControl:false}).setView([' + lat + ',' + lon + '],14);' +
      'L.control.zoom({position:"bottomright"}).addTo(m);' +
      'L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap"}).addTo(m);' +
      'L.marker([' + lat + ',' + lon + '])' + (call ? '.addTo(m).bindTooltip(' + JSON.stringify(call).replace(/</g, '\\u003c') + ',{permanent:true,direction:"top"})' : '.addTo(m)') + ';' +
      '<' + '/script></body></html>';
  }
  /* APRSZOOM */
  function embebido(lat, lon){
    if(aprsMapa === 'google') return 'https://maps.google.com/maps?q=' + lat + ',' + lon + '&z=14&output=embed';
    var dx = 0.02, dy = 0.012;
    return 'https://www.openstreetmap.org/export/embed.html?bbox=' +
      [lon - dx, lat - dy, lon + dx, lat + dy].map(function(n){ return n.toFixed(5); }).join('%2C') + '&layer=mapnik&marker=' + lat + '%2C' + lon;
  }
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && box && box.style.display !== 'none'){ cerrar(); e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('click', function(ev){
    var a = ev.target.closest && ev.target.closest('a.aprs-ver');
    if(!a) return;
    if(ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
    var lat = parseFloat(a.dataset.lat), lon = parseFloat(a.dataset.lon);
    if(!isFinite(lat) || !isFinite(lon)) return;
    ev.preventDefault();
    if(!box) armar();
    var fr = box.querySelector('#aprs-if');
    if(typeof aprsMapa !== 'undefined' && aprsMapa === 'google'){ fr.removeAttribute('srcdoc'); fr.src = embebido(lat, lon); }
    else fr.srcdoc = leafletDoc(lat, lon, a.dataset.call || '');
    box.querySelector('#aprs-tab').href = a.href;
    box.querySelector('#aprs-ttl').textContent = (a.dataset.call || '') + (a.dataset.dist ? ' · ' + a.dataset.dist + ' km' : '');
    box.style.display = 'flex';
  });
  window.aprsVerMapa = function(call, lat, lon, dist){
    var t = document.createElement('a'); t.className = 'aprs-ver'; t.dataset.call = call; t.dataset.lat = lat; t.dataset.lon = lon;
    if(dist != null) t.dataset.dist = dist;
    t.href = aprsUrlMapa({call: call, lat: lat, lon: lon}); t.style.display = 'none'; document.body.appendChild(t); t.click(); t.remove();
  };
})();
