# Ya cayó

Web app móvil de una sola pantalla para cobrar con CoDi en mostrador:

**teclado → QR a pantalla completa → "PAGADO $X" en verde con sonido → "Nuevo cobro".**

Sin login, sin historial, sin panel. Publicada en https://ya-cayo.vercel.app

## Cómo funciona

1. El mostrador teclea el monto. `POST /api/cobros` guarda el cobro como **esperando** y pide a [Pey](https://docs.pey.mx) un QR CoDi con monto, concepto, expiración (6 min, el mínimo de Pey) y una referencia única de 7 dígitos.
2. El cliente escanea el QR con la app de su banco.
3. Pey avisa del pago a `POST /api/webhooks/pey`. Ahí se verifica la firma, se busca el cobro por referencia y se marca **pagado** una sola vez.
4. La pantalla pregunta el estado cada 2 s a `GET /api/cobros/[ref]` y, cuando ve "pagado", se pone verde y suena.

**Regla de oro:** el estado "pagado" solo lo pone el webhook con firma válida. El navegador solo pregunta; no hay ninguna ruta con la que pueda cambiarlo.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `lib/pey.ts` | Cliente del API de Pey (crear QR CoDi) y verificación de firma del webhook. |
| `lib/cobros.ts` | Almacén de cobros. Única función que marca "pagado": `marcarPagado`. |
| `app/api/cobros/route.ts` | Recibe el monto, crea el cobro "esperando" y devuelve el QR. |
| `app/api/cobros/[ref]/route.ts` | Devuelve el estado. Solo lectura. |
| `app/api/webhooks/pey/route.ts` | Verifica firma y marca "pagado" de forma idempotente. |
| `app/page.tsx` | La pantalla. |
| `scripts/probar-webhook.mjs` | Pruebas del webhook: firma inválida, reenvíos, avisos simultáneos. |

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
