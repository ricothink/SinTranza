// Formato de horas y fechas para pantalla y mensajes.

export const dos = (n: number) => (n < 10 ? "0" : "") + n;

export const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/** "14:35" en la hora del aparato que lo muestra (en el mostrador y en el celular del cliente es la de México). */
export const horaMin = (milisegundos: number) => {
  const fecha = new Date(milisegundos);
  return `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
};

/** "14:35:07" */
export const horaMinSeg = (fecha: Date) => `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}:${dos(fecha.getSeconds())}`;

/** "2026-11-14" → "14 NOV". */
export const fechaCorta = (dia: string) => {
  const [, mes, numero] = dia.split("-");
  return `${Number(numero)} ${MESES[Number(mes) - 1] ?? ""}`;
};

// ---------------------------------------------------------------- hora de la Ciudad de México
// Para agrupar ventas por día y por hora sin depender del reloj del aparato.
// La Ciudad de México va 6 horas detrás de la hora universal todo el año (sin
// horario de verano desde 2022).

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
const DESFASE_MX = 6 * HORA_MS;

/** El instante en que empezó ese día en la Ciudad de México. */
export const inicioDelDiaMx = (milisegundos: number) =>
  Math.floor((milisegundos - DESFASE_MX) / DIA_MS) * DIA_MS + DESFASE_MX;

/** "2026-11-15" en la Ciudad de México. */
export const diaDeMexico = (milisegundos: number) => new Date(milisegundos - DESFASE_MX).toISOString().slice(0, 10);

/** La hora del día (0 a 23) en la Ciudad de México. */
export const horaDeMexico = (milisegundos: number) => new Date(milisegundos - DESFASE_MX).getUTCHours();

const DIAS_CORTOS = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

/** "2026-11-15" → "DOM". */
export const diaDeLaSemana = (dia: string) => DIAS_CORTOS[new Date(`${dia}T00:00:00Z`).getUTCDay()] ?? "";

/** "0:42" o "29:58" */
export const reloj = (milisegundos: number) => {
  const segundos = Math.max(0, Math.ceil(milisegundos / 1000));
  return `${Math.floor(segundos / 60)}:${dos(segundos % 60)}`;
};
