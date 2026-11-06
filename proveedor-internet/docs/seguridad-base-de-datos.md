# Seguridad de la base de datos (MongoDB Atlas)

Esta guía documenta cómo se cumple que **un técnico no pueda leer cobranza ni usuarios**, ni siquiera consultando MongoDB directamente.

## Principio

1. **Los usuarios de la aplicación no son usuarios de MongoDB.** Técnicos, atención y administración entran solo por la aplicación. Nadie de esos roles recibe la cadena de conexión ni credenciales de Atlas.
2. **La aplicación aplica los permisos en el servidor**, en cada ruta y en cada consulta (`src/permisos.js`, `src/middleware/sesion.js`). Por ejemplo, la consulta de contratos excluye `tarifa` e historial de cobro cuando el usuario es técnico. Esto está cubierto por pruebas automáticas (`test/acceso.test.js` y `test/pantallas.test.js`).
3. **Colecciones separadas por dominio**, para poder conceder o negar acceso por colección:

| Dominio | Colecciones |
|---|---|
| Acceso | `usuarios`, `sesiones`, `restablecimientos`, `limites` |
| Auditoría | `auditoria` |
| Cobranza | `mensualidades`, `pagos`, `movimientos_bancarios`, `importaciones`, `whatsapp_envios`, `whatsapp_limites`, `whatsapp_entrantes` |
| Operación | `contratos`, `clientes`, `equipos`, `incidencias`, `incidencias_historial`, `evidencias`, `visitas`, `tecnicos` |
| Catálogos y ventas | `planes`, `promociones`, `cobertura`, `solicitudes`, `mensajes` |
| Sistema | `contadores`, `tareas_bloqueos`, `tareas_ejecuciones` |

## Cuentas de base de datos de mínimo privilegio

Crea los roles en Atlas: **Database Access → Custom Roles**. Sustituye `<BASE>` por el valor de `MONGODB_DB`.

### 1. `app_proveedor` (la única cuenta que usa la aplicación)

- **Lectura y escritura** (`find`, `insert`, `update`, `remove`, `createIndex`) sobre `<BASE>`, en todas las colecciones **excepto** las siguientes.
- **`auditoria` e `incidencias_historial`**: solo `find`, `insert` y `createIndex`, **sin** `update` ni `remove`. Así, ni un error de programación puede editar ni borrar la bitácora o el historial.
- Sin acceso a otras bases y sin acciones de administración del clúster (`dropDatabase`, `createUser`, etc.).

Ejemplo para la API de administración de Atlas (custom role):

```json
{
  "roleName": "app_proveedor",
  "actions": [
    { "action": "FIND", "resources": [{ "db": "<BASE>", "collection": "" }] },
    { "action": "INSERT", "resources": [{ "db": "<BASE>", "collection": "" }] },
    { "action": "UPDATE", "resources": [{ "db": "<BASE>", "collection": "usuarios" }, { "db": "<BASE>", "collection": "sesiones" }, { "db": "<BASE>", "collection": "…resto de colecciones excepto auditoria e incidencias_historial…" }] },
    { "action": "REMOVE", "resources": [{ "db": "<BASE>", "collection": "sesiones" }, { "db": "<BASE>", "collection": "limites" }, { "db": "<BASE>", "collection": "restablecimientos" }] },
    { "action": "CREATE_INDEX", "resources": [{ "db": "<BASE>", "collection": "" }] },
    { "action": "CREATE_COLLECTION", "resources": [{ "db": "<BASE>", "collection": "" }] }
  ]
}
```

> La aplicación no borra registros de negocio. Solo necesita `remove` en `sesiones` (cierre de sesión) y `limites` (liberar un cupo de la API). Los TTL los aplica el servidor.

### 2. `soporte_lectura` (opcional, para consultas de soporte técnico interno)

Si alguna persona necesita leer la base directamente (por ejemplo, para diagnosticar), dale una cuenta propia con este rol:

- `find` **solo** en: `contratos`, `equipos`, `incidencias`, `incidencias_historial`, `visitas`, `tecnicos`, `planes`, `cobertura`.
- **Sin** acceso a `usuarios`, `sesiones`, `restablecimientos`, `auditoria`, `mensualidades`, `pagos`, `movimientos_bancarios`, `importaciones` ni `whatsapp_*`.

### 3. Respaldos

Para `npm run respaldo` usa una cuenta con el rol integrado `backup` o con `find` en toda la base, solo desde el equipo de administración y nunca desde la aplicación.

## Otras medidas

- **Network Access** en Atlas: solo las IP de salida de Render y, temporalmente, la de quien administra.
- **Rotación**: si una cadena de conexión se expone, cambia la contraseña del usuario de base de datos en Atlas y actualiza `MONGODB_URI` en Render.
- **Contraseñas** con bcrypt (costo 12). Los tokens de restablecimiento se guardan como hash SHA-256 y son de un solo uso.
- **Evidencias** fuera de la carpeta pública; se entregan solo por una ruta con sesión y permiso de incidencias.
