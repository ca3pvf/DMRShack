/* DMRShack · pieza Ubicación: botón 📍 en la tarjeta RadioID y recuadro con el mapa */
(function(){
  let box = null, ultima = '';
  function miPos(){
    let o = null; try{ o = JSON.parse(localStorage.getItem('pcbox-sys-wx-loc') || 'null'); }catch(e){}
    const la = o && isFinite(o.lat) ? +o.lat : (typeof LAT !== 'undefined' ? LAT : 0);
    const lo = o && isFinite(o.lon) ? +o.lon : (typeof LON !== 'undefined' ? LON : 0);
    return [la, lo];
  }
  function urlMapa(call){
    const p = miPos();
    return location.origin + '/api/ubicacion/mapa?call=' + encodeURIComponent(call) + ((p[0] || p[1]) ? '&lat=' + p[0] + '&lon=' + p[1] : '');
  }
  function armar(){
    box = document.createElement('div');
    box.id = 'ubic-modal';
    box.style.cssText = 'display:none;position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.65);align-items:center;justify-content:center';
    box.innerHTML = '<div style="position:relative;width:min(94vw,900px);height:min(86vh,640px);background:#101418;border:2px solid #3ddc84;border-radius:10px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.6)">' +
      '<div style="position:absolute;right:8px;top:6px;z-index:2;display:flex;gap:8px;align-items:center">' +
      '<a id="ubic-tab" target="_blank" rel="noopener" title="Abrir en una pestaña nueva" style="color:#fff;font:13px system-ui;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:4px;text-decoration:none;cursor:pointer">↗ pestaña</a>' +
      '<button type="button" id="ubic-x" title="Cerrar (Esc)" style="background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:4px;cursor:pointer;padding:2px 9px;font-size:15px">✕</button></div>' +
      '<iframe id="ubic-if" style="width:100%;height:100%;border:0"></iframe></div>';
    document.body.appendChild(box);
    box.addEventListener('click', e => { if(e.target === box || e.target.id === 'ubic-x') cerrar(); });
  }
  function cerrar(){ if(!box) return; box.style.display = 'none'; box.querySelector('#ubic-if').src = 'about:blank'; }
  function abrir(call, pestana){
    call = String(call || '').trim().toUpperCase();
    if(!call || call === '--') return;
    const u = urlMapa(call);
    if(pestana){ window.open(u, '_blank', 'noopener'); return; }
    if(!box) armar();
    box.querySelector('#ubic-if').src = u;
    box.querySelector('#ubic-tab').href = u;
    box.style.display = 'flex';
  }
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && box && box.style.display !== 'none'){ cerrar(); e.stopImmediatePropagation(); }
  }, true);
  function montar(){
    const rc = document.getElementById('rid-call');
    if(!rc || document.getElementById('rid-ubic')) return;
    const azul = rc.closest('div[style*="gradient"]');
    const w = document.createElement('div'); w.style.margin = '0 0 8px';
    w.innerHTML = '<button type="button" class="lh-chip" id="rid-ubic" title="Ver la posible ubicación en un mapa">📍 Ver ubicación</button>';
    if(azul) azul.insertAdjacentElement('afterend', w);
    else { const h = document.querySelector('#radioid .card-body'); if(!h) return; h.appendChild(w); }
    const actual = () => { const t = rc.textContent.trim(); return (t && t !== '--') ? t : ultima; };
    const al = ev => abrir(actual(), ev.metaKey || ev.ctrlKey || ev.shiftKey);
    document.getElementById('rid-ubic').addEventListener('click', al);
    rc.style.cursor = 'pointer'; rc.title = 'Clic: ver ubicación';
    rc.addEventListener('click', al);
    new MutationObserver(() => { const t = rc.textContent.trim(); if(t && t !== '--') ultima = t; })
      .observe(rc, {childList: true, characterData: true, subtree: true});
    const t0 = rc.textContent.trim(); if(t0 && t0 !== '--') ultima = t0;
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
})();
