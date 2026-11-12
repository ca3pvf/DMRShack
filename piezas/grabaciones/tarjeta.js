/* DMRShack · pieza Grabaciones: explorador de QSO y configuración del grabador */
/* ---------- GRABACIONES de QSO: explorador ---------- */
(function(){
  const API = 'http://' + location.hostname + ':5021/api/rec';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const p2 = n => String(n).padStart(2, '0');
  const fecha = ts => { const d = new Date(ts * 1000); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); };
  const nombre = r => r.call ? r.call + ' (' + r.src + ')' : 'ID ' + r.src;
  let lista = [], actual = null, tq = null, reint = 0;
  function params(){
    const p = new URLSearchParams();
    const q = $('rec-q').value.trim(); if(q) p.set('q', q);
    if($('rec-solofav').checked) p.set('fav', '1');
    const d0 = $('rec-desde').value, d1 = $('rec-hasta').value;
    if(d0) p.set('t0', new Date(d0 + 'T00:00:00').getTime() / 1000);
    if(d1) p.set('t1', new Date(d1 + 'T23:59:59').getTime() / 1000);
    if($('rec-dmin').value !== '') p.set('dmin', $('rec-dmin').value);
    if($('rec-dmax').value !== '') p.set('dmax', $('rec-dmax').value);
    p.set('orden', $('rec-orden').value); p.set('dir', $('rec-dir').value);
    return p.toString();
  }
  const idx = () => lista.findIndex(r => r.f === actual);
  const post = async (ruta, cuerpo) => {
    const r = await fetch(API + ruta, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(cuerpo || {})});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  };
  async function cargar(){
    if(document.hidden || cerrada('grabaciones')) return;
    try{
      const d = await getJSON(API + '/list?' + params());
      if(d.pendientes && reint < 5){ reint++; setTimeout(cargar, 3500); }else{ reint = 0; }
      lista = d.items || [];
      $('rec-meta').textContent = lista.length + (d.total > lista.length ? ' de ' + d.total : '') + ' grabaciones';
      pintar();
    }catch(e){ $('rec-lista').innerHTML = '<div class="lh-empty">El servicio de grabaciones no responde (puerto 5021).</div>'; }
  }
  function pintar(){
    const cont = $('rec-lista');
    if(!lista.length){ cont.innerHTML = '<div class="lh-empty">Sin grabaciones' + ($('rec-q').value ? ' para esa búsqueda' : ' todavía (pulsa ↻ Sincronizar)') + '</div>'; return; }
    cont.innerHTML = lista.map((r, i) => '<div data-i="' + i + '" style="display:flex;gap:8px;align-items:center;padding:4px 6px;cursor:pointer;border-bottom:1px solid var(--border);' +
      (r.f === actual ? 'background:rgba(199,125,255,.2);' : '') + '"><span>' + (r.fav ? '★' : '·') + '</span><span style="font-family:var(--mono)">' + fecha(r.ts) +
      '</span><span style="flex:1">' + esc(nombre(r)) + ' → TG ' + esc(r.tg) + '</span><span style="opacity:.75">' + r.dur + ' s' + (r.mp3 ? ' <span title="MP3 generado" style="color:var(--ok);font-weight:700">✔</span>' : '') + '</span></div>').join('');
  }
  function abrir(i){
    const r = lista[i]; if(!r) return;
    actual = r.f;
    $('rec-player').style.display = '';
    $('rec-info').textContent = fecha(r.ts) + ' · ' + nombre(r) + ' → TG ' + r.tg + ' · TS' + r.slot + ' · ' + r.dur + ' s';
    $('rec-msg').textContent = 'Decodificando…';
    const a = $('rec-audio');
    a.src = API + '/audio/' + encodeURIComponent(r.f);
    a.play().catch(() => {});
    $('rec-mp3').href = API + '/mp3/' + encodeURIComponent(r.f);
    $('rec-fav').textContent = r.fav ? '★ Quitar marca' : '☆ Marcar';
    pintar();
  }
  const a = $('rec-audio');
  a.addEventListener('canplay', () => { $('rec-msg').textContent = ''; });
  a.addEventListener('error', () => { $('rec-msg').textContent = 'No se pudo decodificar esta grabación'; });
  a.addEventListener('ended', () => { if($('rec-auto').checked) abrir(idx() + 1); });
  $('rec-lista').addEventListener('click', e => { const f = e.target.closest('[data-i]'); if(f) abrir(+f.dataset.i); });
  $('rec-prev').addEventListener('click', () => abrir(idx() - 1));
  $('rec-next').addEventListener('click', () => abrir(idx() + 1));
  $('rec-fav').addEventListener('click', async () => {
    const r = lista[idx()]; if(!r) return;
    try{ const d = await post('/fav', {f: r.f, fav: !r.fav}); r.fav = d.fav; $('rec-fav').textContent = r.fav ? '★ Quitar marca' : '☆ Marcar'; pintar(); }
    catch(e){ $('rec-msg').textContent = 'Error: ' + e.message; }
  });
  $('rec-del').addEventListener('click', async () => {
    const i = idx(), r = lista[i]; if(!r || !confirm('¿Borrar esta grabación de pcbox?')) return;
    try{ await post('/delete', {f: r.f}); lista.splice(i, 1); actual = null; pintar(); if(lista.length) abrir(Math.min(i, lista.length - 1)); else $('rec-player').style.display = 'none'; }
    catch(e){ $('rec-msg').textContent = 'Error: ' + e.message; }
  });
  $('rec-mail').value = localStorage.getItem('pcbox-rec-mail') || '';
  $('rec-send').addEventListener('click', async () => {
    const r = lista[idx()], to = $('rec-mail').value.trim(), m = $('rec-msg'); if(!r) return;
    if(!to){ m.textContent = 'Escribe el correo de destino'; return; }
    localStorage.setItem('pcbox-rec-mail', to);
    m.textContent = 'Convirtiendo y enviando…';
    try{ await post('/send', {f: r.f, to: to}); m.textContent = 'Enviado a ' + to; r.mp3 = true; pintar(); }
    catch(e){ m.textContent = 'Error: ' + e.message; }
  });
  $('rec-tel').value = localStorage.getItem('pcbox-rec-tel') || '';
  $('rec-wa').addEventListener('click', () => {
    const r = lista[idx()], m = $('rec-msg');
    if(!r){ m.textContent = 'Selecciona una grabación'; return; }
    let raw = $('rec-tel').value.trim();
    if(!raw && r.call) raw = pcboxWa.tel(r.call);
    const t = pcboxWa.normalizar(raw);
    if(!t){ m.textContent = 'Número inválido: usa el formato +56999998888'; return; }
    $('rec-tel').value = t;
    localStorage.setItem('pcbox-rec-tel', t);
    if(r.call) pcboxWa.guardar(r.call, t);
    const d = new Date(r.ts * 1000), p = n => String(n).padStart(2, '0');
    const cuando = p(d.getUTCDate()) + '-' + p(d.getUTCMonth() + 1) + '-' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ' UTC';
    const op = ($('qsl-op-call') && $('qsl-op-call').value.trim().toUpperCase()) || '@@CALL@@';
    const texto = 'Hola' + (r.call ? ' ' + r.call : '') + ', te comparto la grabación del QSO del ' + cuando + ' (TG ' + r.tg + ', ' + r.dur + ' s). 73, ' + op;
    if(!pcboxWa.abrir(t, texto)){ m.textContent = 'El navegador bloqueó la ventana de WhatsApp'; return; }
    pcboxWa.descargar(API + '/mp3/' + encodeURIComponent(r.f));
    m.textContent = 'Se descargará el MP3: adjúntalo en el chat de WhatsApp (' + t + ')';
  });
  $('rec-sync').addEventListener('click', async () => {
    $('rec-meta').textContent = 'Sincronizando…';
    try{ const d = await post('/sync'); $('rec-meta').textContent = d.nuevos + ' nuevas · hotspot: ' + d.en_hotspot + (d.activo === 'active' ? '' : ' · grabador ' + d.activo); await cargar(); }
    catch(e){ $('rec-meta').textContent = 'Error: ' + e.message; }
  });
  ['rec-q', 'rec-desde', 'rec-hasta', 'rec-dmin', 'rec-dmax'].forEach(id => $(id).addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(cargar, 350); }));
  ['rec-solofav', 'rec-orden', 'rec-dir'].forEach(id => $(id).addEventListener('change', cargar));
  $('rec-limpiar').addEventListener('click', () => {
    ['rec-q', 'rec-desde', 'rec-hasta', 'rec-dmin', 'rec-dmax'].forEach(id => { $(id).value = ''; });
    $('rec-solofav').checked = false; $('rec-orden').value = 'fecha'; $('rec-dir').value = 'desc';
    cargar();
  });
  setInterval(cargar, 60000); cargar();
})();

/* REC-SETUP-INICIO */
(function(){
  const panel = document.getElementById('cfg-panel-grabador');
  if(!panel) return;
  const API = 'http://' + location.hostname + ':5021/api/rec';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fila = (ok, t, x) => '<div style="margin:4px 0">' + (ok === true ? '🟢' : (ok === false ? '🔴' : '⚪')) + ' ' + t + (x ? ' <span style="opacity:.75">' + x + '</span>' : '') + '</div>';
  const cmdFfmpeg = {linux:'sudo apt install ffmpeg', darwin:'brew install ffmpeg', win32:'winget install ffmpeg'};
  let E = null, ocupado = false;
  async function estado(){
    $('rs-estado').textContent = 'Consultando…';
    try{
      E = await (await fetch(API + '/setup/status')).json();
    }catch(e){
      E = null;
      $('rs-estado').innerHTML = fila(false, 'El servicio de grabaciones no responde (puerto 5021)');
      return;
    }
    const h = E.hotspot, d = E.decodificador;
    let t = '';
    if(h.ssh){
      t += fila(true, 'Hotspot ' + esc(h.host) + ': conectado por SSH');
      t += fila(!!h.script && h.activo === 'active', 'Grabador en el hotspot: ' + (h.script ? 'instalado' : 'no instalado') + (h.script ? ', servicio ' + esc(h.activo) + (h.habilitado ? ' (' + esc(h.habilitado) + ')' : '') : ''), h.script ? h.grabaciones + ' grabaciones en el hotspot' : '');
    }else{
      t += fila(false, 'Hotspot ' + esc(h.host) + ': sin conexión SSH', esc(h.error || ''));
    }
    if(d.ok) t += fila(true, 'Decodificador (mbelib) listo', esc(d.ruta));
    else if(d.error) t += fila(false, 'Decodificador encontrado pero no carga', esc(d.error));
    else t += fila(false, 'Decodificador (mbelib) no instalado', d.plataforma === 'win32' ? 'no disponible en Windows' : (d.compilador ? 'compilador: ' + esc(d.compilador) : 'falta compilador de C'));
    t += fila(!!E.ffmpeg, E.ffmpeg ? 'ffmpeg instalado (MP3 disponible)' : 'ffmpeg no instalado: sin MP3', E.ffmpeg ? '' : esc(cmdFfmpeg[d.plataforma] || 'instálalo con el gestor de tu sistema'));
    $('rs-estado').innerHTML = t;
    $('rs-inst').disabled = ocupado || !h.ssh || !E.archivos;
    $('rs-quit').disabled = ocupado || !h.ssh || !h.script;
    $('rs-dec').disabled = ocupado || d.plataforma === 'win32' || !d.fuente || !d.compilador;
  }
  async function accion(url, cuerpo, rotulo){
    ocupado = true; ['rs-inst','rs-quit','rs-dec'].forEach(i => $(i).disabled = true);
    $('rs-msg').textContent = rotulo + '…';
    try{
      const r = await fetch(API + url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(cuerpo || {})});
      const d = await r.json();
      $('rs-msg').textContent = (d.ok ? 'Listo. ' : 'Error: ') + (d.error || d.salida || '');
    }catch(e){ $('rs-msg').textContent = 'Error: ' + e.message; }
    ocupado = false;
    estado();
  }
  $('rs-act').addEventListener('click', estado);
  $('rs-inst').addEventListener('click', () => { if(confirm('Se copiarán dmr_rec.py y dmr-rec.service al hotspot (' + (E ? E.hotspot.host : '') + ') y se activará el servicio. El hotspot puede quedar 1 a 2 segundos con el sistema de archivos en escritura. ¿Continuar?')) accion('/setup/hotspot', {accion:'instalar'}, 'Instalando grabador en el hotspot'); });
  $('rs-quit').addEventListener('click', () => { if(confirm('Se detendrá y quitará el grabador del hotspot y se borrarán sus grabaciones temporales de allí. Las ya copiadas a este equipo se conservan. ¿Continuar?')) accion('/setup/hotspot', {accion:'quitar'}, 'Quitando grabador del hotspot'); });
  $('rs-dec').addEventListener('click', () => accion('/setup/decodificador', {}, 'Compilando decodificador (puede tardar unos segundos)'));
  $('rec-conf').addEventListener('toggle', () => { if($('rec-conf').open) estado(); });
})();
/* REC-SETUP-FIN */
