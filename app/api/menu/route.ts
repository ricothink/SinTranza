// GET /api/menu   (público)
// El menú tal como lo usa el servidor para calcular el total: con estos "id"
// se arma un cobro en POST /api/cobros. Solo lee.

import { NextResponse } from "next/server";
import {
  CATEGORIAS,
  MINUTOS_POR_OMISION,
  OPCIONES_DE_MINUTOS,
  PRECIOS_DE_PRUEBA,
  PRODUCTOS,
} from "@/lib/catalogo";
import { NEGOCIO } from "@/lib/negocio";

export async function GET() {
  return NextResponse.json({
    negocio: NEGOCIO.nombre,
    preciosDePrueba: PRECIOS_DE_PRUEBA,
    moneda: "MXN",
    minutos: { opciones: OPCIONES_DE_MINUTOS, porOmision: MINUTOS_POR_OMISION },
    categorias: CATEGORIAS,
    productos: PRODUCTOS.map((producto) => ({
      id: producto.id,
      nombre: producto.nombre,
      categoria: producto.categoria,
      /** Lo que se cobra hoy, en pesos. */
      precio: producto.centavos / 100,
      /** El precio de la hoja del menú, en pesos. */
      precioDeLista: producto.centavosReales / 100,
    })),
  });
}
