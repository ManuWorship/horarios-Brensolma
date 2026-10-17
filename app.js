// App del empleado: marcar salida/llegada de casa, llegada/salida del trabajo e inicio/fin por proyecto.
import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendPasswordResetEmail, doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, getDocs,
  onSnapshot, serverTimestamp,
} from "./fb.js";
import { TIPOS, CONFIG_DEFECTO, siguientes, distanciaM, resumirJornada, hhmm, fechaLocal } from "./calculos.js";

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...hijos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const h of hijos.flat()) if (h !== null && h !== undefined) e.append(h.nodeType ? h : document.createTextNode(h));
  return e;
};
const hora = (t) => new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

let yo = null, perfil = null, cfg = { ...CONFIG_DEFECTO }, proyectos = [], marcasHoy = [], desuscribir = null;

// ---------------------------------------------------------------- ubicación
function ubicacion() {
  return new Promise((ok, mal) => {
    if (!navigator.geolocation) return mal(new Error("Este celular no permite ubicación en el navegador."));
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => mal(new Error(e.code === 1
        ? "Sin permiso de ubicación. Activalo para esta app en los ajustes del celular."
        : "No pude obtener la ubicación. Probá al aire libre o con el GPS activado.")),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 },
    );
  });
}

// ---------------------------------------------------------------- pantallas
function mostrar(id) {
  for (const s of document.querySelectorAll("main > section")) s.hidden = s.id !== id;
}

function aviso(texto, tipo = "info") {
  const a = $("#aviso");
  a.textContent = texto;
  a.className = `aviso ${tipo}`;
  a.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (a.hidden = true), tipo === "error" ? 9000 : 5000);
}

async function ocupado(boton, fn) {
  const txt = boton.innerHTML;
  boton.disabled = true;
  boton.innerHTML = "⏳ Un momento…";
  try { await fn(); } catch (e) { aviso(e.message || String(e), "error"); console.error(e); }
  finally { boton.disabled = false; boton.innerHTML = txt; }
}

// ---------------------------------------------------------------- login
$("#form-login").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const b = ev.submitter;
  ocupado(b, async () => {
    const email = $("#email").value.trim(), pass = $("#pass").value;
    if (b.value === "registro") {
      const nombre = $("#nombre").value.trim();
      if (!nombre) { $("#campo-nombre").hidden = false; throw new Error("Escribí tu nombre y apellido para registrarte."); }
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await setDoc(doc(db, "empleados", cred.user.uid), {
        nombre, email, estado: "pendiente", rol: "empleado", creado: serverTimestamp(),
      });
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  }).catch(() => {});
});
$("#btn-mostrar-registro").addEventListener("click", () => { $("#campo-nombre").hidden = false; });
$("#btn-olvide").addEventListener("click", async () => {
  const email = $("#email").value.trim();
  if (!email) return aviso("Escribí tu mail arriba y tocá de nuevo.", "error");
  try { await sendPasswordResetEmail(auth, email); aviso("Te mandé un mail para cambiar la contraseña."); }
  catch (e) { aviso(e.message, "error"); }
});
$("#btn-salir").addEventListener("click", () => signOut(auth));

// ---------------------------------------------------------------- arranque
onAuthStateChanged(auth, async (u) => {
  yo = u;
  if (desuscribir) { desuscribir(); desuscribir = null; }
  if (!u) { $("#btn-salir").hidden = true; return mostrar("pantalla-login"); }
  $("#btn-salir").hidden = false;
  try {
    const [p, c] = await Promise.all([getDoc(doc(db, "empleados", u.uid)), getDoc(doc(db, "config", "general"))]);
    perfil = p.exists() ? p.data() : null;
    if (c.exists()) cfg = { ...CONFIG_DEFECTO, ...c.data() };
  } catch (e) { aviso("No pude cargar tus datos: " + e.message, "error"); }
  if (!perfil) return mostrar("pantalla-login");
  $("#hola").textContent = `Hola, ${perfil.nombre.split(" ")[0]}`;
  renderPerfil();
  if (perfil.estado !== "activo") return mostrar("pantalla-pendiente");
  const snap = await getDocs(query(collection(db, "proyectos"), where("activo", "==", true)));
  proyectos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  escucharHoy();
  mostrar("pantalla-marcar");
});

function escucharHoy() {
  const q = query(collection(db, "marcas"), where("uid", "==", yo.uid), where("fecha", "==", fechaLocal()));
  desuscribir = onSnapshot(q, (snap) => {
    marcasHoy = snap.docs.map((d) => {
      const m = d.data();
      return { id: d.id, ...m, ts: m.ts ? m.ts.toMillis() : Date.now() };
    }).sort((a, b) => a.ts - b.ts);
    renderMarcar();
  }, (e) => aviso("Error leyendo tus marcas: " + e.message, "error"));
}

// ---------------------------------------------------------------- perfil / casa
function renderPerfil() {
  const txt = perfil.casa ? "✅ Tu casa está registrada y aprobada."
    : perfil.casaPropuesta ? "⏳ Mandaste la ubicación de tu casa. Falta que administración la apruebe."
    : "⚠️ Todavía no registraste tu casa. Hacelo estando en tu casa.";
  $("#estado-casa").textContent = txt;
  $("#estado-casa-2").textContent = txt;
  for (const b of document.querySelectorAll(".btn-casa")) b.hidden = !!perfil.casa;
}

for (const b of document.querySelectorAll(".btn-casa")) {
  b.addEventListener("click", () => ocupado(b, async () => {
    if (!confirm("¿Estás ahora en tu casa? Se va a guardar esta ubicación como tu casa.")) return;
    const u = await ubicacion();
    if (u.acc > 100) throw new Error(`La ubicación es poco precisa (±${u.acc} m). Esperá unos segundos con el GPS activado y probá de nuevo.`);
    await updateDoc(doc(db, "empleados", yo.uid), { casaPropuesta: { ...u, cuando: serverTimestamp() } });
    perfil.casaPropuesta = u;
    renderPerfil();
    aviso("Listo. Administración tiene que aprobar la ubicación de tu casa.");
  }));
}

// ---------------------------------------------------------------- marcar
function textoEstado(ultima) {
  if (!ultima) return "Todavía no arrancaste el día.";
  const h = hora(ultima.ts);
  return {
    salida_casa: `🚙 Viajando al trabajo desde las ${h}`,
    llegada_trabajo: `📍 En ${ultima.lugar || "el trabajo"} desde las ${h}`,
    inicio: `🔧 Trabajando en ${ultima.proyectoNombre} desde las ${h}`,
    cambio: `🔧 Trabajando en ${ultima.proyectoNombre} desde las ${h}`,
    fin: `✅ Terminaste de trabajar a las ${h}`,
    salida_trabajo: `🚗 Volviendo a casa desde las ${h}`,
    llegada_casa: `✅ Jornada terminada a las ${h}`,
  }[ultima.tipo];
}

function renderMarcar() {
  const ultima = marcasHoy[marcasHoy.length - 1];
  $("#fecha-hoy").textContent = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  $("#estado").textContent = textoEstado(ultima);

  const botones = $("#botones");
  botones.replaceChildren();
  const prox = siguientes(marcasHoy);
  for (const tipo of prox) {
    const t = TIPOS[tipo];
    const texto = tipo === "cambio" ? "Cambio de proyecto (opcional)" : t.texto;
    const b = el("button", { class: `marcar ${tipo === prox[0] ? "principal" : "secundario"}` },
      el("span", { class: "emoji" }, t.emoji), texto);
    b.addEventListener("click", () => ocupado(b, () => marcar(tipo)));
    botones.append(b);
  }

  const lista = $("#lista-hoy");
  lista.replaceChildren(...marcasHoy.map((m) => el("li", {},
    el("span", { class: "hora" }, hora(m.ts)),
    `${TIPOS[m.tipo].emoji} ${TIPOS[m.tipo].texto}`,
    m.proyectoNombre ? el("small", {}, ` · ${m.proyectoNombre}`) : null,
    m.lugar && m.tipo === "llegada_trabajo" ? el("small", {}, ` · ${m.lugar}`) : null)));
  $("#sin-marcas").hidden = marcasHoy.length > 0;

  // Mientras trabaja, mostrar las horas que lleva hasta ahora.
  const trabajando = ultima && (ultima.tipo === "inicio" || ultima.tipo === "cambio");
  const r = resumirJornada(trabajando ? [...marcasHoy, { tipo: "fin", ts: Date.now() }] : marcasHoy, cfg);
  const res = $("#resumen");
  res.hidden = !marcasHoy.length;
  res.replaceChildren(
    el("div", {}, el("b", {}, hhmm(r.viajeMin)), el("small", {}, "viaje")),
    el("div", {}, el("b", {}, hhmm(r.trabajoMin)), el("small", {}, "trabajo")),
    el("div", {}, el("b", {}, hhmm(r.extraMin)), el("small", {}, "extra")),
  );
}

function elegir(titulo, opciones, conTexto) {
  // Diálogo simple: lista de opciones + campo libre opcional. Devuelve {valor, texto} o null.
  return new Promise((listo) => {
    const d = $("#dialogo");
    $("#dialogo-titulo").textContent = titulo;
    const cont = $("#dialogo-opciones");
    cont.replaceChildren();
    for (const o of opciones) {
      cont.append(el("button", { type: "button", class: "opcion", onclick: () => { d.close(); listo(o); } }, o.texto));
    }
    const libre = $("#dialogo-libre");
    libre.hidden = !conTexto;
    $("#dialogo-input").value = "";
    $("#dialogo-input").placeholder = conTexto || "";
    $("#dialogo-ok").onclick = (ev) => {
      ev.preventDefault();
      const v = $("#dialogo-input").value.trim();
      if (!v) return;
      d.close(); listo({ valor: "", texto: v });
    };
    $("#dialogo-cancelar").onclick = () => { d.close(); listo(null); };
    d.showModal();
  });
}

async function marcar(tipo) {
  if (!navigator.onLine) throw new Error("No tenés conexión. La marca necesita internet para registrar la hora real.");
  const extra = {};

  if (tipo === "inicio" || tipo === "cambio") {
    if (!proyectos.length) throw new Error("No hay proyectos cargados. Pedile a administración que los agregue.");
    const actual = marcasHoy.filter((m) => m.proyectoId).pop()?.proyectoId;
    const p = await elegir(tipo === "cambio" ? "¿A qué proyecto pasás?" : "¿En qué proyecto vas a trabajar?",
      proyectos.filter((p) => tipo !== "cambio" || p.id !== actual)
        .map((p) => ({ valor: p.id, texto: p.cliente ? `${p.nombre} · ${p.cliente}` : p.nombre })));
    if (!p) return;
    extra.proyectoId = p.valor;
    extra.proyectoNombre = p.texto;
  }

  const u = await ubicacion();

  if (tipo === "salida_casa" || tipo === "llegada_casa") {
    if (!perfil.casa) throw new Error("Tu casa todavía no está aprobada. Registrala desde 'Mi perfil' estando en tu casa.");
    if (u.acc > 100) throw new Error(`La ubicación es poco precisa (±${u.acc} m). Esperá unos segundos con el GPS activado y probá de nuevo.`);
    const dist = distanciaM(u, perfil.casa);
    if (dist > cfg.radioCasaM) {
      throw new Error(`Estás a ${Math.round(dist)} m de tu casa. Esta marca solo se puede hacer desde tu casa (hasta ${cfg.radioCasaM} m).`);
    }
  }

  if (tipo === "llegada_trabajo") {
    const enBrensolma = cfg.brensolma && distanciaM(u, cfg.brensolma) <= cfg.radioBrensolmaM;
    if (enBrensolma) {
      extra.lugar = "Brensolma";
    } else {
      const clientes = [...new Set(proyectos.map((p) => p.cliente).filter(Boolean))];
      const l = await elegir("¿Dónde estás?", clientes.map((c) => ({ valor: c, texto: c })), "Otro lugar (escribilo)");
      if (!l) return;
      extra.lugar = l.texto;
    }
  }

  await addDoc(collection(db, "marcas"), {
    uid: yo.uid, nombre: perfil.nombre, tipo, ts: serverTimestamp(), fecha: fechaLocal(),
    lat: u.lat, lng: u.lng, acc: u.acc, ...extra,
  });
  aviso(`${TIPOS[tipo].emoji} ${TIPOS[tipo].texto} — ${hora(Date.now())}`, "ok");
}

// ---------------------------------------------------------------- navegación
$("#btn-perfil").addEventListener("click", () => mostrar("pantalla-perfil"));
$("#btn-volver").addEventListener("click", () => mostrar(perfil?.estado === "activo" ? "pantalla-marcar" : "pantalla-pendiente"));

// Actualizar cada minuto las horas que lleva trabajando.
setInterval(() => { if (!$("#pantalla-marcar").hidden) renderMarcar(); }, 60000);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
