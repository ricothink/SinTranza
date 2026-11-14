// GET /api/cobros/[ref]
// Devuelve el estado del cobro. Solo lee: desde aquí no se puede cambiar nada.

import { NextResponse } from "next/server";
import { AlmacenNoConfigurado, leerCobro } from "@/lib/cobros";
import { FORMATO_NUM_REF } from "@/lib/pey";

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };

export async function GET(_peticion: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!FORMATO_NUM_REF.test(ref)) {
    return NextResponse.json({ error: "No existe ese cobro" }, { status: 404, headers: sinCache });
  }

  try {
    const cobro = await leerCobro(ref);
    if (!cobro) {
      return NextResponse.json({ error: "No existe ese cobro" }, { status: 404, headers: sinCache });
    }
    return NextResponse.json(
      {
        ref: cobro.ref,
        estado: cobro.estado,
        monto: cobro.monto,
        items: cobro.items,
        creadoEn: cobro.creadoEn,
        venceEn: cobro.venceEn,
        // Solo vienen cuando ya está pagado:
        montoPagado: cobro.montoPagado,
        pagadoEn: cobro.pagadoEn,
        avisoEn: cobro.avisoEn,
      },
      { headers: sinCache },
    );
  } catch (error) {
    if (error instanceof AlmacenNoConfigurado) {
      return NextResponse.json({ error: "La app todavía no está configurada" }, { status: 503, headers: sinCache });
    }
    console.error("[estado] error inesperado:", error);
    return NextResponse.json({ error: "No se pudo consultar" }, { status: 500, headers: sinCache });
  }
}
