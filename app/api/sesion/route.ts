// /api/sesion
//   GET    → { ok: true|false }  ¿hay una sesión del mostrador vigente?
//   POST   → { pin }             entra con el PIN y deja la cookie de sesión
//   DELETE →                     sale (borra la cookie)
//
// Un PIN equivocado se cuenta por dirección: a los 5 fallos en 10 minutos se
// bloquea ese intento hasta que pase la ventana.

import { NextResponse } from "next/server";
import { contarFalloDePin, fallosDePin, olvidarFallosDePin } from "@/lib/cobros";
import { cabeceraDeCookie, crearSesion, haySesion, pinCorrecto, sesionConfigurada } from "@/lib/sesion";

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };
const MAX_FALLOS = 5;

function direccionDe(peticion: Request): string {
  return (peticion.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconocida";
}

export async function GET(peticion: Request) {
  if (!sesionConfigurada()) {
    return NextResponse.json({ ok: false, configurada: false }, { status: 503, headers: sinCache });
  }
  return NextResponse.json({ ok: haySesion(peticion), configurada: true }, { headers: sinCache });
}

export async function POST(peticion: Request) {
  if (!sesionConfigurada()) {
    console.error("[sesion] falta PIN_MOSTRADOR o SESION_SECRETO: la app queda cerrada");
    return NextResponse.json({ error: "El mostrador todavía no tiene PIN" }, { status: 503, headers: sinCache });
  }

  // Bloqueo ANTES de revisar el PIN: pasados los fallos permitidos, ni el PIN correcto entra hasta que pase la ventana.
  const direccion = direccionDe(peticion);
  if ((await fallosDePin(direccion).catch(() => 0)) >= MAX_FALLOS) {
    return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429, headers: sinCache });
  }

  let pin = "";
  try {
    const cuerpo = (await peticion.json()) as { pin?: unknown } | null;
    pin = typeof cuerpo?.pin === "string" ? cuerpo.pin : "";
  } catch {
    // Sin cuerpo: se trata como PIN vacío.
  }

  if (!pinCorrecto(pin)) {
    const fallos = await contarFalloDePin(direccion).catch(() => 0);
    if (fallos >= MAX_FALLOS) {
      return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429, headers: sinCache });
    }
    return NextResponse.json({ error: "PIN incorrecto" }, { status: 401, headers: sinCache });
  }

  await olvidarFallosDePin(direccion).catch(() => {});
  return NextResponse.json(
    { ok: true },
    { headers: { ...sinCache, "Set-Cookie": cabeceraDeCookie(crearSesion()) } },
  );
}

export async function DELETE() {
  return NextResponse.json({ ok: true }, { headers: { ...sinCache, "Set-Cookie": cabeceraDeCookie("") } });
}
