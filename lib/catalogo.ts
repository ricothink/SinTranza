// Menú de Milpa · Cocina de Raíz y cálculo del total.
//
// Los precios viven AQUÍ, en el servidor. El celular solo manda "qué platillo
// y cuántos": el total lo calcula esta función. Así nadie puede cobrarse menos
// editando la petición.
//
// PRECIOS DE PRUEBA: mientras PRECIOS_DE_PRUEBA sea true, TODO se cobra a $0.01
// (un centavo). Los precios reales de la hoja ya están guardados (centavosReales);
// para cobrar de verdad basta poner PRECIOS_DE_PRUEBA en false y publicar.
//
// OJO: los precios de la hoja dicen "Precio BH" (precio especial para The
// Bright House Academy Coyoacán). Falta confirmar si a los vecinos se les cobra
// ese mismo precio.
//
// Se usa también en pantalla, por eso no depende de nada del servidor.

export const PRECIOS_DE_PRUEBA = true;
const CENTAVOS_DE_PRUEBA = 1;

export type CategoriaId = "desayunos" | "comidas" | "bebidas" | "postres";

export type Producto = {
  id: string;
  nombre: string;
  categoria: CategoriaId;
  /** Lo que se cobra hoy, en centavos (para que las sumas sean exactas). */
  centavos: number;
  /** Precio de la hoja del menú, en centavos. */
  centavosReales: number;
};

export const CATEGORIAS: ReadonlyArray<{ id: CategoriaId; titulo: string }> = [
  { id: "desayunos", titulo: "Desayunos" },
  { id: "comidas", titulo: "Comidas" },
  { id: "bebidas", titulo: "Bebidas" },
  { id: "postres", titulo: "Postres" },
];

// [categoría, id, nombre, precio de la hoja en pesos]
const MENU: ReadonlyArray<readonly [CategoriaId, string, string, number]> = [
  ["desayunos", "bowl-frutas-amaranto", "Bowl de Frutas con Amaranto", 130],
  ["desayunos", "bowl-avena", "Bowl de Avena", 130],
  ["desayunos", "tosta-aguacate", "Tosta de Aguacate, Frijoles y Huevo", 160],
  ["desayunos", "huevos-rancheros", "Huevos Rancheros de Milpa", 130],
  ["desayunos", "molletes", "Molletes de Masa Madre", 130],
  ["desayunos", "trio-quesadillas", "Trío de Quesadillas", 130],
  ["desayunos", "enfrijoladas", "Enfrijoladas de Milpa", 160],
  ["desayunos", "chilaquiles", "Chilaquiles Verdes o Rojos", 150],

  ["comidas", "bowl-quinoa-salmon", "Bowl de Quinoa con Salmón", 155],
  ["comidas", "bowl-arroz-pollo", "Bowl de Arroz Integral con Pollo", 165],
  ["comidas", "bowl-arroz-cilantro-atun", "Bowl de Arroz al Cilantro con Atún", 170],
  ["comidas", "bowl-vegetariano", "Bowl Vegetariano de Frijol y Aguacate", 90],
  ["comidas", "bowl-quinoa-pollo-pipian", "Bowl de Quinoa con Pollo y Pipián", 165],
  ["comidas", "bowl-arroz-camote", "Bowl de Arroz Integral y Camote Asado", 120],
  ["comidas", "ensalada-salmon", "Ensalada Verde con Salmón", 165],
  ["comidas", "tacos-nopal", "Tacos de Nopal Asado", 90],
  ["comidas", "aguachile-champinon", "Aguachile de Champiñón", 120],
  ["comidas", "sopa-lentejas", "Sopa de Lentejas con Plátano", 120],
  ["comidas", "mole-negro", "Mole Negro con Pollo", 210],
  ["comidas", "enchiladas-verdes", "Enchiladas Verdes", 170],
  ["comidas", "tinga-hongos", "Tinga de Hongos con “Arroz” de Coliflor", 120],
  ["comidas", "caldo-tlalpeno", "Caldo Tlalpeño", 135],

  ["bebidas", "agua-temporada", "Agua de Temporada", 40],
  ["bebidas", "cafe-olla", "Café de Olla 280 ml", 40],
  ["bebidas", "jugo-verde", "Jugo Verde 400 ml", 55],
  ["bebidas", "jugo-naranja", "Jugo de Naranja 400 ml", 40],

  ["postres", "arroz-leche-coco", "Arroz con Leche de Coco", 80],
  ["postres", "flan-vainilla", "Flan de Vainilla", 120],
];

export const PRODUCTOS: ReadonlyArray<Producto> = MENU.map(([categoria, id, nombre, pesos]) => ({
  id,
  nombre,
  categoria,
  centavosReales: pesos * 100,
  centavos: PRECIOS_DE_PRUEBA ? CENTAVOS_DE_PRUEBA : pesos * 100,
}));

const POR_ID = new Map(PRODUCTOS.map((producto) => [producto.id, producto]));

/** Una línea ya cobrada: se guarda con nombre y precio de ese momento. */
export type LineaCobro = {
  id: string;
  nombre: string;
  /** Precio unitario en pesos. */
  precio: number;
  cantidad: number;
};

export const MAX_CANTIDAD_POR_PRODUCTO = 99;
export const MAX_LINEAS = 40;

// ---------------------------------------------------------------- hora de recoger

/** Los botones de "listo en … min" que ve quien atiende. */
export const OPCIONES_DE_MINUTOS: ReadonlyArray<number> = [10, 15, 20, 30, 45, 60];
export const MINUTOS_POR_OMISION = 20;
export const MIN_MINUTOS = 5;
export const MAX_MINUTOS = 180;

export type MinutosLeidos = { ok: true; minutos?: number } | { ok: false; error: string };

/** Sin minutos está bien (cobro libre). Si vienen, deben ser un entero de 5 a 180. */
export function leerMinutos(valor: unknown): MinutosLeidos {
  if (valor === undefined || valor === null) return { ok: true };
  if (!Number.isInteger(valor) || (valor as number) < MIN_MINUTOS || (valor as number) > MAX_MINUTOS) {
    return { ok: false, error: `El tiempo de entrega debe ser de ${MIN_MINUTOS} a ${MAX_MINUTOS} minutos` };
  }
  return { ok: true, minutos: valor as number };
}

// ---------------------------------------------------------------- total

export type CobroArmado =
  | { ok: true; lineas: LineaCobro[]; centavos: number; monto: number }
  | { ok: false; error: string };

/**
 * Convierte lo que manda el celular ([{ id, cantidad }]) en líneas con precio
 * y un total. Ignora cualquier otro campo que venga en la petición (precio,
 * total…): solo cuentan el platillo y la cantidad.
 */
export function armarCobro(entrada: unknown): CobroArmado {
  if (!Array.isArray(entrada) || entrada.length === 0) {
    return { ok: false, error: "No hay productos en la venta" };
  }
  if (entrada.length > MAX_LINEAS) {
    return { ok: false, error: "Demasiados productos distintos en una venta" };
  }

  const cantidades = new Map<string, number>();
  for (const linea of entrada) {
    const id = (linea as { id?: unknown } | null)?.id;
    const cantidad = (linea as { cantidad?: unknown } | null)?.cantidad;
    if (typeof id !== "string" || !POR_ID.has(id)) {
      return { ok: false, error: "Hay un producto que no existe" };
    }
    if (!Number.isInteger(cantidad) || (cantidad as number) < 1 || (cantidad as number) > MAX_CANTIDAD_POR_PRODUCTO) {
      return { ok: false, error: `La cantidad debe ser de 1 a ${MAX_CANTIDAD_POR_PRODUCTO}` };
    }
    const total = (cantidades.get(id) ?? 0) + (cantidad as number);
    if (total > MAX_CANTIDAD_POR_PRODUCTO) {
      return { ok: false, error: `La cantidad debe ser de 1 a ${MAX_CANTIDAD_POR_PRODUCTO}` };
    }
    cantidades.set(id, total);
  }

  let centavos = 0;
  const lineas: LineaCobro[] = [];
  for (const [id, cantidad] of cantidades) {
    const producto = POR_ID.get(id)!;
    centavos += producto.centavos * cantidad;
    lineas.push({ id, nombre: producto.nombre, precio: producto.centavos / 100, cantidad });
  }
  if (centavos <= 0) return { ok: false, error: "El total debe ser mayor a cero" };

  return { ok: true, lineas, centavos, monto: centavos / 100 };
}
