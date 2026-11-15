// GET /api/salud   (público)
// Para quien revisa la app con un script o un agente: dice, sin secretos, si
// la app está viva, en qué modo está y qué rutas puede usar. Solo lee.

import { NextResponse } from "next/server";
import { PRECIOS_DE_PRUEBA } from "@/lib/catalogo";
import { versionDelRegistro } from "@/lib/cobros";
import { NEGOCIO, urlPublica } from "@/lib/negocio";
import { mostradorAbierto } from "@/lib/sesion";

export const dynamic = "force-dynamic";

export async function GET() {
  // Solo se dice si cada llave está puesta, nunca su valor.
  const pey = Boolean(process.env.PEY_API_KEY);
  const avisosDePey = Boolean(process.env.PEY_WEBHOOK_SECRET);
  const almacen = await versionDelRegistro().then(
    () => true,
    () => false,
  );
  const abierto = mostradorAbierto();
  const base = urlPublica();

  return NextResponse.json(
    {
      ok: pey && avisosDePey && almacen,
      app: "Sin Tranza",
      negocio: NEGOCIO.nombre,
      modo: abierto ? "abierto" : "con_pin",
      necesitaPin: !abierto,
      preciosDePrueba: PRECIOS_DE_PRUEBA,
      servicios: { almacen, pey, avisosDePey },
      hora: new Date().toISOString(),
      guia: `${base}/llms.txt`,
      repositorio: "https://github.com/ricothink/SinTranza",
      rutas: {
        mostrador: `${base}/`,
        demostracion: `${base}/demo`,
        menu: "GET /api/menu",
        crearCobro: 'POST /api/cobros  { "items": [{ "id": "chilaquiles", "cantidad": 1 }], "minutos": 20, "metodo": "qr" | "link" }',
        estadoDelCobro: "GET /api/cobros/{ref}",
        registroDelDia: "GET /api/registro",
        avisoDePey: "POST /api/webhooks/pey  (solo Pey, con firma)",
      },
      reglaDeOro: 'Un cobro solo pasa a "pagado" con el aviso firmado de Pey. Ninguna ruta pública puede marcarlo.',
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
