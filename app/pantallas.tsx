"use client";

// Las pantallas del mostrador. Aquí solo se dibuja: la lógica (qué pasa al
// tocar, cuándo se pide el cobro, cuándo cayó el pago) vive en page.tsx.

import { useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Ajusta, altoDePantalla, esApaisado, type Calculo } from "./ajusta";
import {
  CATEGORIAS,
  OPCIONES_DE_MINUTOS,
  PRECIOS_DE_PRUEBA,
  PRODUCTOS,
  type LineaCobro,
  type Producto,
} from "@/lib/catalogo";
import { diaDeLaSemana, dos, fechaCorta, horaMin, MESES, reloj } from "@/lib/hora";
import type { Inteligencia } from "@/lib/inteligencia";
import { importeConLetra, letraCorta, textoDeMonto } from "@/lib/letra";
import { NEGOCIO } from "@/lib/negocio";
import {
  resumenDeProductos,
  type CobroPendiente,
  type CobroRegistrado,
  type MetodoDeCobro,
  type ResumenDelDia,
} from "@/lib/registro";
import { enlaceWhatsapp, mensajeDeConfirmacion, mensajeDeInstrucciones } from "@/lib/whatsapp";

const centavosDe = (pesos: number) => Math.round(pesos * 100);

// Tamaños de los letreros (se miden contra la pantalla, como en la maqueta).
const calcTitulo: Calculo = (c) => ({ w: c.w * 0.97, h: altoDePantalla() * (esApaisado() ? 0.4 : 0.44) });
// Con el bloque "REGRESA A LAS…" en pantalla ancha, el letrero cede espacio para que el importe se siga viendo grande.
const calcTituloConRecoge: Calculo = (c) => ({ w: c.w * 0.97, h: altoDePantalla() * (esApaisado() ? 0.27 : 0.44) });
const calcNoEntregar: Calculo = (c) => ({ w: c.w, h: altoDePantalla() * 0.085 });
const calcEspera: Calculo = (c) => ({ w: c.w, h: altoDePantalla() * 0.05 });
const calcRegresa: Calculo = (c) => ({ w: c.w, h: altoDePantalla() * 0.065 });

export function Monto({ texto, golpe = 0 }: { texto: string; golpe?: number }) {
  return (
    <Ajusta key={golpe} className={golpe > 0 ? "monto golpe" : "monto"}>
      <span className="peso">$</span>
      {texto}
    </Ajusta>
  );
}

const ETIQUETA_DEL_METODO: Record<MetodoDeCobro, string> = { qr: "QR", push: "CELULAR", link: "ENLACE" };

// ---------------------------------------------------------------- teclado numérico (monto, PIN, celular)

export type Tecla = string; // "0"-"9", ".", "borrar", "entrar" o "" (hueco)

function Teclas({
  teclas,
  pisada,
  onPulsar,
  onTecla,
}: {
  teclas: ReadonlyArray<Tecla>;
  pisada: string | null;
  /** Se llama al pisar la tecla (antes de soltar), igual que un teclado de caja. */
  onPulsar: (tecla: string) => void;
  /** Activación por teclado físico o lector de pantalla. */
  onTecla: (tecla: string) => void;
}) {
  const alPisar = (evento: PointerEvent<HTMLDivElement>) => {
    const boton = (evento.target as HTMLElement).closest<HTMLElement>(".tecla[data-t]");
    if (!boton) return;
    evento.preventDefault();
    onPulsar(boton.dataset.t ?? "");
  };
  const alTocar = (evento: MouseEvent<HTMLDivElement>) => {
    if (evento.detail !== 0) return; // solo teclado físico o lector de pantalla
    const boton = (evento.target as HTMLElement).closest<HTMLElement>(".tecla[data-t]");
    if (boton) onTecla(boton.dataset.t ?? "");
  };
  return (
    <div className="teclas" onPointerDown={alPisar} onClick={alTocar}>
      {teclas.map((tecla, i) =>
        tecla === "" ? (
          <div key={`hueco-${i}`} className="tecla vacia" aria-hidden="true" />
        ) : (
          <button
            key={tecla}
            className={`tecla${tecla === "." ? " punto" : ""}${tecla === "entrar" ? " entrar" : ""}${pisada === tecla ? " pisada" : ""}`}
            type="button"
            data-t={tecla}
            aria-label={tecla === "borrar" ? "Borrar" : tecla === "." ? "Punto para centavos" : tecla === "entrar" ? "Entrar" : tecla}
          >
            {tecla === "borrar" ? (
              <>
                <svg viewBox="0 0 30 22" aria-hidden="true">
                  <path d="M10 1.5H28.5V20.5H10L1.8 11Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="miter" />
                  <path d="M14.5 6.5l9 9M23.5 6.5l-9 9" fill="none" stroke="currentColor" strokeWidth="3" />
                </svg>
                <small>BORRAR</small>
              </>
            ) : tecla === "." ? (
              <>
                <span aria-hidden="true">.</span>
                <small>CENTAVOS</small>
              </>
            ) : tecla === "entrar" ? (
              "ENTRAR"
            ) : (
              tecla
            )}
          </button>
        ),
      )}
    </div>
  );
}

const TECLAS_MONTO: ReadonlyArray<Tecla> = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "borrar"];
const TECLAS_PIN: ReadonlyArray<Tecla> = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "borrar", "0", "entrar"];
const TECLAS_CELULAR: ReadonlyArray<Tecla> = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "borrar"];

// ---------------------------------------------------------------- PIN del mostrador

export function PantallaPin({
  digitos,
  mensaje,
  pisada,
  ocupado,
  onTecla,
  onPulsar,
  onEntrar,
}: {
  digitos: number;
  /** Lo que se le dice a quien teclea (error, bloqueo, falta de configuración). */
  mensaje: string;
  pisada: string | null;
  ocupado: boolean;
  onTecla: (tecla: string) => void;
  onPulsar: (tecla: string) => void;
  onEntrar: () => void;
}) {
  return (
    <main className="pantalla tienda teclado-pantalla">
      <div className="cuerpo">
        <section className="hoja">
          <header className="cabeza">
            <b>Sin Tranza</b>
            <span>Mostrador cerrado</span>
          </header>
          <div className="importe" aria-live="polite">
            <span className="rot">PIN del mostrador</span>
            <Ajusta className="monto">{digitos > 0 ? "•".repeat(digitos) : "—"}</Ajusta>
          </div>
          <p className="letra">{mensaje || (ocupado ? "(revisando…)" : "(escribe el PIN y toca entrar)")}</p>
        </section>
        <section className="teclado">
          <Teclas
            teclas={TECLAS_PIN}
            pisada={pisada}
            onTecla={(t) => (t === "entrar" ? onEntrar() : onTecla(t))}
            onPulsar={(t) => (t === "entrar" ? onEntrar() : onPulsar(t))}
          />
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- la tira de arriba

/** Lo último que selló el banco hoy, cuántos van y cuántos esperan. Al tocarla se abre el registro. */
function Tira({ registro, onAbrir }: { registro: ResumenDelDia | null; onAbrir: () => void }) {
  const ultimo = registro?.cobros[0];
  const esperando = registro?.pendientes.length ?? 0;
  return (
    <button className="tira" type="button" onClick={onAbrir} aria-label="Ver los cobros de hoy">
      <span className={ultimo ? "ult" : "ult nada"}>
        {ultimo
          ? `CAYÓ $${textoDeMonto(centavosDe(ultimo.monto))} · ${horaMin(ultimo.pagadoEn)}`
          : registro
            ? "HOY TODAVÍA NO CAE NADA"
            : "ABRIR COBROS DE HOY"}
      </span>
      {esperando > 0 && <span className="pend">POR COBRAR: {esperando}</span>}
      <span className="hoy">
        HOY: {registro ? registro.cuantos : "–"} · VER TABLERO <span aria-hidden="true">›</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- 0 · mostrador

export function PantallaTienda({
  carrito,
  lineas,
  centavos,
  articulos,
  minutos,
  registro,
  onAgregar,
  onQuitar,
  onVaciar,
  onMinutos,
  onCobrar,
  onOtroMonto,
  onAbrirRegistro,
}: {
  carrito: Record<string, number>;
  lineas: LineaCobro[];
  centavos: number;
  articulos: number;
  minutos: number;
  registro: ResumenDelDia | null;
  onAgregar: (producto: Producto, tarjeta: HTMLElement | null) => void;
  onQuitar: (producto: Producto) => void;
  onVaciar: () => void;
  onMinutos: (minutos: number) => void;
  onCobrar: () => void;
  onOtroMonto: () => void;
  onAbrirRegistro: () => void;
}) {
  const lista = centavos > 0;
  return (
    <main className="pantalla tienda">
      <header className="cabeza">
        <b>Sin Tranza</b>
        <button className="texto-chico" type="button" onClick={onOtroMonto}>
          otro monto
        </button>
        <span>Milpa</span>
      </header>
      <Tira registro={registro} onAbrir={onAbrirRegistro} />
      <div className="cuerpo">
        <div className="catalogo">
          {PRECIOS_DE_PRUEBA && <p className="aviso-prueba">Precios de prueba · todo cuesta $0.01</p>}
          {CATEGORIAS.map((categoria) => (
            <section key={categoria.id}>
              <h2 className="seccion">{categoria.titulo}</h2>
              <div className="prods">
                {PRODUCTOS.filter((producto) => producto.categoria === categoria.id).map((producto) => {
                  const cantidad = carrito[producto.id] ?? 0;
                  return (
                    <div key={producto.id} className={cantidad > 0 ? "prod lleva" : "prod"}>
                      <button
                        className="prod-add"
                        type="button"
                        aria-label={`Agregar ${producto.nombre}, $${textoDeMonto(producto.centavos)}${cantidad ? `. Lleva ${cantidad}` : ""}`}
                        onClick={(evento: MouseEvent<HTMLButtonElement>) => onAgregar(producto, evento.currentTarget)}
                      >
                        <span className="nom">{producto.nombre}</span>
                        <span className="pre">${textoDeMonto(producto.centavos)}</span>
                      </button>
                      {cantidad > 0 && (
                        <>
                          <span className="cant" aria-hidden="true">
                            ×{cantidad}
                          </span>
                          <button
                            className="menos"
                            type="button"
                            aria-label={`Quitar uno de ${producto.nombre}`}
                            onClick={() => onQuitar(producto)}
                          >
                            −
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <section className="lateral">
          <div className="importe">
            <span className="rot">
              Importe{articulos > 0 ? ` · ${articulos} ${articulos === 1 ? "platillo" : "platillos"}` : ""}
            </span>
            {articulos > 0 && (
              <button className="texto-chico vaciar" type="button" onClick={onVaciar}>
                vaciar
              </button>
            )}
            <Monto texto={textoDeMonto(centavos)} />
          </div>
          <ul className="lineas" aria-label="Lo que lleva el pedido">
            {lineas.length === 0 && <li className="vacia">Toca los platillos para agregarlos.</li>}
            {lineas.map((linea) => (
              <li key={linea.id}>
                <span>
                  {linea.cantidad} × {linea.nombre}
                </span>
                <span>${textoDeMonto(centavosDe(linea.precio * linea.cantidad))}</span>
              </li>
            ))}
          </ul>
          <p className="letra">{lista ? `(${importeConLetra(centavos)})` : "(toca los platillos)"}</p>
          <div className="listo-en" role="group" aria-label="Listo en cuántos minutos después de pagar">
            <span className="rot">Listo en</span>
            {OPCIONES_DE_MINUTOS.map((opcion) => (
              <button
                key={opcion}
                className={opcion === minutos ? "chip activo" : "chip"}
                type="button"
                aria-pressed={opcion === minutos}
                onClick={() => onMinutos(opcion)}
              >
                {opcion}
              </button>
            ))}
            <span className="rot">min</span>
          </div>
          <button className={lista ? "cobrar lista" : "cobrar"} type="button" aria-disabled={!lista} onClick={onCobrar}>
            COBRAR
          </button>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- 1 · monto libre

export function PantallaTeclado({
  textoMonto,
  centavos,
  golpe,
  pisada,
  registro,
  onTecla,
  onPulsar,
  onCobrar,
  onVolver,
  onAbrirRegistro,
}: {
  /** Lo tecleado, ya con comas ("1,500.5"). */
  textoMonto: string;
  centavos: number;
  golpe: number;
  pisada: string | null;
  registro: ResumenDelDia | null;
  onTecla: (tecla: string) => void;
  onPulsar: (tecla: string) => void;
  onCobrar: () => void;
  onVolver: () => void;
  onAbrirRegistro: () => void;
}) {
  const lista = centavos > 0;
  return (
    <main className="pantalla tienda teclado-pantalla">
      <div className="cuerpo">
        <section className="hoja">
          <header className="cabeza">
            <b>Sin Tranza</b>
            <button className="texto-chico" type="button" onClick={onVolver}>
              ← menú
            </button>
            <span>Monto libre</span>
          </header>
          <Tira registro={registro} onAbrir={onAbrirRegistro} />
          <div className="importe" aria-live="polite">
            <span className="rot">Importe</span>
            <Monto texto={textoMonto} golpe={golpe} />
          </div>
          <p className="letra">{lista ? `(${importeConLetra(centavos)})` : "(teclea el importe)"}</p>
        </section>
        <section className="teclado">
          <Teclas teclas={TECLAS_MONTO} pisada={pisada} onTecla={onTecla} onPulsar={onPulsar} />
          <button className={lista ? "cobrar lista" : "cobrar"} type="button" aria-disabled={!lista} onClick={onCobrar}>
            COBRAR
          </button>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- ¿cómo paga?

export function PantallaMetodo({
  centavos,
  minutos,
  items,
  onElegir,
  onVolver,
}: {
  centavos: number;
  minutos?: number;
  items?: LineaCobro[];
  onElegir: (metodo: MetodoDeCobro) => void;
  onVolver: () => void;
}) {
  return (
    <main className="pantalla metodo">
      <section className="info">
        <header className="cabeza">
          <b>Sin Tranza</b>
          <button className="texto-chico" type="button" onClick={onVolver}>
            ← cambiar pedido
          </button>
          <span>¿Cómo paga?</span>
        </header>
        <div className="importe">
          <span className="rot">Importe</span>
          <Monto texto={textoDeMonto(centavos)} />
        </div>
        <p className="letra">({importeConLetra(centavos)})</p>
        {minutos !== undefined && <p className="entrega">Listo en {minutos} min después de pagar</p>}
      </section>
      <div className="opciones">
        {items && items.length > 0 && <p className="resumen-pedido">{resumenDeProductos(items)}</p>}
        <button className="opcion" type="button" onClick={() => onElegir("qr")}>
          <b>QR AQUÍ</b>
          <span>El cliente está presente: escanea esta pantalla con la app de su banco.</span>
        </button>
        <button className="opcion" type="button" onClick={() => onElegir("push")}>
          <b>A SU CELULAR</b>
          <span>Le llega una solicitud de pago CoDi a su app del banco. No escanea nada.</span>
        </button>
        <button className="opcion" type="button" onClick={() => onElegir("link")}>
          <b>ENLACE DE PAGO</b>
          <span>Se lo mandas por WhatsApp. Paga con tarjeta, Apple Pay, Google Pay o CoDi.</span>
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- celular del cliente

/** "5512345678" → "55 1234 5678" (se va armando mientras se teclea). */
const celularConEspacios = (digitos: string) =>
  [digitos.slice(0, 2), digitos.slice(2, 6), digitos.slice(6, 10)].filter(Boolean).join(" ");

export function PantallaCelular({
  modo,
  digitos,
  centavos,
  pisada,
  mensaje,
  onTecla,
  onPulsar,
  onEnviar,
  onOmitir,
  onVolver,
}: {
  modo: "push" | "link";
  /** Lo tecleado, solo dígitos (hasta 10). */
  digitos: string;
  centavos: number;
  pisada: string | null;
  mensaje: string;
  onTecla: (tecla: string) => void;
  onPulsar: (tecla: string) => void;
  onEnviar: () => void;
  /** Solo en el enlace de pago: seguir sin celular. */
  onOmitir?: () => void;
  onVolver: () => void;
}) {
  const completo = digitos.length === 10;
  return (
    <main className="pantalla tienda teclado-pantalla">
      <div className="cuerpo">
        <section className="hoja">
          <header className="cabeza">
            <b>Sin Tranza</b>
            <button className="texto-chico" type="button" onClick={onVolver}>
              ← cómo paga
            </button>
            <span>${textoDeMonto(centavos)}</span>
          </header>
          <div className="importe" aria-live="polite">
            <span className="rot">Celular del cliente</span>
            <Ajusta className="monto">{digitos ? celularConEspacios(digitos) : "—"}</Ajusta>
          </div>
          <p className="letra">
            {mensaje ||
              (modo === "push"
                ? "(10 dígitos: ahí le llega la solicitud de pago CoDi y el WhatsApp)"
                : "(10 dígitos para mandarle el enlace por WhatsApp)")}
          </p>
        </section>
        <section className="teclado">
          <Teclas teclas={TECLAS_CELULAR} pisada={pisada} onTecla={onTecla} onPulsar={onPulsar} />
          <button className={completo ? "cobrar lista" : "cobrar"} type="button" aria-disabled={!completo} onClick={onEnviar}>
            {modo === "push" ? "MANDAR SOLICITUD DE PAGO" : "HACER ENLACE DE PAGO"}
          </button>
          {onOmitir && (
            <button className="texto-chico omitir" type="button" onClick={onOmitir}>
              seguir sin celular (solo el enlace)
            </button>
          )}
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- cobro a distancia en espera

export type CobroRemoto = {
  ref: string;
  metodo: "push" | "link";
  centavos: number;
  items?: LineaCobro[];
  minutos?: number;
  telefono?: string;
  seguimiento: string;
  enlaceDePago?: string;
  creadoEn: number;
  venceEn: number;
};

/** Botón o enlace con el estilo de la nota. */
function Accion({ children, href, onClick, primaria }: { children: ReactNode; href?: string; onClick?: () => void; primaria?: boolean }) {
  const clase = primaria ? "accion primaria" : "accion";
  return href ? (
    <a className={clase} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <button className={clase} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

export function PantallaRemota({
  cobro,
  ahora,
  puntos,
  onSeguir,
}: {
  cobro: CobroRemoto;
  ahora: number;
  puntos: string;
  onSeguir: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const mensaje = mensajeDeInstrucciones({
    metodo: cobro.metodo,
    centavos: centavosDe(cobro.centavos),
    items: cobro.items,
    minutos: cobro.minutos,
    enlaceDePago: cobro.enlaceDePago,
    enlaceDeSeguimiento: cobro.seguimiento,
  });
  const whatsapp = cobro.telefono
    ? enlaceWhatsapp(cobro.telefono, mensaje)
    : `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
  const faltan = cobro.venceEn - ahora;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(cobro.metodo === "link" ? (cobro.enlaceDePago ?? cobro.seguimiento) : cobro.seguimiento);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso para copiar: queda WhatsApp.
    }
  };
  return (
    <main className="pantalla remota" role="status">
      <section className="info">
        <header className="cabeza">
          <b>Sin Tranza</b>
          <span>Nota N.º {cobro.ref}</span>
        </header>
        <div className="importe">
          <span className="rot">Importe</span>
          <Monto texto={textoDeMonto(centavosDe(cobro.centavos))} />
        </div>
        <p className="letra">({importeConLetra(centavosDe(cobro.centavos))})</p>
        {cobro.minutos !== undefined && <p className="entrega">Listo en {cobro.minutos} min después de pagar</p>}
      </section>

      <div className="remota-cuerpo">
        <div className="instruccion">
          {cobro.metodo === "push" ? (
            <>
              <b>SOLICITUD ENVIADA{cobro.telefono ? ` AL ····${cobro.telefono.slice(-4)}` : ""}</b>
              <p>
                Pídele que abra la app de su banco y <strong>acepte la solicitud de pago CoDi</strong>. Si no le llega, usa
                el enlace de pago.
              </p>
            </>
          ) : (
            <>
              <b>ENLACE DE PAGO LISTO</b>
              <p>
                Mándaselo por WhatsApp. Paga con <strong>tarjeta, Apple Pay, Google Pay o CoDi</strong>.
              </p>
            </>
          )}
        </div>
        <Accion href={whatsapp} primaria>
          {cobro.telefono ? "ENVIAR INSTRUCCIONES POR WHATSAPP" : "ELEGIR CONTACTO Y ENVIAR POR WHATSAPP"}
        </Accion>
        <Accion onClick={copiar}>{copiado ? "COPIADO" : cobro.metodo === "link" ? "COPIAR ENLACE DE PAGO" : "COPIAR ENLACE DE SEGUIMIENTO"}</Accion>
      </div>

      <section className="estado">
        <div className="sin-sello">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <rect x="0" y="0" width="100" height="100" />
          </svg>
          <Ajusta className="esp" calculo={calcEspera}>
            ESPERANDO EL PAGO
            <span className="pts" aria-hidden="true">
              {puntos}
            </span>
          </Ajusta>
        </div>
        <div className="vence">
          <span>
            {cobro.metodo === "push"
              ? faltan > 0
                ? `La solicitud vence en ${reloj(faltan)}`
                : "La solicitud ya venció"
              : "El enlace sigue activo hasta que se pague"}
          </span>
          <button className="texto-chico" type="button" onClick={onSeguir}>
            seguir atendiendo
          </button>
        </div>
        <div className="no-entregar">
          <Ajusta className="" calculo={calcNoEntregar}>
            NO ENTREGAR MERCANCÍA
          </Ajusta>
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- registro del día

function FilaPagada({ cobro, nueva }: { cobro: CobroRegistrado; nueva: boolean }) {
  const texto = textoDeMonto(centavosDe(cobro.monto));
  const detalle = [
    cobro.recogerEn !== undefined ? `RECOGE ${horaMin(cobro.recogerEn)}` : null,
    cobro.items && cobro.items.length > 0 ? resumenDeProductos(cobro.items) : "MONTO LIBRE",
  ]
    .filter(Boolean)
    .join(" · ");
  const confirmacion = cobro.telefono
    ? enlaceWhatsapp(
        cobro.telefono,
        mensajeDeConfirmacion({
          centavos: centavosDe(cobro.monto),
          items: cobro.items,
          numero: cobro.numero,
          minutos: cobro.minutos,
          recogerEn: cobro.recogerEn,
        }),
      )
    : null;
  return (
    <li className={nueva ? "fila nueva" : "fila"}>
      <span className="cuando">
        {horaMin(cobro.pagadoEn)}
        <small>
          {cobro.numero !== undefined ? `PEDIDO ${dos(cobro.numero)}` : `NOTA ${cobro.ref}`} · {ETIQUETA_DEL_METODO[cobro.metodo]}
        </small>
      </span>
      {cobro.ejemplo ? <span className="pag ej">EJEMPLO</span> : <span className="pag">PAGADO</span>}
      <span className={texto.length > 6 ? "cuanto largo" : "cuanto"}>
        <span className="peso">$</span>
        {texto}
      </span>
      <span className="que">{detalle}</span>
      {confirmacion && (
        <a className="mini" href={confirmacion} target="_blank" rel="noopener noreferrer">
          CONFIRMAR POR WHATSAPP
        </a>
      )}
    </li>
  );
}

function FilaPendiente({ cobro, ahora }: { cobro: CobroPendiente; ahora: number }) {
  const texto = textoDeMonto(centavosDe(cobro.monto));
  const faltan = cobro.venceEn - ahora;
  const venceTexto =
    cobro.metodo === "push" ? (faltan > 0 ? `VENCE EN ${reloj(faltan)}` : "SOLICITUD VENCIDA") : "ENLACE ACTIVO";
  const instrucciones = enlaceWhatsapp(
    cobro.telefono ?? "",
    mensajeDeInstrucciones({
      metodo: cobro.metodo,
      centavos: centavosDe(cobro.monto),
      items: cobro.items,
      minutos: cobro.minutos,
      enlaceDePago: cobro.enlaceDePago,
      enlaceDeSeguimiento: cobro.seguimiento,
    }),
  );
  const href = cobro.telefono ? instrucciones : instrucciones.replace("/52?text=", "/?text=");
  return (
    <li className="fila falta">
      <span className="cuando">
        {ETIQUETA_DEL_METODO[cobro.metodo]}
        <small>{cobro.telefono ? `····${cobro.telefono.slice(-4)}` : "SIN CELULAR"}</small>
      </span>
      <span className="pag">SIN SELLO</span>
      <span className={texto.length > 6 ? "cuanto largo" : "cuanto"}>
        <span className="peso">$</span>
        {texto}
      </span>
      <span className="que">
        {venceTexto}
        {cobro.items && cobro.items.length > 0 ? ` · ${resumenDeProductos(cobro.items)}` : ""}
      </span>
      <a className="mini" href={href} target="_blank" rel="noopener noreferrer">
        REENVIAR POR WHATSAPP
      </a>
    </li>
  );
}

/** Las dos caras del tablero. */
export type VistaDelTablero = "cobros" | "inteligencia";

/** Si el tablero trae ventas de ejemplo y cómo quitarlas o ponerlas (sin `onCambiar` no se pueden quitar: es la demostración). */
export type Ejemplos = { activos: boolean; cuantos: number; onCambiar?: (activos: boolean) => void };

function Pestanas({ activa, onCambiar }: { activa: VistaDelTablero; onCambiar: (vista: VistaDelTablero) => void }) {
  const pestana = (vista: VistaDelTablero, rotulo: string) => (
    <button
      type="button"
      className={activa === vista ? "activa" : undefined}
      aria-current={activa === vista ? "page" : undefined}
      onClick={() => onCambiar(vista)}
    >
      {rotulo}
    </button>
  );
  return (
    <nav className="pestanas" aria-label="Tablero">
      {pestana("cobros", "COBROS DE HOY")}
      {pestana("inteligencia", "INTELIGENCIA")}
    </nav>
  );
}

/** La franja que dice, sin rodeos, si lo que se ve trae ventas de ejemplo. */
function AvisoEjemplos({ ejemplos }: { ejemplos?: Ejemplos }) {
  if (!ejemplos) return null;
  const { activos, cuantos, onCambiar } = ejemplos;
  return (
    <p className={activos ? "aviso-ejemplos" : "aviso-ejemplos reales"}>
      <span>
        {!onCambiar
          ? "Vista de demostración · todas las ventas son de ejemplo, no dinero real"
          : activos
            ? `Incluye ${cuantos} ${cuantos === 1 ? "venta" : "ventas"} de ejemplo (sello EJEMPLO): no son dinero real`
            : "Solo cobros reales, sellados por el banco"}
      </span>
      {onCambiar && (
        <button type="button" onClick={() => onCambiar(!activos)}>
          {activos ? "QUITAR EJEMPLOS" : "VER CON EJEMPLOS"}
        </button>
      )}
    </p>
  );
}

export function PantallaRegistro({
  registro,
  fallo,
  nuevas,
  ahora,
  ejemplos,
  textoVolver = "VOLVER A COBRAR",
  onVista,
  onVolver,
  onSalir,
}: {
  registro: ResumenDelDia | null;
  /** true si no se pudo cargar el registro. */
  fallo: boolean;
  /** Referencias que acaban de aparecer (para el golpe de entrada). */
  nuevas: ReadonlySet<string>;
  ahora: number;
  ejemplos?: Ejemplos;
  textoVolver?: string;
  onVista: (vista: VistaDelTablero) => void;
  onVolver: () => void;
  /** Sin esto no sale "cerrar el mostrador" (la demostración no tiene sesión). */
  onSalir?: () => void;
}) {
  const cuantos = registro?.cuantos ?? 0;
  const suma = registro?.sumaCentavos ?? 0;
  const pendientes = registro?.pendientes ?? [];
  const deEjemplo = registro?.cobros.filter((cobro) => cobro.ejemplo).length ?? 0;
  return (
    <main className="pantalla registro">
      <section className="libro">
        <header className="cabeza">
          <b>Sin Tranza</b>
          {onSalir && (
            <button className="texto-chico" type="button" onClick={onSalir}>
              cerrar el mostrador
            </button>
          )}
          <span>Cobros de hoy{registro ? ` · ${fechaCorta(registro.dia)}` : ""}</span>
        </header>
        <Pestanas activa="cobros" onCambiar={onVista} />
        {registro && <AvisoEjemplos ejemplos={ejemplos} />}
        <ul className="renglones" aria-label="Cobros de hoy">
          {!registro && (
            <li className="vacio">
              <b>{fallo ? "NO SE PUDO CARGAR." : "CARGANDO…"}</b>
              {fallo && <p>Revisa tu internet. Se vuelve a intentar solo.</p>}
            </li>
          )}
          {pendientes.length > 0 && (
            <li className="subtitulo">
              Por cobrar · {pendientes.length} (no cuentan en la suma hasta que el banco los selle)
            </li>
          )}
          {pendientes.map((cobro) => (
            <FilaPendiente key={cobro.ref} cobro={cobro} ahora={ahora} />
          ))}
          {registro && cuantos === 0 && pendientes.length === 0 && (
            <li className="vacio">
              <b>HOY TODAVÍA NO CAE NADA.</b>
              <p>Aquí se apunta solo lo que el banco ya selló. Lo que te enseñen en una captura no cuenta.</p>
            </li>
          )}
          {cuantos > 0 && pendientes.length > 0 && <li className="subtitulo">Pagados · {cuantos}</li>}
          {registro?.cobros.map((cobro) => (
            <FilaPagada key={cobro.ref} cobro={cobro} nueva={nuevas.has(cobro.ref)} />
          ))}
        </ul>
      </section>
      <section className="suma">
        <div className="importe">
          <span className="rot">
            Suma de hoy · {cuantos} {cuantos === 1 ? "cobro" : "cobros"}
            {deEjemplo > 0 ? ` · ${deEjemplo} de ejemplo` : ""}
          </span>
          <Monto texto={textoDeMonto(suma)} />
        </div>
        <p className="letra">({importeConLetra(suma)})</p>
        <button className="volver" type="button" onClick={onVolver}>
          {textoVolver}
        </button>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- inteligencia de negocio

const NOMBRE_DEL_METODO: Record<MetodoDeCobro, string> = {
  qr: "QR aquí",
  push: "A su celular",
  link: "Enlace de pago",
};
// Cada forma de pago tiene su color fijo (y siempre su nombre al lado: el color nunca va solo).
const TONO_DEL_METODO: Record<MetodoDeCobro, "verde" | "anil" | "naranja"> = {
  qr: "verde",
  push: "anil",
  link: "naranja",
};

/** "$18,450" cuando ya son cientos de pesos; con centavos cuando es poco (los cobros de prueba de un centavo). */
const enPesos = (centavos: number) =>
  centavos >= 100_00 ? Math.round(centavos / 100).toLocaleString("es-MX") : textoDeMonto(centavos);

function Cifra({ rotulo, valor, nota, tono }: { rotulo: string; valor: string; nota?: string; tono?: "verde" | "maiz" }) {
  return (
    <div className={tono ? `cifra ${tono}` : "cifra"}>
      <span className="rot">{rotulo}</span>
      <b>{valor}</b>
      {nota && <small>{nota}</small>}
    </div>
  );
}

/** Alto, en pixeles, de la barra más alta de una gráfica. */
const ALTO_DE_BARRA = 120;

/**
 * Barras de pie: una por hora o por día, en verde (es dinero). La que importa
 * (la hora pico, el día de hoy) va en tinta y lleva su cifra arriba; con
 * `conCifras` la llevan todas. El detalle completo sale al dejar el cursor.
 */
function Barras({
  casillas,
  descripcion,
  conCifras = false,
}: {
  casillas: Array<{ clave: string; pie: string; centavos: number; cuantos: number; detalle: string; marcada?: boolean }>;
  descripcion: string;
  conCifras?: boolean;
}) {
  const tope = Math.max(1, ...casillas.map((casilla) => casilla.centavos));
  return (
    <div className="barras" role="img" aria-label={descripcion}>
      {casillas.map((casilla) => {
        const alto = casilla.centavos > 0 ? Math.max(2, Math.round((casilla.centavos / tope) * ALTO_DE_BARRA)) : 0;
        return (
          <div
            key={casilla.clave}
            className="barra"
            title={`${casilla.detalle} · $${enPesos(casilla.centavos)} · ${casilla.cuantos} ${casilla.cuantos === 1 ? "cobro" : "cobros"}`}
          >
            <span className="valor">
              {(conCifras || casilla.marcada) && casilla.centavos > 0 ? `$${enPesos(casilla.centavos)}` : ""}
            </span>
            <i className={casilla.marcada ? "marcada" : undefined} style={{ height: `${alto}px` }} />
            <small>{casilla.pie}</small>
          </div>
        );
      })}
    </div>
  );
}

/** Barras acostadas con su nombre y su cifra al lado (cómo pagan, qué se vende). */
function Tramos({
  filas,
}: {
  filas: Array<{ nombre: string; parte: number; cifra: string; tono?: "verde" | "anil" | "naranja" }>;
}) {
  return (
    <ul className="tramos">
      {filas.map((fila) => (
        <li key={fila.nombre}>
          <span className="nombre">{fila.nombre}</span>
          <span className="pista">
            <i className={fila.tono} style={{ width: `${Math.max(0, Math.min(1, fila.parte)) * 100}%` }} />
          </span>
          <b>{fila.cifra}</b>
        </li>
      ))}
    </ul>
  );
}

export function PantallaInteligencia({
  datos,
  dia,
  ejemplos,
  textoVolver = "VOLVER A COBRAR",
  onVista,
  onVolver,
  onSalir,
}: {
  /** null mientras carga el registro. */
  datos: Inteligencia | null;
  dia?: string;
  ejemplos?: Ejemplos;
  textoVolver?: string;
  onVista: (vista: VistaDelTablero) => void;
  onVolver: () => void;
  onSalir?: () => void;
}) {
  const contraAyer =
    datos && datos.ayerALaMismaHora !== null && datos.ayerALaMismaHora > 0
      ? Math.round(((datos.centavos - datos.ayerALaMismaHora) / datos.ayerALaMismaHora) * 100)
      : null;
  const topePiezas = datos ? Math.max(1, ...datos.top.map((platillo) => platillo.piezas)) : 1;
  return (
    <main className="pantalla registro de-intel">
      <section className="libro">
        <header className="cabeza">
          <b>Sin Tranza</b>
          {onSalir && (
            <button className="texto-chico" type="button" onClick={onSalir}>
              cerrar el mostrador
            </button>
          )}
          <span>Inteligencia{dia ? ` · ${fechaCorta(dia)}` : ""}</span>
        </header>
        <Pestanas activa="inteligencia" onCambiar={onVista} />
        {datos && <AvisoEjemplos ejemplos={ejemplos} />}
        <div className="renglones intel">
          {!datos && (
            <div className="vacio">
              <b>CARGANDO…</b>
            </div>
          )}
          {datos && (
            <>
              <div className="cifras">
                <Cifra
                  tono="verde"
                  rotulo="Venta de hoy"
                  valor={`$${enPesos(datos.centavos)}`}
                  nota={
                    contraAyer === null
                      ? undefined
                      : `${contraAyer >= 0 ? "+" : "−"}${Math.abs(contraAyer)}% contra ayer a esta hora`
                  }
                />
                <Cifra
                  rotulo="Cobros sellados"
                  valor={String(datos.cuantos)}
                  nota={datos.piezas > 0 ? `${datos.piezas} platillos y bebidas` : undefined}
                />
                <Cifra rotulo="Ticket promedio" valor={`$${enPesos(datos.ticketCentavos)}`} nota="por cobro" />
                <Cifra
                  tono="maiz"
                  rotulo="Hora pico"
                  valor={datos.horaPico !== null ? `${dos(datos.horaPico)}:00` : "–"}
                  nota={datos.horaPico !== null ? "la hora que más vende" : "todavía no cae nada"}
                />
              </div>

              <div className="graficas">
              <section className="grafica">
                <h2 className="seccion">Ventas por hora · hoy (en negro, la hora pico)</h2>
                <Barras
                  descripcion="Ventas de hoy por hora"
                  casillas={datos.porHora.map((casilla) => ({
                    clave: String(casilla.hora),
                    pie: String(casilla.hora),
                    centavos: casilla.centavos,
                    cuantos: casilla.cuantos,
                    detalle: `${dos(casilla.hora)}:00 a ${dos(casilla.hora)}:59`,
                    marcada: casilla.hora === datos.horaPico,
                  }))}
                />
              </section>

              <section className="grafica">
                <h2 className="seccion">
                  {datos.porDia.length > 1 ? `Últimos ${datos.porDia.length} días (en negro, hoy)` : "Venta del día"}
                </h2>
                <Barras
                  conCifras
                  descripcion="Venta de cada día"
                  casillas={datos.porDia.map((casilla) => ({
                    clave: casilla.dia,
                    pie: casilla.esHoy ? "HOY" : diaDeLaSemana(casilla.dia),
                    centavos: casilla.centavos,
                    cuantos: casilla.cuantos,
                    detalle: fechaCorta(casilla.dia),
                    marcada: casilla.esHoy,
                  }))}
                />
                {datos.porDia.length > 1 && <p className="pie-grafica">Hoy va a medias: el día todavía no cierra.</p>}
              </section>

              <section className="grafica">
                <h2 className="seccion">Cómo pagan</h2>
                <Tramos
                  filas={datos.porMetodo.map((metodo) => ({
                    nombre: NOMBRE_DEL_METODO[metodo.metodo],
                    tono: TONO_DEL_METODO[metodo.metodo],
                    parte: datos.cuantos > 0 ? metodo.cuantos / datos.cuantos : 0,
                    cifra: `${datos.cuantos > 0 ? Math.round((metodo.cuantos / datos.cuantos) * 100) : 0}% · ${metodo.cuantos}`,
                  }))}
                />
              </section>

              <section className="grafica">
                <h2 className="seccion">Lo que más se vende hoy</h2>
                {datos.top.length > 0 ? (
                  <Tramos
                    filas={datos.top.map((platillo) => ({
                      nombre: platillo.nombre,
                      tono: "anil" as const,
                      parte: platillo.piezas / topePiezas,
                      cifra: `${platillo.piezas} · $${enPesos(platillo.centavos)}`,
                    }))}
                  />
                ) : (
                  <p className="pie-grafica">Todavía no hay platillos vendidos hoy.</p>
                )}
              </section>
              </div>
            </>
          )}
        </div>
      </section>
      <section className="suma">
        <button className="volver" type="button" onClick={onVolver}>
          {textoVolver}
        </button>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- 2 · espera (QR)

export function PantallaEspera({
  referencia,
  centavos,
  minutos,
  qrSvg,
  queHace = "HACIENDO EL QR",
  puntos,
  transcurridoMs,
  restanteMs,
  vencido,
  onCancelar,
  onNuevo,
}: {
  referencia: string | null;
  centavos: number;
  /** En cuánto estará listo el pedido (undefined en un cobro de monto libre). */
  minutos?: number;
  /** null mientras Pey todavía hace el QR (o la solicitud, o el enlace). */
  qrSvg: string | null;
  /** Qué está haciendo Pey mientras no hay QR. */
  queHace?: string;
  puntos: string;
  transcurridoMs: number;
  restanteMs: number;
  vencido: boolean;
  onCancelar?: () => void;
  onNuevo: () => void;
}) {
  const generando = qrSvg === null;
  return (
    <main className="pantalla espera" role="status">
      <section className="info">
        <header className="cabeza">
          <b>Sin Tranza</b>
          <span>Nota N.º {referencia ?? "·······"}</span>
        </header>
        <div className="importe">
          <span className="rot">Importe</span>
          <Monto texto={textoDeMonto(centavos)} />
        </div>
        <p className="letra">({importeConLetra(centavos)})</p>
        {minutos !== undefined && <p className="entrega">Listo en {minutos} min después de pagar</p>}
      </section>

      <div className={vencido ? "qr vencido" : "qr"} role="img" aria-label="Código QR para pagar con CoDi">
        {qrSvg ? <div className="qr-caja golpe" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : <div className="qr-hueco" />}
        {vencido && (
          <div className="qr-vencido">
            <b>ESTE QR YA VENCIÓ</b>
            <span>No se cobró nada. Haz un cobro nuevo.</span>
          </div>
        )}
      </div>

      <section className="estado">
        {vencido ? (
          <button className="nuevo-papel" type="button" onClick={onNuevo}>
            NUEVO COBRO
          </button>
        ) : (
          <>
            <div className="sin-sello">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <rect x="0" y="0" width="100" height="100" />
              </svg>
              <Ajusta className="esp" calculo={calcEspera}>
                {generando ? queHace : "ESPERANDO AL BANCO"}
                <span className="pts" aria-hidden="true">
                  {puntos}
                </span>
                {!generando && (
                  <span className="reloj" aria-hidden="true">
                    {reloj(transcurridoMs)}
                  </span>
                )}
              </Ajusta>
            </div>
            <div className="vence">
              <span>{generando ? "" : `El QR vence en ${reloj(restanteMs)}`}</span>
              {onCancelar && (
                <button className="texto-chico" type="button" onClick={onCancelar}>
                  cancelar cobro
                </button>
              )}
            </div>
          </>
        )}
        <div className="no-entregar">
          <Ajusta className="" calculo={calcNoEntregar}>
            NO ENTREGAR MERCANCÍA
          </Ajusta>
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- 3 · ya cayó

export function PantallaCayo({
  referencia,
  centavos,
  items,
  numero,
  minutos,
  recogerEn,
  hora,
  selloCae,
  quedan,
  sello = "BANCO · CODI",
  marca = "Sin Tranza",
  direccion,
  telefono,
  confirmacion,
  onNuevo,
}: {
  referencia: string;
  centavos: number;
  items?: LineaCobro[];
  numero?: number;
  minutos?: number;
  /** A qué hora debe regresar el cliente (milisegundos). */
  recogerEn?: number;
  hora: Date;
  selloCae: boolean;
  quedan: number;
  /** Texto de arriba del sello. */
  sello?: string;
  marca?: string;
  /** Dónde pasa por su pedido (en la página del cliente). */
  direccion?: string;
  /** Celular del cliente: si se conoce, sale el botón de confirmar por WhatsApp. */
  telefono?: string;
  /** Mensaje de confirmación de compra, ya armado. */
  confirmacion?: string;
  /** Sin esto no hay botón ni cuenta regresiva (página del cliente). */
  onNuevo?: () => void;
}) {
  const horaTexto = `${dos(hora.getHours())}:${dos(hora.getMinutes())}:${dos(hora.getSeconds())}`;
  const fecha = `${hora.getDate()} ${MESES[hora.getMonth()]} ${hora.getFullYear()} · ${dos(hora.getHours())}:${dos(hora.getMinutes())}`;
  return (
    <main className={selloCae ? "pantalla cayo pum2" : "pantalla cayo pum"} role="alert">
      <header className="cabeza">
        <b>{marca}</b>
        <span>
          Nota N.º {referencia} · {horaTexto}
        </span>
      </header>
      <h1 className="titulo">
        <Ajusta className="t-in" calculo={recogerEn !== undefined ? calcTituloConRecoge : calcTitulo}>
          <span>¡YA </span>
          <span>CAYÓ!</span>
        </Ajusta>
      </h1>
      <div className="c-monto">
        <Monto texto={textoDeMonto(centavos)} />
      </div>
      {recogerEn !== undefined && (
        <div className="recoge">
          <Ajusta className="" calculo={calcRegresa}>
            REGRESA A LAS {horaMin(recogerEn)}
          </Ajusta>
          <p>
            {numero !== undefined ? `Pedido N.º ${dos(numero)} · ` : ""}
            {minutos !== undefined ? `Listo en ${minutos} min` : ""}
          </p>
          {direccion && <p>Recoge en: {direccion}</p>}
        </div>
      )}
      <div className="c-pie">
        <div className="c-col">
          {items && items.length > 0 && <p className="c-items">{resumenDeProductos(items)}</p>}
          <p className="c-letra">{letraCorta(centavos)}</p>
        </div>
        <svg className={selloCae ? "sello cae" : "sello"} viewBox="0 0 300 160" aria-hidden="true">
          <defs>
            <filter id="tinta" x="-6%" y="-10%" width="112%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="11" result="onda" />
              <feDisplacementMap in="SourceGraphic" in2="onda" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="chueco" />
              <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="1" seed="4" result="grano" />
              <feColorMatrix in="grano" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -16 0 0 0 11" result="huecos" />
              <feComposite in="chueco" in2="huecos" operator="in" />
            </filter>
          </defs>
          <g filter="url(#tinta)">
            <rect x="7" y="7" width="286" height="146" rx="18" fill="none" stroke="#FFFFFF" strokeWidth="10" />
            <rect x="21" y="21" width="258" height="118" rx="9" fill="none" stroke="#FFFFFF" strokeWidth="3" />
            <g fill="#FFFFFF" textAnchor="middle">
              <text x="150" y="50" fontSize="23" fontWeight="700" letterSpacing="4">{sello}</text>
              <text x="150" y="106" fontSize="60" fontWeight="700" letterSpacing="3">PAGADO</text>
              <text x="150" y="131" fontSize="19" fontWeight="700" letterSpacing="2">{fecha}</text>
            </g>
          </g>
        </svg>
      </div>
      {telefono && confirmacion && (
        <a className="accion-verde" href={enlaceWhatsapp(telefono, confirmacion)} target="_blank" rel="noopener noreferrer">
          CONFIRMAR LA COMPRA POR WHATSAPP
        </a>
      )}
      {onNuevo && (
        <>
          <button className="nuevo" type="button" onClick={onNuevo}>
            NUEVO COBRO
          </button>
          <p className="regresa">
            Regresa sola al mostrador en <span>{Math.max(quedan, 0)}</span> s
          </p>
        </>
      )}
      {!onNuevo && <p className="regresa">{NEGOCIO.nombre} · WhatsApp {NEGOCIO.whatsapp}</p>}
    </main>
  );
}

// ---------------------------------------------------------------- error

export function PantallaError({ mensaje, onVolver }: { mensaje: string; onVolver: () => void }) {
  return (
    <main className="pantalla error" role="alert">
      <header className="cabeza">
        <b>Sin Tranza</b>
        <span>Sin sello</span>
      </header>
      <div className="error-cuerpo">
        <h1>NO SE PUDO</h1>
        <p>{mensaje}</p>
      </div>
      <button className="nuevo-papel" type="button" onClick={onVolver}>
        VOLVER
      </button>
    </main>
  );
}
