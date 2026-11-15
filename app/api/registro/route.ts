// GET /api/registro   (solo con sesión del mostrador)
// El registro del día: los cobros que el banco YA selló hoy (hora de la Ciudad
// de México), el más nuevo primero, con su suma; más los cobros a distancia que
// siguen esperando el pago ("por cobrar"). Solo lee: no hay forma de cambiar
// nada desde aquí. Lo que sigue "esperando" no entra a la suma ni al conteo.
//
// Para preguntar barato si hay novedades se puede mandar ?v=<versión que ya
// tienes>: si no cambió nada responde solo { version, sinCambios: true }.

import { NextResponse } from "next/server";
import {
  AlmacenNoConfigurado,
  diaMx,
  listarCobrosPagados,
  listarCobrosPendientes,
  versionDelRegistro,
} from "@/lib/cobros";
import { urlPublica } from "@/lib/negocio";
import type { CobroPendiente, CobroRegistrado, ResumenDelDia } from "@/lib/registro";
import { exigirAcceso } from "@/lib/sesion";

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };

export async function GET(peticion: Request) {
  const paso = exigirAcceso(peticion);
  if (paso.bloqueo) return paso.bloqueo;
  // Los celulares de los clientes solo los ve el personal (con PIN), nunca un invitado.
  const conCelulares = paso.acceso === "personal";

  try {
    const version = await versionDelRegistro();
    const conocida = new URL(peticion.url).searchParams.get("v");
    if (conocida !== null && conocida === String(version)) {
      return NextResponse.json({ version, sinCambios: true }, { headers: sinCache });
    }

    const dia = diaMx(Date.now());
    const [pagados, esperando] = await Promise.all([listarCobrosPagados(dia), listarCobrosPendientes()]);
    const publica = urlPublica();

    const cobros: CobroRegistrado[] = pagados.map((cobro) => {
      const pagadoEn = cobro.pagadoEn ?? cobro.avisoEn ?? 0;
      return {
        ref: cobro.ref,
        metodo: cobro.metodo,
        numero: cobro.numero,
        monto: cobro.montoPagado ?? cobro.monto,
        pagadoEn,
        recogerEn: cobro.minutos !== undefined ? pagadoEn + cobro.minutos * 60_000 : undefined,
        minutos: cobro.minutos,
        items: cobro.items,
        telefono: conCelulares ? cobro.telefono : undefined,
      };
    });

    const pendientes: CobroPendiente[] = esperando
      .filter((cobro) => cobro.metodo !== "qr")
      .map((cobro) => ({
        ref: cobro.ref,
        metodo: cobro.metodo as "push" | "link",
        monto: cobro.monto,
        creadoEn: cobro.creadoEn,
        venceEn: cobro.venceEn,
        minutos: cobro.minutos,
        items: cobro.items,
        telefono: conCelulares ? cobro.telefono : undefined,
        seguimiento: `${publica}/p/${cobro.ref}?t=${cobro.token ?? ""}`,
        enlaceDePago: cobro.linkUrl,
      }));

    // Las sumas se hacen en centavos (enteros) para que salgan exactas.
    const sumaCentavos = cobros.reduce((suma, cobro) => suma + Math.round(cobro.monto * 100), 0);
    const resumen: ResumenDelDia = { version, dia, cuantos: cobros.length, sumaCentavos, cobros, pendientes };
    return NextResponse.json(resumen, { headers: sinCache });
  } catch (error) {
    if (error instanceof AlmacenNoConfigurado) {
      return NextResponse.json({ error: "La app todavía no está configurada" }, { status: 503, headers: sinCache });
    }
    console.error("[registro] error inesperado:", error);
    return NextResponse.json({ error: "No se pudo cargar el registro" }, { status: 500, headers: sinCache });
  }
}
