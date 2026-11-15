// Inteligencia de negocio: los números que salen de los cobros ya sellados.
// Solo cuentas: no guarda nada y no sabe de dónde vienen los cobros (reales o
// de ejemplo). Todas las sumas van en centavos enteros para que salgan exactas.

import { horaDeMexico, inicioDelDiaMx } from "./hora";
import type { CobroRegistrado, MetodoDeCobro } from "./registro";

/** Las ventas de un día (AAAA-MM-DD en la Ciudad de México). */
export type DiaDeVentas = { dia: string; cobros: CobroRegistrado[] };

export type Inteligencia = {
  /** Lo vendido hoy. */
  centavos: number;
  cuantos: number;
  /** Lo que deja en promedio cada cobro. */
  ticketCentavos: number;
  /** Platillos y bebidas entregados hoy. */
  piezas: number;
  /** Cuánto se llevaba ayer a esta misma hora (null si no hay ayer con qué comparar). */
  ayerALaMismaHora: number | null;
  porHora: Array<{ hora: number; centavos: number; cuantos: number }>;
  /** La hora en que más se ha vendido hoy. */
  horaPico: number | null;
  /** Del día más viejo a hoy. */
  porDia: Array<{ dia: string; centavos: number; cuantos: number; esHoy: boolean }>;
  porMetodo: Array<{ metodo: MetodoDeCobro; centavos: number; cuantos: number }>;
  /** Lo que más se vende hoy, por piezas. */
  top: Array<{ nombre: string; piezas: number; centavos: number }>;
  /** Cuántos de los cobros de hoy son de ejemplo. */
  deEjemplo: number;
};

const centavosDe = (cobro: CobroRegistrado) => Math.round(cobro.monto * 100);
const suma = (cobros: CobroRegistrado[]) => cobros.reduce((total, cobro) => total + centavosDe(cobro), 0);

const PRIMERA_HORA = 7;
const ULTIMA_HORA = 17;
const METODOS: MetodoDeCobro[] = ["qr", "push", "link"];

export function calcularInteligencia(
  hoy: CobroRegistrado[],
  anteriores: DiaDeVentas[],
  diaDeHoy: string,
  ahora: number,
): Inteligencia {
  const centavos = suma(hoy);
  const cuantos = hoy.length;

  // Por hora: siempre se ve el horario del negocio; si cayó algo fuera, se alarga.
  const horas = hoy.map((cobro) => horaDeMexico(cobro.pagadoEn));
  const desde = Math.min(PRIMERA_HORA, ...horas);
  const hasta = Math.max(ULTIMA_HORA, ...horas);
  const porHora: Inteligencia["porHora"] = [];
  for (let hora = desde; hora <= hasta; hora++) porHora.push({ hora, centavos: 0, cuantos: 0 });
  hoy.forEach((cobro, i) => {
    const casilla = porHora[horas[i] - desde];
    casilla.centavos += centavosDe(cobro);
    casilla.cuantos += 1;
  });
  const pico = porHora.reduce((mejor, casilla) => (casilla.centavos > mejor.centavos ? casilla : mejor), porHora[0]);

  const porMetodo = METODOS.map((metodo) => {
    const suyos = hoy.filter((cobro) => cobro.metodo === metodo);
    return { metodo, centavos: suma(suyos), cuantos: suyos.length };
  });

  const platillos = new Map<string, { nombre: string; piezas: number; centavos: number }>();
  let piezas = 0;
  for (const cobro of hoy) {
    for (const linea of cobro.items ?? []) {
      const fila = platillos.get(linea.nombre) ?? { nombre: linea.nombre, piezas: 0, centavos: 0 };
      fila.piezas += linea.cantidad;
      fila.centavos += Math.round(linea.precio * 100) * linea.cantidad;
      platillos.set(linea.nombre, fila);
      piezas += linea.cantidad;
    }
  }
  const top = [...platillos.values()].sort((a, b) => b.piezas - a.piezas || b.centavos - a.centavos).slice(0, 6);

  // Ayer a esta misma hora: lo que ya se había vendido cuando el reloj marcaba lo de ahora.
  const ayer = anteriores[anteriores.length - 1];
  const transcurrido = ahora - inicioDelDiaMx(ahora);
  const ayerALaMismaHora =
    ayer && ayer.cobros.length > 0
      ? suma(ayer.cobros.filter((cobro) => cobro.pagadoEn - inicioDelDiaMx(cobro.pagadoEn) <= transcurrido))
      : null;

  return {
    centavos,
    cuantos,
    ticketCentavos: cuantos > 0 ? Math.round(centavos / cuantos) : 0,
    piezas,
    ayerALaMismaHora,
    porHora,
    horaPico: pico && pico.centavos > 0 ? pico.hora : null,
    porDia: [
      ...anteriores.map(({ dia, cobros }) => ({ dia, centavos: suma(cobros), cuantos: cobros.length, esHoy: false })),
      { dia: diaDeHoy, centavos, cuantos, esHoy: true },
    ],
    porMetodo,
    top,
    deEjemplo: hoy.filter((cobro) => cobro.ejemplo).length,
  };
}
