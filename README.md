# Sin Tranza (Ya cayó)

Cobro con CoDi a través de [Pey](https://docs.pey.mx) para un negocio de **pedir, pagar y pasar a recoger**: Milpa · Cocina de Raíz (desayunos y comidas para llevar). Un vecino pasa, pide, le hacen el cobro, paga y regresa a la hora que le indican. Pensado para el momento en que **el pago cae y la pantalla lo grita**:

**PIN → menú (se tocan platillos y se elige en cuántos minutos estará) → ¿cómo paga? → ¡YA CAYÓ! en verde, con sonido de caja, voz y vibración, y la hora a la que regresa el cliente.**

Se puede cobrar de tres maneras:

| Forma | Cuándo | Qué hace Pey |
| --- | --- | --- |
| **QR aquí** | el cliente está presente | Un QR CoDi en la pantalla del mostrador. |
| **A su celular** | el cliente no puede escanear su propio QR | Le manda una solicitud de pago CoDi al celular (10 dígitos); la acepta en la app de su banco. |
| **Enlace de pago** | el cliente está lejos | Una página de pago de Pey (tarjeta, Apple Pay, Google Pay o CoDi) que se manda por WhatsApp. |

Los cobros a distancia quedan **por cobrar**: el mostrador sigue atendiendo y, cuando cae el pago, la pantalla verde salta sola. Además: el **registro del día** (tablero de control), un teclado para cobrar un monto libre ("otro monto"), la **página de seguimiento del cliente** (`/p/<referencia>?t=<código>`) y los **mensajes de WhatsApp** de instrucciones y de confirmación de compra. Sin inventario. Publicada en https://ya-cayo.vercel.app

El diseño (nota de remisión: papel, tinta y verde; golpes secos, sin sombras) viene de la maqueta `sin-tranza.html` de Ricardo.

## Tablero, inteligencia y vista de demostración

**Para verla sin PIN: https://ya-cayo.vercel.app/demo** (el tablero y la inteligencia, solo con ventas de ejemplo).

En el mostrador, la franja de arriba trae el botón **VER TABLERO ›**. El tablero tiene dos pestañas:

- **Cobros de hoy**: lo que el banco ya selló y lo que sigue por cobrar.
- **Inteligencia**: venta del día, cobros, ticket promedio, hora pico, ventas por hora, últimos 7 días, cómo pagan (QR / celular / enlace) y lo que más se vende.

**Ventas de ejemplo.** Para que el tablero no se vea vacío en una demostración, se pueden intercalar ventas de ejemplo (botón QUITAR EJEMPLOS / VER CON EJEMPLOS; se recuerda en el aparato). Se fabrican en la pantalla (`lib/demo.ts`): **nunca se guardan, nunca pasan por el servidor y nunca tocan el almacén de cobros.** Llevan sello punteado **EJEMPLO** (no el sello PAGADO), la suma dice cuántas son de ejemplo y usan los precios de la hoja del menú. La franja del mostrador y la pantalla verde siguen leyendo solo cobros reales. La regla de oro no cambia: "pagado" solo lo pone el aviso firmado de Pey.

## PIN del mostrador

Todo lo del mostrador (crear cobros, ver el registro, mandar solicitudes al celular) exige entrar con el PIN. Si faltan `PIN_MOSTRADOR` o `SESION_SECRETO` la app queda **cerrada**, nunca abierta. La sesión es una cookie firmada que dura 12 horas; 5 PIN equivocados seguidos desde una misma dirección la bloquean 10 minutos (ni el PIN correcto entra mientras dure). Lo único público es el aviso de Pey (lleva su propia firma) y la página de seguimiento del cliente (lleva su propio código secreto en la dirección).

## Precios de prueba

Mientras `PRECIOS_DE_PRUEBA` sea `true` en `lib/catalogo.ts`, **todo cuesta $0.01**. Los precios de la hoja del menú ya están guardados (`centavosReales`); para cobrar de verdad se pone `PRECIOS_DE_PRUEBA` en `false` y se publica. Ojo: la hoja dice "Precio BH" (precio especial para The Bright House Academy Coyoacán); falta confirmar si a los vecinos se les cobra ese mismo precio, y revisar los precios contra la hoja original (la foto estaba borrosa).

## Cómo funciona

1. Quien atiende toca los platillos y elige en cuántos minutos estará el pedido (10, 15, 20, 30, 45 o 60, contados desde el pago). Al tocar COBRAR elige la forma de pago. El celular manda solo `{ items: [{ id, cantidad }], minutos, metodo, telefono? }` a `POST /api/cobros`. **El servidor calcula el total con su propio catálogo** (`lib/catalogo.ts`) y descarta cualquier precio o monto que mande el celular. Guarda el cobro como **esperando** y lo pide a Pey con una referencia única de 7 dígitos.
2. El cliente paga: escanea el QR, acepta la solicitud en su banco o paga en el enlace.
3. Pey avisa a `POST /api/webhooks/pey`. Ahí se verifica la firma, se busca el cobro y se confirma que el aviso es de **ese** cobro:
   - QR (`codi.qr.payment_received`): por referencia y por el identificador del QR.
   - Solicitud al celular (`codi.pn.payment_received`): por referencia, método y monto.
   - Enlace (`payment_link.status_updated` con estado `paid`): por la referencia que mandamos al crearlo, el identificador del enlace y el monto. Lo que cuenta para el pedido es la base; la comisión de la tarjeta se anota aparte.

   Se marca **pagado** una sola vez y, en el mismo paso atómico, se asigna el **número de pedido del día** (1, 2, 3…), se anota en el índice del registro, se quita de los pendientes y sube la versión del registro.
4. La pantalla pregunta el estado cada 2 s (QR) o revisa el registro cada 3 s (cobros a distancia; cada 20 s si no hay nada esperando; solo con la pestaña a la vista) y, cuando cae, se pone verde: suena la caja, una voz dice cuánto cayó, vibra, y aparece "REGRESA A LAS hh:mm", el número de pedido, lo pedido y el sello PAGADO. A los 10 s regresa sola al mostrador. Si cae un pago a distancia mientras se arma otro pedido, el pedido a medias se conserva.
5. El cliente puede seguir su pedido en `/p/<referencia>?t=<código>`: esperando su pago (con el botón PAGAR AHORA en el enlace) y, al pagar, verde con la hora de regreso y la dirección.
6. El registro (`GET /api/registro`, se abre tocando la tira de arriba) lista lo **por cobrar** y los cobros ya sellados de hoy (hora de la Ciudad de México, el más nuevo primero), con hora, número de pedido, forma de pago, monto, hora de recoger y platillos, y la suma del día. Lo que sigue esperando no cuenta en la suma. Cada fila con celular tiene su botón de WhatsApp.

**Regla de oro:** el estado "pagado" solo lo pone el webhook de Pey con firma válida. El navegador solo pregunta; no hay ninguna ruta con la que pueda cambiarlo.

## WhatsApp

No hay envío automático (eso requiere la API de WhatsApp Business de Meta, con cuenta verificada y plantillas aprobadas). Los mensajes se arman en `lib/whatsapp.ts` y se abren con un enlace `wa.me` con el texto ya escrito: quien atiende solo toca "enviar". Hay dos mensajes: **instrucciones** (al cobrar a distancia: qué pidió, total, cómo pagar y la liga de seguimiento) y **confirmación de compra** (al caer el pago: pedido, total, hora y dirección donde recoger; sale en la pantalla verde y en cada fila pagada del registro).

El celular del cliente se guarda junto al cobro (mismo tiempo de vida: 24 horas, 7 días en los enlaces) y solo lo ve el personal con PIN; la página pública del cliente nunca lo muestra completo.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `lib/pey.ts` | Cliente del API de Pey (QR CoDi, solicitud al celular, enlace de pago) y verificación de firma del webhook. |
| `lib/catalogo.ts` | Menú de Milpa, interruptor de precios de prueba, cálculo del total y validación de la hora de entrega. Los precios viven aquí, en el servidor. |
| `lib/cobros.ts` | Almacén de cobros. Única función que marca "pagado": `marcarPagado` (también asigna el número de pedido, llena el índice del día y actualiza los pendientes). |
| `lib/sesion.ts` | PIN del mostrador y sesión firmada. |
| `lib/registro.ts` | Tipos del registro del día. |
| `lib/demo.ts` | Ventas de ejemplo (solo en pantalla, nunca en el almacén). |
| `lib/inteligencia.ts` | Las cuentas de la pantalla de inteligencia. |
| `app/demo/page.tsx` | Vista pública de demostración, sin PIN y sin datos reales. |
| `lib/negocio.ts`, `lib/whatsapp.ts`, `lib/hora.ts` | Datos de Milpa, mensajes de WhatsApp y formato de horas. |
| `lib/letra.ts` | Importe con letra ("quince pesos 50/100 M.N.") y la frase que dice la voz. |
| `lib/sonido.ts` | Clics, golpe del QR, caja registradora y voz: todo sintetizado, sin archivos de audio. |
| `app/api/sesion/route.ts` | Entrar con el PIN, saber si hay sesión y salir. |
| `app/api/cobros/route.ts` | Recibe el pedido (`items`, `minutos`, `metodo`, `telefono`) o un monto libre, crea el cobro y lo pide a Pey. |
| `app/api/cobros/[ref]/route.ts` | Devuelve el estado, lo pedido, el número de pedido y la hora de recoger. Solo lectura, con PIN. |
| `app/api/registro/route.ts` | Devuelve el registro del día y los pendientes. Solo lectura, con PIN. |
| `app/api/seguimiento/[ref]/route.ts` | Lo que ve el cliente de su pedido (con su código secreto). |
| `app/api/webhooks/pey/route.ts` | Verifica firma y marca "pagado" de forma idempotente (QR, solicitud al celular y enlace). |
| `app/page.tsx` | La lógica de las pantallas. |
| `app/pantallas.tsx`, `app/ajusta.tsx`, `app/globals.css` | Cómo se ven: PIN, menú, tira, teclado, ¿cómo paga?, celular, espera, YA CAYÓ, registro y error. |
| `app/p/[ref]/` | La página de seguimiento del cliente. |
| `scripts/probar-webhook.mjs` | Pruebas del webhook: firma inválida, reenvíos, avisos simultáneos, número de pedido y registro. |
| `scripts/probar-catalogo.mjs` | Pruebas del total y de la hora de entrega. |
| `scripts/probar-remoto.mjs` | Pruebas del PIN, del cobro por enlace, del seguimiento y de que cada aviso solo marca su propio cobro. |

## Variables de entorno

El repo es público: **ninguna llave va en el código.** Todo se lee de variables de entorno (ver `.env.example`).

| Variable | De dónde sale |
| --- | --- |
| `PEY_API_KEY` | portal.mipey.mx → Developer → Create API Key |
| `PEY_WEBHOOK_SECRET` | portal.mipey.mx → Developer → engrane de la llave → Create Webhook (empieza con `whsec_`) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis; en Vercel los pone la integración |
| `PIN_MOSTRADOR` | El PIN del mostrador (4 a 8 números). Lo elige el dueño. |
| `SESION_SECRETO` | Texto largo al azar (mínimo 32 caracteres) para firmar la sesión. |
| `APP_PUBLICA` | Opcional. Dirección HTTPS pública (por omisión `https://ya-cayo.vercel.app`); va en los enlaces al cliente y es a donde Pey lo regresa. |

La dirección que se registra como webhook en Pey es `https://ya-cayo.vercel.app/api/webhooks/pey`. **El webhook debe estar suscrito a los tres tipos de aviso** (QR, solicitud al celular y enlace de pago), o a todos.

## Datos de Pey usados (confirmados en docs.pey.mx y su especificación `/openapi.json`)

- QR: `POST /codi/qr` con `Authorization: Bearer <llave>`; `amount`, `concept`, `expiration` (mínimo 360), `numRef` (1 a 7 dígitos). Respuesta `201` con `id` y `qrString`. Aviso `codi.qr.payment_received`.
- Solicitud al celular: `POST /codi/pn`; `amount`, `phoneNumber` (10 dígitos), `concept`, `expiration` (mínimo 360), `numRef`. Respuesta `200` con `transactionId` y `codiId`. Aviso `codi.pn.payment_received` (`amount`, `numRef`, `transactionId`, `datePaid`…; no trae el identificador del QR).
- Enlace de pago: `POST /payment-link/create`; `amount`, `successUrl` y `backUrl` (HTTPS), `clientReferenceId`. Respuesta `200` con `id` y `url`. Aviso `payment_link.status_updated` (`paymentLinkId`, `status`, `clientReferenceId`, `transactions[]` con `amountBreakdown` base/tip/fee). El enlace no vence y no se puede cancelar.
- No hay cobro por transferencia SPEI con seguimiento (ni cuenta CLABE): lo que se pague por fuera, o en efectivo, lo tendría que confirmar el vendedor (pendiente).
- Firma [Standard Webhooks](https://www.standardwebhooks.com/): cabeceras `webhook-id`, `webhook-timestamp`, `webhook-signature`.

## Correr en local

```bash
npm install
npm run dev
```

Pon `PIN_MOSTRADOR` y `SESION_SECRETO` en `.env.local` (sin ellos la app queda cerrada). Sin las variables del almacén, en local los cobros se guardan en memoria (solo para desarrollo; en producción la app se niega a arrancar sin almacén).

## Pruebas

Los scripts entran con el PIN: pásalo en `PIN_MOSTRADOR`.

```bash
PIN_MOSTRADOR=123456 PEY_WEBHOOK_SECRET=whsec_... node scripts/probar-webhook.mjs https://ya-cayo.vercel.app
PIN_MOSTRADOR=123456 node scripts/probar-catalogo.mjs https://ya-cayo.vercel.app
PIN_MOSTRADOR=123456 PEY_WEBHOOK_SECRET=whsec_... node scripts/probar-remoto.mjs https://ya-cayo.vercel.app
```

Firman avisos simulados con el mismo secreto que la app; sirven para probar la lógica, no sustituyen un pago real. Crean cobros reales en Pey que nadie paga. **No mandan ninguna solicitud de pago a un celular** (eso le llega a una persona de verdad): la solicitud al celular se prueba a mano con tu propio número.

Ojo: las pruebas contra un servidor local que usa las llaves reales escriben pagos simulados en el mismo Redis de producción y aparecen en el registro del día. Se quitan reconociendo su `transactionId` simulado y el celular de prueba `5500000001`; un pago real nunca se toca.

## Probar el flujo completo con un centavo

Con los precios de prueba, cualquier platillo cuesta $0.01. Se agrega, se elige el tiempo, se toca COBRAR y se escoge la forma de pago: es el flujo real completo por un centavo.
