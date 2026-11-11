/* ---------- SISMOS: CSN + USGS ---------- */
(function(){
  const API = 'http://' + location.hostname + ':5022/api/sismos';
  const LSK = 'pcbox-sismos-fuente';
  const FUENTES = {csn:'CSN', chile:'USGS Chile', mundo:'USGS Mundo'};
  const $ = id => document.getElementById(id), p2 = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let fuente = localStorage.getItem(LSK), D;
  if(!FUENTES[fuente]) fuente = 'csn';
  const hora = t => { const d = new Date(t * 1000); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const color = m => m >= 6 ? '#ff5d5d' : (m >= 5 ? 'var(--amber)' : 'var(--text)');
  const TH = 'text-align:left;color:var(--text-dim);font-weight:400;padding:2px 6px 2px 0;';
  const TD = 'padding:3px 6px 3px 0;border-top:1px solid var(--border);';

  function miPos(){
    let o = null; try{ o = JSON.parse(localStorage.getItem('pcbox-sys-wx-loc') || 'null'); }catch(e){}
    const la = o && isFinite(o.lat) ? +o.lat : (typeof LAT !== 'undefined' ? LAT : 0);
    const lo = o && isFinite(o.lon) ? +o.lon : (typeof LON !== 'undefined' ? LON : 0);
    return [la, lo];
  }
  function mapaUrl(s){
    const h = miPos();
    const q = {lat: s.lat == null ? '' : s.lat, lon: s.lon == null ? '' : s.lon, mag: s.mag, tipo: s.tipo || '', lugar: s.lugar || '',
      prof: s.prof == null ? '' : s.prof, hora: s.hora || '', fuente: s.fuente || '', rep: s.url || ''};
    if(h[0] || h[1]){ q.hlat = h[0]; q.hlon = h[1]; }
    return 'http://' + location.hostname + ':5022/api/sismos/mapa?' + Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&');
  }

  function filas(){
    if(!D) return [];
    if(fuente === 'csn') return (D.sismos || []).map(s => ({mag:s.mag, tipo:s.tipo, lugar:s.lugar, prof:s.prof,
      hora: s.local.slice(8, 10) + '/' + s.local.slice(5, 7) + ' ' + s.local.slice(11, 16), url:'https://sismologia.cl' + s.path, lat:s.lat, lon:s.lon, fuente:'CSN'}));
    return (D[fuente] || []).map(s => ({mag:s.mag, tipo:s.tipo, lugar:s.lugar, prof:s.prof == null ? null : Math.round(s.prof), hora:hora(s.ts), url:s.url, lat:s.lat, lon:s.lon, fuente:'USGS'}));
  }
  function pintar(){
    const cont = $('sis-lista'); if(!cont) return;
    Object.keys(FUENTES).forEach(k => $('sis-f-' + k).classList.toggle('on', k === fuente));
    if(D === undefined){ cont.innerHTML = '<div class="lh-empty">Cargando…</div>'; return; }
    if(!D){ cont.innerHTML = '<div class="lh-empty">El servicio de sismos no responde (puerto 5022).</div>'; $('sis-meta').textContent = '--'; return; }
    $('sis-meta').textContent = D.calculado ? 'act. ' + hora(D.calculado).slice(6) : 'cargando…';
    const f = filas().slice(0, 15);
    const aviso = D.error ? '<div style="color:var(--amber);font-size:0.85em">' + esc(D.error) + '</div>' : '';
    if(!f.length){ cont.innerHTML = aviso + '<div class="lh-empty">Sin sismos para mostrar.</div>'; return; }
    cont.innerHTML = aviso + '<table style="width:100%;border-collapse:collapse;font-size:0.9em"><tr><th style="' + TH + '">Mag</th><th style="' + TH + '">Lugar</th><th style="' + TH + '">Prof.</th><th style="' + TH + '">Hora</th></tr>' +
      f.map(s => '<tr><td style="' + TD + 'font-weight:700;color:' + color(s.mag) + '">' + s.mag.toFixed(1) +
        (s.tipo ? ' <span style="font-weight:400;color:var(--text-dim);font-size:0.8em">' + esc(s.tipo) + '</span>' : '') + '</td>' +
        '<td style="' + TD + '"><a class="sis-ev" href="' + esc(mapaUrl(s)) + '" title="Ver en un mapa (Cmd/Ctrl+clic: pestaña nueva)" style="color:inherit;text-decoration:none">' + esc(s.lugar) + '</a></td>' +
        '<td style="' + TD + 'white-space:nowrap">' + (s.prof == null ? '--' : s.prof + ' km') + '</td>' +
        '<td style="' + TD + 'white-space:nowrap">' + s.hora + '</td></tr>').join('') + '</table>';
  }
  async function cargar(){
    if(document.hidden || (typeof cerrada === 'function' && cerrada('sismos'))) return;
    try{ D = await (await fetch(API + (fuente === 'csn' ? '' : '/usgs'))).json(); }catch(e){ D = null; }
    pintar();
  }
  Object.keys(FUENTES).forEach(k => {
    const b = $('sis-f-' + k); if(!b) return;
    ['mousedown', 'pointerdown', 'touchstart'].forEach(ev => b.addEventListener(ev, e => e.stopPropagation()));
    b.addEventListener('click', () => { fuente = k; localStorage.setItem(LSK, k); pintar(); cargar(); });
  });
  const bRef = $('sis-refresh');
  if(bRef){
    ['mousedown', 'pointerdown', 'touchstart'].forEach(ev => bRef.addEventListener(ev, e => e.stopPropagation()));
    bRef.addEventListener('click', async () => {
      if(bRef.disabled) return;
      bRef.disabled = true; bRef.textContent = '…';
      try{ await fetch(API + '/refresh', {method: 'POST'}); }catch(e){}
      await cargar();
      bRef.textContent = '⟳'; bRef.disabled = false;
    });
  }
  setInterval(cargar, 60000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) cargar(); });
  pintar(); cargar();
})();

/* ---------- SISMOS: ALERTA VISUAL ---------- */
(function(){
  const API = 'http://' + location.hostname + ':5022/api/sismos';
  const LSK = 'pcbox-sismos-alerta';
  const $ = id => document.getElementById(id), p2 = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const num = (v, d) => (v === undefined || v === null || v === '' || !isFinite(Number(v))) ? d : Number(v);
  const hh = t => { const d = new Date(t * 1000); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  function leerCfg(){
    let c = {}; try{ c = JSON.parse(localStorage.getItem(LSK) || '{}') || {}; }catch(e){}
    return {km: Math.max(0, num(c.km, 100)), seg: Math.max(3, num(c.seg, 10)), mag: Math.min(10, Math.max(0, num(c.mag, 0)))};
  }

  const st = document.createElement('style');
  st.textContent = [
    '#sis-alerta{display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:100000;width:min(92vw,520px);box-sizing:border-box;padding:20px 24px;border-radius:12px;border:3px solid #ff5d5d;background:#3a1518;color:#fff;text-align:center;animation:sis-blink 1s ease-in-out infinite;}',
    '#sis-alerta.on{display:block;}',
    '#sis-alerta .sa-t{font-size:1.1em;font-weight:700;letter-spacing:.08em;}',
    '#sis-alerta .sa-m{font-size:2.4em;font-weight:800;line-height:1.1;margin:6px 0;}',
    '#sis-alerta .sa-l{font-size:1.1em;margin-bottom:4px;}',
    '#sis-alerta .sa-d{font-size:.9em;opacity:.85;}',
    '#sis-alerta-x{position:absolute;right:8px;top:6px;background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:4px;cursor:pointer;padding:2px 8px;font-size:1em;}',
    '@keyframes sis-blink{0%,100%{background:#3a1518;box-shadow:0 0 28px rgba(255,93,93,.75);}50%{background:#7a1f26;box-shadow:0 0 6px rgba(255,93,93,.2);}}'
  ].join('');
  document.head.appendChild(st);
  const box = document.createElement('div'); box.id = 'sis-alerta';
  document.body.appendChild(box);

  let timer = null;
  function cerrar(){ box.classList.remove('on'); clearTimeout(timer); timer = null; }
  box.addEventListener('click', e => { if(e.target.id === 'sis-alerta-x') cerrar(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') cerrar(); });
  function mostrar(s, prueba, seg){
    box.innerHTML = '<button type="button" id="sis-alerta-x" title="Cerrar (Esc)">✕</button>' +
      '<div class="sa-t">⚠ ' + (prueba ? 'PRUEBA · ' : '') + 'SISMO</div>' +
      '<div class="sa-m">M ' + Number(s.mag).toFixed(1) + (s.tipo ? ' ' + esc(s.tipo) : '') + '</div>' +
      '<div class="sa-l">' + esc(s.lugar) + '</div>' +
      '<div class="sa-d">' + (s.dist_km != null ? 'a ' + Math.round(s.dist_km) + ' km de tu ubicación · ' : '') +
      (s.prof != null ? 'prof. ' + Math.round(s.prof) + ' km · ' : '') + esc(s.hora) + ' · ' + esc(s.fuente) + '</div>';
    box.classList.add('on');
    clearTimeout(timer); timer = setTimeout(cerrar, (seg || leerCfg().seg) * 1000);
  }

  // ----- vigilancia de sismos nuevos -----
  const vistos = new Set(), prim = {CSN:true, USGS:true}; let recientes = [];
  const traer = async u => { try{ return await (await fetch(u)).json(); }catch(e){ return null; } };
  async function revisar(){
    if(document.hidden) return;
    const [c, u] = await Promise.all([traer(API), traer(API + '/usgs')]);
    const items = [];
    if(c) (c.sismos || []).forEach(s => items.push({k:'c' + s.id, fuente:'CSN', mag:s.mag, tipo:s.tipo, lugar:s.lugar, prof:s.prof,
      ts:s.ts, lat:s.lat, lon:s.lon, dist_km:s.dist_km, hora:s.local.slice(8, 10) + '/' + s.local.slice(5, 7) + ' ' + s.local.slice(11, 16)}));
    if(u) ['chile', 'mundo'].forEach(l => (u[l] || []).forEach(s => items.push({k:'u' + s.id, fuente:'USGS', mag:s.mag, tipo:s.tipo,
      lugar:s.lugar, prof:s.prof, ts:s.ts, lat:s.lat, lon:s.lon, dist_km:s.dist_km, hora:hh(s.ts)})));
    const cfg = leerCfg(), ahora = Date.now() / 1000, nuevos = [];
    items.forEach(s => {
      if(vistos.has(s.k)) return;
      if(prim[s.fuente]){ vistos.add(s.k); return; }          // lo que ya existía al abrir: no alerta
      if(s.dist_km == null) return;                            // CSN aún sin coordenadas: se reintenta
      vistos.add(s.k);
      if(cfg.km <= 0 || s.dist_km > cfg.km) return;
      if(s.mag < cfg.mag) return;                              // bajo la magnitud mínima elegida
      if(s.ts && ahora - s.ts > 3600) return;
      if(recientes.some(r => Math.abs(r.ts - s.ts) < 300 && Math.abs(r.lat - s.lat) < 1.5 && Math.abs(r.lon - s.lon) < 1.5)) return;  // mismo sismo ya avisado por la otra fuente
      recientes.push(s); nuevos.push(s);
    });
    if(c) prim.CSN = false;
    if(u) prim.USGS = false;
    if(recientes.length > 50) recientes = recientes.slice(-50);
    if(nuevos.length){ nuevos.sort((a, b) => b.mag - a.mag); mostrar(nuevos[0]); }
  }
  setInterval(revisar, 60000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) revisar(); });
  revisar();

  // ----- panel de configuración (⚙ en la tarjeta Sismos) -----
  const btn = $('sis-cfg-btn');
  if(btn){
    ['mousedown', 'pointerdown', 'touchstart'].forEach(ev => btn.addEventListener(ev, e => e.stopPropagation()));
    const msg = t => { $('sis-c-msg').textContent = t; };
    const leerCampos = () => {
      const km = num($('sis-c-km').value, NaN), seg = num($('sis-c-seg').value, NaN), mag = num($('sis-c-mag').value, 0);
      if(!isFinite(km) || km < 0 || km > 20000){ msg('Distancia inválida (0 a 20000 km; 0 = alerta desactivada)'); return null; }
      if(!isFinite(seg) || seg < 3 || seg > 120){ msg('Tiempo inválido (3 a 120 segundos)'); return null; }
      if(!isFinite(mag) || mag < 0 || mag > 10){ msg('Magnitud inválida (0 a 10; 0 = todas)'); return null; }
      return {km:km, seg:seg, mag:mag};
    };
    btn.addEventListener('click', () => {
      const f = $('sis-cfg'), abrir = f.style.display === 'none';
      f.style.display = abrir ? '' : 'none';
      if(abrir){ const c = leerCfg(); $('sis-c-km').value = c.km; $('sis-c-seg').value = c.seg; $('sis-c-mag').value = c.mag; msg('0 km = alerta desactivada · magnitud 0 = todas'); }
    });
    $('sis-c-ok').addEventListener('click', () => {
      const c = leerCampos(); if(!c) return;
      localStorage.setItem(LSK, JSON.stringify(c));
      msg(c.km === 0 ? 'Guardado: alerta desactivada' : 'Guardado: sismos a ≤ ' + c.km + ' km' + (c.mag > 0 ? ' y magnitud ≥ ' + c.mag : '') + ', aviso por ' + c.seg + ' s');
    });
    $('sis-c-test').addEventListener('click', () => {
      const c = leerCampos(); if(!c) return;
      mostrar({mag:5.2, tipo:'MLv', lugar:'Ejemplo: 40 km al SO de Santiago', prof:35, dist_km:40, hora:hh(Date.now() / 1000), fuente:'PRUEBA'}, true, c.seg);
    });
  }
})();
