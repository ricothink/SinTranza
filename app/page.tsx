"use client";

// El mostrador de Milpa, de punta a punta:
//
//   PIN → menú (se tocan platillos y se elige en cuántos minutos estará) →
//   ¿cómo paga? (QR aquí / a su celular / enlace de pago) → ¡YA CAYÓ! en verde,
//   con sonido, voz y vibración, y la hora a la que regresa el cliente.
//
// Los cobros a distancia (solicitud al celular y enlace) quedan "por cobrar" y
// el mostrador sigue atendiendo: cuando cae el pago, la pantalla verde salta
// sola. Hay también un teclado para cobrar un monto libre y un registro con los
// cobros del día (tablero de control).
//
// El navegador solo PREGUNTA el estado. Nunca lo cambia: "pagado" lo pone el
// servidor cuando Pey avisa. Y el total de un pedido lo calcula el servidor con
// su catálogo: aquí solo se manda qué platillo, cuántos y en cuántos minutos.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  MAX_CANTIDAD_POR_PRODUCTO,
  MINUTOS_POR_OMISION,
  PRODUCTOS,
  type LineaCobro,
  type Producto,
} from "@/lib/catalogo";
import { fraseDePago } from "@/lib/letra";
import type { CobroRegistrado, MetodoDeCobro, ResumenDelDia } from "@/lib/registro";
import { audio, decir, iniciarVoz, prepararVoz, sonarCaja, sonarSelloQR, sonarTecla, sonarTope } from "@/lib/sonido";
import { mensajeDeConfirmacion } from "@/lib/whatsapp";
import {
  PantallaCayo,
  PantallaCelular,
  PantallaEspera,
  PantallaError,
  PantallaMetodo,
  PantallaPin,
  PantallaRegistro,
  PantallaRemota,
  PantallaTeclado,
  PantallaTienda,
  type CobroRemoto,
} from "./pantallas";

type Origen = "tienda" | "teclado";

type Pagado = {
  ref: string;
  centavos: number;
  items?: LineaCobro[];
  numero?: number;
  minutos?: number;
  recogerEn?: number;
  pagadoEn: number;
  telefono?: string;
  /** true si el pedido que se acaba de pagar es el que está en pantalla (QR): al caer se vacía. */
  limpiar: boolean;
};

type Pantalla =
  | { paso: "tienda" }
  | { paso: "teclado" }
  | { paso: "metodo"; origen: Origen }
  | { paso: "celular"; modo: "push" | "link"; origen: Origen }
  | { paso: "registro"; origen: Origen }
  | { paso: "generando"; centavos: number; minutos?: number; queHace: string; origen: Origen }
  | {
      paso: "qr";
      ref: string;
      centavos: number;
      items?: LineaCobro[];
      minutos?: number;
      qrSvg: string;
      inicio: number;
      venceLocal: number;
      origen: Origen;
    }
  | { paso: "remota"; cobro: CobroRemoto }
  | ({ paso: "pagado" } & Pagado)
  | { paso: "error"; mensaje: string; volverA: Pantalla };

const CADA_CUANTO_CONSULTAR_MS = 2000;
const CADA_CUANTO_REGISTRO_CON_PENDIENTES_MS = 3000;
const CADA_CUANTO_REGISTRO_EN_CALMA_MS = 20000;
const MAX_ENTEROS = 6;
const MAX_DIGITOS_PIN = 8;
const MIN_DIGITOS_PIN = 4;
const SEGUNDOS_DE_REGRESO = 10;
const VERDE = "#008A2E";
const PAPEL = "#F6F3EA";

const aOrigen = (origen: Origen): Pantalla => ({ paso: origen });

/** Aplica una tecla al monto que se va escribiendo ("150.5"). */
function teclear(actual: string, tecla: string): string {
  if (tecla === "borrar") return actual.slice(0, -1);
  if (tecla === ".") {
    if (actual.includes(".")) return actual;
    return actual === "" ? "0." : `${actual}.`;
  }
  const [enteros, decimales] = actual.split(".");
  if (decimales !== undefined) return decimales.length >= 2 ? actual : actual + tecla;
  if (enteros === "0") return tecla;
  if (enteros.length >= MAX_ENTEROS) return actual;
  return actual + tecla;
}

/** "1500.5" → "1,500.5" (tal como se va tecleando). */
function comoSeTeclea(texto: string): string {
  if (texto === "") return "0";
  const [enteros, decimales] = texto.split(".");
  return `${Number(enteros).toLocaleString("es-MX")}${decimales !== undefined ? `.${decimales}` : ""}`;
}

/** Vuelve a disparar una animación de golpe sobre el mismo elemento. */
function relanzar(elemento: HTMLElement | null, clase: string) {
  if (!elemento) return;
  elemento.classList.remove(clase);
  void elemento.offsetWidth;
  elemento.classList.add(clase);
}

export default function Pagina() {
  const [sesion, setSesion] = useState<"cargando" | "no" | "si" | "sin_pin">("cargando");
  const [pin, setPin] = useState("");
  const [mensajePin, setMensajePin] = useState("");
  const [ocupadoPin, setOcupadoPin] = useState(false);

  const [pantalla, setPantalla] = useState<Pantalla>({ paso: "tienda" });
  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [minutos, setMinutos] = useState(MINUTOS_POR_OMISION);
  const [texto, setTexto] = useState("");
  const [celular, setCelular] = useState("");
  const [mensajeCelular, setMensajeCelular] = useState("");
  const [golpe, setGolpe] = useState(0);
  const [pisada, setPisada] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [selloCae, setSelloCae] = useState(false);
  const [quedan, setQuedan] = useState(SEGUNDOS_DE_REGRESO);
  const [registro, setRegistro] = useState<ResumenDelDia | null>(null);
  const [falloRegistro, setFalloRegistro] = useState(false);
  const [nuevas, setNuevas] = useState<ReadonlySet<string>>(new Set());

  const temporizadorBorrar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refsVistas = useRef<Set<string> | null>(null);
  const versionVista = useRef<number | null>(null);
  /** Cobros a distancia que se vieron esperando: cuando caigan, la pantalla verde salta sola. */
  const pendientesVistos = useRef<Set<string>>(new Set());
  const celebrados = useRef<Set<string>>(new Set());
  const cola = useRef<string[]>([]);

  // ------------------------------------------------------------ hablar con el servidor
  /** Igual que fetch, pero si el servidor dice que falta el PIN regresa a la pantalla del PIN. */
  const llamar = useCallback(async (url: string, init?: RequestInit) => {
    const respuesta = await fetch(url, { cache: "no-store", ...init });
    if (respuesta.status === 401) {
      setSesion("no");
      setPin("");
      setMensajePin("(la sesión terminó: escribe el PIN)");
    }
    return respuesta;
  }, []);

  // ------------------------------------------------------------ lo que lleva el pedido
  const lineas = useMemo<LineaCobro[]>(
    () =>
      PRODUCTOS.filter((producto) => carrito[producto.id]).map((producto) => ({
        id: producto.id,
        nombre: producto.nombre,
        precio: producto.centavos / 100,
        cantidad: carrito[producto.id],
      })),
    [carrito],
  );
  const centavosCarrito = lineas.reduce((suma, linea) => suma + Math.round(linea.precio * 100) * linea.cantidad, 0);
  const articulos = lineas.reduce((suma, linea) => suma + linea.cantidad, 0);
  const centavosTeclado = Math.round(Number(texto.replace(/\.$/, "") || "0") * 100);

  const agregar = useCallback(
    (producto: Producto, tarjeta: HTMLElement | null) => {
      if ((carrito[producto.id] ?? 0) >= MAX_CANTIDAD_POR_PRODUCTO) {
        sonarTope();
        return;
      }
      sonarTecla();
      relanzar(tarjeta, "golpe");
      setCarrito((actual) => ({ ...actual, [producto.id]: (actual[producto.id] ?? 0) + 1 }));
    },
    [carrito],
  );

  const quitar = useCallback(
    (producto: Producto) => {
      if (!carrito[producto.id]) return;
      sonarTecla();
      setCarrito((actual) => {
        const { [producto.id]: cantidad, ...resto } = actual;
        return cantidad > 1 ? { ...resto, [producto.id]: cantidad - 1 } : resto;
      });
    },
    [carrito],
  );

  const vaciar = useCallback(() => {
    sonarTecla();
    setCarrito({});
  }, []);

  const elegirMinutos = useCallback((opcion: number) => {
    sonarTecla();
    setMinutos(opcion);
  }, []);

  // ------------------------------------------------------------ teclado de monto libre
  const aplicarTecla = useCallback(
    (tecla: string) => {
      const nuevo = teclear(texto, tecla);
      if (nuevo === texto) {
        sonarTope();
        return;
      }
      sonarTecla();
      setTexto(nuevo);
      setGolpe((g) => g + 1);
    },
    [texto],
  );

  /** Pisar una tecla: se marca y, en "borrar", dejarla apretada vacía todo. */
  const pulsar = useCallback((tecla: string, alTeclear: (tecla: string) => void, alVaciar: () => void) => {
    setPisada(tecla);
    alTeclear(tecla);
    if (tecla === "borrar") {
      if (temporizadorBorrar.current) clearTimeout(temporizadorBorrar.current);
      temporizadorBorrar.current = setTimeout(alVaciar, 550);
    }
  }, []);

  const pulsarTecla = useCallback(
    (tecla: string) =>
      pulsar(tecla, aplicarTecla, () =>
        setTexto((actual) => {
          if (actual) sonarTecla();
          return "";
        }),
      ),
    [pulsar, aplicarTecla],
  );

  // ------------------------------------------------------------ PIN del mostrador
  const teclaPin = useCallback((tecla: string) => {
    setMensajePin("");
    setPin((actual) => {
      if (tecla === "borrar") {
        if (actual) sonarTecla();
        return actual.slice(0, -1);
      }
      if (!/^\d$/.test(tecla) || actual.length >= MAX_DIGITOS_PIN) {
        sonarTope();
        return actual;
      }
      sonarTecla();
      return actual + tecla;
    });
  }, []);

  const pulsarPin = useCallback(
    (tecla: string) =>
      pulsar(tecla, teclaPin, () =>
        setPin((actual) => {
          if (actual) sonarTecla();
          return "";
        }),
      ),
    [pulsar, teclaPin],
  );

  // ------------------------------------------------------------ registro del día
  /** Pone a la vista un pago que cayó. Lo celebra con la pantalla verde si hay un momento libre. */
  const alLlegarRegistro = useCallback((datos: ResumenDelDia) => {
    const pagadosPorRef = new Map(datos.cobros.map((cobro) => [cobro.ref, cobro]));
    for (const ref of pendientesVistos.current) {
      if (pagadosPorRef.has(ref) && !celebrados.current.has(ref) && !cola.current.includes(ref)) cola.current.push(ref);
    }
    for (const pendiente of datos.pendientes) pendientesVistos.current.add(pendiente.ref);

    const actuales = new Set(datos.cobros.map((cobro) => cobro.ref));
    // Lo que apareció desde la última vez entra con golpe (menos en la primera carga).
    const previas = refsVistas.current;
    setNuevas(previas ? new Set([...actuales].filter((ref) => !previas.has(ref))) : new Set());
    refsVistas.current = actuales;
    setRegistro(datos);
    setFalloRegistro(false);
  }, []);

  const cargarRegistro = useCallback(
    async (forzar = false) => {
      try {
        const conocida = versionVista.current;
        const url = forzar || conocida === null ? "/api/registro" : `/api/registro?v=${conocida}`;
        const respuesta = await llamar(url);
        if (!respuesta.ok) throw new Error(String(respuesta.status));
        const datos = (await respuesta.json()) as ResumenDelDia & { sinCambios?: boolean };
        if (datos.sinCambios) return;
        versionVista.current = datos.version;
        alLlegarRegistro(datos);
      } catch {
        setFalloRegistro(true);
      }
    },
    [llamar, alLlegarRegistro],
  );

  const abrirRegistro = useCallback(
    (origen: Origen) => {
      audio();
      sonarTecla();
      setPantalla({ paso: "registro", origen });
      void cargarRegistro(true);
    },
    [cargarRegistro],
  );

  const entrarConPin = useCallback(async () => {
    audio();
    if (pin.length < MIN_DIGITOS_PIN) {
      sonarTope();
      setMensajePin(`(el PIN tiene de ${MIN_DIGITOS_PIN} a ${MAX_DIGITOS_PIN} números)`);
      return;
    }
    setOcupadoPin(true);
    try {
      const respuesta = await fetch("/api/sesion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (respuesta.ok) {
        sonarSelloQR();
        setSesion("si");
        setPin("");
        setMensajePin("");
        versionVista.current = null;
        setPantalla({ paso: "tienda" });
        void cargarRegistro(true);
        return;
      }
      sonarTope();
      setPin("");
      setMensajePin(
        respuesta.status === 429
          ? "(demasiados intentos: espera unos minutos)"
          : respuesta.status === 503
            ? "(falta configurar el PIN del mostrador)"
            : "(PIN incorrecto)",
      );
    } catch {
      sonarTope();
      setMensajePin("(sin conexión: revisa tu internet)");
    } finally {
      setOcupadoPin(false);
    }
  }, [pin, cargarRegistro]);

  const salir = useCallback(async () => {
    sonarTecla();
    await fetch("/api/sesion", { method: "DELETE" }).catch(() => {});
    setSesion("no");
    setPin("");
    setMensajePin("");
    setRegistro(null);
    versionVista.current = null;
    refsVistas.current = null;
    setPantalla({ paso: "tienda" });
  }, []);

  // ------------------------------------------------------------ cobrar
  const irAMetodo = useCallback((origen: Origen) => {
    audio();
    sonarTecla();
    setPantalla({ paso: "metodo", origen });
  }, []);

  const cobrarTienda = useCallback(() => {
    audio();
    if (centavosCarrito <= 0) {
      sonarTope();
      return;
    }
    irAMetodo("tienda");
  }, [centavosCarrito, irAMetodo]);

  const cobrarLibre = useCallback(() => {
    audio();
    if (centavosTeclado <= 0) {
      sonarTope();
      return;
    }
    irAMetodo("teclado");
  }, [centavosTeclado, irAMetodo]);

  const iniciarCobro = useCallback(
    async (metodo: MetodoDeCobro, origen: Origen, telefono?: string) => {
      // El celular solo deja sonar si el audio se activó con un toque.
      // Se activa aquí para que suene después, cuando caiga el pago.
      audio();
      prepararVoz();
      const centavos = origen === "tienda" ? centavosCarrito : centavosTeclado;
      const tiempo = origen === "tienda" ? minutos : undefined;
      const queHace = metodo === "qr" ? "HACIENDO EL QR" : metodo === "push" ? "MANDANDO LA SOLICITUD" : "HACIENDO EL ENLACE";
      const falloVuelveA: Pantalla = metodo === "qr" ? aOrigen(origen) : { paso: "metodo", origen };
      setPantalla({ paso: "generando", centavos, minutos: tiempo, queHace, origen });

      const cuerpo =
        origen === "tienda"
          ? { items: lineas.map(({ id, cantidad }) => ({ id, cantidad })), minutos, metodo, telefono }
          : { monto: texto.replace(/\.$/, ""), metodo, telefono };
      try {
        const respuesta = await llamar("/api/cobros", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo),
        });
        if (respuesta.status === 401) return; // regresó al PIN
        const datos = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok) {
          setPantalla({
            paso: "error",
            mensaje: datos.error || "No se pudo hacer el cobro. Intenta de nuevo.",
            volverA: falloVuelveA,
          });
          return;
        }

        if (metodo === "qr") {
          const qrSvg = await QRCode.toString(datos.qrString, {
            type: "svg",
            errorCorrectionLevel: "M",
            margin: 2,
            color: { dark: "#141413", light: PAPEL },
          });
          const inicio = Date.now();
          setAhora(inicio);
          setPantalla({
            paso: "qr",
            ref: datos.ref,
            centavos: Math.round(Number(datos.monto) * 100),
            items: datos.items,
            minutos: datos.minutos,
            qrSvg,
            inicio,
            // Se cuenta con el reloj del celular, a partir de lo que dura el QR.
            venceLocal: inicio + (datos.venceEn - datos.creadoEn),
            origen,
          });
          sonarSelloQR();
          return;
        }

        // Cobro a distancia: queda por cobrar y el mostrador queda libre para el siguiente.
        pendientesVistos.current.add(datos.ref);
        setCarrito({});
        setTexto("");
        setCelular("");
        setAhora(Date.now());
        setPantalla({
          paso: "remota",
          cobro: {
            ref: datos.ref,
            metodo,
            centavos: Number(datos.monto),
            items: datos.items,
            minutos: datos.minutos,
            telefono: datos.telefono,
            seguimiento: datos.seguimiento,
            enlaceDePago: datos.enlaceDePago,
            creadoEn: datos.creadoEn,
            venceEn: datos.venceEn,
          },
        });
        sonarSelloQR();
        void cargarRegistro(true);
      } catch {
        setPantalla({ paso: "error", mensaje: "No hay conexión. Revisa tu internet e intenta de nuevo.", volverA: falloVuelveA });
      }
    },
    [centavosCarrito, centavosTeclado, minutos, lineas, texto, llamar, cargarRegistro],
  );

  const elegirMetodo = useCallback(
    (metodo: MetodoDeCobro, origen: Origen) => {
      if (metodo === "qr") {
        void iniciarCobro("qr", origen);
        return;
      }
      sonarTecla();
      setCelular("");
      setMensajeCelular("");
      setPantalla({ paso: "celular", modo: metodo, origen });
    },
    [iniciarCobro],
  );

  const teclaCelular = useCallback((tecla: string) => {
    setMensajeCelular("");
    setCelular((actual) => {
      if (tecla === "borrar") {
        if (actual) sonarTecla();
        return actual.slice(0, -1);
      }
      if (!/^\d$/.test(tecla) || actual.length >= 10) {
        sonarTope();
        return actual;
      }
      sonarTecla();
      return actual + tecla;
    });
  }, []);

  const pulsarCelular = useCallback(
    (tecla: string) =>
      pulsar(tecla, teclaCelular, () =>
        setCelular((actual) => {
          if (actual) sonarTecla();
          return "";
        }),
      ),
    [pulsar, teclaCelular],
  );

  /** Regresa a donde se estaba (el pedido o el teclado se conservan). */
  const volver = useCallback(() => {
    setPantalla((actual) => {
      if ("origen" in actual) return aOrigen(actual.origen);
      if (actual.paso === "error") return actual.volverA;
      return { paso: "tienda" };
    });
  }, []);

  const cerrarRegistro = useCallback(() => {
    audio();
    sonarTecla();
    volver();
  }, [volver]);

  /** Después de un pago: mostrador limpio. */
  const nuevoCobro = useCallback(() => {
    sonarTecla();
    setPantalla({ paso: "tienda" });
  }, []);

  /** Enseña la pantalla verde de un pago que cayó mientras se atendía otra cosa. */
  const celebrar = useCallback((cobro: CobroRegistrado) => {
    celebrados.current.add(cobro.ref);
    pendientesVistos.current.delete(cobro.ref);
    setSelloCae(false);
    setQuedan(SEGUNDOS_DE_REGRESO);
    setPantalla({
      paso: "pagado",
      ref: cobro.ref,
      centavos: Math.round(cobro.monto * 100),
      items: cobro.items,
      numero: cobro.numero,
      minutos: cobro.minutos,
      recogerEn: cobro.recogerEn,
      pagadoEn: cobro.pagadoEn,
      telefono: cobro.telefono,
      limpiar: false,
    });
  }, []);

  // ------------------------------------------------------------ efectos
  // Al abrir: ¿ya hay una sesión del mostrador?
  useEffect(() => {
    let vigente = true;
    fetch("/api/sesion", { cache: "no-store" })
      .then(async (respuesta) => {
        if (!vigente) return;
        if (respuesta.status === 503) setSesion("sin_pin");
        else setSesion((await respuesta.json()).ok ? "si" : "no");
      })
      .catch(() => vigente && setSesion("no"));
    return () => {
      vigente = false;
    };
  }, []);

  // El audio y la voz se crean o se reanudan en el primer toque, sea donde sea.
  useEffect(() => {
    iniciarVoz();
    const despertar = () => void audio();
    const eventos = ["pointerdown", "pointerup", "touchend", "click"] as const;
    for (const evento of eventos) window.addEventListener(evento, despertar, { capture: true, passive: true });
    const alVolver = () => {
      if (!document.hidden) despertar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      for (const evento of eventos) window.removeEventListener(evento, despertar, { capture: true });
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  // Al soltar una tecla se apaga la marca y se cancela el "borrar todo".
  useEffect(() => {
    const soltar = () => {
      if (temporizadorBorrar.current) clearTimeout(temporizadorBorrar.current);
      setPisada(null);
    };
    const eventos = ["pointerup", "pointercancel", "blur"] as const;
    for (const evento of eventos) window.addEventListener(evento, soltar, true);
    return () => {
      for (const evento of eventos) window.removeEventListener(evento, soltar, true);
    };
  }, []);

  // Con sesión, el registro se carga y se vuelve a cargar al regresar a la página.
  useEffect(() => {
    if (sesion !== "si") return;
    void cargarRegistro(true);
    const alVolver = () => {
      if (!document.hidden) void cargarRegistro();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [sesion, cargarRegistro]);

  // El fondo de toda la página (y la barra del celular) se vuelve verde con el pago.
  const verde = pantalla.paso === "pagado";
  useEffect(() => {
    document.documentElement.setAttribute("data-estado", verde ? "cayo" : "calc");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", verde ? VERDE : PAPEL);
  }, [verde]);

  // Teclado de computadora.
  const paso = pantalla.paso;
  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.metaKey || evento.ctrlKey || evento.altKey) return;
      audio();
      const k = evento.key;
      const digito = /^[0-9]$/.test(k);

      if (sesion === "no") {
        if (digito) teclaPin(k);
        else if (k === "Backspace" || k === "Delete") teclaPin("borrar");
        else if (k === "Enter") void entrarConPin();
        else return;
        evento.preventDefault();
        return;
      }
      if (sesion !== "si") return;

      if (paso === "teclado") {
        if (digito || k === ".") aplicarTecla(k);
        else if (k === "Backspace" || k === "Delete") aplicarTecla("borrar");
        else if (k === "Enter") cobrarLibre();
        else return;
      } else if (paso === "celular") {
        if (digito) teclaCelular(k);
        else if (k === "Backspace" || k === "Delete") teclaCelular("borrar");
        else return;
      } else if (paso === "registro") {
        if (k === "Enter" || k === "Escape" || k === "Backspace") cerrarRegistro();
        else return;
      } else if (paso === "pagado") {
        if (k === "Enter" || k === " ") nuevoCobro();
        else return;
      } else return;
      evento.preventDefault();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [sesion, paso, teclaPin, entrarConPin, aplicarTecla, cobrarLibre, teclaCelular, cerrarRegistro, nuevoCobro]);

  // Mientras se espera algo (QR, solicitud, registro abierto): un reloj para los puntos y las cuentas regresivas.
  const conReloj = paso === "generando" || paso === "qr" || paso === "remota" || paso === "registro";
  useEffect(() => {
    if (!conReloj) return;
    const reloj = setInterval(() => setAhora(Date.now()), 330);
    return () => clearInterval(reloj);
  }, [conReloj]);

  // El registro se actualiza solo: rápido si hay cobros a distancia esperando, tranquilo si no.
  const hayPendientes = (registro?.pendientes.length ?? 0) > 0 || paso === "remota" || paso === "registro";
  useEffect(() => {
    if (sesion !== "si") return;
    const ms = hayPendientes ? CADA_CUANTO_REGISTRO_CON_PENDIENTES_MS : CADA_CUANTO_REGISTRO_EN_CALMA_MS;
    const intervalo = setInterval(() => {
      if (!document.hidden) void cargarRegistro();
    }, ms);
    return () => clearInterval(intervalo);
  }, [sesion, hayPendientes, cargarRegistro]);

  // Cuando cae un pago a distancia y hay un momento libre, salta la pantalla verde.
  const libreParaCelebrar = paso !== "generando" && paso !== "qr" && paso !== "pagado";
  useEffect(() => {
    if (!libreParaCelebrar || sesion !== "si") return;
    while (cola.current.length > 0) {
      const ref = cola.current[0];
      const cobro = registro?.cobros.find((c) => c.ref === ref);
      if (!cobro) return; // todavía no llega el registro con ese pago
      cola.current.shift();
      if (celebrados.current.has(ref)) continue;
      celebrar(cobro);
      return;
    }
  }, [libreParaCelebrar, sesion, registro, celebrar]);

  // Mientras se muestra el QR: preguntar el estado cada 2 segundos.
  const refEnPantalla = pantalla.paso === "qr" ? pantalla.ref : null;
  useEffect(() => {
    if (!refEnPantalla) return;
    let vigente = true;
    let ocupado = false;
    const consultar = async () => {
      if (ocupado) return;
      ocupado = true;
      try {
        const respuesta = await llamar(`/api/cobros/${refEnPantalla}`);
        if (!respuesta.ok) return;
        const datos = await respuesta.json();
        if (vigente && datos.estado === "pagado") {
          celebrados.current.add(refEnPantalla);
          setSelloCae(false);
          setQuedan(SEGUNDOS_DE_REGRESO);
          setPantalla((actual) =>
            actual.paso === "qr" && actual.ref === refEnPantalla
              ? {
                  paso: "pagado",
                  ref: refEnPantalla,
                  centavos: Math.round(Number(datos.montoPagado ?? datos.monto) * 100),
                  items: datos.items ?? actual.items,
                  numero: datos.numero,
                  minutos: datos.minutos ?? actual.minutos,
                  recogerEn: datos.recogerEn,
                  pagadoEn: Number(datos.pagadoEn) || Date.now(),
                  limpiar: true,
                }
              : actual,
          );
        }
      } catch {
        // Se fue el internet un momento: se vuelve a preguntar en 2 s.
      } finally {
        ocupado = false;
      }
    };
    const intervalo = setInterval(consultar, CADA_CUANTO_CONSULTAR_MS);
    return () => {
      vigente = false;
      clearInterval(intervalo);
    };
  }, [refEnPantalla, llamar]);

  // Mientras se muestra el QR o se espera un cobro a distancia: que no se apague la pantalla.
  const esperandoPago = refEnPantalla !== null || paso === "remota";
  useEffect(() => {
    if (!esperandoPago || !("wakeLock" in navigator)) return;
    let vigente = true;
    let candado: WakeLockSentinel | null = null;
    const pedir = async () => {
      try {
        const nuevo = await navigator.wakeLock.request("screen");
        if (vigente) candado = nuevo;
        else void nuevo.release();
      } catch {
        // El celular no lo permitió (batería baja, etc.). No pasa nada.
      }
    };
    const alVolver = () => {
      if (document.visibilityState === "visible") void pedir();
    };
    void pedir();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vigente = false;
      document.removeEventListener("visibilitychange", alVolver);
      void candado?.release().catch(() => {});
    };
  }, [esperandoPago]);

  // Al caer el pago: sonido, voz y vibración, todo en el mismo instante.
  const refPagado = pantalla.paso === "pagado" ? pantalla.ref : null;
  const centavosPagados = pantalla.paso === "pagado" ? pantalla.centavos : 0;
  const limpiarAlPagar = pantalla.paso === "pagado" ? pantalla.limpiar : false;
  useEffect(() => {
    if (!refPagado) return;
    sonarCaja();
    decir(fraseDePago(centavosPagados));
    try {
      navigator.vibrate?.([90, 40, 180]);
    } catch {
      // Sin vibración: la pantalla verde ya lo dice.
    }
    if (limpiarAlPagar) {
      setCarrito({});
      setTexto("");
    }
    void cargarRegistro(true); // el pago recién caído entra al registro y a la tira
    const sello = setTimeout(() => setSelloCae(true), 260); // el sello pega cuando se bota el cajón
    const cuenta = setInterval(() => setQuedan((q) => q - 1), 1000);
    return () => {
      clearTimeout(sello);
      clearInterval(cuenta);
    };
  }, [refPagado, centavosPagados, limpiarAlPagar, cargarRegistro]);

  // A los 10 segundos la pantalla verde regresa sola al mostrador.
  useEffect(() => {
    if (refPagado && quedan <= 0) setPantalla({ paso: "tienda" });
  }, [refPagado, quedan]);

  // ------------------------------------------------------------ qué pantalla se dibuja
  const puntos = "...".slice(0, (Math.floor(ahora / 330) % 3) + 1);

  if (sesion === "cargando") return <main className="pantalla" aria-busy="true" />;

  if (sesion !== "si") {
    return (
      <PantallaPin
        digitos={pin.length}
        mensaje={sesion === "sin_pin" ? "(falta configurar el PIN del mostrador)" : mensajePin}
        pisada={pisada}
        ocupado={ocupadoPin}
        onTecla={teclaPin}
        onPulsar={pulsarPin}
        onEntrar={() => void entrarConPin()}
      />
    );
  }

  switch (pantalla.paso) {
    case "pagado":
      return (
        <PantallaCayo
          referencia={pantalla.ref}
          centavos={pantalla.centavos}
          items={pantalla.items}
          numero={pantalla.numero}
          minutos={pantalla.minutos}
          recogerEn={pantalla.recogerEn}
          hora={new Date(pantalla.pagadoEn)}
          selloCae={selloCae}
          quedan={quedan}
          telefono={pantalla.telefono}
          confirmacion={mensajeDeConfirmacion({
            centavos: pantalla.centavos,
            items: pantalla.items,
            numero: pantalla.numero,
            minutos: pantalla.minutos,
            recogerEn: pantalla.recogerEn,
          })}
          onNuevo={nuevoCobro}
        />
      );
    case "qr":
      return (
        <PantallaEspera
          referencia={pantalla.ref}
          centavos={pantalla.centavos}
          minutos={pantalla.minutos}
          qrSvg={pantalla.qrSvg}
          puntos={puntos}
          transcurridoMs={ahora - pantalla.inicio}
          restanteMs={pantalla.venceLocal - ahora}
          vencido={ahora >= pantalla.venceLocal}
          onCancelar={volver}
          onNuevo={volver}
        />
      );
    case "generando":
      return (
        <PantallaEspera
          referencia={null}
          centavos={pantalla.centavos}
          minutos={pantalla.minutos}
          qrSvg={null}
          queHace={pantalla.queHace}
          puntos={puntos}
          transcurridoMs={0}
          restanteMs={0}
          vencido={false}
          onNuevo={volver}
        />
      );
    case "remota":
      return <PantallaRemota cobro={pantalla.cobro} ahora={ahora} puntos={puntos} onSeguir={nuevoCobro} />;
    case "error":
      return <PantallaError mensaje={pantalla.mensaje} onVolver={volver} />;
    case "registro":
      return (
        <PantallaRegistro
          registro={registro}
          fallo={falloRegistro}
          nuevas={nuevas}
          ahora={ahora}
          onVolver={cerrarRegistro}
          onSalir={() => void salir()}
        />
      );
    case "metodo":
      return (
        <PantallaMetodo
          centavos={pantalla.origen === "tienda" ? centavosCarrito : centavosTeclado}
          minutos={pantalla.origen === "tienda" ? minutos : undefined}
          items={pantalla.origen === "tienda" ? lineas : undefined}
          onElegir={(metodo) => elegirMetodo(metodo, pantalla.origen)}
          onVolver={volver}
        />
      );
    case "celular": {
      const { modo, origen } = pantalla;
      return (
        <PantallaCelular
          modo={modo}
          digitos={celular}
          centavos={origen === "tienda" ? centavosCarrito : centavosTeclado}
          pisada={pisada}
          mensaje={mensajeCelular}
          onTecla={teclaCelular}
          onPulsar={pulsarCelular}
          onEnviar={() => {
            if (celular.length !== 10) {
              sonarTope();
              setMensajeCelular("(faltan dígitos: son 10)");
              return;
            }
            void iniciarCobro(modo, origen, celular);
          }}
          onOmitir={modo === "link" ? () => void iniciarCobro("link", origen) : undefined}
          onVolver={() => setPantalla({ paso: "metodo", origen })}
        />
      );
    }
    case "teclado":
      return (
        <PantallaTeclado
          textoMonto={comoSeTeclea(texto)}
          centavos={centavosTeclado}
          golpe={golpe}
          pisada={pisada}
          registro={registro}
          onTecla={aplicarTecla}
          onPulsar={pulsarTecla}
          onCobrar={cobrarLibre}
          onVolver={() => setPantalla({ paso: "tienda" })}
          onAbrirRegistro={() => abrirRegistro("teclado")}
        />
      );
    default:
      return (
        <PantallaTienda
          carrito={carrito}
          lineas={lineas}
          centavos={centavosCarrito}
          articulos={articulos}
          minutos={minutos}
          registro={registro}
          onAgregar={agregar}
          onQuitar={quitar}
          onVaciar={vaciar}
          onMinutos={elegirMinutos}
          onCobrar={cobrarTienda}
          onOtroMonto={() => setPantalla({ paso: "teclado" })}
          onAbrirRegistro={() => abrirRegistro("tienda")}
        />
      );
  }
}
