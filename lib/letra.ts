// Importes con letra, como en una nota de remisión: "(quince pesos 50/100 M.N.)".
// Funciona hasta 999,999 pesos (el máximo que deja teclear la app).

const U = [
  "cero", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
  "veintisiete", "veintiocho", "veintinueve",
];
const D = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const C = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

function menosDeMil(n: number): string {
  if (n === 100) return "cien";
  const partes: string[] = [];
  const centenas = Math.floor(n / 100);
  const resto = n % 100;
  if (centenas) partes.push(C[centenas]);
  if (resto) {
    if (resto < 30) partes.push(U[resto]);
    else {
      const decenas = Math.floor(resto / 10);
      const unidades = resto % 10;
      partes.push(D[decenas] + (unidades ? ` y ${U[unidades]}` : ""));
    }
  }
  return partes.join(" ");
}

/** 0 a 999,999 en palabras, sin la unidad ("quince", "mil un"). */
export function palabras(n: number): string {
  if (n === 0) return "cero";
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (miles) partes.push(miles === 1 ? "mil" : `${menosDeMil(miles)} mil`);
  if (resto) partes.push(menosDeMil(resto));
  return partes.join(" ");
}

const dos = (n: number) => (n < 10 ? "0" : "") + n;

/** "quince pesos 50/100 M.N." */
export function importeConLetra(centavos: number): string {
  const pesos = Math.floor(centavos / 100);
  const resto = centavos % 100;
  return `${palabras(pesos)} ${pesos === 1 ? "peso" : "pesos"} ${dos(resto)}/100 M.N.`;
}

/** Para la pantalla verde: "ochenta pesos", o con centavos "quince pesos 50/100 M.N.". */
export function letraCorta(centavos: number): string {
  if (centavos % 100 !== 0) return importeConLetra(centavos);
  const pesos = centavos / 100;
  return `${palabras(pesos)} ${pesos === 1 ? "peso" : "pesos"}`;
}

/** Lo que dice la voz cuando cae el pago: "Ya cayeron ochenta pesos". */
export function fraseDePago(centavos: number): string {
  const pesos = Math.floor(centavos / 100);
  const resto = centavos % 100;
  if (resto === 0) return pesos === 1 ? "Ya cayó un peso" : `Ya cayeron ${palabras(pesos)} pesos`;
  const cent = `${palabras(resto)} ${resto === 1 ? "centavo" : "centavos"}`;
  if (pesos === 0) return resto === 1 ? `Ya cayó ${cent}` : `Ya cayeron ${cent}`;
  return `Ya cayeron ${palabras(pesos)} ${pesos === 1 ? "peso" : "pesos"} con ${cent}`;
}

/** 123456 → "1,234.56"; 8000 → "80"; 150 → "1.50". Sin el signo de pesos. */
export function textoDeMonto(centavos: number): string {
  const pesos = Math.floor(centavos / 100);
  const resto = centavos % 100;
  const enteros = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return resto === 0 ? enteros : `${enteros}.${dos(resto)}`;
}
