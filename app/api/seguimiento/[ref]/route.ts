// GET /api/seguimiento/[ref]?t=<código>   (público, con el código secreto del cobro)
// Lo que ve el CLIENTE en su página de seguimiento: cómo va su pedido. Solo
// responde si el código de la dirección coincide con el del cobro; nunca
// devuelve el celular ni datos de otros cobros.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { AlmacenNoConfigurado, leerCobro } from "@/lib/cobros";
import { FORMATO_NUM_REF } from "@/lib/pey";

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };
const noExiste = () => NextResponse.json({ error: "No existe ese pedido" }, { status: 404, headers: sinCache });

function mismoCodigo(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(peticion: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const codigo = new URL(peticion.url).searchParams.get("t") ?? "";
  if (!FORMATO_NUM_REF.test(ref) || codigo.length < 8) return noExiste();

  try {
    const cobro = await leerCobro(ref);
    if (!cobro || !cobro.token || !mismoCodigo(codigo, cobro.token)) return noExiste();

    const pagado = cobro.estado === "pagado";
    return NextResponse.json(
      {
        estado: cobro.estado,
        metodo: cobro.metodo,
        monto: pagado ? (cobro.montoPagado ?? cobro.monto) : cobro.monto,
        items: cobro.items,
        minutos: cobro.minutos,
        venceEn: cobro.venceEn,
        numero: cobro.numero,
        pagadoEn: cobro.pagadoEn,
        recogerEn:
          cobro.pagadoEn !== undefined && cobro.minutos !== undefined ? cobro.pagadoEn + cobro.minutos * 60_000 : undefined,
        // El enlace de pago solo se ofrece mientras el cobro espera.
        enlaceDePago: !pagado && cobro.metodo === "link" ? cobro.linkUrl : undefined,
        // Cuántas cifras del celular al que se mandó la solicitud, para que el cliente sepa cuál abrir.
        celularTermina: cobro.metodo === "push" && cobro.telefono ? cobro.telefono.slice(-4) : undefined,
      },
      { headers: sinCache },
    );
  } catch (error) {
    if (error instanceof AlmacenNoConfigurado) {
      return NextResponse.json({ error: "La app todavía no está configurada" }, { status: 503, headers: sinCache });
    }
    console.error("[seguimiento] error inesperado:", error);
    return NextResponse.json({ error: "No se pudo consultar" }, { status: 500, headers: sinCache });
  }
}
