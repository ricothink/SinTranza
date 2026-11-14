# Sin Tranza (Ya cayó)

Cobro con CoDi a través de [Pey](https://docs.pey.mx) para un negocio de **pedir, pagar y pasar a recoger**: Milpa · Cocina de Raíz (desayunos y comidas para llevar). Un vecino pasa, pide, le hacen el cobro con un QR, paga desde su banco y regresa a la hora que le indican. Pensado para el momento en que **el pago cae y la pantalla lo grita**:

**menú (se tocan platillos y se elige en cuántos minutos estará) → QR a pantalla completa → ¡YA CAYÓ! en verde, con sonido de caja, voz y vibración, y la hora a la que regresa el cliente → nuevo cobro.**

Además: un **registro del día** (tablero de control) con lo que el banco ya selló, y un teclado para cobrar un monto libre ("otro monto"). Sin login, sin inventario. Publicada en https://ya-cayo.vercel.app

El diseño (nota de remisión: papel, tinta y verde; golpes secos, sin sombras) viene de la maqueta `sin-tranza.html` de Ricardo.

## Precios de prueba

Mientras `PRECIOS_DE_PRUEBA` sea `true` en `lib/catalogo.ts`, **todo cuesta $0.01**. Los precios de la hoja del menú ya están guardados (`centavosReales`); para cobrar de verdad se pone `PRECIOS_DE_PRUEBA` en `false` y se publica. Ojo: la hoja dice "Precio BH" (precio especial para The Bright House Academy Coyoacán); falta confirmar si a los vecinos se les cobra ese mismo precio, y revisar los precios contra la hoja original (la foto estaba borrosa).

## Cómo funciona

1. Quien atiende toca los platillos y elige en cuántos minutos estará el pedido (10, 15, 20, 30, 45 o 60, contados desde el pago). Al cobrar, el celular manda solo `{ items: [{ id, cantidad }], minutos }` a `POST /api/cobros`. **El servidor calcula el total con su propio catálogo** (`lib/catalogo.ts`) y descarta cualquier precio o monto que mande el celular. Guarda el cobro como **esperando** y pide a Pey un QR CoDi con ese monto, concepto, expiración (6 min, el mínimo de Pey) y una referencia única de 7 dígitos.
2. El cliente escanea el QR con la app de su banco.
3. Pey avisa del pago a `POST /api/webhooks/pey`. Ahí se verifica la firma, se busca el cobro por referencia y se marca **pagado** una sola vez. En el mismo paso atómico se le asigna su **número de pedido del día** (1, 2, 3…) y entra al índice del registro.
4. La pantalla pregunta el estado cada 2 s a `GET /api/cobros/[ref]` y, cuando ve "pagado", se pone verde: suena la caja, una voz dice cuánto cayó, vibra, y aparece "REGRESA A LAS hh:mm", el número de pedido, lo pedido y el sello PAGADO. A los 10 s regresa sola al mostrador.
5. El registro (`GET /api/registro`, se abre tocando la tira de arriba) lista los cobros ya sellados de hoy en hora de la Ciudad de México, el más nuevo primero: hora, número de pedido, monto, hora de recoger y platillos, con la suma del día. Lo que sigue "esperando" no aparece ni se suma.

**Regla de oro:** el estado "pagado" solo lo pone el webhook con firma válida. El navegador solo pregunta; no hay ninguna ruta con la que pueda cambiarlo.

**Ojo con la privacidad:** el registro no pide clave: cualquiera con la dirección de la app puede verlo (ve montos, horas y platillos; no hay nombres ni teléfonos). Pendiente: ponerle un PIN.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `lib/pey.ts` | Cliente del API de Pey (crear QR CoDi) y verificación de firma del webhook. |
| `lib/catalogo.ts` | Menú de Milpa, interruptor de precios de prueba y cálculo del total. Los precios viven aquí, en el servidor. |
| `lib/cobros.ts` | Almacén de cobros. Única función que marca "pagado": `marcarPagado` (también asigna el número de pedido y llena el índice del día). |
| `lib/registro.ts` | Tipos del registro del día. |
| `lib/letra.ts` | Importe con letra ("quince pesos 50/100 M.N.") y la frase que dice la voz. |
| `lib/sonido.ts` | Clics, golpe del QR, caja registradora y voz: todo sintetizado, sin archivos de audio. |
| `app/api/cobros/route.ts` | Recibe el pedido (`items` y `minutos`) o un monto libre, crea el cobro "esperando" y devuelve el QR. |
| `app/api/cobros/[ref]/route.ts` | Devuelve el estado, lo pedido, el número de pedido y la hora de recoger. Solo lectura. |
| `app/api/registro/route.ts` | Devuelve el registro del día. Solo lectura. |
| `app/api/webhooks/pey/route.ts` | Verifica firma y marca "pagado" de forma idempotente. |
| `app/page.tsx` | La lógica de las pantallas (pedido, pedir el QR, preguntar el estado, sonido, registro). |
| `app/pantallas.tsx`, `app/ajusta.tsx`, `app/globals.css` | Cómo se ven: menú, tira, teclado, espera, YA CAYÓ, registro y error. |
| `scripts/probar-webhook.mjs` | Pruebas del webhook: firma inválida, reenvíos, avisos simultáneos, número de pedido y registro. |
| `scripts/probar-catalogo.mjs` | Pruebas del total y de la hora de entrega: el servidor ignora precios falsos y rechaza pedidos inválidos. |

## Variables de entorno

El repo es público: **ninguna llave va en el código.** Todo se lee de variables de entorno (ver `.env.example`).

| Variable | De dónde sale |
| --- | --- |
| `PEY_API_KEY` | portal.mipey.mx → Developer → Create API Key |
| `PEY_WEBHOOK_SECRET` | portal.mipey.mx → Developer → engrane de la llave → Create Webhook (empieza con `whsec_`) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis; en Vercel los pone la integración |

La dirección que se registra como webhook en Pey es `https://ya-cayo.vercel.app/api/webhooks/pey`.

## Datos de Pey usados (confirmados en docs.pey.mx)

- `POST https://api.pey.mx/codi/qr` con `Authorization: Bearer <llave>`; cuerpo `amount` (pesos MXN), `concept`, `expiration` (segundos, mínimo 360), `numRef` (1 a 7 dígitos). Respuesta `201` con `id` y `qrString`.
- Webhook `codi.qr.payment_received` con `amount`, `codiQrId`, `numRef`, `datePaid`, `transactionId`, entre otros.
- Firma [Standard Webhooks](https://www.standardwebhooks.com/): cabeceras `webhook-id`, `webhook-timestamp`, `webhook-signature`.

## Correr en local

```bash
npm install
npm run dev
```

Sin las variables del almacén, en local los cobros se guardan en memoria (solo para desarrollo; en producción la app se niega a arrancar sin almacén).

## Probar el webhook

```bash
PEY_WEBHOOK_SECRET=whsec_... node scripts/probar-webhook.mjs https://ya-cayo.vercel.app
```

Firma avisos de prueba con el mismo secreto que la app y comprueba rechazos, reenvíos y avisos simultáneos. El aviso "válido" de esta prueba es simulado: no sustituye un pago real.

## Probar el total y la hora de entrega

```bash
node scripts/probar-catalogo.mjs https://ya-cayo.vercel.app
```

No necesita secretos. Crea QR reales de Pey que nadie paga.

## Probar el flujo completo con un centavo

Con los precios de prueba, cualquier platillo cuesta $0.01. Se agrega, se elige el tiempo, se toca "Mostrar QR para cobrar", se escanea con la app del banco y se paga: es el flujo real completo por un centavo.

Ojo: las pruebas de scripts que usan un servidor local con las llaves reales escriben pagos simulados en el mismo Redis de producción y aparecen en el registro del día. Se quitan reconociendo su `transactionId` simulado; un pago real nunca se toca.
