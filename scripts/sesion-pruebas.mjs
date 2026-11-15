// Ayuda para los scripts de prueba: entra al mostrador con el PIN y devuelve la
// cookie de sesión para mandarla en las peticiones que la exigen.
//
//   PIN_MOSTRADOR=123456 node scripts/probar-catalogo.mjs https://mi-app.vercel.app
//
// El PIN se toma de la variable de entorno PIN_MOSTRADOR (el mismo que usa la app).

export async function entrar(base) {
  const pin = process.env.PIN_MOSTRADOR;
  if (!pin) {
    console.error("Falta PIN_MOSTRADOR en el entorno (el PIN del mostrador).");
    process.exit(2);
  }
  const r = await fetch(`${base}/api/sesion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (!r.ok) {
    console.error(`No se pudo entrar al mostrador: HTTP ${r.status} (¿PIN correcto?)`);
    process.exit(2);
  }
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) {
    console.error("La respuesta de entrada no trajo cookie de sesión.");
    process.exit(2);
  }
  return cookie;
}

/** Agrega la cookie de sesión a las opciones de fetch. */
export const conSesion = (cookie, init = {}) => ({ ...init, headers: { ...(init.headers ?? {}), Cookie: cookie } });
