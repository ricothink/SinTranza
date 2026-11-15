// POST /api/webhooks/pey
// Aquí avisa Pey que algo se pagó. Es la ÚNICA entrada que puede marcar un
// cobro como "pagado".
//
//   1. Se verifica la firma con el cuerpo crudo. Si no es válida: 401 y no pasa nada.
//   2. Según el tipo de aviso se busca el cobro y se confirma que sea el mismo:
//        codi.qr.payment_received → por referencia (numRef) y el QR (codiQrId)
//        codi.pn.payment_received → por referencia (numRef), método "push" y monto
//        payment_link.status_updated (paid) → por nuestra referencia (clientReferenceId),
//                                   el enlace (paymentLinkId) y monto
//   3. Se marca "pagado" una sola vez. Un aviso repetido responde 200 sin cambiar nada.

import { NextResponse } from "next/server";
import { AlmacenNoConfigurado, leerCobro, marcarPagado, type DatosDePago } from "@/lib/cobros";
import {
  EVENTO_ENLACE,
  EVENTO_PAGO_PN,
  EVENTO_PAGO_QR,
  FORMATO_NUM_REF,
  verificarWebhook,
  type EnlaceActualizado,
  type PagoPnRecibido,
  type PagoQrRecibido,
} from "@/lib/pey";

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };

/** Diferencia de centavos que se tolera al comparar montos (por redondeo de decimales). */
const TOLERANCIA = 0.005;

const aviso = (resultado: string) => NextResponse.json({ ok: true, resultado }, { headers: sinCache });

export async function POST(peticion: Request) {
  const secreto = process.env.PEY_WEBHOOK_SECRET;
  if (!secreto) {
    console.error("[webhook] falta PEY_WEBHOOK_SECRET");
    return NextResponse.json({ error: "Webhook sin configurar" }, { status: 503, headers: sinCache });
  }

  // El cuerpo se lee como texto y así se verifica: la firma cubre los bytes exactos.
  const crudo = await peticion.text();
  const webhookId = peticion.headers.get("webhook-id") ?? "";

  let evento: { type?: unknown };
  try {
    evento = verificarWebhook(crudo, peticion.headers, secreto) as { type?: unknown };
  } catch (error) {
    console.warn(`[webhook] RECHAZADO firma inválida webhook-id=${webhookId || "(sin id)"} motivo=${String(error)}`);
    return NextResponse.json({ error: "Firma inválida" }, { status: 401, headers: sinCache });
  }

  try {
    switch (evento?.type) {
      case EVENTO_PAGO_QR:
        return await alPagarQr(evento as Partial<PagoQrRecibido>, webhookId);
      case EVENTO_PAGO_PN:
        return await alPagarSolicitud(evento as Partial<PagoPnRecibido>, webhookId);
      case EVENTO_ENLACE:
        return await alActualizarseEnlace(evento as Partial<EnlaceActualizado>, webhookId);
      default:
        // Firma válida pero es otro tipo de aviso: se acusa recibo y no se hace nada.
        console.log(`[webhook] ignorado type=${String(evento?.type)} webhook-id=${webhookId}`);
        return aviso("ignorado");
    }
  } catch (error) {
    // Si el almacén falla se responde error para que Pey reintente después.
    const sinConfigurar = error instanceof AlmacenNoConfigurado;
    console.error("[webhook] no se pudo guardar el pago:", error);
    return NextResponse.json(
      { error: sinConfigurar ? "Almacén sin configurar" : "No se pudo guardar el pago" },
      { status: sinConfigurar ? 503 : 500, headers: sinCache },
    );
  }
}

/** Marca y deja la línea de registro. 200 en todos los casos con firma válida: Pey no necesita reintentar. */
async function marcar(tipo: string, ref: string, pago: DatosDePago, webhookId: string) {
  const resultado = await marcarPagado(ref, pago);
  console.log(
    `[webhook] ${resultado} tipo=${tipo} ref=${ref} monto=${pago.montoPagado} webhook-id=${webhookId} transactionId=${pago.transactionId}`,
  );
  return aviso(resultado);
}

// ---------------------------------------------------------------- QR

async function alPagarQr(evento: Partial<PagoQrRecibido>, webhookId: string) {
  const numRef = String(evento.numRef ?? "");
  const codiQrId = String(evento.codiQrId ?? "");
  const monto = Number(evento.amount);
  const fechaPago = Number(evento.datePaid);
  if (!FORMATO_NUM_REF.test(numRef) || !codiQrId || !Number.isFinite(monto) || !Number.isFinite(fechaPago)) {
    console.warn(`[webhook] aviso incompleto webhook-id=${webhookId} numRef=${numRef} codiQrId=${codiQrId}`);
    return aviso("ignorado");
  }
  return marcar(
    "qr",
    numRef,
    {
      llave: { campo: "codiQrId", valor: codiQrId },
      montoPagado: monto,
      pagadoEn: fechaPago * 1000, // datePaid viene en segundos
      transactionId: String(evento.transactionId ?? ""),
      webhookId,
    },
    webhookId,
  );
}

// ---------------------------------------------------------------- solicitud al celular

async function alPagarSolicitud(evento: Partial<PagoPnRecibido>, webhookId: string) {
  const numRef = String(evento.numRef ?? "");
  const monto = Number(evento.amount);
  const fechaPago = Number(evento.datePaid);
  const transactionId = String(evento.transactionId ?? "");
  if (!FORMATO_NUM_REF.test(numRef) || !Number.isFinite(monto) || !Number.isFinite(fechaPago) || !transactionId) {
    console.warn(`[webhook] aviso incompleto (solicitud) webhook-id=${webhookId} numRef=${numRef}`);
    return aviso("ignorado");
  }

  // El aviso de una solicitud no trae el identificador del QR: se comprueba que
  // el cobro exista, sea una solicitud al celular y que el monto sea el pedido.
  const cobro = await leerCobro(numRef);
  if (cobro && Math.abs(monto - cobro.monto) > TOLERANCIA) {
    console.warn(`[webhook] monto_distinto tipo=pn ref=${numRef} pagado=${monto} pedido=${cobro.monto} webhook-id=${webhookId}`);
    return aviso("monto_distinto");
  }
  return marcar(
    "pn",
    numRef,
    {
      llave: { campo: "metodo", valor: "push" },
      montoPagado: monto,
      pagadoEn: fechaPago * 1000,
      transactionId,
      webhookId,
    },
    webhookId,
  );
}

// ---------------------------------------------------------------- enlace de pago

async function alActualizarseEnlace(evento: Partial<EnlaceActualizado>, webhookId: string) {
  // Solo "paid" cuenta. "pending", "processing" y los parciales no marcan nada.
  if (evento.status !== "paid") {
    console.log(`[webhook] ignorado tipo=enlace status=${String(evento.status)} webhook-id=${webhookId}`);
    return aviso("ignorado");
  }

  const ref = String(evento.clientReferenceId ?? "");
  const paymentLinkId = String(evento.paymentLinkId ?? "");
  const transacciones = Array.isArray(evento.transactions) ? evento.transactions : [];
  if (!FORMATO_NUM_REF.test(ref) || !paymentLinkId || transacciones.length === 0) {
    console.warn(`[webhook] aviso incompleto (enlace) webhook-id=${webhookId} ref=${ref} enlace=${paymentLinkId}`);
    return aviso("ignorado");
  }

  // Lo que cuenta para el pedido es la base: la comisión de la tarjeta no es del platillo.
  const base = transacciones.reduce((suma, t) => suma + Number(t.amountBreakdown?.base ?? t.amount ?? 0), 0);
  const comision = transacciones.reduce((suma, t) => suma + Number(t.amountBreakdown?.fee ?? 0), 0);
  const fechaPago = Math.max(...transacciones.map((t) => Number(t.datePaid) || 0));
  if (!Number.isFinite(base) || base <= 0 || !fechaPago) {
    console.warn(`[webhook] aviso incompleto (enlace) webhook-id=${webhookId} ref=${ref} base=${base}`);
    return aviso("ignorado");
  }

  const cobro = await leerCobro(ref);
  if (cobro && base + TOLERANCIA < cobro.monto) {
    console.warn(`[webhook] monto_distinto tipo=enlace ref=${ref} pagado=${base} pedido=${cobro.monto} webhook-id=${webhookId}`);
    return aviso("monto_distinto");
  }
  return marcar(
    "enlace",
    ref,
    {
      llave: { campo: "linkId", valor: paymentLinkId },
      montoPagado: base,
      pagadoEn: fechaPago * 1000,
      transactionId: String(transacciones[0].transactionId ?? ""),
      webhookId,
      comision: comision > 0 ? comision : undefined,
    },
    webhookId,
  );
}
