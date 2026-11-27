/* botc - Bot de concursos APRS (pieza de DMRShack). Todo este archivo se ejecuta junto: lo que otras partes
   del dashboard necesiten debe ser function o var (const/let quedan locales). */

/* ---------- BOT APRS (CONCURSO) ---------- */
const BOT_API = location.origin + '/api/aprs/bot';
window.BOT_API = BOT_API;      // otras piezas (ej. APRS) pueden usarla
function botMsg(t){ const m = document.getElementById('bot-msg'); m.textContent = t; setTimeout(() => { if(m.textContent === t) m.textContent = ''; }, 8000); }
async function botCargar(){
  const est = document.getElementById('bot-estado');
  try{
    const d = await (await fetch(BOT_API)).json();
    const c = d.config, act = document.activeElement;
    const set = (id, v) => { const e = document.getElementById(id); if(act !== e) e.value = v; };
    if(act !== document.getElementById('bot-on')) document.getElementById('bot-on').checked = !!c.enabled;
    set('bot-nombre', c.nombre || ''); set('bot-max', c.max_por_dia || 200);
    set('bot-ini', c.inicio || ''); set('bot-fin', c.fin || '');
    set('bot-palabras', (c.palabras || []).join('\n'));
    set('bot-ok', c.resp_ok || ''); set('bot-okm', c.resp_ok_manual || ''); set('bot-dup', c.resp_dup || '');
    set('bot-preg', c.resp_pregunta || ''); set('bot-mailok', c.resp_mail_ok || ''); set('bot-no', c.resp_no || ''); set('bot-mal', c.resp_mal || ''); set('bot-fuera', c.resp_fuera || '');
    if(act !== document.getElementById('bot-auto')) document.getElementById('bot-auto').checked = !!c.auto;
    set('bot-qfreq', c.q_freq || ''); set('bot-qband', c.q_band || ''); set('bot-qmode', c.q_mode || '');
    set('bot-qrs', c.q_rst_s || ''); set('bot-qrr', c.q_rst_r || ''); set('bot-qcom', c.q_comments || '');
    est.textContent = d.estado + ' · participantes registrados: ' + d.total; botAjustar(); if(typeof botRequisitos === 'function') botRequisitos();
    document.getElementById('bot-body').innerHTML = d.participantes.length ? d.participantes.map(p =>
      '<tr><td class="lh-call">' + qcEsc(p.call) + '</td><td>' + qcEsc(p.peer) + '</td><td>' +
      qcEsc(new Date(p.ts * 1000).toLocaleString('es-CL')) + '</td><td>' + qcEsc(p.texto) + '</td><td>' + botBadge(p) + '</td></tr>').join('')
      : '<tr><td colspan="5" class="lh-empty">Sin participantes</td></tr>';
  }catch(e){ est.textContent = 'Sin conexión con el servicio APRS (puerto 5014).'; }
}
document.getElementById('bot-guardar').addEventListener('click', async () => {
  const v = id => document.getElementById(id).value;
  try{
    const r = await fetch(BOT_API, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({enabled: document.getElementById('bot-on').checked, nombre: v('bot-nombre'),
        palabras: v('bot-palabras'), inicio: v('bot-ini'), fin: v('bot-fin'), resp_ok: v('bot-ok'), resp_ok_manual: v('bot-okm'),
        resp_dup: v('bot-dup'), max_por_dia: v('bot-max'),
        resp_pregunta: v('bot-preg'), resp_mail_ok: v('bot-mailok'), resp_no: v('bot-no'), resp_mal: v('bot-mal'), resp_fuera: v('bot-fuera'),
        auto: document.getElementById('bot-auto').checked, q_freq: v('bot-qfreq'), q_band: v('bot-qband'),
        q_mode: v('bot-qmode'), q_rst_s: v('bot-qrs'), q_rst_r: v('bot-qrr'), q_comments: v('bot-qcom')})});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    botMsg('Guardado'); botCargar();
  }catch(e){ botMsg('Error: ' + e.message); }
});
document.getElementById('bot-actualizar').addEventListener('click', botCargar);
document.getElementById('bot-reset').addEventListener('click', async () => {
  if(!confirm('¿Borrar la lista de participantes de este concurso? Podrán volver a registrarse. La cola QSL no se toca.')) return;
  try{ await fetch(BOT_API + '/reset', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({all: true})}); botMsg('Participantes borrados'); botCargar(); }
  catch(e){ botMsg('Error: ' + e.message); }
});

/* ---------- AGENDA DEL BOT ---------- */
let agData = [], agVig = null, agDirty = false, agEdit = -1, agImg = '';
const agEl = id => document.getElementById(id);
function agMsg(t){ const m = agEl('ag-msg'); m.textContent = t; setTimeout(() => { if(m.textContent === t) m.textContent = ''; }, 8000); }
function agFmt(s){ return String(s || '').replace('T', ' '); }
function agPintar(){
  agData.sort((a, b) => a.inicio < b.inicio ? -1 : 1);
  agEl('ag-body').innerHTML = agData.length ? agData.map((a, i) =>
    '<tr><td>' + (a.id === agVig ? '● ' : '') + qcEsc(a.nombre) + '</td><td>' + qcEsc(agFmt(a.inicio)) + '</td><td>' + qcEsc(agFmt(a.fin)) +
    '</td><td>' + qcEsc((a.palabras || []).join(', ')) + '</td><td>' +
    (a.img ? '<img src="' + BOT_API + '/img/' + qcEsc(a.img) + '" style="height:34px;border-radius:3px">' : '—') +
    '</td><td>' + (a.participantes == null ? '' : a.participantes) + '</td><td><button class="qsl-btn" data-ag-ed="' + i +
    '">Editar</button> <button class="qsl-btn danger" data-ag-del="' + i + '">Quitar</button></td></tr>').join('')
    : '<tr><td colspan="7" class="lh-empty">Sin actividades programadas: el bot usa la configuración de abajo</td></tr>';
  const v = agData.find(a => a.id === agVig);
  agEl('ag-estado').textContent = (agData.length ? (v ? 'Vigente ahora: ' + v.nombre : 'Ninguna actividad vigente en este momento') : '') +
    (agDirty ? ' · CAMBIOS SIN GUARDAR' : '');
}
async function agCargar(force){
  if(agDirty && !force) return;
  try{
    const d = await (await fetch(BOT_API + '/agenda')).json();
    agData = d.actividades || []; agVig = d.vigente; agDirty = false; agPintar();
  }catch(e){ agMsg('Sin conexión con el servicio APRS'); }
}
function agLimpiarForm(){
  ['ag-nombre', 'ag-ini', 'ag-fin', 'ag-pal', 'ag-qfreq', 'ag-qband', 'ag-qmode', 'ag-qcom'].forEach(id => agEl(id).value = '');
  agEdit = -1; agImg = ''; agEl('ag-imgprev').style.display = 'none'; agEl('ag-add').textContent = 'Agregar actividad';
}
function agForm(){
  const v = id => agEl(id).value.trim();
  const a = {nombre: v('ag-nombre'), inicio: v('ag-ini'), fin: v('ag-fin'),
    palabras: agEl('ag-pal').value.split('\n').map(s => s.trim()).filter(Boolean),
    q_freq: v('ag-qfreq'), q_band: v('ag-qband'), q_mode: v('ag-qmode'), q_comments: v('ag-qcom'), img: agImg};
  if(!a.nombre || !a.inicio || !a.fin || !a.palabras.length){ agMsg('Faltan nombre, inicio, fin o palabras'); return null; }
  if(a.fin <= a.inicio){ agMsg('El fin debe ser posterior al inicio'); return null; }
  return a;
}
function agNuevoId(){ return 'a' + Math.random().toString(36).slice(2, 8); }
function agDesplazar(s, dias){
  const m = s.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/), d = new Date(+m[1], +m[2] - 1, +m[3] + dias, +m[4], +m[5]), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
agEl('ag-add').addEventListener('click', () => {
  const a = agForm(); if(!a) return;
  if(agEdit >= 0){ a.id = agData[agEdit].id; agData[agEdit] = a; } else { a.id = agNuevoId(); agData.push(a); }
  agDirty = true; agLimpiarForm(); agPintar();
});
agEl('ag-cancel').addEventListener('click', agLimpiarForm);
agEl('ag-imgquitar').addEventListener('click', () => { agImg = ''; agEl('ag-imgprev').style.display = 'none'; });
agEl('ag-img').addEventListener('change', async e => {
  const f = e.target.files[0]; if(!f) return;
  agMsg('Subiendo imagen…');
  try{
    const r = await fetch(BOT_API + '/agenda/img', {method: 'POST', body: f});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    agImg = d.img; const p = agEl('ag-imgprev'); p.src = BOT_API + '/img/' + d.img; p.style.display = '';
    agMsg('Imagen lista: se aplica al agregar la actividad');
  }catch(err){ agMsg('Error: ' + err.message); }
  e.target.value = '';
});
agEl('ag-serie').addEventListener('click', () => {
  const a = agForm(); if(!a) return;
  const step = parseInt(agEl('ag-step').value, 10), cant = parseInt(agEl('ag-cant').value, 10);
  if(!(step >= 1 && step <= 60) || !(cant >= 1 && cant <= 60)){ agMsg('Cada 1 a 60 días, cantidad de 1 a 60'); return; }
  if(agData.length + cant > 120){ agMsg('Máximo 120 actividades'); return; }
  for(let k = 0; k < cant; k++){
    const n = k + 1, rep = t => t.replace(/\{n\}/g, n);
    agData.push({id: agNuevoId(), nombre: (a.nombre.indexOf('{n}') >= 0 ? rep(a.nombre) : a.nombre + ' ' + n).slice(0, 40),
      inicio: agDesplazar(a.inicio, k * step), fin: agDesplazar(a.fin, k * step), palabras: a.palabras.map(rep),
      q_freq: a.q_freq, q_band: a.q_band, q_mode: a.q_mode, q_comments: a.q_comments, img: a.img});
  }
  agDirty = true; agLimpiarForm(); agPintar(); agMsg(cant + ' actividades agregadas: revisa y pulsa Guardar agenda');
});
agEl('ag-body').addEventListener('click', e => {
  const ed = e.target.dataset.agEd, del = e.target.dataset.agDel;
  if(ed !== undefined){
    const a = agData[+ed]; agEdit = +ed;
    agEl('ag-nombre').value = a.nombre; agEl('ag-ini').value = a.inicio; agEl('ag-fin').value = a.fin;
    agEl('ag-pal').value = (a.palabras || []).join('\n'); agEl('ag-qfreq').value = a.q_freq || ''; agEl('ag-qband').value = a.q_band || '';
    agEl('ag-qmode').value = a.q_mode || ''; agEl('ag-qcom').value = a.q_comments || ''; agImg = a.img || '';
    const p = agEl('ag-imgprev'); if(agImg){ p.src = BOT_API + '/img/' + agImg; p.style.display = ''; } else p.style.display = 'none';
    agEl('ag-add').textContent = 'Actualizar actividad';
  } else if(del !== undefined){
    if(!confirm('¿Quitar «' + agData[+del].nombre + '»? Se aplica al guardar la agenda.')) return;
    agData.splice(+del, 1); agDirty = true; agLimpiarForm(); agPintar();
  }
});
agEl('ag-guardar').addEventListener('click', async () => {
  try{
    const r = await fetch(BOT_API + '/agenda', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({actividades: agData})});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    agMsg('Agenda guardada (' + d.total + ' actividades)'); await agCargar(true); botCargar();
  }catch(e){ agMsg('Error: ' + e.message); }
});
agEl('ag-descartar').addEventListener('click', () => { agLimpiarForm(); agCargar(true); });

/* ---------- VISTA BOT (menú) ---------- */
(function(){
  const cont = document.getElementById('botc-cont'), card = document.getElementById('botc');
  if(!cont || !card) return;
  const fila = id => { const e = document.getElementById(id); return e ? e.closest('.qsl-field-row') : null; };
  ['bot-ini', 'bot-palabras', 'bot-qfreq', 'bot-qcom'].forEach(id => { const f = fila(id); if(f) f.classList.add('bot-solo-unico'); });
  const kids = Array.from(cont.querySelectorAll('.qsl-config > *'));
  const i0 = kids.findIndex(k => k.classList.contains('qsl-section-label') && k.textContent.indexOf('Agenda') === 0);
  const i1 = kids.indexOf(agEl('ag-guardar').closest('.qsl-field-row'));
  if(i0 >= 0 && i1 >= i0) kids.slice(i0, i1 + 1).forEach(k => k.classList.add('bot-solo-agenda'));
  const st = document.createElement('style');
  st.textContent = '#botc.bot-modo-unico .bot-solo-agenda{display:none !important}#botc.bot-modo-agenda .bot-solo-unico{display:none !important}';
  document.head.appendChild(st);
  function modo(m, guardar){
    card.classList.toggle('bot-modo-unico', m === 'unico'); card.classList.toggle('bot-modo-agenda', m === 'agenda');
    document.querySelectorAll('#botc-tabs [data-botmodo]').forEach(b => b.classList.toggle('on', b.dataset.botmodo === m));
    if(guardar){ try{ localStorage.setItem('pcbox-bot-modo', m); }catch(e){} }
  }
  document.getElementById('botc-tabs').addEventListener('click', e => { const m = e.target.dataset.botmodo; if(m) modo(m, true); });
  let guardado = null; try{ guardado = localStorage.getItem('pcbox-bot-modo'); }catch(e){}
  modo(guardado || 'unico', false);
  const nav = document.querySelector('.nav button[data-view="botc"]');
  async function abrir(){
    botCargar();
    await agCargar(false);
    let g = null; try{ g = localStorage.getItem('pcbox-bot-modo'); }catch(e){}
    if(!g && agData.length) modo('agenda', false);
  }
  if(nav) nav.addEventListener('click', abrir);
  if(!card.classList.contains('hidden')) abrir();
  const ml = document.createElement('a');
  ml.className = 'man-link'; ml.href = 'manuales/index.html#bot'; ml.target = '_blank';
  ml.textContent = 'Ver manual de esta sección ↗';
  ml.style.cssText = 'display:inline-block;margin:0 0 10px;font-size:12px;color:var(--amber)';
  const cb = document.querySelector('#botc .card-body');
  if(cb) cb.insertBefore(ml, cb.firstChild);
})();
function botAjustar(){
  document.querySelectorAll('.bot-msg').forEach(function(t){
    t.style.height = 'auto';
    if(t.scrollHeight > 0) t.style.height = (t.scrollHeight + (t.offsetHeight - t.clientHeight)) + 'px';
  });
}
(function(){
  var st = document.createElement('style');
  st.textContent = '.bot-msg{width:100%;box-sizing:border-box;resize:none;overflow:hidden;line-height:1.35;min-height:0}';
  document.head.appendChild(st);
  document.addEventListener('input', function(e){ if(e.target.classList && e.target.classList.contains('bot-msg')) botAjustar(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Enter' && e.target.classList && e.target.classList.contains('bot-msg')) e.preventDefault(); });
  window.addEventListener('resize', botAjustar);
})();

/* ---------- REQUISITOS Y ESTADOS ---------- */
function botBadge(p){ return '<span class="bot-st bot-st-' + qcEsc(p.cod || 'otro') + '">' + qcEsc(p.qsl || 'nuevo') + '</span>'; }
async function botRequisitos(){
  const box = document.getElementById('bot-req'); if(!box) return;
  try{
    const d = await (await fetch(BOT_API + '/requisitos')).json();
    box.textContent = '';
    const t = document.createElement('div'); t.style.cssText = 'font-weight:600;margin-bottom:2px';
    t.textContent = d.errores ? 'Requisitos: ' + d.errores + ' con problema' : (d.avisos ? 'Requisitos: lo esencial en orden (' + d.avisos + ' aviso(s))' : 'Requisitos: todo en orden');
    box.appendChild(t);
    d.checks.forEach(c => {
      const f = document.createElement('div'); f.className = 'rq ' + c.nivel;
      const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = c.nivel === 'ok' ? '✓' : (c.nivel === 'aviso' ? '!' : '✗');
      const n = document.createElement('b'); n.textContent = c.nombre;
      const x = document.createElement('span'); x.className = 'tx'; x.textContent = c.texto;
      f.appendChild(ic); f.appendChild(n); f.appendChild(x);
      if(c.tab && c.tab !== 'bot' && c.nivel !== 'ok'){
        const a = document.createElement('a'); a.textContent = 'abrir';
        a.onclick = () => { const b = document.querySelector('[data-cfg="' + c.tab + '"]'); if(b) b.click(); };
        f.appendChild(a);
      }
      box.appendChild(f);
    });
  }catch(e){ box.textContent = 'No se pudieron consultar los requisitos.'; }
}

/* ---------- RESUMEN DEL CONCURSO EN LA TARJETA APRS ---------- */
(function(){
  const box = document.getElementById('aprs-conc'); if(!box) return;
  const API = BOT_API.replace(/\/bot$/, '');
  let vista = null, ultimo = null, msgsPend = [], part = [];
  const el = (tag, txt, css) => { const e = document.createElement(tag); if(txt != null) e.textContent = txt; if(css) e.style.cssText = css; return e; };
  const irConfig = () => {
    try{
      const nav = document.querySelector('.nav button[data-view="botc"]');
      if(nav) nav.click();
      window.scrollTo(0, 0);
    }catch(e){ alert('No se pudo abrir el bot: ' + e.message); }
  };
  async function cargarPart(){
    try{ part = (await (await fetch(BOT_API)).json()).participantes || []; }catch(e){ part = []; }
  }
  async function abrir(clave){
    vista = (vista === clave) ? null : clave;
    if(vista && vista !== 'msgs') await cargarPart();
    pintar();
  }
  function contador(txt, n, clave, rojo){
    if(!n) return el('span', txt + ' 0', 'opacity:.55');
    const a = el('a', txt + ' ' + n, 'color:' + (rojo ? '#ff5d5d' : '#ffb300'));
    a.title = 'Ver el detalle'; a.onclick = () => abrir(clave); return a;
  }
  function detalle(){
    const L = el('div'); L.className = 'aprs-conc-lista';
    if(vista === 'msgs'){
      if(!msgsPend.length) L.appendChild(el('span', 'Sin mensajes pendientes de enviar', 'opacity:.7'));
      msgsPend.forEach(m => L.appendChild(el('span', aprsFechaHora(m.ts) + ' → ' + m.peer + ': ' + m.text + ' (pendiente ' + m.intentos + '/6)')));
    }else{
      const grupos = {en_cola: ['en_cola', 'enviando'], esperando_correo: ['esperando_correo'], sin_correo: ['sin_correo'], error: ['error']};
      const g = grupos[vista];
      const filas = part.filter(p => !g || g.indexOf(p.cod) >= 0);
      if(!filas.length) L.appendChild(el('span', 'Nada en esta lista', 'opacity:.7'));
      filas.forEach(p => {
        const f = el('span'); f.appendChild(el('b', p.call));
        f.appendChild(el('span', ' ' + p.peer + ' · ' + aprsFechaHora(p.ts) + ' ', 'opacity:.7'));
        const b = el('span', p.qsl || 'nuevo'); b.className = 'bot-st bot-st-' + (p.cod || 'otro'); f.appendChild(b); L.appendChild(f);
      });
      if(!g) L.appendChild(el('span', 'Se muestran los últimos 30 participantes', 'opacity:.55;font-size:.9em'));
    }
    box.appendChild(L);
  }
  function pintar(){
    box.textContent = '';
    if(!ultimo){ box.style.display = 'none'; return; }
    box.style.display = '';
    const d = ultimo, c = d.conteo || {}, col = d.estado === 'activo' ? '#39ff14' : (d.estado === 'apagado' ? '#9aa5b1' : '#ffb300');
    box.appendChild(el('span', 'Concurso', 'font-weight:600'));
    box.appendChild(el('span', d.estado, 'color:' + col + ';font-weight:600'));
    if(d.estado !== 'apagado'){
      box.appendChild(el('span', 'hoy ' + d.hoy));
      box.appendChild(el('span', 'total ' + d.total));
      if(d.ultimos.length) box.appendChild(el('span', 'último ' + d.ultimos[0].call + ' ' + aprsFechaHora(d.ultimos[0].ts), 'opacity:.8'));
    }
    box.appendChild(contador('msgs por enviar', msgsPend.length, 'msgs'));
    box.appendChild(contador('QSL en cola', (c.en_cola || 0) + (c.enviando || 0), 'en_cola'));
    box.appendChild(contador('esperando correo', c.esperando_correo || 0, 'esperando_correo'));
    if(c.sin_correo) box.appendChild(contador('sin correo', c.sin_correo, 'sin_correo'));
    if(c.error) box.appendChild(contador('con error', c.error, 'error', true));
    if(d.errores){ const w = el('a', '⚠ ' + d.errores + ' requisito(s) con problema', 'color:#ff5d5d'); w.onclick = irConfig; box.appendChild(w); }
    const a = el('a', vista === 'todos' ? 'ocultar lista ▴' : 'ver lista ▾'); a.onclick = () => abrir('todos'); box.appendChild(a);
    const cfg = el('a', 'configurar'); cfg.onclick = irConfig; box.appendChild(cfg);
    if(vista) detalle();
  }
  async function cargar(){
    try{ ultimo = await (await fetch(BOT_API + '/resumen')).json(); }catch(e){ ultimo = null; }
    try{ msgsPend = (await (await fetch(API + '/messages')).json()).filter(m => m.dir === 'out' && m.estado === 'pendiente'); }catch(e){ msgsPend = []; }
    if(vista && vista !== 'msgs') await cargarPart();
    pintar();
  }
  cargar(); setInterval(() => { if(!document.hidden) cargar(); }, 30000);
})();

/* ---------- ESTADISTICAS, REGISTRO Y CERTIFICADOS ---------- */
(function(){
  const API = location.origin + '/api/aprs/bot';
  const tabs = document.getElementById('botc-tabs'), cont = document.getElementById('botc-cont');
  if(!tabs || !cont) return;
  const el = id => document.getElementById(id);
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ETQ = {enviada:'✓ QSL enviada', en_cola:'en cola', esperando_correo:'esperando correo', sin_correo:'sin correo', error:'error', enviando:'enviando', nuevo:'nuevo', otro:'otro'};
  const fecha = ts => new Date(ts * 1000).toLocaleString('es-CL', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
  const badge = c => '<span class="bot-st bot-st-' + esc(c.cod || 'otro') + '" title="' + esc(c.qsl) + '">' + esc(ETQ[c.cod] || c.cod) + '</span>';
    const badgeP = (x, call) => x.cod === 'esperando_correo' ? '<span class="bot-st bot-st-esperando_correo" data-edit="' + esc(call) + '" style="cursor:pointer" title="Clic para completar los datos del contacto">esperando correo ✎</span>' : badge(x);
  let D = null, sel = null, conocidas = new Set();

  const st = document.createElement('style');
  st.textContent = '#bst table{width:100%;border-collapse:collapse;font-size:.88em}#bst th,#bst td{padding:4px 8px;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap}#bst tr.bst-ok td{background:rgba(var(--green-rgb),0.10)}#bst td[data-call]{cursor:pointer;color:var(--amber)}#bst details{margin-top:12px}#bst summary{cursor:pointer;color:var(--amber)}';
  document.head.appendChild(st);

  const tab = document.createElement('button');
  tab.type = 'button'; tab.className = 'cfg-tab'; tab.id = 'bst-tab'; tab.textContent = 'Estadísticas';
  tabs.appendChild(tab);

  const panel = document.createElement('div');
  panel.id = 'bst'; panel.style.display = 'none';
  panel.innerHTML =
    '<div class="qsl-field-row">' +
    '<label>Indicativo <input type="text" id="bst-q" autocomplete="off" style="width:110px"></label>' +
    '<label>Mostrar <select id="bst-f"><option value="">Todos</option><option value="completo">Cumplieron todo</option>' +
    '<option value="incompleto">No completaron</option><option value="pend">Con correo pendiente</option>' +
    '<option value="error">Con error de envío</option></select></label>' +
    '<button type="button" class="qsl-btn" id="bst-act">Actualizar</button>' +
    '<button type="button" class="qsl-btn" id="bst-csv">Exportar CSV</button>' +
    '<span id="bst-msg" style="opacity:.8;font-size:0.85em"></span></div>' +
    '<div id="bst-sel" class="qsl-hint"></div><div id="bst-kpi" class="qsl-hint"></div>' +
    '<div style="overflow-x:auto"><table><thead id="bst-head"></thead><tbody id="bst-body"></tbody></table></div>' +
    '<div id="bst-pais" class="qsl-hint"></div>' +
    '<details id="bst-reg"><summary>Registro de actividad (eventos y mensajes)</summary><div id="bst-regc" class="qsl-hint">Cargando…</div></details>';
  cont.parentNode.insertBefore(panel, cont.nextSibling);
  /* BOTMAIL-INICIO */
  const form = document.createElement('div');
  form.id = 'bst-form';
  form.style.cssText = 'display:none;border:1px solid var(--amber);border-radius:6px;padding:10px;margin:10px 0';
  panel.insertBefore(form, el('bst-sel'));
  async function abrirForm(call){
    form.style.display = ''; form.textContent = 'Cargando datos de ' + call + '…';
    let c = {};
    try{ c = await (await fetch(API + '/contacto?call=' + encodeURIComponent(call))).json(); }catch(e){}
    form.innerHTML = '<div class="qsl-section-label">Completar datos de ' + esc(call) + '</div>' +
      '<div class="qsl-field-row">' +
      '<label>Nombre <input type="text" id="bf-name" autocomplete="off" style="width:200px"></label>' +
      '<label>Correo <input type="text" id="bf-mail" autocomplete="off" style="width:240px"></label>' +
      '<label>País <input type="text" id="bf-pais" autocomplete="off" style="width:130px"></label></div>' +
      '<div class="qsl-field-row"><label class="qsl-checkbox"><input type="checkbox" id="bf-env" checked> Enviar la QSL ahora (si el envío automático está activado)</label></div>' +
      '<div class="qsl-field-row"><button type="button" class="qsl-btn primary" id="bf-ok">Guardar</button>' +
      '<button type="button" class="qsl-btn" id="bf-qrz">Buscar en QRZ</button>' +
      '<button type="button" class="qsl-btn" id="bf-no">Cancelar</button>' +
      '<span id="bf-msg" style="opacity:.8;font-size:0.85em"></span></div>';
    el('bf-name').value = c.name || ''; el('bf-mail').value = c.email || ''; el('bf-pais').value = c.country || '';
    el('bf-no').onclick = () => { form.style.display = 'none'; };
    el('bf-qrz').onclick = async () => {
      const m = el('bf-msg'); m.textContent = 'Consultando QRZ…';
      try{
        const q = await (await fetch('http://' + location.hostname + ':5015/api/qrz/lookup?call=' + encodeURIComponent(call))).json();
        if(!q.found){ m.textContent = q.error ? 'QRZ: ' + q.error : 'QRZ no encontró ese indicativo.'; return; }
        if(!el('bf-name').value) el('bf-name').value = q.name || '';
        if(!el('bf-mail').value) el('bf-mail').value = q.email || '';
        if(!el('bf-pais').value) el('bf-pais').value = q.country || '';
        m.textContent = 'Datos de QRZ cargados (revisa antes de guardar).';
      }catch(e){ m.textContent = 'No se pudo consultar QRZ.'; }
    };
    el('bf-ok').onclick = async () => {
      const m = el('bf-msg'); m.textContent = 'Guardando…'; el('bf-ok').disabled = true;
      try{
        const r = await fetch(API + '/contacto', {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({call: call, name: el('bf-name').value, email: el('bf-mail').value, country: el('bf-pais').value, enviar: el('bf-env').checked})});
        const j = await r.json();
        if(!r.ok) throw new Error(j.error || r.status);
        form.style.display = 'none';
        await cargar(true);
        el('bst-msg').textContent = 'Datos de ' + call + ' guardados. ' + (j.enviando ? 'Enviando ' + j.enviando + ' QSL…' : (j.actividades ? j.actividades + ' actividad(es) en cola.' : ''));
        setTimeout(() => cargar(true), 15000);
      }catch(e){
        m.textContent = 'No se pudo guardar: ' + e.message; el('bf-ok').disabled = false;
      }
    };
    el('bf-mail').focus();
  }
  /* BOTMAIL-FIN */


  function mostrar(on){
    panel.style.display = on ? '' : 'none';
    cont.style.display = on ? 'none' : '';
    tab.classList.toggle('on', on);
    if(on){ tabs.querySelectorAll('[data-botmodo]').forEach(b => b.classList.remove('on')); cargar(false); }
  }
  tabs.addEventListener('click', e => {
    if(e.target === tab) mostrar(true);
    else if(e.target.dataset && e.target.dataset.botmodo) mostrar(false);
  });

  function pasa(p){
    const q = el('bst-q').value.trim().toUpperCase(), f = el('bst-f').value;
    if(q && p.call.indexOf(q) < 0) return false;
    const cs = Object.values(p.celdas);
    if(f === 'completo') return p.completo;
    if(f === 'incompleto') return !p.completo;
    if(f === 'pend') return cs.some(c => ['en_cola','esperando_correo','enviando','nuevo'].indexOf(c.cod) >= 0);
    if(f === 'error') return cs.some(c => c.cod === 'error');
    return true;
  }

  function pintar(){
    if(!D) return;
    const cols = D.columnas || [];
    el('bst-sel').innerHTML = (D.todas && D.todas.length)
      ? 'Actividades que cuentan para «cumplió todo»: ' + D.todas.map(a => '<label style="margin-right:12px"><input type="checkbox" data-cid="' + esc(a.cid) + '"' +
          (sel && sel.has(a.cid) ? ' checked' : '') + '> ' + esc(a.nombre) + '</label>').join('')
      : '';
    const e = D.estados || {};
    const pend = (e.en_cola || 0) + (e.enviando || 0) + (e.nuevo || 0);
    el('bst-kpi').innerHTML = '<b>' + D.participantes.length + '</b> participantes · <b style="color:var(--green)">' + D.completos +
      '</b> cumplieron las ' + cols.length + ' actividades · QSL enviadas: ' + (e.enviada || 0) + ' · en cola: ' + pend +
      ' · esperando correo: ' + (e.esperando_correo || 0) + ' · sin correo: ' + (e.sin_correo || 0) + ' · con error: ' + (e.error || 0) +
      (D.cerrada ? '' : '<br>La campaña sigue en curso: «cumplió todo» se confirma al terminar la última actividad.');
    el('bst-head').innerHTML = '<tr><th>Indicativo</th><th>País</th>' + cols.map(c => '<th title="' + esc(c.inicio) + ' → ' + esc(c.fin) + '">' + esc(c.nombre) + '</th>').join('') +
      '<th>Actividades</th><th>Cumplió</th></tr>';
    const filas = D.participantes.filter(pasa);
    el('bst-body').innerHTML = filas.length ? filas.map(p =>
      '<tr class="' + (p.completo ? 'bst-ok' : '') + '"><td data-call="' + esc(p.call) + '"><b>' + esc(p.call) + '</b></td><td>' + esc(p.pais || '—') + '</td>' +
      cols.map(c => { const x = p.celdas[c.cid]; return '<td>' + (x ? badgeP(x, p.call) + ' <span style="opacity:.6">' + fecha(x.ts) + '</span>' : '<span style="opacity:.4">—</span>') + '</td>'; }).join('') +
      '<td>' + p.n + ' de ' + cols.length + '</td><td>' + (p.completo ? '★ Sí' : 'No') + '</td></tr>').join('')
      : '<tr><td colspan="' + (cols.length + 4) + '" style="opacity:.7">Sin participantes con este filtro.</td></tr>';
    const pa = Object.keys(D.paises || {}).sort((a, b) => D.paises[b] - D.paises[a]);
    el('bst-pais').textContent = pa.length ? 'Por país: ' + pa.map(k => k + ' ' + D.paises[k]).join(' · ') : '';
  }

  async function cargar(silencioso){
    const msg = el('bst-msg');
    if(!silencioso) msg.textContent = 'Cargando…';
    try{
      let ids = '';
      if(sel !== null) ids = sel.size ? Array.from(sel).map(c => c.replace(/^act:/, '')).join(',') : 'none';
      const r = await fetch(API + '/stats' + (ids ? '?ids=' + encodeURIComponent(ids) : ''));
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || r.status);
      D = j;
      if(D.todas && D.todas.length){
        const todos = D.todas.map(a => a.cid);
        if(sel === null) sel = new Set(todos);
        else todos.forEach(c => { if(!conocidas.has(c)) sel.add(c); });
        conocidas = new Set(todos);
      }
      msg.textContent = '';
      pintar();
      if(el('bst-reg').open) registro();
    }catch(err){
      msg.textContent = 'No se pudo cargar: ' + err.message;
    }
  }

  async function registro(){
    const q = el('bst-q').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const c = el('bst-regc');
    try{
      const r = await fetch(API + '/registro?limit=200' + (q ? '&call=' + q : ''));
      const j = await r.json();
      const nom = {}; ((D && D.todas) || []).concat((D && D.columnas) || []).forEach(a => { nom[a.cid] = a.nombre; });
      const evt = {participa:'Participó (mensaje válido)', repetido:'Mensaje repetido', correo:'Correo anotado desde el panel'};
      c.innerHTML = '<b>Eventos del bot</b> (desde que se activó este registro)<table><thead><tr><th>Fecha</th><th>Actividad</th><th>Indicativo</th><th>Evento</th></tr></thead><tbody>' +
        (j.eventos.length ? j.eventos.map(x => '<tr><td>' + fecha(x.ts) + '</td><td>' + esc(nom[x.concurso] || x.concurso) + '</td><td>' + esc(x.call) + '</td><td>' +
          esc(x.evento === 'estado' ? x.detalle : (evt[x.evento] || x.evento)) + '</td></tr>').join('') : '<tr><td colspan="4" style="opacity:.7">Sin eventos todavía.</td></tr>') +
        '</tbody></table><br><b>Mensajes recibidos y contestados</b><table><thead><tr><th>Fecha</th><th></th><th>Indicativo</th><th>Texto</th><th>Estado</th></tr></thead><tbody>' +
        (j.mensajes.length ? j.mensajes.map(x => '<tr><td>' + fecha(x.ts) + '</td><td>' + (x.dir === 'in' ? 'Recibido' : 'Enviado') + '</td><td>' + esc(x.peer) + '</td><td style="white-space:normal">' +
          esc(x.text) + '</td><td>' + esc(x.estado) + '</td></tr>').join('') : '<tr><td colspan="5" style="opacity:.7">Sin mensajes.</td></tr>') + '</tbody></table>';
    }catch(err){
      c.textContent = 'No se pudo cargar el registro: ' + err.message;
    }
  }

  function csv(){
    if(!D) return;
    const cols = D.columnas || [];
    const cel = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const filas = [['Indicativo', 'País'].concat(cols.map(c => c.nombre), ['Actividades', 'Cumplió todo'])];
    D.participantes.filter(pasa).forEach(p => filas.push([p.call, p.pais].concat(
      cols.map(c => p.celdas[c.cid] ? p.celdas[c.cid].qsl : ''), [p.n + '/' + cols.length, p.completo ? 'Sí' : 'No'])));
    const blob = new Blob(['\ufeff' + filas.map(f => f.map(cel).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bot-estadisticas-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* REPPAIS-INICIO */
  (function(){
    var ESPEC = [
      ['CA-CE,XQ,XR,3G','Chile','cl'], ['LO-LW,AY,AZ,L2-L9','Argentina','ar'], ['OA-OC,4T','Perú','pe'],
      ['HJ,HK,5J,5K','Colombia','co'], ['XA-XI,4A-4C,6D-6J','México','mx'], ['EA-EH,AM-AO','España','es'],
      ['PP-PY,ZV-ZZ','Brasil','br'], ['YB-YH,JZ,PK-PO,7A-7I,8A-8I','Indonesia','id'], ['9M,9W','Malasia','my'],
      ['CL-CM,CO,T4','Cuba','cu'], ['K,N,W,AA-AL','Estados Unidos','us'], ['KP3,KP4,NP3,NP4,WP3,WP4','Puerto Rico','pr'],
      ['DA-DR','Alemania','de'], ['HC,HD','Ecuador','ec'], ['HQ,HR','Honduras','hn'], ['YV-YY,4M','Venezuela','ve'],
      ['VU,AT-AW,8T-8Y','India','in'], ['CQ-CT','Portugal','pt'], ['CV-CX','Uruguay','uy'], ['DU-DZ,4D-4I','Filipinas','ph'],
      ['TE,TI','Costa Rica','cr'], ['TA-TC,YM','Turquía','tr'], ['SN-SR,HF,3Z','Polonia','pl'], ['CP','Bolivia','bo'],
      ['ZP','Paraguay','py'], ['HO,HP,H3,H8,H9','Panamá','pa'], ['TG,TD','Guatemala','gt'], ['YS,HU','El Salvador','sv'],
      ['YN,HT','Nicaragua','ni'], ['HI','República Dominicana','do'], ['VA-VG,VO,VY,CF-CK,XJ-XO','Canadá','ca'],
      ['F','Francia','fr'], ['I','Italia','it'], ['G,M','Reino Unido','gb'], ['JA-JS,7J-7N,8J-8N','Japón','jp'],
      ['VK','Australia','au'], ['R,UA-UI','Rusia','ru'], ['UR-UZ,EM-EO','Ucrania','ua'], ['B','China','cn'],
      ['HL,DS,DT,6K-6N','Corea del Sur','kr'], ['PA-PI','Países Bajos','nl'], ['ON-OT','Bélgica','be'], ['HB','Suiza','ch'],
      ['OE','Austria','at'], ['SA-SM','Suecia','se'], ['LA-LN','Noruega','no'], ['OU-OZ','Dinamarca','dk'],
      ['OF-OJ','Finlandia','fi'], ['SV-SZ','Grecia','gr'], ['EI,EJ','Irlanda','ie'], ['ZR-ZU','Sudáfrica','za'],
      ['ZL,ZM','Nueva Zelanda','nz']
    ];
    var MAPA = {};
    ESPEC.forEach(function(e){ e[0].split(',').forEach(function(t){
      if(t.indexOf('-') < 0){ MAPA[t] = e; return; }
      var a = t.split('-'), s = a[0], z = a[1].charAt(a[1].length - 1);
      for(var c = s.charCodeAt(s.length - 1); c <= z.charCodeAt(0); c++) MAPA[s.slice(0, -1) + String.fromCharCode(c)] = e;
    }); });
    function paisDe(call){
      var c = String(call || '').toUpperCase().split('-')[0];
      if(c.indexOf('/') >= 0) c = c.split('/').sort(function(x, y){ return y.length - x.length; })[0];
      for(var n = Math.min(3, c.length); n >= 1; n--){ var e = MAPA[c.slice(0, n)]; if(e) return e; }
      return null;
    }
    function datos(){
      var g = {};
      D.participantes.filter(pasa).forEach(function(p){
        var e = paisDe(p.call), k = e ? e[1] : (p.pais || 'Sin dato');
        var o = g[k] || (g[k] = {pais: k, iso: e ? e[2] : '', calls: []});
        o.calls.push(p.call);
      });
      var filas = Object.keys(g).map(function(k){ g[k].calls.sort(); return g[k]; });
      filas.sort(function(a, b){ return b.calls.length - a.calls.length || a.pais.localeCompare(b.pais, 'es'); });
      return {cols: D.columnas || [], filas: filas, total: filas.reduce(function(s, f){ return s + f.calls.length; }, 0)};
    }
    function html(d){
      var tit = d.cols.length ? d.cols.map(function(c){ return esc(String(c.nombre).toUpperCase()); }).join(' · ') : 'ACTIVIDAD APRS';
      var filas = d.filas.map(function(f){
        return '<tr><td class="rp-p">' + (f.iso ? '<img src="https://flagcdn.com/w40/' + f.iso + '.png" alt="" onerror="this.style.visibility=\'hidden\'"> ' : '') + esc(f.pais) +
          '</td><td class="rp-n">' + f.calls.length + '</td><td class="rp-c">' + f.calls.map(esc).join(', ') + '</td></tr>';
      }).join('');
      return '<div class="rp-t1">' + tit + '</div><div class="rp-t2">RADIOAFICIONADOS PARTICIPANTES POR PAÍS (ordenados de mayor a menor)</div>' +
        '<div class="rp-t3">Reporte generado el ' + new Date().toLocaleDateString('es-CL') + '</div>' +
        '<div class="rp-kpi"><div><span>PAÍSES PARTICIPANTES</span><b>' + d.filas.length + '</b></div><div><span>TOTAL RADIOAFICIONADOS</span><b>' + d.total + '</b></div></div>' +
        '<table class="rp-tab"><thead><tr><th>PAÍS</th><th>TOTAL</th><th>LISTA DE RADIOAFICIONADOS (callsign)</th></tr></thead><tbody>' +
        (filas || '<tr><td colspan="3">Sin participantes.</td></tr>') + '</tbody><tfoot><tr><td>TOTAL GENERAL</td><td class="rp-n">' + d.total +
        '</td><td>' + d.total + ' radioaficionados únicos registrados en ' + d.filas.length + ' países</td></tr></tfoot></table>';
    }
    var css = document.createElement('style');
    css.textContent = '#rp-modal{display:none;position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.65);align-items:center;justify-content:center}' +
      '#rp-caja{background:#e6e6e8;color:#0b1d4d;width:min(96vw,1250px);max-height:92vh;overflow:auto;border-radius:10px;border:2px solid #4d7cff;font-family:system-ui,sans-serif}' +
      '#rp-bar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:8px;background:#e6e6e8;z-index:2}' +
      '#rp-bar button{background:#0b2a63;color:#fff;border:0;border-radius:5px;padding:6px 14px;font-size:14px;cursor:pointer}' +
      '#rp-doc{padding:6px 22px 18px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.rp-t1{text-align:center;font-weight:800;font-size:26px;letter-spacing:.5px}.rp-t2{text-align:center;font-weight:700;font-size:16px;margin-top:4px}' +
      '.rp-t3{text-align:center;font-size:13px;opacity:.7;margin:2px 0 10px}' +
      '.rp-kpi{display:flex;border:2px solid #0b2a63;margin-bottom:10px}.rp-kpi div{flex:1;text-align:center;padding:4px}' +
      '.rp-kpi div+div{border-left:1px solid #0b2a63}.rp-kpi span{display:block;font-weight:700;font-size:14px}.rp-kpi b{font-size:30px;color:#e07b5a}' +
      '.rp-tab{width:100%;border-collapse:collapse;font-size:13px;border:2px solid #0b2a63}' +
      '.rp-tab th{background:#0b2a63;color:#fff;text-align:left;padding:6px 8px}.rp-tab td{padding:4px 8px;border-bottom:1px solid #c9c9cc;vertical-align:middle}' +
      '.rp-tab td.rp-p{font-weight:700;white-space:nowrap;width:210px}.rp-tab td.rp-p img{width:26px;height:auto;vertical-align:middle;margin-right:6px;border:1px solid #bbb}' +
      '.rp-tab td.rp-n,.rp-tab th:nth-child(2){text-align:center;width:70px;font-weight:700}.rp-tab td.rp-c{color:#444}' +
      '.rp-tab tfoot td{font-weight:800;border-top:2px solid #0b2a63;background:#dcdce0}.rp-tab tr{page-break-inside:avoid}';
    document.head.appendChild(css);
    function cerrar(){ var m = document.getElementById('rp-modal'); if(m) m.style.display = 'none'; }
    function pdf(){
      var s = document.createElement('style'); s.id = 'rp-print';
      s.textContent = '@page{size:A4 landscape;margin:8mm}@media print{body>*:not(#rp-modal){display:none!important}' +
        '#rp-modal{position:static!important;background:#fff!important;display:block!important}' +
        '#rp-caja{width:auto!important;max-height:none!important;overflow:visible!important;border:0!important}#rp-bar{display:none!important}}';
      document.head.appendChild(s);
      var t0 = document.title; document.title = 'Estadisticas-por-pais-' + new Date().toISOString().slice(0, 10);
      var fin = function(){ var x = document.getElementById('rp-print'); if(x) x.remove(); document.title = t0; window.removeEventListener('afterprint', fin); };
      window.addEventListener('afterprint', fin);
      setTimeout(function(){ window.print(); }, 200);
    }
    function abrir(){
      if(!D){ el('bst-msg').textContent = 'Primero carga las estadísticas (Actualizar).'; return; }
      var m = document.getElementById('rp-modal');
      if(!m){
        m = document.createElement('div'); m.id = 'rp-modal'; document.body.appendChild(m);
        m.addEventListener('click', function(e){ if(e.target === m || e.target.id === 'rp-x') cerrar(); else if(e.target.id === 'rp-pdf') pdf(); });
        document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && m.style.display !== 'none'){ cerrar(); e.stopImmediatePropagation(); } }, true);
      }
      m.innerHTML = '<div id="rp-caja"><div id="rp-bar"><button type="button" id="rp-pdf">📄 PDF</button><button type="button" id="rp-x">✕ Cerrar</button></div><div id="rp-doc">' + html(datos()) + '</div></div>';
      m.style.display = 'flex';
    }
    el('bst-csv').insertAdjacentHTML('afterend', ' <button type="button" class="qsl-btn" id="bst-rep">Reporte por país</button>');
    el('bst-rep').addEventListener('click', abrir);
  })();
  /* REPPAIS-FIN */
  el('bst-act').addEventListener('click', () => cargar(false));
  el('bst-csv').addEventListener('click', csv);
  el('bst-q').addEventListener('input', () => { pintar(); });
  el('bst-f').addEventListener('change', pintar);
  el('bst-sel').addEventListener('change', e => {
    const cid = e.target.dataset && e.target.dataset.cid;
    if(!cid || !sel) return;
    if(e.target.checked) sel.add(cid); else sel.delete(cid);
    cargar(false);
  });
  el('bst-body').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]');
    if(ed){ abrirForm(ed.dataset.edit); return; }
    const call = e.target.closest('td[data-call]');
    if(call){ el('bst-q').value = call.dataset.call; pintar(); el('bst-reg').open = true; registro(); }
  });
  el('bst-reg').addEventListener('toggle', () => { if(el('bst-reg').open) registro(); });
  setInterval(() => { if(panel.style.display !== 'none' && !document.hidden) cargar(true); }, 60000);
})();
