// Catálogo de la tiendita de ejemplo y cálculo del total.
//
// Los precios viven AQUÍ, en el servidor. El celular solo manda "qué producto
// y cuántos": el total lo calcula esta función. Así nadie puede cobrarse menos
// editando la petición.
//
// Es un catálogo de demostración (nombres tomados de la tiendita real; los
// precios son de ejemplo). Se usa también en pantalla, por eso no tiene nada
// que dependa del servidor.

export type CategoriaId = "bebidas" | "papas" | "galletas" | "prueba";

export type Producto = {
  id: string;
  nombre: string;
  categoria: CategoriaId;
  /** Precio en centavos, para que las sumas sean exactas. */
  centavos: number;
};

export const CATEGORIAS: ReadonlyArray<{ id: CategoriaId; titulo: string }> = [
  { id: "bebidas", titulo: "Bebidas" },
  { id: "papas", titulo: "Papas y frituras" },
  { id: "galletas", titulo: "Galletas" },
  { id: "prueba", titulo: "Para probar" },
];

export const PRODUCTOS: ReadonlyArray<Producto> = [
  { id: "agua", nombre: "Agua natural", categoria: "bebidas", centavos: 1500 },
  { id: "electrolit", nombre: "Electrolit", categoria: "bebidas", centavos: 2800 },
  { id: "sidral", nombre: "Sidral Mundet", categoria: "bebidas", centavos: 1800 },
  { id: "boing", nombre: "Boing", categoria: "bebidas", centavos: 1600 },
  { id: "sabritas", nombre: "Sabritas Original", categoria: "papas", centavos: 2200 },
  { id: "doritos", nombre: "Doritos Nacho", categoria: "papas", centavos: 2400 },
  { id: "takis", nombre: "Takis Fuego", categoria: "papas", centavos: 2000 },
  { id: "cacahuates", nombre: "Cacahuates", categoria: "papas", centavos: 1200 },
  { id: "palomitas", nombre: "Palomitas", categoria: "papas", centavos: 1400 },
  { id: "surtidas", nombre: "Galletas surtidas", categoria: "galletas", centavos: 1000 },
  { id: "polvorones", nombre: "Polvorones", categoria: "galletas", centavos: 800 },
  { id: "barquillo", nombre: "Barquillos de fresa", categoria: "galletas", centavos: 1200 },
  // Para demostrar el flujo completo pagando solo un centavo.
  { id: "prueba-centavo", nombre: "Prueba: 1 centavo", categoria: "prueba", centavos: 1 },
];

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

export type CobroArmado =
  | { ok: true; lineas: LineaCobro[]; centavos: number; monto: number }
  | { ok: false; error: string };

/**
 * Convierte lo que manda el celular ([{ id, cantidad }]) en líneas con precio
 * y un total. Ignora cualquier otro campo que venga en la petición (precio,
 * total…): solo cuentan el producto y la cantidad.
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
