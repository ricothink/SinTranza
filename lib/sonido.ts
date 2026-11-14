// Sonido y voz del mostrador. Todo se sintetiza aquí mismo (no hay archivos de
// audio): clic de tecla, golpe del QR, el "¡clinc!" de la caja registradora
// cuando cae el pago, y una voz que dice cuánto cayó.
//
// Solo se usa desde el navegador (eventos y efectos), nunca al cargar la página.

type NavegadorConAudio = typeof globalThis & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

let ctx: AudioContext | null = null;
let salida: DynamicsCompressorNode | null = null;
let bufRuido: AudioBuffer | null = null;

/** Crea o reanuda el audio. Hay que llamarla dentro de un toque del usuario. */
export function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const global = globalThis as NavegadorConAudio;
      const AC = global.AudioContext ?? global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      salida = ctx.createDynamicsCompressor();
      salida.connect(ctx.destination);
      const largo = Math.floor(ctx.sampleRate * 0.6);
      bufRuido = ctx.createBuffer(1, largo, ctx.sampleRate);
      const datos = bufRuido.getChannelData(0);
      for (let i = 0; i < largo; i++) datos[i] = Math.random() * 2 - 1;
    }
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
  } catch {
    return null;
  }
  return ctx;
}

function envolvente(t: number, volumen: number, duracion: number): GainNode {
  const ganancia = ctx!.createGain();
  ganancia.gain.setValueAtTime(volumen, t);
  ganancia.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
  ganancia.connect(salida!);
  return ganancia;
}

function ruido(t: number, duracion: number, tipo: BiquadFilterType, frecuencia: number, q: number, volumen: number) {
  const fuente = ctx!.createBufferSource();
  fuente.buffer = bufRuido;
  const filtro = ctx!.createBiquadFilter();
  filtro.type = tipo;
  filtro.frequency.value = frecuencia;
  filtro.Q.value = q;
  fuente.connect(filtro);
  filtro.connect(envolvente(t, volumen, duracion));
  fuente.start(t, Math.random() * 0.3, duracion + 0.02);
}

function tono(t: number, forma: OscillatorType, f0: number, f1: number, duracion: number, volumen: number) {
  const oscilador = ctx!.createOscillator();
  oscilador.type = forma;
  oscilador.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) oscilador.frequency.exponentialRampToValueAtTime(f1, t + duracion);
  oscilador.connect(envolvente(t, volumen, duracion));
  oscilador.start(t);
  oscilador.stop(t + duracion + 0.02);
}

/** Clic corto y seco. */
export function sonarTecla() {
  if (!audio()) return;
  const t = ctx!.currentTime;
  ruido(t, 0.022, "bandpass", 2600, 1.2, 0.55);
  tono(t, "square", 190, 120, 0.03, 0.16);
}

/** Tecla que no entra: madera sorda. */
export function sonarTope() {
  if (!audio()) return;
  tono(ctx!.currentTime, "sine", 120, 70, 0.07, 0.4);
}

/** El QR pega contra la nota. */
export function sonarSelloQR() {
  if (!audio()) return;
  const t = ctx!.currentTime;
  ruido(t, 0.06, "lowpass", 700, 0.7, 0.7);
  tono(t, "sine", 140, 55, 0.11, 0.6);
}

/** Parciales inarmónicos: suena a metal, no a "ding". */
function campana(t: number, f: number, volumen: number) {
  const parciales: Array<[number, number, number]> = [
    [1, 1, 1.25], [2.0, 0.55, 0.9], [2.76, 0.5, 0.7], [4.07, 0.28, 0.45], [5.4, 0.2, 0.3], [8.93, 0.1, 0.18],
  ];
  for (const [mult, vol, dur] of parciales) tono(t, "sine", f * mult, f * mult, dur, volumen * vol);
  ruido(t, 0.012, "highpass", 5000, 0.7, volumen * 0.9); // el martillo
}

/** ¡Clinc! + cajón que se bota + morralla. Es el sonido de "ya cayó". */
export function sonarCaja() {
  if (!audio()) return;
  const t = ctx!.currentTime + 0.005;
  ruido(t, 0.05, "bandpass", 1500, 0.9, 0.7); // palanca
  tono(t, "square", 210, 90, 0.06, 0.25);
  campana(t + 0.03, 2093, 0.34); // clinc
  campana(t + 0.13, 2637, 0.26);
  const c = t + 0.26; // cajón (cae junto con el sello)
  ruido(c, 0.24, "lowpass", 520, 0.6, 0.9);
  tono(c, "sine", 115, 44, 0.2, 0.85);
  ruido(c + 0.01, 0.03, "bandpass", 900, 2, 0.5);
  for (let i = 0; i < 6; i++) {
    // monedas en la charola
    const m = c + 0.05 + i * 0.045 + Math.random() * 0.02;
    tono(m, "triangle", 3200 + Math.random() * 3000, 3000 + Math.random() * 2500, 0.07, 0.07);
  }
}

// ---------------------------------------------------------------- voz

let voz: SpeechSynthesisVoice | null = null;
let ultimaFrase: SpeechSynthesisUtterance | null = null;

function sintetizador(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window
    ? window.speechSynthesis
    : null;
}

function elegirVoz() {
  const sintesis = sintetizador();
  if (!sintesis) return;
  let voces: SpeechSynthesisVoice[] = [];
  try {
    voces = sintesis.getVoices() || [];
  } catch {
    // Sin voces todavía; se vuelve a intentar.
  }
  let mx: SpeechSynthesisVoice | null = null;
  let us: SpeechSynthesisVoice | null = null;
  let es: SpeechSynthesisVoice | null = null;
  for (const v of voces) {
    const idioma = String(v.lang || "").replace("_", "-").toLowerCase();
    if (idioma === "es-mx" && !mx) mx = v;
    else if ((idioma === "es-us" || idioma === "es-419") && !us) us = v;
    else if (idioma.startsWith("es") && !es) es = v;
  }
  voz = mx || us || es || null;
}

/** Las voces llegan después, de forma asíncrona. Se llama una vez al abrir la página. */
export function iniciarVoz() {
  const sintesis = sintetizador();
  if (!sintesis) return;
  elegirVoz();
  try {
    sintesis.onvoiceschanged = elegirVoz;
  } catch {
    // Algunos navegadores no dejan asignarlo.
  }
  setTimeout(elegirVoz, 600);
  setTimeout(elegirVoz, 2500);
}

/** Locución muda dentro del toque: en iPhone sin esto la voz no deja hablar después. */
export function prepararVoz() {
  const sintesis = sintetizador();
  if (!sintesis) return;
  try {
    if (!voz) elegirVoz();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    u.lang = voz ? voz.lang : "es-MX";
    if (voz) u.voice = voz;
    sintesis.speak(u);
    ultimaFrase = u;
  } catch {
    // Sin voz: el sonido y la pantalla avisan igual.
  }
}

export function decir(texto: string) {
  const sintesis = sintetizador();
  if (!sintesis) return;
  try {
    if (!voz) elegirVoz();
    if (sintesis.speaking || sintesis.pending) sintesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = voz ? String(voz.lang).replace("_", "-") : "es-MX";
    if (voz) u.voice = voz;
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;
    ultimaFrase = u; // la referencia evita que el navegador la descarte
    sintesis.speak(u);
  } catch {
    // Igual que arriba.
  }
}
