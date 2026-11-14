// POST /api/cobros
// Recibe la venta, guarda el cobro como "esperando", pide el QR a Pey y lo devuelve.
//
// La venta llega de dos formas:
//   { items: [{ id, cantidad }], minutos } → pedido del menú: el servidor calcula
//                                   el total con SU catálogo (lib/catalogo.ts).
//                                   "minutos" = en cuánto estará listo, contado
//                                   desde el pago (de 5 a 180).
//   { monto: "150.50" }           → cobro de monto libre (teclado), sin hora de entrega.
// Si vienen las dos, solo cuentan los productos: el monto que mande el celular
// no puede cambiar el total.

import { NextResponse } from "next/server";
import { armarCobro, leerMinutos, type LineaCobro } from "@/lib/catalogo";
import { AlmacenNoConfigurado, asignarQr, descartarCobro, guardarCobroEsperando } from "@/lib/cobros";
import { crearQrCodi, EXPIRACION_MINIMA_SEGUNDOS, PeyError } from "@/lib/pey";

export const dynamic = "force-dynamic";

/** Lo que ve quien paga en la app de su banco. Sin acentos a propósito. */
const CONCEPTO = "Cobro Ya cayo";

/** El QR vive lo mínimo que permite Pey: 6 minutos. */
const SEGUNDOS_DE_VIDA = EXPIRACION_MINIMA_SEGUNDOS;

const sinCache = { "Cache-Control": "no-store" };

/** Acepta 150, "150", "150.5", "0.01". Rechaza negativos, cero y más de 2 decimales. */
function leerMonto(valor: unknown): number | null {
  const texto = typeof valor === "number" ? String(valor) : typeof valor === "string" ? valor.trim() : "";
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(texto)) return null;
  const monto = Number(texto);
  return monto > 0 ? monto : null;
}

export async function POST(peticion: Request) {
  let cuerpo: unknown;
  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: "Falta el monto" }, { status: 400, headers: sinCache });
  }

  const entrada = cuerpo as { monto?: unknown; items?: unknown; minutos?: unknown } | null;
  let monto: number;
  let lineas: LineaCobro[] | undefined;
  let minutos: number | undefined;
  if (entrada?.items !== undefined) {
    const armado = armarCobro(entrada.items);
    if (!armado.ok) return NextResponse.json({ error: armado.error }, { status: 400, headers: sinCache });
    const tiempo = leerMinutos(entrada.minutos);
    if (!tiempo.ok) return NextResponse.json({ error: tiempo.error }, { status: 400, headers: sinCache });
    monto = armado.monto;
    lineas = armado.lineas;
    minutos = tiempo.minutos;
  } else {
    const libre = leerMonto(entrada?.monto);
    if (libre === null) return NextResponse.json({ error: "Monto inválido" }, { status: 400, headers: sinCache });
    monto = libre;
  }

  let ref: string | null = null;
  try {
    // 1. Se guarda primero como "esperando": así el aviso de pago siempre
    //    encuentra el cobro, por rápido que llegue.
    const cobro = await guardarCobroEsperando(monto, SEGUNDOS_DE_VIDA, lineas, minutos);
    ref = cobro.ref;

    // 2. Se pide el QR a Pey con esa misma referencia.
    const qr = await crearQrCodi({
      amount: monto,
      concept: CONCEPTO,
      expiration: SEGUNDOS_DE_VIDA,
      numRef: cobro.ref,
    });

    // 3. Se anota qué QR le tocó, para que el webhook lo pueda confirmar.
    await asignarQr(cobro.ref, qr.id);

    return NextResponse.json(
      {
        ref: cobro.ref,
        estado: cobro.estado,
        monto: cobro.monto,
        items: cobro.items,
        minutos: cobro.minutos,
        qrString: qr.qrString,
        creadoEn: cobro.creadoEn,
        venceEn: cobro.venceEn,
      },
      { status: 201, headers: sinCache },
    );
  } catch (error) {
    // Si el cobro se apartó pero no hubo QR, se borra: nadie lo puede pagar.
    if (ref) await descartarCobro(ref).catch(() => {});

    if (error instanceof AlmacenNoConfigurado || (error instanceof PeyError && error.message.includes("PEY_API_KEY"))) {
      console.error("[cobros] app sin configurar:", error.message);
      return NextResponse.json({ error: "La app todavía no está configurada" }, { status: 503, headers: sinCache });
    }
    if (error instanceof PeyError) {
      console.error("[cobros] Pey falló:", error.message, JSON.stringify(error.cuerpo));
      return NextResponse.json({ error: "No se pudo generar el QR. Intenta de nuevo." }, { status: 502, headers: sinCache });
    }
    console.error("[cobros] error inesperado:", error);
    return NextResponse.json({ error: "Algo falló. Intenta de nuevo." }, { status: 500, headers: sinCache });
  }
}
