(function(){
  const API = location.origin + '/api/contactos';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  let datos = [];
  function msg(t){ const e = $('ct-msg'); if(e) e.textContent = t || ''; }
  function pintar(){
    const f = ($('ct-filtro').value || '').toLowerCase();
    const l = datos.filter(c => !f || (c.call + ' ' + c.name + ' ' + c.email + ' ' + c.country).toLowerCase().indexOf(f) >= 0);
    $('ct-body').innerHTML = l.map(c => '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 6px"><b>' + (typeof lhQrz === 'function' ? lhQrz(c.call) : esc(c.call)) + '</b></td><td>' + esc(c.name) + '</td><td>' +
      esc(c.email) + '</td><td>' + esc(c.country) + '</td><td class="nx-sm">' + esc(c.fuente) + '</td><td style="white-space:nowrap"><button data-ed="' + esc(c.call) +
      '" title="Editar">✎</button> <button data-del="' + esc(c.call) + '" title="Borrar">✕</button></td></tr>').join('');
    $('ct-estado').textContent = datos.length + ' contactos (' + datos.filter(c => c.email).length + ' con correo)' + (l.length !== datos.length ? ' · mostrando ' + l.length : '');
  }
  async function cargar(){
    try{ const r = await fetch(API); datos = await r.json(); pintar(); }
    catch(e){ $('ct-estado').textContent = 'Sin conexión con el servicio de contactos (puerto 5018)'; }
  }
  $('ct-filtro').addEventListener('input', pintar);
  $('ct-guardar').addEventListener('click', async () => {
    msg('Guardando...');
    try{
      const r = await fetch(API, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({call: $('ct-call').value, name: $('ct-name').value, email: $('ct-mail').value, country: $('ct-pais').value})});
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      ['ct-call','ct-name','ct-mail','ct-pais'].forEach(i => $(i).value = '');
      msg('Guardado'); cargar();
    }catch(e){ msg('Error: ' + e.message); }
  });
  $('ct-sync').addEventListener('click', async () => {
    msg('Sincronizando...');
    try{ const r = await fetch(API + '/sync', {method: 'POST'}); const j = await r.json(); msg('Nuevos: ' + j.nuevos + (j.repetidos ? ' · correos repetidos omitidos: ' + j.repetidos : '')); cargar(); }
    catch(e){ msg('Error: ' + e.message); }
  });
  $('ct-body').addEventListener('click', async ev => {
    const ed = ev.target.closest('[data-ed]'), del = ev.target.closest('[data-del]');
    if(ed){
      const c = datos.find(x => x.call === ed.dataset.ed); if(!c) return;
      $('ct-call').value = c.call; $('ct-name').value = c.name; $('ct-mail').value = c.email; $('ct-pais').value = c.country; msg('Editando ' + c.call);
    }else if(del){
      if(!confirm('¿Borrar a ' + del.dataset.del + ' de la libreta?')) return;
      try{ await fetch(API + '/' + encodeURIComponent(del.dataset.del), {method: 'DELETE'}); cargar(); }catch(e){ msg('Error: ' + e.message); }
    }
  });
  document.querySelectorAll('[data-ctx]').forEach(b => b.addEventListener('click', () => { location.href = API + '/export?fmt=' + b.dataset.ctx; }));
  function parseQrz(t){
    const L = String(t || '').replace(/\r/g, '').split('\n').map(s => s.replace(/\u00a0/g, ' ').trim());
    const m = L.join('\n').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
    const email = m ? m[0] : '';
    const util = L.filter(s => s && !/^e-?mail\s*:/i.test(s));
    if(!util.length) return null;
    const p = util[0].match(/^([A-Za-z0-9]{3,10}(?:\/[A-Za-z0-9]+)?)\s*(.*)$/);
    if(!p) return null;
    let pais = p[2].trim();
    const resto = util.slice(1), name = resto[0] || '', dir = resto.slice(1);
    if(!pais && dir.length) pais = dir[dir.length - 1];
    const addr = (dir.length && dir[dir.length - 1].toLowerCase() === pais.toLowerCase() ? dir.slice(0, -1) : dir).join(' | ');
    return {call: p[1].toUpperCase(), name: name, email: email, pais: pais, notes: addr.slice(0, 200)};
  }
  $('ct-pegar-ok').addEventListener('click', async () => {
    const pm = $('ct-pegar-msg'), d = parseQrz($('ct-pegar').value);
    if(!d){ pm.textContent = 'No pude leer el formato: la primera línea debe empezar con el indicativo'; return; }
    const prev = datos.find(x => x.call === d.call.split('/')[0]) || {};
    pm.textContent = 'Guardando...';
    try{
      const r = await fetch(API, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({call: d.call, name: d.name || prev.name || '', email: d.email || prev.email || '',
                              country: d.pais || prev.country || '', notes: d.notes || prev.notes || ''})});
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      $('ct-pegar').value = '';
      pm.textContent = 'Agregado ' + j.call + (d.email ? ' (' + d.email + ')' : ' (sin correo)');
      cargar();
    }catch(e){ pm.textContent = 'Error: ' + e.message; }
  });
  const tab = document.querySelector('[data-cfg="contactos"]');
  if(tab) tab.addEventListener('click', cargar);
  const p = $('cfg-panel-contactos');
  if(p && !p.querySelector('.man-link')){
    const a = document.createElement('a'); a.className = 'man-link'; a.target = '_blank';
    a.href = 'manuales/index.html#contactos';
    a.textContent = 'Ver manual de esta sección ↗';
    a.style.cssText = 'display:inline-block;margin:0 0 10px;font-size:12px;color:var(--amber)';
    p.insertBefore(a, p.firstChild);
  }
})();
