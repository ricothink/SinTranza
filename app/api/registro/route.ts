// GET /api/registro
// El registro del día: los cobros que el banco YA selló hoy (hora de la Ciudad
// de México), el más nuevo primero, con su suma. Solo lee: no hay forma de
// cambiar nada desde aquí. Lo que sigue "esperando" no aparece ni se suma.

import { NextResponse } from "next/server";
import { AlmacenNoConfigurado, diaMx, listarCobrosPagados } from "@/lib/cobros";
import type { CobroRegistrado, ResumenDelDia } from "@/lib/registro";

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const dia = diaMx(Date.now());
    const pagados = await listarCobrosPagados(dia);

    const cobros: CobroRegistrado[] = pagados.map((cobro) => {
      const pagadoEn = cobro.pagadoEn ?? cobro.avisoEn ?? 0;
      return {
        ref: cobro.ref,
        numero: cobro.numero,
        monto: cobro.montoPagado ?? cobro.monto,
        pagadoEn,
        recogerEn: cobro.minutos !== undefined ? pagadoEn + cobro.minutos * 60_000 : undefined,
        minutos: cobro.minutos,
        items: cobro.items,
      };
    });

    // Las sumas se hacen en centavos (enteros) para que salgan exactas.
    const sumaCentavos = cobros.reduce((suma, cobro) => suma + Math.round(cobro.monto * 100), 0);
    const resumen: ResumenDelDia = { dia, cuantos: cobros.length, sumaCentavos, cobros };
    return NextResponse.json(resumen, { headers: sinCache });
  } catch (error) {
    if (error instanceof AlmacenNoConfigurado) {
      return NextResponse.json({ error: "La app todavía no está configurada" }, { status: 503, headers: sinCache });
    }
    console.error("[registro] error inesperado:", error);
    return NextResponse.json({ error: "No se pudo cargar el registro" }, { status: 500, headers: sinCache });
  }
}
