# Sin Tranza (Ya cayó)

Mostrador de una tiendita que cobra con CoDi a través de [Pey](https://docs.pey.mx), pensado para el momento en que **el pago cae y la pantalla lo grita**:

**mostrador (se tocan productos) → QR a pantalla completa → ¡YA CAYÓ! en verde, con sonido de caja, voz y vibración → nuevo cobro.**

También hay un teclado para cobrar un monto libre (botón "otro monto"). Sin login, sin inventario, sin historial. Publicada en https://ya-cayo.vercel.app

El diseño (nota de remisión: papel, tinta y verde; golpes secos, sin sombras) viene de la maqueta `sin-tranza.html` de Ricardo. La lógica de venta es una versión mínima de la Tiendita (`ricothink/Tiendita`): solo catálogo, carrito y cobro, sin existencias ni caja.

## Cómo funciona

1. En el mostrador se tocan productos. Al cobrar, el celular manda solo `{ id, cantidad }` a `POST /api/cobros`. **El servidor calcula el total con su propio catálogo** (`lib/catalogo.ts`) y descarta cualquier precio o monto que mande el celular. Guarda el cobro como **esperando** y pide a Pey un QR CoDi con ese monto, concepto, expiración (6 min, el mínimo de Pey) y una referencia única de 7 dígitos.
2. El cliente escanea el QR con la app de su banco.
3. Pey avisa del pago a `POST /api/webhooks/pey`. Ahí se verifica la firma, se busca el cobro por referencia y se marca **pagado** una sola vez.
4. La pantalla pregunta el estado cada 2 s a `GET /api/cobros/[ref]` y, cuando ve "pagado", se pone verde: suena la caja, una voz dice cuánto cayó ("Ya cayeron cincuenta y cuatro pesos"), vibra, y aparece lo vendido con el sello PAGADO. A los 10 s regresa sola al mostrador.

**Regla de oro:** el estado "pagado" solo lo pone el webhook con firma válida. El navegador solo pregunta; no hay ninguna ruta con la que pueda cambiarlo.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `lib/pey.ts` | Cliente del API de Pey (crear QR CoDi) y verificación de firma del webhook. |
| `lib/catalogo.ts` | Catálogo de ejemplo y cálculo del total. Los precios viven aquí, en el servidor. |
| `lib/cobros.ts` | Almacén de cobros. Única función que marca "pagado": `marcarPagado`. |
| `lib/letra.ts` | Importe con letra ("quince pesos 50/100 M.N.") y la frase que dice la voz. |
| `lib/sonido.ts` | Clics, golpe del QR, caja registradora y voz: todo sintetizado, sin archivos de audio. |
| `app/api/cobros/route.ts` | Recibe la venta (`items`) o un monto libre, crea el cobro "esperando" y devuelve el QR. |
| `app/api/cobros/[ref]/route.ts` | Devuelve el estado y lo vendido. Solo lectura. |
| `app/api/webhooks/pey/route.ts` | Verifica firma y marca "pagado" de forma idempotente. |
| `app/page.tsx` | La lógica de las pantallas (carrito, pedir el QR, preguntar el estado, sonido). |
| `app/pantallas.tsx`, `app/ajusta.tsx`, `app/globals.css` | Cómo se ven: mostrador, teclado, espera, YA CAYÓ y error. |
| `scripts/probar-webhook.mjs` | Pruebas del webhook: firma inválida, reenvíos, avisos simultáneos. |
| `scripts/probar-catalogo.mjs` | Pruebas del total: el servidor ignora precios falsos y rechaza ventas inválidas. |

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

## Probar el total de la tiendita

```bash
node scripts/probar-catalogo.mjs https://ya-cayo.vercel.app
```

No necesita secretos. Crea QR reales de Pey que nadie paga.

## Probar el flujo completo con un centavo

En el mostrador hay un producto "Prueba: 1 centavo" (sección "Para probar"). Se agrega, se toca "Mostrar QR para cobrar", se escanea con la app del banco y se paga: es el flujo real completo por un centavo.
