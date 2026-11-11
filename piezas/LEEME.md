# Piezas de DMRShack

Una pieza es una carpeta con un `pieza.json`. Las que vienen con DMRShack están en `piezas/`; las que instalas
desde Configuración → Piezas quedan en `<carpeta de datos>/piezas/`. Agregar, quitar o activar una pieza se
aplica al reiniciar DMRShack (el propio panel tiene el botón).

```
mi_pieza/
  pieza.json      obligatorio
  servicio.py     backend (opcional): un Flask con `app`, igual que los servicios de services/
  tarjeta.html    tarjeta (opcional): un <section class="card" id="mi_pieza"> con el mismo id de la pieza
  tarjeta.js      código de la tarjeta (opcional)
```

```json
{
  "id": "mi_pieza",
  "nombre": "Mi pieza",
  "version": "1.0.0",
  "descripcion": "Qué hace, en una línea.",
  "autor": "CA3PVF",
  "orden": 100,
  "backend":  {"archivo": "servicio.py", "init": [], "arranque": ["bucle"]},
  "frontend": {"menu": "Mi pieza", "tarjeta": "tarjeta.html", "js": "tarjeta.js"}
}
```

- `id`: minúsculas, números y `_` (2 a 24). La carpeta debe llamarse igual. No puede ser el de una vista del núcleo.
- `backend.init`: funciones que se llaman una vez al arrancar. `backend.arranque`: funciones que corren en un hilo.
- En el JS, los datos se piden a `location.origin + '/api/...'`. Si la pieza falla, el resto del dashboard sigue.
- Para instalar una pieza: comprimir la carpeta en un .zip y subirlo en Configuración → Piezas (solo desde el equipo
  donde corre DMRShack, porque una pieza ejecuta código).
