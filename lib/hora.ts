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

/** "0:42" o "29:58" */
export const reloj = (milisegundos: number) => {
  const segundos = Math.max(0, Math.ceil(milisegundos / 1000));
  return `${Math.floor(segundos / 60)}:${dos(segundos % 60)}`;
};
