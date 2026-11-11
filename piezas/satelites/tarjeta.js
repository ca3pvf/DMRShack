/* DMRShack · pieza Satélites: estilos y código de la tarjeta, el mapa de ruta y el aviso de pasada */
(function(){ var st = document.createElement('style'); st.id = 'pieza-satelites-css';
  st.textContent = "#sat-banner{position:fixed;top:0;left:0;right:0;z-index:1000;display:none;padding:12px 48px 12px 16px;text-align:center;font-weight:700;\n  font-size:1.05em;color:#fff;background:#d6004c;border-bottom:3px solid #ffd400;box-shadow:0 2px 14px rgba(214,0,76,.6);}\n#sat-banner.on{display:block;animation:satblink 1s step-end infinite;}\n#sat-banner.paso{background:#0a7d2c;border-bottom-color:#7dffb0;box-shadow:0 2px 14px rgba(10,125,44,.6);animation:none;}\n@keyframes satblink{0%{opacity:1}50%{opacity:.3}}\n@media (prefers-reduced-motion:reduce){#sat-banner.on{animation:none;}}\n#sat-banner button{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:1px solid #fff;color:#fff;border-radius:6px;cursor:pointer;padding:2px 9px;}\n#sat-tabla{width:100%;border-collapse:collapse;font-size:0.85em;margin-top:8px;}\n#sat-tabla td,#sat-tabla th{padding:3px 6px;border-bottom:1px solid var(--border);text-align:left;}\n.sat-fila{cursor:pointer}tr.sat-fila:hover,div.sat-fila:hover{background:rgba(127,140,160,.14)}\n#sat-sug{display:none;max-height:190px;overflow:auto;margin:-2px 0 8px;border:1px solid var(--border);border-radius:6px;font-size:.9em}\n#sat-sug div{padding:4px 10px;cursor:pointer}\n#sat-sug div.on,#sat-sug div:hover{background:rgba(255,159,26,.22)}\n#sat-sug small{color:var(--text-dim);margin-left:8px}\n#sat-banner{position:fixed !important;top:50% !important;left:50% !important;right:auto !important;bottom:auto !important;\n  transform:translate(-50%,-50%) !important;width:clamp(300px,60vmin,680px) !important;aspect-ratio:1/0.866 !important;\n  padding:0 !important;margin:0 !important;box-sizing:border-box;border:0 !important;box-shadow:none !important;\n  background:#e60000 !important;clip-path:polygon(0 0,100% 0,50% 100%);animation:none !important;\n  color:#000 !important;text-shadow:none !important;text-align:center;font-weight:800;line-height:1.25;\n  font-size:clamp(11px,2.3vmin,22px);isolation:isolate}\n#sat-banner.on{display:block !important}\n#sat-banner.on:not(.paso){animation:satcedablink 1s step-end infinite !important}\n#sat-banner.paso{background:#11a14a !important}\n#sat-banner::before{content:\"\";position:absolute;inset:0;z-index:-1;background:#fff;\n  clip-path:polygon(11% 7.33%,89% 7.33%,50% 85.33%)}\n#sat-hex-txt{position:absolute;top:15%;left:50%;transform:translateX(-50%);width:54%;display:block;\n  overflow-wrap:anywhere;text-wrap:balance}\n#sat-banner #sat-x{position:absolute;top:58%;left:50%;right:auto;transform:translateX(-50%);z-index:1;width:1.9em;height:1.9em;\n  padding:0;border-radius:50%;background:rgba(0,0,0,.06);border:1px solid #000;color:#000;cursor:pointer;font-size:.8em;line-height:1}\n@keyframes satcedablink{0%{background:#e60000}50%{background:#9a0000}}\n@media (prefers-reduced-motion:reduce){#sat-banner.on:not(.paso){animation:none !important}}"; document.head.appendChild(st); })();

/* ---------- SATÉLITES: pasadas + banner de aviso ---------- */
(function(){
  const API = 'http://' + location.hostname + ':5020/api/sat';
  let D = null, off = 0, descartados = {};
  const $ = id => document.getElementById(id), p2 = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const ahora = () => Date.now() / 1000 + off;
  const hhmm = t => { const d = new Date(t * 1000); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const fecha = t => { const d = new Date(t * 1000); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1); };
  const cuenta = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return h ? h + ' h ' + p2(m) + ' min' : p2(m) + ':' + p2(s % 60); };
  const clave = p => p.norad + '_' + Math.round(p.aos);

  const ban = document.createElement('div'); ban.id = 'sat-banner'; document.body.appendChild(ban);
  ban.addEventListener('click', e => { if(e.target.id === 'sat-x'){ descartados[ban.dataset.k] = 1; banner(); } });

  function banner(){
    if(!D || !D.passes){ ban.className = ''; return; }
    const n = ahora(), lead = D.config.lead_min * 60;
    const p = D.passes.find(x => !descartados[clave(x)] && x.los > n && x.aos - n <= lead);
    if(!p){ ban.className = ''; return; }
    const dentro = n >= p.aos;
    ban.dataset.k = clave(p);
    ban.className = 'on' + (dentro ? ' paso' : '');
    ban.innerHTML = '🛰 ' + esc(p.sat) + (dentro ? ' — EN PASO · termina en ' + cuenta(p.los - n) : ' — pasa en ' + cuenta(p.aos - n)) +
      ' · máx ' + Math.round(p.max_el) + '° · ' + hhmm(p.aos) + '–' + hhmm(p.los) + ' · acimut ' + Math.round(p.az_aos) + '° → ' + Math.round(p.az_los) + '°' +
      '<button type="button" id="sat-x" title="Descartar aviso">✕</button>';
  }

  function pintar(){
    const prox = $('sat-prox'), lista = $('sat-lista');
    if(!prox) return;
    if(!D){ prox.innerHTML = '<div class="lh-empty">El servicio de satélites no responde (puerto 5020).</div>'; lista.innerHTML = ''; return; }
    $('sat-meta').textContent = D.tle_edad_h != null ? 'TLE hace ' + D.tle_edad_h + ' h' : 'sin TLE';
    const n = ahora(), ps = D.passes.filter(p => p.los > n);
    let aviso = D.error ? '<div style="color:var(--amber);font-size:0.85em">' + esc(D.error) + '</div>' : '';
    if(D.no_encontrados && D.no_encontrados.length) aviso += '<div style="color:var(--amber);font-size:0.85em">No encontrado: ' + esc(D.no_encontrados.join(', ')) + '</div>';
    if(!ps.length){ prox.innerHTML = aviso + '<div class="lh-empty">Sin pasadas en las próximas 48 h con elevación mínima de ' + D.config.min_el + '°.</div>'; lista.innerHTML = ''; return; }
    const p = ps[0];
    prox.innerHTML = aviso + '<div class="sat-fila" data-n="' + p.norad + '" data-a="' + Math.round(p.aos) + '" data-l="' + Math.round(p.los) + '" title="Clic: ver la ruta en el mapa"><div style="font-size:11px;color:var(--text-dim)">PRÓXIMA PASADA · clic para ver la ruta</div>' +
      '<div style="font-size:1.15em;font-weight:700;color:var(--amber)">' + esc(p.sat) + '</div>' +
      '<div id="sat-cd" style="font-family:var(--mono);font-size:1.7em;font-weight:600;color:var(--green)"></div>' +
      '<div style="font-size:0.85em;color:var(--text-dim)">' + fecha(p.aos) + ' · ' + hhmm(p.aos) + ' → ' + hhmm(p.los) + ' · máx ' + Math.round(p.max_el) + '° a las ' + hhmm(p.max_t) +
      ' · acimut ' + Math.round(p.az_aos) + '° → ' + Math.round(p.az_los) + '°</div></div>';
    lista.innerHTML = ps.length > 1 ? '<table id="sat-tabla"><tr><th>Satélite</th><th>Día</th><th>Inicio</th><th>Máx°</th><th>Fin</th></tr>' +
      ps.slice(1, 9).map(q => '<tr class="sat-fila" data-n="' + q.norad + '" data-a="' + Math.round(q.aos) + '" data-l="' + Math.round(q.los) + '" title="Clic: ver la ruta en el mapa"><td>' + esc(q.sat) + '</td><td>' + fecha(q.aos) + '</td><td>' + hhmm(q.aos) + '</td><td>' + Math.round(q.max_el) + '°</td><td>' + hhmm(q.los) + '</td></tr>').join('') + '</table>' : '';
    tic();
  }
  function tic(){
    const cd = $('sat-cd'); if(!cd || !D) return;
    const n = ahora(), p = D.passes.find(x => x.los > n);
    if(p) cd.textContent = n >= p.aos ? 'EN PASO · ' + cuenta(p.los - n) : 'en ' + cuenta(p.aos - n);
  }
  async function cargar(){
    try{ D = await (await fetch(API + '/passes')).json(); off = D.now - Date.now() / 1000; }catch(e){ D = null; }
    pintar(); banner();
  }
  setInterval(() => { if(!document.hidden){ tic(); banner(); } }, 1000);
  setInterval(() => { if(!document.hidden) cargar(); }, 30000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) cargar(); });

  const btn = $('sat-cfg-btn');
  ['mousedown', 'pointerdown', 'touchstart'].forEach(ev => btn.addEventListener(ev, e => e.stopPropagation()));
  btn.addEventListener('click', () => {
    const f = $('sat-cfg'), ab = f.style.display === 'none';
    f.style.display = ab ? '' : 'none';
    if(ab && D){ $('sat-c-sats').value = D.config.sats; $('sat-c-el').value = D.config.min_el; $('sat-c-lead').value = D.config.lead_min; }
  });
  $('sat-c-ok').addEventListener('click', async () => {
    const msg = $('sat-c-msg'); msg.textContent = 'Guardando y recalculando…';
    try{
      const r = await (await fetch(API + '/config', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({sats: $('sat-c-sats').value, min_el: $('sat-c-el').value, lead_min: $('sat-c-lead').value})})).json();
      msg.textContent = r.error ? r.error : 'Listo: ' + (r.resueltos || []).join(', ') + ((r.no_encontrados || []).length ? ' · no encontrado: ' + r.no_encontrados.join(', ') : '');
      descartados = {}; cargar();
    }catch(e){ msg.textContent = 'No se pudo guardar (servicio no responde).'; }
  });
  cargar();
})();

(function(){
  let box = null;
  function armar(){
    box = document.createElement('div');
    box.id = 'sat-ruta-modal';
    box.style.cssText = 'display:none;position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.65);align-items:center;justify-content:center';
    box.innerHTML = '<div style="position:relative;width:min(94vw,980px);height:min(88vh,700px);background:#101418;border:2px solid #ffb020;border-radius:10px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.6)">' +
      '<div style="position:absolute;right:8px;top:6px;z-index:2;display:flex;gap:8px;align-items:center">' +
      '<a id="sat-ruta-tab" target="_blank" rel="noopener" title="Abrir en una pestaña nueva" style="color:#fff;font:13px system-ui;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:4px;text-decoration:none;cursor:pointer">↗ pestaña</a>' +
      '<button type="button" id="sat-ruta-x" title="Cerrar (Esc)" style="background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:4px;cursor:pointer;padding:2px 9px;font-size:15px">✕</button></div>' +
      '<iframe id="sat-ruta-if" style="width:100%;height:100%;border:0"></iframe></div>';
    document.body.appendChild(box);
    box.addEventListener('click', e => { if(e.target === box || e.target.id === 'sat-ruta-x') cerrar(); });
  }
  function cerrar(){ if(!box) return; box.style.display = 'none'; box.querySelector('#sat-ruta-if').src = 'about:blank'; }
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && box && box.style.display !== 'none'){ cerrar(); e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('click', ev => {
    const f = ev.target.closest && ev.target.closest('.sat-fila');
    if(!f) return;
    const u = 'http://' + location.hostname + ':5020/api/sat/ruta?norad=' + f.dataset.n + '&aos=' + f.dataset.a + '&los=' + f.dataset.l;
    if(ev.metaKey || ev.ctrlKey || ev.shiftKey){ window.open(u, '_blank', 'noopener'); return; }
    if(!box) armar();
    box.querySelector('#sat-ruta-if').src = u;
    box.querySelector('#sat-ruta-tab').href = u;
    box.style.display = 'flex';
  });
})();

(function(){
  const API = 'http://' + location.hostname + ':5020/api/sat';
  const $ = id => document.getElementById(id);
  const inp = $('sat-c-sats'), ok = $('sat-c-ok'), msg = $('sat-c-msg'), cfgp = $('sat-cfg');
  if(!inp || !ok || !msg || !cfgp) return;
  const U = s => String(s).toUpperCase();
  let LISTA = [], vis = [], sel = -1;
  async function cargar(){
    if(LISTA.length) return LISTA;
    try{ const d = await (await fetch(API + '/lista')).json(); LISTA = d.sats || []; }catch(e){ LISTA = []; }
    return LISTA;
  }
  const box = document.createElement('div'); box.id = 'sat-sug';
  (inp.closest('label') || inp).after(box);
  function partes(){ const v = inp.value, i = v.lastIndexOf(','); return {pre: v.slice(0, i + 1).trim(), tok: v.slice(i + 1).trim()}; }
  function pintar(){
    box.innerHTML = '';
    vis.forEach((s, i) => {
      const d = document.createElement('div'); d.dataset.i = i; if(i === sel) d.className = 'on';
      d.appendChild(document.createTextNode(s[1]));
      const m = document.createElement('small'); m.textContent = 'NORAD ' + s[0]; d.appendChild(m);
      box.appendChild(d);
    });
    box.style.display = vis.length ? 'block' : 'none';
  }
  async function mostrar(){
    const L = await cargar(), b = U(partes().tok);
    if(!L.length){ box.style.display = 'none'; return; }
    const ini = L.filter(s => U(s[1]).startsWith(b));
    const resto = L.filter(s => !U(s[1]).startsWith(b) && (U(s[1]).includes(b) || String(s[0]).startsWith(b)));
    vis = ini.concat(resto).slice(0, 60); sel = -1; pintar();
  }
  function elegir(i){
    const s = vis[i]; if(!s) return;
    const p = partes().pre; inp.value = (p ? p + ' ' : '') + s[1] + ', ';
    box.style.display = 'none'; inp.focus();
  }
  inp.addEventListener('input', mostrar);
  inp.addEventListener('focus', mostrar);
  inp.addEventListener('blur', () => setTimeout(() => { box.style.display = 'none'; }, 150));
  inp.addEventListener('keydown', e => {
    if(box.style.display === 'none' || !vis.length) return;
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + vis.length) % vis.length; pintar();
      const el = box.children[sel]; if(el) el.scrollIntoView({block: 'nearest'});
    } else if(e.key === 'Enter' && sel >= 0){ e.preventDefault(); elegir(sel); }
    else if(e.key === 'Escape'){ box.style.display = 'none'; }
  });
  box.addEventListener('mousedown', e => { const d = e.target.closest('div[data-i]'); if(d){ e.preventDefault(); elegir(+d.dataset.i); } });

  function resolver(t, L){
    const b = U(t);
    if(/^\d+$/.test(t)) return L.some(s => String(s[0]) === t) ? t : null;
    let m = L.filter(s => U(s[1]) === b);
    if(!m.length) m = L.filter(s => U(s[1]).startsWith(b));
    if(!m.length) m = L.filter(s => U(s[1]).includes(b));
    return m.length ? m.reduce((a, c) => c[0] < a[0] ? c : a)[1] : null;
  }
  // Valida los nombres antes de que el boton Guardar original los envie
  cfgp.addEventListener('click', ev => {
    if(!ev.target.closest('#sat-c-ok')) return;
    if(ok.dataset.pasar === '1'){ delete ok.dataset.pasar; return; }
    ev.stopPropagation(); ev.preventDefault();
    cargar().then(L => {
      if(L.length){
        const toks = inp.value.split(',').map(x => x.trim()).filter(Boolean), nom = [], malos = [];
        toks.forEach(t => { const r = resolver(t, L); if(r === null) malos.push(t); else if(nom.indexOf(r) < 0) nom.push(r); });
        if(malos.length){ msg.style.color = '#ff5d5d'; msg.textContent = 'No está en la lista de satélites: ' + malos.join(', ') + '. Elígelo de las sugerencias.'; return; }
        if(nom.length > 12){ msg.style.color = '#ff5d5d'; msg.textContent = 'Máximo 12 satélites (hay ' + nom.length + ').'; return; }
        inp.value = nom.join(', ');
      }
      msg.style.color = ''; ok.dataset.pasar = '1'; ok.click();
    });
  }, true);

  const fb = document.createElement('button');
  fb.type = 'button'; fb.className = 'qsl-btn'; fb.id = 'sat-c-forzar'; fb.textContent = '↻ Forzar carga';
  fb.title = 'Descarga los TLE ahora y recalcula las pasadas, sin esperar el ciclo automático';
  fb.style.cssText = 'align-self:flex-end;margin-left:6px;';
  ok.after(fb);
  fb.addEventListener('click', async () => {
    fb.disabled = true; msg.style.color = ''; msg.textContent = 'Descargando TLE y recalculando pasadas…';
    try{
      const r = await fetch(API + '/forzar', {method: 'POST'}), d = await r.json();
      if(!r.ok || d.ok === false){ msg.style.color = '#ff5d5d'; msg.textContent = d.error || ('Error ' + r.status); }
      else { LISTA = []; msg.textContent = 'Listo: ' + d.pasadas + ' pasadas en las próximas 48 h (TLE con ' + d.tle_sats + ' satélites).'; ok.click(); }
    }catch(e){ msg.style.color = '#ff5d5d'; msg.textContent = 'No se pudo contactar el servicio de satélites (puerto 5020).'; }
    fb.disabled = false;
  });
})();

(function(){
  let n = 0;
  function init(){
    const b = document.getElementById('sat-banner');
    if(!b){ if(++n < 20) setTimeout(init, 500); return; }
    const obs = new MutationObserver(envolver);
    function envolver(){
      obs.disconnect();
      try{
        const x = b.querySelector('#sat-x');
        const nodos = [].slice.call(b.childNodes).filter(function(e){ return e !== x; });
        if(nodos.length && !(nodos.length === 1 && nodos[0].id === 'sat-hex-txt')){
          const w = document.createElement('span'); w.id = 'sat-hex-txt';
          nodos.forEach(function(e){ w.appendChild(e); });
          b.insertBefore(w, x || null);
        }
      }catch(e){}
      obs.observe(b, {childList: true});
    }
    envolver();
  }
  init();
})();
