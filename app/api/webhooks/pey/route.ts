// POST /api/webhooks/pey
// Aquí avisa Pey que un QR se pagó. Es la ÚNICA entrada que puede marcar
// un cobro como "pagado".
//
//   1. Se verifica la firma con el cuerpo crudo. Si no es válida: 401 y no pasa nada.
//   2. Se busca el cobro por referencia (numRef) y se confirma que el QR sea el mismo.
//   3. Se marca "pagado" una sola vez. Un aviso repetido responde 200 sin cambiar nada.

import { NextResponse } from "next/server";
import { AlmacenNoConfigurado, marcarPagado } from "@/lib/cobros";
import { EVENTO_PAGO_QR, FORMATO_NUM_REF, verificarWebhook, type PagoQrRecibido } from "@/lib/pey";

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };

export async function POST(peticion: Request) {
  const secreto = process.env.PEY_WEBHOOK_SECRET;
  if (!secreto) {
    console.error("[webhook] falta PEY_WEBHOOK_SECRET");
    return NextResponse.json({ error: "Webhook sin configurar" }, { status: 503, headers: sinCache });
  }

  // El cuerpo se lee como texto y así se verifica: la firma cubre los bytes exactos.
  const crudo = await peticion.text();
  const webhookId = peticion.headers.get("webhook-id") ?? "";

  let evento: Partial<PagoQrRecibido>;
  try {
    evento = verificarWebhook(crudo, peticion.headers, secreto) as Partial<PagoQrRecibido>;
  } catch (error) {
    console.warn(`[webhook] RECHAZADO firma inválida webhook-id=${webhookId || "(sin id)"} motivo=${String(error)}`);
    return NextResponse.json({ error: "Firma inválida" }, { status: 401, headers: sinCache });
  }

  // Firma válida pero es otro tipo de aviso: se acusa recibo y no se hace nada.
  if (evento?.type !== EVENTO_PAGO_QR) {
    console.log(`[webhook] ignorado type=${String(evento?.type)} webhook-id=${webhookId}`);
    return NextResponse.json({ ok: true, resultado: "ignorado" }, { headers: sinCache });
  }

  const numRef = String(evento.numRef ?? "");
  const codiQrId = String(evento.codiQrId ?? "");
  const monto = Number(evento.amount);
  const fechaPago = Number(evento.datePaid);
  if (!FORMATO_NUM_REF.test(numRef) || !codiQrId || !Number.isFinite(monto) || !Number.isFinite(fechaPago)) {
    console.warn(`[webhook] aviso incompleto webhook-id=${webhookId} numRef=${numRef} codiQrId=${codiQrId}`);
    return NextResponse.json({ ok: true, resultado: "ignorado" }, { headers: sinCache });
  }

  try {
    const resultado = await marcarPagado(numRef, {
      codiQrId,
      montoPagado: monto,
      pagadoEn: fechaPago * 1000, // datePaid viene en segundos
      transactionId: String(evento.transactionId ?? ""),
      webhookId,
    });
    console.log(
      `[webhook] ${resultado} ref=${numRef} codiQrId=${codiQrId} monto=${monto} webhook-id=${webhookId} transactionId=${String(evento.transactionId ?? "")}`,
    );
    // 200 en todos los casos con firma válida: el aviso se recibió bien y
    // Pey no necesita reintentarlo.
    return NextResponse.json({ ok: true, resultado }, { headers: sinCache });
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
