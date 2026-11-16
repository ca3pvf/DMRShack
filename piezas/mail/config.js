/* DMRShack · pieza Mail: configuración de la cuenta Gmail. Reemplaza el mlCargar vacío del núcleo. */
(function(){
function mlMsg(t){ const m = document.getElementById('ml-msg'); m.textContent = t; setTimeout(() => { if(m.textContent === t) m.textContent = ''; }, 8000); }
mlCargar = async function(){
  const est = document.getElementById('ml-estado');
  try{
    const d = await (await fetch(ML_API + '/status')).json();
    const act = document.activeElement;
    const set = (id, v) => { const e = document.getElementById(id); if(act !== e) e.value = v; };
    set('ml-addr', d.address || ''); set('ml-nombre', d.from_name || ''); set('ml-op', d.op_call || '');
    set('ml-asunto', d.subject || ''); set('ml-cuerpo', d.body || '');
    if(!d.configured){ est.textContent = 'Sin cuenta guardada.'; return d; }
    let t = 'Cuenta guardada: ' + d.address + ' · enviados hoy: ' + d.enviados_hoy + ' de ' + d.limite_diario;
    if(d.ok === false && d.error) t += ' · último error: ' + d.error;
    est.textContent = t;
    return d;
  }catch(e){ est.textContent = 'Sin conexión con el servicio de correo (puerto 5017).'; return null; }
};
document.getElementById('ml-guardar').addEventListener('click', async () => {
  const v = id => document.getElementById(id).value;
  mlMsg('Probando acceso...');
  try{
    const r = await fetch(ML_API + '/config', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({address: v('ml-addr').trim(), app_password: v('ml-pass'), from_name: v('ml-nombre'),
        op_call: v('ml-op'), subject: v('ml-asunto'), body: v('ml-cuerpo')})});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    document.getElementById('ml-pass').value = '';
    mlMsg('Acceso correcto, cuenta guardada');
    mlCargar();
  }catch(e){ mlMsg('Error: ' + e.message); }
});
document.getElementById('ml-probar').addEventListener('click', async () => {
  mlMsg('Enviando prueba...');
  try{
    const r = await fetch(ML_API + '/test', {method: 'POST'});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    mlMsg('Prueba enviada a ' + d.to);
    mlCargar();
  }catch(e){ mlMsg('Error: ' + e.message); }
});
document.getElementById('ml-quitar').addEventListener('click', async () => {
  if(!confirm('¿Quitar la cuenta Gmail y la contraseña guardadas en pcbox?')) return;
  try{ await fetch(ML_API + '/clear', {method: 'POST'}); document.getElementById('ml-pass').value = ''; mlMsg('Cuenta eliminada'); mlCargar(); }
  catch(e){ mlMsg('Error: ' + e.message); }
});
document.querySelector('[data-cfg="mail"]').addEventListener('click', mlCargar);
  var p = document.getElementById('cfg-panel-mail');
  if(p && !p.querySelector('.man-link')){
    var l = document.createElement('a'); l.className = 'man-link'; l.href = 'manuales/index.html#gmail'; l.target = '_blank';
    l.textContent = 'Ver manual de esta sección ↗';
    l.style.cssText = 'display:inline-block;margin:0 0 10px;font-size:12px;color:var(--amber)';
    p.insertBefore(l, p.firstChild);
  }
})();
