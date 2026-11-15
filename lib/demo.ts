// Ventas de EJEMPLO para el tablero y la pantalla de inteligencia.
//
// Se fabrican aquí, en la pantalla, cada vez que se pinta el tablero. NUNCA se
// guardan, nunca pasan por el servidor y nunca tocan el almacén de cobros: un
// cobro real solo lo pone "pagado" el aviso firmado de Pey (lib/cobros.ts).
// Cada venta de ejemplo lleva la marca `ejemplo: true` y en pantalla sale con
// el sello EJEMPLO, no con el sello PAGADO.
//
// Son siempre las mismas para un mismo día (la "suerte" sale de la fecha), así
// que el tablero no brinca al recargar; y las de hoy van "cayendo" conforme
// avanza el reloj. Usan los precios de la hoja del menú, no el centavo de prueba.

import { PRODUCTOS, type CategoriaId, type LineaCobro, type Producto } from "./catalogo";
import { diaDeMexico, inicioDelDiaMx } from "./hora";
import type { DiaDeVentas } from "./inteligencia";
import type { CobroRegistrado, MetodoDeCobro, ResumenDelDia } from "./registro";

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

/** Números al azar que se repiten igual si la semilla es la misma. */
function azarCon(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function semillaDe(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function elegir<T>(azar: () => number, opciones: ReadonlyArray<T>, peso: (opcion: T) => number): T {
  const total = opciones.reduce((suma, opcion) => suma + peso(opcion), 0);
  let punto = azar() * total;
  for (const opcion of opciones) {
    punto -= peso(opcion);
    if (punto <= 0) return opcion;
  }
  return opciones[opciones.length - 1];
}

// Cuánto se vende a cada hora: el desayuno (8 a 10) y la comida (13 a 15) son los picos.
const HORAS: ReadonlyArray<readonly [hora: number, peso: number]> = [
  [7, 2],
  [8, 6],
  [9, 8],
  [10, 5],
  [11, 3],
  [12, 4],
  [13, 8],
  [14, 9],
  [15, 6],
  [16, 3],
];

// Los consentidos de la casa pesan más; lo que no está aquí pesa 1.
const GUSTO: Record<string, number> = {
  chilaquiles: 5,
  "huevos-rancheros": 3,
  molletes: 3,
  "tosta-aguacate": 2.5,
  enfrijoladas: 2,
  "mole-negro": 4,
  "enchiladas-verdes": 3.5,
  "bowl-arroz-pollo": 3,
  "tacos-nopal": 2.5,
  "caldo-tlalpeno": 2,
  "bowl-quinoa-salmon": 2,
  "cafe-olla": 5,
  "agua-temporada": 4,
  "jugo-verde": 2.5,
  "jugo-naranja": 2,
  "flan-vainilla": 1.5,
  "arroz-leche-coco": 1.2,
};
const gusto = (producto: Producto) => GUSTO[producto.id] ?? 1;
const deCategoria = (categoria: CategoriaId) => PRODUCTOS.filter((producto) => producto.categoria === categoria);
const DESAYUNOS = deCategoria("desayunos");
const COMIDAS = deCategoria("comidas");
const BEBIDAS = deCategoria("bebidas");
const POSTRES = deCategoria("postres");

const METODOS: ReadonlyArray<readonly [MetodoDeCobro, number]> = [
  ["qr", 58],
  ["push", 26],
  ["link", 16],
];
const MINUTOS: ReadonlyArray<readonly [number, number]> = [
  [10, 2],
  [15, 4],
  [20, 5],
  [30, 3],
  [45, 1],
];

// Entre semana se vende más que en fin de semana (domingo = 0).
const POR_DIA_DE_LA_SEMANA = [0.8, 1, 1, 1.02, 1.05, 1.12, 0.9];

const dias = new Map<number, CobroRegistrado[]>();

/** Todas las ventas de ejemplo de un día completo, de la primera a la última. */
function ventasDelDia(inicio: number): CobroRegistrado[] {
  const guardadas = dias.get(inicio);
  if (guardadas) return guardadas;

  const dia = diaDeMexico(inicio);
  const azar = azarCon(semillaDe(`milpa:${dia}`));
  const diaDeLaSemana = new Date(`${dia}T00:00:00Z`).getUTCDay();
  const cuantas = Math.round((104 + azar() * 20) * POR_DIA_DE_LA_SEMANA[diaDeLaSemana]);

  const ventas: CobroRegistrado[] = [];
  for (let i = 0; i < cuantas; i++) {
    const [hora] = elegir(azar, HORAS, ([, peso]) => peso);
    const pagadoEn = inicio + hora * HORA_MS + Math.floor(azar() * HORA_MS);

    const fuertes = hora < 12 ? DESAYUNOS : COMIDAS;
    const cantidades = new Map<string, number>();
    const agregar = (producto: Producto, cantidad: number) =>
      cantidades.set(producto.id, Math.min(9, (cantidades.get(producto.id) ?? 0) + cantidad));
    const comensales = azar() < 0.28 ? 2 : 1;
    agregar(elegir(azar, fuertes, gusto), comensales === 2 && azar() < 0.5 ? 2 : 1);
    if (comensales === 2 || azar() < 0.18) agregar(elegir(azar, fuertes, gusto), 1);
    if (azar() < 0.66) agregar(elegir(azar, BEBIDAS, gusto), comensales);
    if (azar() < (hora < 12 ? 0.06 : 0.2)) agregar(elegir(azar, POSTRES, gusto), 1);

    let centavos = 0;
    const items: LineaCobro[] = [];
    for (const producto of PRODUCTOS) {
      const cantidad = cantidades.get(producto.id);
      if (!cantidad) continue;
      centavos += producto.centavosReales * cantidad;
      items.push({ id: producto.id, nombre: producto.nombre, precio: producto.centavosReales / 100, cantidad });
    }

    const [metodo] = elegir(azar, METODOS, ([, peso]) => peso);
    const [minutos] = elegir(azar, MINUTOS, ([, peso]) => peso);
    ventas.push({
      ref: `ejemplo-${dia}-${i}`,
      metodo,
      monto: centavos / 100,
      pagadoEn,
      recogerEn: pagadoEn + minutos * 60_000,
      minutos,
      items,
      ejemplo: true,
    });
  }

  ventas.sort((a, b) => a.pagadoEn - b.pagadoEn);
  ventas.forEach((venta, i) => {
    venta.numero = i + 1;
  });
  dias.set(inicio, ventas);
  return ventas;
}

/** Las ventas de ejemplo de hoy que "ya cayeron" a esta hora, la más nueva primero. */
export function ejemplosDeHoy(ahora: number): CobroRegistrado[] {
  return ventasDelDia(inicioDelDiaMx(ahora))
    .filter((venta) => venta.pagadoEn <= ahora)
    .reverse();
}

/** Los días anteriores completos, del más viejo al de ayer. */
export function ejemplosDeDiasAnteriores(ahora: number, cuantos = 6): DiaDeVentas[] {
  const hoy = inicioDelDiaMx(ahora);
  const anteriores: DiaDeVentas[] = [];
  for (let atras = cuantos; atras >= 1; atras--) {
    const inicio = hoy - atras * DIA_MS;
    anteriores.push({ dia: diaDeMexico(inicio), cobros: ventasDelDia(inicio) });
  }
  return anteriores;
}

/**
 * El registro del día con las ventas de ejemplo intercaladas por hora. Lo real
 * no se toca: sus filas siguen ahí, con su sello, y los cobros por cobrar son
 * solo los reales. Sin registro real (la página de demostración) salen solo
 * los ejemplos.
 */
export function registroConEjemplos(real: ResumenDelDia | null, ahora: number): ResumenDelDia {
  const cobros = [...(real?.cobros ?? []), ...ejemplosDeHoy(ahora)].sort((a, b) => b.pagadoEn - a.pagadoEn);
  return {
    version: real?.version ?? 0,
    dia: real?.dia ?? diaDeMexico(ahora),
    cuantos: cobros.length,
    sumaCentavos: cobros.reduce((suma, cobro) => suma + Math.round(cobro.monto * 100), 0),
    cobros,
    pendientes: real?.pendientes ?? [],
  };
}
