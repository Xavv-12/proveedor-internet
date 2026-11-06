# Proveedor de Internet · aplicación interna

Herramienta privada para la operación de un proveedor de internet: ventas, clientes, soporte en campo, cobranza y conciliación bancaria. Está pensada para usarse desde el teléfono (diseño desde 360 px) por técnicos y personal de oficina. No es un sitio de ventas.

El sitio público (HTML estático en HostGator) **no forma parte de este proyecto**. Se comunica con esta aplicación solo mediante la API REST `/api/v1`.

## Contenido

1. [Tecnologías y versiones](#tecnologías-y-versiones)
2. [Arquitectura](#arquitectura)
3. [Instalación en Windows](#instalación-en-windows)
4. [Variables de entorno](#variables-de-entorno)
5. [Roles y permisos](#roles-y-permisos)
6. [API pública /api/v1](#api-pública-apiv1)
7. [Webhook de WhatsApp](#webhook-de-whatsapp)
8. [Tareas programadas](#tareas-programadas)
9. [Despliegue en Render](#despliegue-en-render)
10. [Respaldo y restauración](#respaldo-y-restauración)
11. [Pruebas](#pruebas)
12. [Estructura del código](#estructura-del-código)

## Tecnologías y versiones

| Componente | Versión |
|---|---|
| Node.js | 20 LTS en Render (archivo `.node-version`); funciona también en 22 y 24 |
| Express | 4.21 |
| EJS | 7.0 |
| MongoDB (driver oficial `mongodb`) | 6.x · MongoDB Atlas con réplica (requerido para transacciones) |
| express-session + connect-mongo | 1.18 / 5.1 |
| bcryptjs (costo 12) | 2.4 |
| Zod (validación en servidor) | 4.6 |
| helmet | 7.2 |
| multer | 2.0 |
| node-cron | 4.6 |
| nodemailer | 10.3 |
| pino (logs) | 9.6 |
| Pruebas | `node:test` + supertest + mongodb-memory-server |

## Arquitectura

```
Sitio público (HostGator, dominio principal)          Aplicación interna (Render, subdominio)
  index.html, paquetes.html, cobertura.html …   ──►   /api/v1  (CORS solo para SITIO_ORIGENES)
  assets/js/config.js  → solo la URL de la API          /webhooks/whatsapp  (firma HMAC)
                                                        /salud
                                                        resto de rutas: requieren sesión
                                                              │
                                                              ▼
                                                        MongoDB Atlas
```

- El sitio nunca accede a MongoDB ni a rutas privadas.
- `config.js` del sitio solo debe tener la dirección pública de la API, por ejemplo `https://app.tu-dominio/api/v1`. Nunca claves, tokens ni credenciales.
- Fechas guardadas en UTC y mostradas en hora de la Ciudad de México (`America/Mexico_City`).
- Dinero en MXN guardado como **enteros en centavos** (`20000` = `$200.00`). Nunca decimales flotantes.
- Folios con contador atómico e índice único: `SOL-AAAA-00001`, `CTR-AAAA-00001`, `INC-AAAA-00001`.
- Nada se borra desde la aplicación: planes, clientes, equipos, técnicos y usuarios se desactivan.

## Instalación en Windows

1. Instala **Node.js 20 LTS** desde nodejs.org (instalador `.msi`). Verifica en PowerShell:

   ```powershell
   node -v   # debe mostrar v20.x
   npm -v
   ```

2. Descarga el proyecto y entra a la carpeta:

   ```powershell
   cd C:\ruta\proveedor-internet
   ```

3. Copia el ejemplo de variables y edítalo con tus valores (nunca subas `.env` al repositorio):

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   Para generar un `SESSION_SECRET` aleatorio:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   **Para uso local solo necesitas `MONGODB_URI`, `MONGODB_DB` y `DEMO_SEED_PASSWORD`.** En desarrollo, si faltan, `APP_URL` toma `http://localhost:PUERTO`, `SITIO_ORIGENES` queda vacío (la API solo responde a peticiones sin origen de navegador) y `SESSION_SECRET` se genera al arrancar (las sesiones se cierran al reiniciar). En producción las tres son obligatorias.

   En desarrollo usa `NODE_ENV=development` y una base distinta de producción (por ejemplo `MONGODB_DB=proveedor_desarrollo`).

4. Instala dependencias exactamente como en el `package-lock.json`:

   ```powershell
   npm ci
   ```

5. Crea los datos de demostración (solo en desarrollo; se niega con `NODE_ENV=production`):

   ```powershell
   npm run seed
   ```

   Crea `admin@demo.mx`, `atencion@demo.mx` y `tecnico@demo.mx`, todas con la contraseña definida en `DEMO_SEED_PASSWORD`. También crea los cinco planes iniciales como **borradores ocultos** (sin velocidades) y datos ficticios de ejemplo. Se puede ejecutar varias veces sin duplicar.

   **MongoDB local.** La aplicación usa transacciones, así que MongoDB debe correr como réplica. Si instalaste MongoDB Community en Windows, edita `C:\Program Files\MongoDB\Server\<versión>\bin\mongod.cfg`, agrega:

   ```yaml
   replication:
     replSetName: rs0
   ```

   Reinicia el servicio y, una sola vez, inicializa la réplica:

   ```powershell
   Restart-Service MongoDB
   mongosh --eval "rs.initiate()"
   ```

   Usa entonces `MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0`. Con Atlas no hace falta nada de esto.

6. Inicia la aplicación:

   ```powershell
   npm start
   ```

   Abre `http://localhost:3000` (o el `PORT` que definiste). Para desarrollo con recarga automática: `npm run dev`.

## Variables de entorno

Todas se configuran en el panel de Render (o en `.env` local). El archivo `.env.example` contiene solo los nombres.

| Variable | Obligatoria | Significado |
|---|---|---|
| `MONGODB_URI` | Sí | Cadena de conexión de MongoDB Atlas (`mongodb+srv://…`) con un usuario de mínimo privilegio. |
| `MONGODB_DB` | Sí | Nombre de la base de datos de la aplicación. |
| `SESSION_SECRET` | Sí | Secreto para firmar la cookie de sesión. Mínimo 32 caracteres aleatorios. |
| `APP_URL` | Sí | Dirección pública de la aplicación (subdominio en Render, con `https` en producción). Se usa en los enlaces de recuperación de contraseña. |
| `SITIO_ORIGENES` | Sí | Orígenes que pueden llamar a `/api/v1`, separados por comas, con `https` en producción. Ejemplo de forma: `https://dominio-del-sitio,https://www.dominio-del-sitio`. |
| `PORT` | No | Puerto de escucha. Render lo asigna solo. Por defecto 3000. |
| `NODE_ENV` | No | `production` en Render; `development` en tu equipo. |
| `TRUST_PROXY` | En Render | `true` para confiar en el proxy de Render (IP real del visitante y cookie segura). |
| `WA_VERIFY_TOKEN` | En producción | Texto que tú eliges y capturas en Meta para verificar el webhook. |
| `WA_APP_SECRET` | En producción | Clave secreta de la app de Meta; valida la firma `X-Hub-Signature-256`. |
| `WA_TOKEN` | No | Token de acceso de WhatsApp Cloud API. Sin él, los recordatorios quedan desactivados. |
| `WA_PHONE_ID` | No | Identificador del número de WhatsApp (Phone number ID). |
| `SMTP_HOST` | En producción | Servidor SMTP para correos de recuperación. |
| `SMTP_PORT` | En producción | Puerto SMTP (465 usa TLS directo; 587 usa STARTTLS). |
| `SMTP_USER` | No | Usuario SMTP. |
| `SMTP_PASS` | No | Contraseña SMTP. |
| `SMTP_FROM` | En producción | Remitente de los correos. |
| `EVIDENCE_DIR` | No | Carpeta privada para evidencias (fuera de `public`). En Render, la ruta del disco persistente. Por defecto `./evidencias`. |
| `MAX_UPLOAD_MB` | No | Tamaño máximo por archivo, de 1 a 50 MB. Por defecto 8. |
| `DEMO_SEED_PASSWORD` | Solo para `npm run seed` | Contraseña de las cuentas demo (mínimo 10 caracteres). No la definas en producción. |
| `WA_API_VERSION` | No (opcional) | Versión de Graph API. Por defecto `v23.0`. Actualízala cuando Meta retire versiones. |
| `LOG_LEVEL` | No (opcional) | Nivel de logs de pino (`info` por defecto). |

Al arrancar, la aplicación valida las variables y se detiene con un mensaje claro si falta alguna. Los logs nunca registran contraseñas, tokens, cadenas de conexión ni firmas.

## Roles y permisos

Los permisos se aplican en el servidor en cada ruta y en cada consulta (ocultar un botón no cuenta). Una ruta no permitida responde 403 con "No tienes permiso para ver esto".

| Módulo | admin | atencion | tecnico |
|---|---|---|---|
| Tablero | Completo | Completo | Solo incidencias abiertas, visitas de hoy y contratos activos |
| Solicitudes, Planes, Promociones, Cobertura, Clientes | Sí | Sí | No |
| Contratos, Equipos | Sí | Sí | Solo lectura (sin tarifas ni mensualidades) |
| Incidencias, Agenda de visitas | Sí | Sí | Sí |
| Técnicos | Sí | Sí | Solo lectura |
| Pagos y cobranza, Prioridad, Conciliación | Sí | Sí | No |
| Mensajes y avisos | Sí | Sí | No |
| Usuarios, Auditoría | Sí | No | No |

Inactividad verificada en servidor: admin 30 min, atención 60 min, técnico 120 min. Al vencer, se vuelve a `/login` con "Tu sesión se cerró por inactividad".

En la base de datos, los técnicos **nunca** reciben credenciales de MongoDB; el control es por rol en la aplicación, documentado y probado. La guía de cuentas de mínimo privilegio en Atlas está en [`docs/seguridad-base-de-datos.md`](docs/seguridad-base-de-datos.md).

## API pública /api/v1

Uso exclusivo del sitio público. No usa sesión, cookies ni claves. CORS solo para `SITIO_ORIGENES` (responde también al preflight `OPTIONS`). Todas las respuestas llevan `Cache-Control: no-store`.

**Forma de respuesta**

```json
{ "success": true, "data": { } }
{ "success": false, "error": "Mensaje para mostrar" }
```

**Códigos de error**

| Código | Cuándo |
|---|---|
| 400 | Datos inválidos o JSON mal formado. |
| 403 | El `Origin` no está en `SITIO_ORIGENES`. |
| 404 | Ruta inexistente. |
| 413 | Cuerpo mayor a 10 KB. |
| 415 | `POST` sin `Content-Type: application/json`. |
| 429 | Límite excedido: "Ya recibimos varias solicitudes desde tu conexión. Escríbenos por WhatsApp." |
| 500 | Error interno (sin detalles). |

### GET /api/v1/planes

Solo planes activos, publicados y con velocidad de bajada capturada.

```json
{
  "success": true,
  "data": [
    { "clave": "premium-1", "nombre": "Premium 1", "precio": "$400.00", "precioCentavos": 40000,
      "moneda": "MXN", "velocidadBajadaMbps": 0, "velocidadSubidaMbps": null, "descripcion": "" }
  ]
}
```

> Los planes iniciales se crean **sin velocidades** y por eso la lista sale vacía hasta que alguien capture la velocidad real y marque "Publicar en la página". La `clave` coincide con los botones de la página (`basico`, `plus`, `premium-1`, `premium-2`, `premium-3`).

### GET /api/v1/promociones

Promociones activas, publicadas y vigentes.

```json
{ "success": true, "data": [ { "titulo": "…", "descripcion": "…", "planes": ["plus"],
  "vigenciaInicio": "2026-11-01T06:00:00.000Z", "vigenciaFin": null } ] }
```

### GET /api/v1/cobertura

Parámetros: `cp` (5 dígitos) **o** `colonia` (mínimo 3 letras, sin distinguir acentos). Límite: 60 consultas por IP cada 10 minutos.

```
GET /api/v1/cobertura?cp=01234
GET /api/v1/cobertura?colonia=centro
```

```json
{ "success": true, "data": { "disponible": true,
  "zonas": [ { "codigoPostal": "01234", "colonia": "…", "municipio": "…", "estado": "…", "disponible": true } ] } }
```

### POST /api/v1/solicitudes

`Content-Type: application/json`. Límites por IP: 5 solicitudes válidas por hora y 20 intentos por hora.

| Campo | Obligatorio | Regla |
|---|---|---|
| `nombre` | Sí | 2 a 120 caracteres |
| `telefono` | Sí | 10 dígitos; se quitan espacios, guiones, paréntesis y `+52` |
| `codigoPostal` | Sí | 5 dígitos |
| `colonia` | Sí | 2 a 120 caracteres |
| `correo` | No | Correo válido |
| `direccion` | No | Máximo 300 |
| `plan` | No | Clave web de un plan publicado |
| `comentarios` | No | Máximo 500 |

Ejemplo desde el sitio:

```js
const r = await fetch(`${CONFIG.API_URL}/solicitudes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nombre, telefono, codigoPostal, colonia, plan: 'premium-1' }),
});
const datos = await r.json();
if (!datos.success) mostrarError(datos.error);
```

Respuesta `201`:

```json
{ "success": true, "data": { "folio": "SOL-2026-00012", "mensaje": "Recibimos tu solicitud. Te contactaremos pronto." } }
```

La respuesta nunca incluye datos de otros clientes ni datos internos.

## Webhook de WhatsApp

- `GET /webhooks/whatsapp`: responde el reto (`hub.challenge`) solo si `hub.verify_token` coincide con `WA_VERIFY_TOKEN`.
- `POST /webhooks/whatsapp`: verifica `X-Hub-Signature-256` (HMAC SHA-256 con `WA_APP_SECRET` sobre el cuerpo crudo, comparación de tiempo constante). Si no coincide responde **401** y no procesa nada. Con firma válida guarda los estados de entrega y los mensajes entrantes (sin duplicar reenvíos).

En Meta, la URL de devolución es `https://<tu-subdominio>/webhooks/whatsapp`.

Los recordatorios de cobro usan el mensaje de tipo "Recordatorio de cobro" activo en **Mensajes y avisos**. Fuera de la ventana de 24 horas, WhatsApp solo entrega **plantillas aprobadas**: captura el nombre de la plantilla y usa tres variables en este orden: nombre, saldo y folio. Nunca se envía más de un recordatorio al mismo teléfono cada 20 horas (reserva atómica en MongoDB).

## Tareas programadas

Se ejecutan con `node-cron` en zona `America/Mexico_City`. Cada tarea usa un bloqueo en MongoDB (`tareas_bloqueos`) para no correr en paralelo ni en varias instancias, y registra inicio, fin y resultado en `tareas_ejecuciones` y en los logs.

| Tarea | Horario | Qué hace |
|---|---|---|
| `vencimiento-mensualidades` | Diario 00:05 | Marca como VENCIDA cada mensualidad pendiente o parcial cuya fecha límite ya pasó. También corre al abrir Cobranza, Prioridad y el Tablero. |
| `recordatorios-cobro` | Diario 10:00 | Envía un recordatorio por WhatsApp a cada contrato con mensualidades vencidas, respetando las 20 horas por teléfono. Se omite si WhatsApp no está configurado. |

> En Render, las tareas solo corren si el servicio está encendido. Un plan gratuito se suspende por inactividad y no ejecutará las tareas: usa una instancia de pago.

## Despliegue en Render

1. **MongoDB Atlas**
   - Crea un clúster (Atlas siempre usa réplica, necesaria para las transacciones).
   - Crea un usuario de base de datos dedicado para la app con el rol descrito en `docs/seguridad-base-de-datos.md`.
   - En **Network Access**, permite las conexiones desde Render. Render muestra las IP de salida de tu servicio en su panel (opción *Connect → Outbound*). Agrega esas IP a la lista de acceso de Atlas; evita `0.0.0.0/0` si puedes.

2. **Servicio en Render**
   - Crea un **Web Service** conectado a tu repositorio.
   - Entorno: **Node**. Versión: la toma de `.node-version` (20). Para cambiarla, edita ese archivo o define `NODE_VERSION` en Render.
   - Build command: `npm ci`
   - Start command: `npm start`
   - Health check path: `/salud`
   - Variables de entorno: captura todas las de la tabla anterior en *Environment*. Como mínimo: `NODE_ENV=production`, `TRUST_PROXY=true`, `APP_URL` con `https`, `SITIO_ORIGENES` con el dominio del sitio en HostGator con `https`.

3. **Disco persistente para evidencias**
   - El sistema de archivos de Render se borra en cada despliegue. Agrega un **Disk** (requiere plan de pago) y monta una ruta, por ejemplo `/var/data`.
   - Define `EVIDENCE_DIR` con una carpeta dentro de esa ruta, por ejemplo `/var/data/evidencias`.
   - Con disco, el servicio trabaja con una sola instancia.

4. **Subdominio en HostGator**
   - En Render, abre el servicio → *Settings* → *Custom Domains* → agrega el subdominio que usarás para la app.
   - Render te mostrará el registro DNS que debes crear (tipo, nombre y valor). Cópialo **exactamente como lo indica Render**; no uses valores de ejemplo.
   - En HostGator (cPanel → *Zone Editor* del dominio), agrega ese registro para el subdominio. No toques los registros del dominio principal, que sigue apuntando al sitio.
   - Espera la propagación y vuelve a Render para verificar el dominio. Render emite el certificado HTTPS automáticamente.
   - Actualiza `APP_URL` con la dirección final del subdominio.

5. **Conectar el sitio**
   - En el sitio, `assets/js/config.js` debe contener solo la URL pública de la API (`https://<subdominio>/api/v1`).
   - Verifica desde el navegador o con PowerShell:

     ```powershell
     Invoke-RestMethod https://<subdominio>/salud
     Invoke-RestMethod https://<subdominio>/api/v1/planes
     ```

     `/salud` debe responder `{"estado":"ok","mongodb":"ok",…}`.

6. **Primer usuario administrador en producción**. `npm run seed` no corre en producción. Crea el primer administrador una sola vez desde tu equipo, con un `.env` temporal que apunte a la base de producción:

   ```powershell
   npm run crear-admin -- correo@tu-dominio "Nombre completo"
   ```

   El script pide la contraseña por teclado (no queda en el historial). Después borra ese `.env` temporal. Los demás usuarios se dan de alta desde **Usuarios**.

## Respaldo y restauración

Requieren **MongoDB Database Tools** (`mongodump` y `mongorestore`) instalados y en el `PATH`. Los scripts leen `MONGODB_URI` y `MONGODB_DB` del entorno o del `.env`, y pasan la cadena de conexión mediante un archivo temporal con permisos restringidos (no aparece en la línea de comandos ni en el historial).

```powershell
# Respaldo comprimido en .\respaldos\respaldo-<base>-<fecha>.archive.gz
npm run respaldo

# Prueba de restauración en otra base (recomendado antes de restaurar producción)
npm run restaurar -- .\respaldos\respaldo-xxx.archive.gz --confirmar --destino=proveedor_restauracion

# Restauración sobre la base configurada (reemplaza colecciones)
npm run restaurar -- .\respaldos\respaldo-xxx.archive.gz --confirmar
```

- Los respaldos contienen datos personales: guárdalos cifrados y fuera del repositorio (`respaldos/` está en `.gitignore`).
- Las evidencias viven en `EVIDENCE_DIR`, no en MongoDB. Respáldalas aparte copiando esa carpeta.
- Atlas también ofrece respaldos automáticos en planes dedicados; este script es un complemento.

## Pruebas

```powershell
npm test
```

Usan una base de datos MongoDB en memoria (réplica de un nodo) llamada `proveedor_pruebas`, distinta de producción. La primera vez se descarga un binario de MongoDB (requiere internet). Si ya tienes `mongod` instalado, puedes usarlo:

```powershell
$env:MONGOMS_SYSTEM_BINARY = "C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe"
npm test
```

Cubren:

- Acceso sin sesión bloqueado en todas las rutas privadas.
- Cada rol ve solo lo suyo; el técnico sin cobranza, usuarios, auditoría ni tarifas.
- CSRF obligatorio y mensaje único de error de inicio de sesión.
- Bloqueo tras 20 intentos fallidos.
- Usuarios desactivados sin acceso.
- Nadie puede desactivarse a sí mismo.
- Cambio de contraseña cierra otras sesiones.
- Pagos repetidos rechazados.
- 40 cobros simultáneos sin duplicar ni pasar el saldo.
- Misma referencia en paralelo registrada una sola vez.
- 12 meses idempotentes.
- Conciliación sin duplicados y con filas inválidas reportadas.
- Límite de 20 horas por teléfono y bloqueo de tareas.
- Firma inválida del webhook rechazada sin procesar.
- Límites de la API (429) y forma de errores.
- Recorrido de todas las pantallas con los datos de demostración, sin errores.

Ninguna prueba usa datos reales.

## Estructura del código

```
src/
  server.js            Arranque, índices, tareas y apagado controlado (SIGTERM)
  app.js               Express: helmet, sesiones, CSRF, rutas y manejo de errores
  config.js            Validación de variables de entorno
  db.js · indices.js   Conexión, transacciones e índices
  permisos.js          Matriz de permisos, roles, menú e inactividad
  middleware/          Sesión, inactividad, permisos y CSRF
  lib/                 Dinero, fechas, teléfono, folios, auditoría, límites, archivos, CSV, correo, WhatsApp, vistas
  servicios/           Cobranza, conciliación, recordatorios, incidencias y tareas programadas
  rutas/               Un archivo por módulo (+ recurso.js, fábrica de CRUD con desactivación)
  vistas/              Plantillas EJS (escape automático)
public/                CSS, JS sin scripts en línea y logo
scripts/               seed, índices, respaldo y restauración
test/                  Pruebas automáticas
docs/                  Seguridad de base de datos
```

## Notas

- **Auditoría.** Registra usuario, fecha UTC y acción de:
  - inicios fallidos y bloqueos;
  - cambios de usuarios y permisos;
  - altas y cambios de solicitudes, contratos y planes;
  - pagos;
  - importaciones CSV;
  - estados de incidencias.

  Solo admin la ve, y la aplicación no tiene rutas para editarla ni borrarla.
- **Historial de incidencias.** Es inmutable: las correcciones son entradas nuevas.
- **Tarifa de cada contrato.** Se copia del plan al crearlo o al cambiar de plan. Los cambios de precio posteriores no alteran contratos existentes.
- **Métodos de pago.**
  - El efectivo se valida al registrarse.
  - Transferencia, depósito y tarjeta quedan "por validar". Mientras tanto, apartan saldo para que no se cobre de más.
  - La conciliación marca coincidencias exactas de referencia e importe, y permite validar desde ahí.
- **Nombre provisional.** El nombre "Proveedor de Internet" está en `src/app.js` (`EMPRESA`) y el logo en `public/img/logo.svg`.
