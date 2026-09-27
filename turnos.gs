/**
 * TURNOS · Campo Antonio Martín
 * Gestión de apertura, cierre y control de la instalación.
 *
 * Archivo independiente: se añade al proyecto "Reservas Campo" como turnos.gs.
 * Solo LEE la pestaña Reservas; no toca el backend de reservas ni la web.
 * Todas sus funciones y constantes llevan el prefijo "turnos"/"TURNOS" para no
 * chocar con las del backend.
 *
 * Instalación: ejecutar una vez turnos_instalar() desde el editor.
 */

// ============================== CONFIGURACIÓN ==============================
const TURNOS = {
  HOJA_RESERVAS: 'Reservas',
  ESTADOS_ACTIVOS: ['pagada'],      // incluye las altas manuales del panel

  MARGEN_ANTES: 30,                 // min antes de cada actividad (abrir, vestuarios)
  MARGEN_DESPUES: 15,               // min después (duchas, cierre)
  DESCANSO_OBJETIVO: 120,           // min de descanso en jornada partida
  DESCANSO_MINIMO: 60,              // huecos más cortos se trabajan
  TRAMO_MAX_SIN_DESCANSO: 360,      // por encima de esto se parte la jornada
  JORNADA_MAX: 540,                 // aviso a partir de 9 h en un día

  // Horario obligatorio (0 = domingo … 6 = sábado). Lo que no está aquí es gris.
  OBLIGATORIO: {
    1: [['16:00', '23:00']],
    2: [['16:00', '23:00']],
    3: [['16:00', '23:00']],
    4: [['16:00', '23:00']],
    5: [['16:00', '23:00']],
    6: [['09:00', '23:00']],
    0: [['09:00', '17:00']]
  },

  // Lunes a viernes: turnos fijos de voluntariado
  DIAS_VOLUNTARIADO: [1, 2, 3, 4, 5],
  TURNOS_VOLUNTARIADO: [
    { nombre: 'A', inicio: '16:00', fin: '19:30' },
    { nombre: 'B', inicio: '19:30', fin: '23:00' }
  ],
  PLAZO_CEAN_HORAS: 72,             // sin voluntario a 72 h → pasa a CEAN

  // Sábado y domingo: jornada calculada según la programación
  DIAS_PROGRAMACION: [6, 0],
  OBJETIVO_FINDE: { 6: 600, 0: 480 },   // min: 10 h sábado, 8 h domingo
  MODO_FINDE: 'ajustada',               // 'ajustada' | 'completa'

  PROVEEDOR: 'CEAN',
  AVISAR_A: '',                     // vacío = EMAIL_CLUB del backend

  // PIN del enlace "Turnos" de la web. Si existe la propiedad del script
  // TURNOS_PIN, manda la propiedad y esto se ignora.
  PIN_POR_DEFECTO: '1379'
};

const TURNOS_HOJAS = {
  TURNOS: 'Turnos',
  CUADRANTE: 'Cuadrante',
  PEDIDO: 'Pedido CEAN',
  VOLUNTARIOS: 'Voluntarios',
  AJUSTES: 'Ajustes turnos'
};

const TURNOS_COLORES = {
  voluntario: '#CFE3C9',   // cubierto por voluntario
  proveedor: '#CFDCEA',    // cubierto por CEAN
  pendiente: '#F5DFA8',    // turno creado, sin asignar
  sinPersonal: '#F6D5CF',  // horario obligatorio sin nadie
  actividadSola: '#E08E80',// actividad sin nadie (no debería pasar)
  gris: '#E4E4E4',         // no obligatorio y sin actividad
  cabecera: '#3A3A3C'
};

const TURNOS_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// ============================ CÁLCULO (puro) ===============================

function turnosMin_(s) {
  if (typeof s === 'number') return s;
  const p = String(s).split(':').map(Number);
  return p[0] * 60 + (p[1] || 0);
}

function turnosHora_(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

function turnosDuracionTxt_(m) {
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + r + ' min' : '');
}

function turnosUnir_(ints) {
  const s = ints.filter(i => i[1] > i[0]).map(i => [i[0], i[1]]).sort((a, b) => a[0] - b[0]);
  const out = [];
  s.forEach(i => {
    const u = out[out.length - 1];
    if (u && i[0] <= u[1]) u[1] = Math.max(u[1], i[1]);
    else out.push(i);
  });
  return out;
}

function turnosRestar_(ints, quitar) {
  let res = turnosUnir_(ints);
  turnosUnir_(quitar).forEach(q => {
    const n = [];
    res.forEach(i => {
      if (q[1] <= i[0] || q[0] >= i[1]) { n.push(i); return; }
      if (q[0] > i[0]) n.push([i[0], q[0]]);
      if (q[1] < i[1]) n.push([q[1], i[1]]);
    });
    res = n;
  });
  return res;
}

function turnosDuracion_(ints) {
  return ints.reduce((a, i) => a + i[1] - i[0], 0);
}

function turnosObligatorio_(dow) {
  return (TURNOS.OBLIGATORIO[dow] || []).map(p => [turnosMin_(p[0]), turnosMin_(p[1])]);
}

function turnosEsObligatorio_(m, obl) {
  return obl.some(o => m >= o[0] && m < o[1]);
}

function turnosNecesidades_(acts) {
  return turnosUnir_(acts.map(a => [a[0] - TURNOS.MARGEN_ANTES, a[1] + TURNOS.MARGEN_DESPUES]));
}

/** Une bloques separados por huecos menores que "minimo". */
function turnosCerrarHuecos_(bloques, minimo) {
  const out = [];
  turnosUnir_(bloques).forEach(b => {
    const u = out[out.length - 1];
    if (u && b[0] - u[1] < minimo) u[1] = b[1];
    else out.push(b.slice());
  });
  return out;
}

/** Deja un único descanso: el hueco más largo. Los demás huecos se trabajan. */
function turnosUnDescanso_(bloques) {
  if (bloques.length <= 2) return bloques;
  let k = 0, max = -1;
  for (let i = 0; i < bloques.length - 1; i++) {
    const h = bloques[i + 1][0] - bloques[i][1];
    if (h > max) { max = h; k = i; }
  }
  return [[bloques[0][0], bloques[k][1]], [bloques[k + 1][0], bloques[bloques.length - 1][1]]];
}

/** Tramo contiguo de horario obligatorio desde "desde", hacia delante (+1) o atrás (-1). */
function turnosTramoObligatorio_(desde, obl, max, dir) {
  let a = desde, b = desde;
  if (dir > 0) {
    while (b - a < max && turnosEsObligatorio_(b, obl)) b += Math.min(15, max - (b - a));
  } else {
    while (b - a < max && turnosEsObligatorio_(a - 1, obl)) a -= Math.min(15, max - (b - a));
  }
  return b > a ? [a, b] : null;
}

/**
 * Jornada de fin de semana.
 * acts: [[ini, fin], …] en minutos. Devuelve { bloques, trabajo, alertas }.
 */
function turnosPlanFinde_(acts, dow, objetivo, modo) {
  const obl = turnosObligatorio_(dow);
  const nec = turnosNecesidades_(acts);
  const alertas = [];
  let bloques;

  if (modo === 'completa') {
    bloques = turnosUnDescanso_(turnosCerrarHuecos_(nec.concat(obl), TURNOS.DESCANSO_MINIMO));
  } else {
    if (!nec.length) {
      if (objetivo >= turnosDuracion_(obl)) bloques = obl.map(o => o.slice());
      else {
        const primera = Math.ceil(objetivo / 2 / 15) * 15;
        bloques = [[obl[0][0], obl[0][0] + primera]];
      }
    } else {
      bloques = nec.map(n => n.slice());
    }
    bloques = turnosUnDescanso_(turnosCerrarHuecos_(bloques, TURNOS.DESCANSO_MINIMO));
    let resto = objetivo - turnosDuracion_(bloques);

    // 1. Reducir el descanso hasta su duración objetivo trabajando horario obligatorio
    if (resto > 0 && bloques.length === 2) {
      let cubrir = Math.min(resto, bloques[1][0] - bloques[0][1] - TURNOS.DESCANSO_OBJETIVO);
      while (cubrir > 0 && turnosEsObligatorio_(bloques[0][1], obl)) {
        const p = Math.min(15, cubrir); bloques[0][1] += p; cubrir -= p; resto -= p;
      }
      while (cubrir > 0 && turnosEsObligatorio_(bloques[1][0] - 1, obl)) {
        const p = Math.min(15, cubrir); bloques[1][0] -= p; cubrir -= p; resto -= p;
      }
    }

    // 2. Jornada de un solo tramo demasiado larga: descanso y segundo tramo
    if (resto > 0 && bloques.length === 1 &&
        turnosDuracion_(bloques) + resto > TURNOS.TRAMO_MAX_SIN_DESCANSO) {
      const b = bloques[0];
      const despues = turnosTramoObligatorio_(b[1] + TURNOS.DESCANSO_OBJETIVO, obl, resto, 1);
      if (despues) { bloques.push(despues); resto -= despues[1] - despues[0]; }
      if (resto > 0) {
        // Antes: se prioriza abrir a la hora obligatoria, aunque el descanso salga más largo
        const tope = b[0] - TURNOS.DESCANSO_OBJETIVO;
        const ventana = obl.find(o => o[0] < tope && o[1] >= tope);
        if (ventana) {
          const antes = [ventana[0], Math.min(ventana[0] + resto, tope)];
          bloques.unshift(antes); resto -= antes[1] - antes[0];
        }
      }
    }

    // 3. Alargar los extremos de la jornada dentro del horario obligatorio
    const ult = bloques[bloques.length - 1];
    while (resto > 0 && turnosEsObligatorio_(ult[1], obl)) {
      const p = Math.min(15, resto); ult[1] += p; resto -= p;
    }
    const pri = bloques[0];
    while (resto > 0 && turnosEsObligatorio_(pri[0] - 1, obl)) {
      const p = Math.min(15, resto); pri[0] -= p; resto -= p;
    }
    bloques = turnosUnir_(bloques);
  }

  const trabajo = turnosDuracion_(bloques);
  if (modo !== 'completa' && trabajo > objetivo) {
    alertas.push('Supera el objetivo en ' + turnosDuracionTxt_(trabajo - objetivo) + ': prever relevo u horas extra');
  }
  if (modo !== 'completa' && trabajo < objetivo) {
    alertas.push('Jornada de ' + turnosDuracionTxt_(trabajo) + ', por debajo del objetivo: no queda horario obligatorio que cubrir');
  }
  if (trabajo > Math.max(TURNOS.JORNADA_MAX, objetivo)) alertas.push('Más de 9 h en el día: conviene repartir entre dos personas');
  if (bloques.length === 1 && trabajo > TURNOS.TRAMO_MAX_SIN_DESCANSO) {
    alertas.push('Jornada continua, sin descanso de ' + turnosDuracionTxt_(TURNOS.DESCANSO_OBJETIVO));
  }
  const sinPersonal = turnosRestar_(obl, bloques);
  if (sinPersonal.length) {
    alertas.push('Horario obligatorio sin personal: ' +
      sinPersonal.map(i => turnosHora_(i[0]) + '–' + turnosHora_(i[1])).join(', '));
  }
  return { bloques: bloques, trabajo: trabajo, alertas: alertas };
}

/** Lunes a viernes: turnos fijos A/B más refuerzos por actividad en horario gris. */
function turnosPlanDiario_(acts, dow) {
  const obl = turnosObligatorio_(dow);
  const filas = TURNOS.TURNOS_VOLUNTARIADO.map(t => ({
    ini: turnosMin_(t.inicio), fin: turnosMin_(t.fin),
    turno: 'Turno ' + t.nombre, tipo: 'Voluntariado'
  }));
  const juntos = turnosCerrarHuecos_(turnosNecesidades_(acts).concat(obl), TURNOS.DESCANSO_MINIMO);
  turnosRestar_(juntos, obl).forEach(r => {
    filas.push({ ini: r[0], fin: r[1], turno: 'Refuerzo', tipo: 'Refuerzo' });
  });
  return filas;
}

/** Apertura para el tramo que empieza con la instalación cerrada, cierre para el que la deja cerrada. */
function turnosTareas_(filas) {
  filas.sort((a, b) => a.ini - b.ini);
  filas.forEach(f => {
    const abre = !filas.some(o => o !== f && o.ini < f.ini && o.fin >= f.ini);
    const cierra = !filas.some(o => o !== f && o.fin > f.fin && o.ini <= f.fin);
    f.tarea = abre && cierra ? 'Apertura y cierre' : abre ? 'Apertura' : cierra ? 'Cierre' : '';
  });
  return filas;
}

// ============================ HOJA DE CÁLCULO ==============================

function turnosTz_() { return Session.getScriptTimeZone(); }

function turnosFecha_(d) { return Utilities.formatDate(d, turnosTz_(), 'yyyy-MM-dd'); }

function turnosDesdeTexto_(txt, minutos) {
  const p = String(txt).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], Math.floor((minutos || 0) / 60), (minutos || 0) % 60);
}

function turnosLunes_(d) {
  const dif = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dif, 12);
}

function turnosHoja_(nombre) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

function turnosLeerReservas_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TURNOS.HOJA_RESERVAS);
  const v = sh.getDataRange().getValues();
  const cab = v[0].map(x => String(x).trim().toLowerCase());
  const c = n => cab.indexOf(n);
  const iF = c('fecha'), iH = c('hora'), iN = c('horas'), iE = c('estado'), iS = c('espacio'), iEnt = c('entidad');
  const out = {};
  for (let r = 1; r < v.length; r++) {
    const f0 = v[r][iF];
    if (!f0 || TURNOS.ESTADOS_ACTIVOS.indexOf(String(v[r][iE]).trim()) < 0) continue;
    const f = f0 instanceof Date ? turnosFecha_(f0) : String(f0).slice(0, 10);
    const h0 = v[r][iH];
    const ini = (h0 instanceof Date ? h0.getHours() + h0.getMinutes() / 60 : Number(h0)) * 60;
    const fin = ini + (Number(v[r][iN]) || 1) * 60;
    (out[f] = out[f] || []).push({ ini: ini, fin: fin, espacio: v[r][iS], entidad: v[r][iEnt] });
  }
  return out;
}

function turnosLeerAjustes_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TURNOS_HOJAS.AJUSTES);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    if (!r[0] || !r[1]) return;
    const f = r[0] instanceof Date ? turnosFecha_(r[0]) : String(r[0]).slice(0, 10);
    out[f] = String(r[1]).trim().toLowerCase();
  });
  return out;
}

const TURNOS_CAB = ['id', 'semana', 'fecha', 'día', 'inicio', 'fin', 'horas', 'turno',
                    'tarea', 'tipo', 'asignado', 'estado', 'alertas', 'notas'];

/** Genera (o regenera) una semana conservando lo asignado a mano. */
function turnosGenerarSemana_(fechaCualquiera) {
  const lunes = turnosLunes_(fechaCualquiera);
  const semana = turnosFecha_(lunes);
  const reservas = turnosLeerReservas_();
  const ajustes = turnosLeerAjustes_();
  const nuevas = [];

  for (let d = 0; d < 7; d++) {
    const dia = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + d, 12);
    const dow = dia.getDay(), f = turnosFecha_(dia);
    const acts = (reservas[f] || []).map(a => [a.ini, a.fin]);
    let filas = [];

    if (TURNOS.DIAS_PROGRAMACION.indexOf(dow) >= 0) {
      const modo = ajustes[f] || TURNOS.MODO_FINDE;
      const otro = modo === 'completa' ? 'ajustada' : 'completa';
      const plan = turnosPlanFinde_(acts, dow, TURNOS.OBJETIVO_FINDE[dow], modo);
      const alt = turnosPlanFinde_(acts, dow, TURNOS.OBJETIVO_FINDE[dow], otro);
      filas = plan.bloques.map(b => ({ ini: b[0], fin: b[1], turno: 'Fin de semana · ' + modo, tipo: TURNOS.PROVEEDOR }));
      if (filas.length) {
        filas[0].alertas = plan.alertas.concat(['Total ' + turnosDuracionTxt_(plan.trabajo) +
          '. Opción ' + otro + ': ' + turnosDuracionTxt_(alt.trabajo) + ' (' +
          alt.bloques.map(b => turnosHora_(b[0]) + '–' + turnosHora_(b[1])).join(' / ') + ')']).join(' · ');
      }
    } else if (TURNOS.DIAS_VOLUNTARIADO.indexOf(dow) >= 0) {
      filas = turnosPlanDiario_(acts, dow);
    }

    turnosTareas_(filas).forEach(x => {
      nuevas.push({
        id: f + '|' + turnosHora_(x.ini) + '|' + x.tipo, semana: semana, fecha: f,
        dia: TURNOS_DIAS[dow], ini: x.ini, fin: x.fin, turno: x.turno, tarea: x.tarea,
        tipo: x.tipo, alertas: x.alertas || ''
      });
    });
  }

  const sh = turnosHoja_(TURNOS_HOJAS.TURNOS);
  const previas = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, TURNOS_CAB.length).getDisplayValues() : [];
  const guardado = {};
  previas.forEach(r => { guardado[r[0]] = { asignado: r[10], notas: r[13] }; });

  const otras = previas.filter(r => r[1] !== semana);
  const filasNuevas = nuevas.map(n => {
    const g = guardado[n.id];
    const asignado = g ? g.asignado : (n.tipo === TURNOS.PROVEEDOR ? TURNOS.PROVEEDOR : '');
    return [n.id, n.semana, n.fecha, n.dia, turnosHora_(n.ini), turnosHora_(n.fin),
            (n.fin - n.ini) / 60, n.turno, n.tarea, n.tipo, asignado, '', n.alertas, g ? g.notas : ''];
  });
  const todas = otras.concat(filasNuevas).sort((a, b) =>
    (a[2] + a[4]).localeCompare(b[2] + b[4]));

  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), TURNOS_CAB.length).clearContent();
  if (todas.length) {
    // Texto plano en todo salvo horas (G) y estado (L), para que Sheets no convierta fechas ni horas
    ['A:F', 'H:K', 'M:N'].forEach(c => {
      const p = c.split(':');
      sh.getRange(p[0] + '2:' + p[1] + (todas.length + 1)).setNumberFormat('@');
    });
    sh.getRange(2, 1, todas.length, TURNOS_CAB.length).setValues(todas.map(r => r.map(String)));
    sh.getRange(2, 7, todas.length, 1).setNumberFormat('0.00')
      .setValues(todas.map(r => [Number(r[6])]));
    const P = TURNOS.PROVEEDOR;
    sh.getRange(2, 12, todas.length, 1).setFormulas(todas.map((_, i) => {
      const k = 'K' + (i + 2);
      return ['=IF(' + k + '="","Pendiente",IF(' + k + '="' + P + '","' + P + '","Cubierto"))'];
    }));
  }
  return semana;
}

/** Turnos de voluntariado o refuerzo sin asignar a menos de PLAZO_CEAN_HORAS → CEAN. */
function turnos_pasarPendientes() {
  const sh = turnosHoja_(TURNOS_HOJAS.TURNOS);
  if (sh.getLastRow() < 2) return;
  const rango = sh.getRange(2, 1, sh.getLastRow() - 1, TURNOS_CAB.length);
  const v = rango.getDisplayValues();
  const ahora = new Date(), limite = ahora.getTime() + TURNOS.PLAZO_CEAN_HORAS * 3600e3;
  const pasados = [];
  v.forEach((r, i) => {
    if (r[9] === TURNOS.PROVEEDOR || r[10]) return;
    const inicio = turnosDesdeTexto_(r[2], turnosMin_(r[4]));
    if (inicio > ahora && inicio.getTime() <= limite) {
      sh.getRange(i + 2, 11).setValue(TURNOS.PROVEEDOR);
      sh.getRange(i + 2, 14).setValue((r[13] ? r[13] + ' · ' : '') + 'Sin voluntario: pasa a ' +
        TURNOS.PROVEEDOR + ' (' + Utilities.formatDate(ahora, turnosTz_(), 'dd/MM HH:mm') + ')');
      pasados.push(r[3] + ' ' + r[2] + ' · ' + r[4] + '–' + r[5] + ' · ' + r[7]);
    }
  });
  const dest = TURNOS.AVISAR_A || (typeof EMAIL_CLUB !== 'undefined' ? EMAIL_CLUB : '');
  if (pasados.length && dest) {
    MailApp.sendEmail(dest, 'Turnos sin voluntario asignados a ' + TURNOS.PROVEEDOR,
      'Estos turnos no tenían voluntario a ' + TURNOS.PLAZO_CEAN_HORAS + ' h vista y se han pasado a ' +
      TURNOS.PROVEEDOR + ':\n\n' + pasados.join('\n') + '\n\nRevisa la pestaña Pedido CEAN.');
  }
}

/** Pinta la rejilla semanal de 9:00 a 23:00 en medias horas. */
function turnos_pintarCuadrante(semanaTxt) {
  const sh = turnosHoja_(TURNOS_HOJAS.CUADRANTE);
  const semana = semanaTxt || sh.getRange('B1').getDisplayValue() || turnosFecha_(turnosLunes_(new Date()));
  const lunes = turnosDesdeTexto_(semana, 720);
  const reservas = turnosLeerReservas_();
  const shT = turnosHoja_(TURNOS_HOJAS.TURNOS);
  const turnos = shT.getLastRow() > 1
    ? shT.getRange(2, 1, shT.getLastRow() - 1, TURNOS_CAB.length).getDisplayValues()
        .filter(r => r[1] === semana) : [];

  const INI = 9 * 60, FIN = 23 * 60, PASO = 30, n = (FIN - INI) / PASO;
  const cab = ['Día'];
  for (let m = INI; m < FIN; m += PASO) cab.push(turnosHora_(m));
  cab.push('Horas', 'CEAN');

  const valores = [cab], fondos = [cab.map(() => TURNOS_COLORES.cabecera)];
  let totalCean = 0;
  for (let d = 0; d < 7; d++) {
    const dia = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + d, 12);
    const f = turnosFecha_(dia), obl = turnosObligatorio_(dia.getDay());
    const acts = (reservas[f] || []).map(a => [a.ini, a.fin]);
    const delDia = turnos.filter(r => r[2] === f).map(r => ({
      ini: turnosMin_(r[4]), fin: turnosMin_(r[5]), asignado: r[10]
    }));
    const fila = [TURNOS_DIAS[dia.getDay()] + ' ' + f.slice(8) + '/' + f.slice(5, 7)];
    const color = ['#FFFFFF'];
    for (let m = INI; m < FIN; m += PASO) {
      const act = acts.some(a => a[0] < m + PASO && a[1] > m);
      const t = delDia.find(x => x.ini < m + PASO && x.fin > m);
      let txt = '', c = TURNOS_COLORES.gris;
      if (t && t.asignado) {
        c = t.asignado === TURNOS.PROVEEDOR ? TURNOS_COLORES.proveedor : TURNOS_COLORES.voluntario;
        txt = String(t.asignado).split(' ')[0].slice(0, 8);
      } else if (t) { c = TURNOS_COLORES.pendiente; txt = 'libre'; }
      else if (act) { c = TURNOS_COLORES.actividadSola; txt = '!'; }
      else if (turnosEsObligatorio_(m, obl)) { c = TURNOS_COLORES.sinPersonal; txt = '—'; }
      fila.push(act ? '● ' + txt : txt);
      color.push(c);
    }
    const horas = delDia.reduce((a, x) => a + x.fin - x.ini, 0) / 60;
    const cean = delDia.filter(x => x.asignado === TURNOS.PROVEEDOR).reduce((a, x) => a + x.fin - x.ini, 0) / 60;
    totalCean += cean;
    fila.push(horas, cean); color.push('#FFFFFF', '#FFFFFF');
    valores.push(fila); fondos.push(color);
  }

  sh.getRange(3, 1, Math.max(sh.getMaxRows() - 2, 1), sh.getMaxColumns()).clear();
  sh.getRange('A1').setValue('Semana (lunes, aaaa-mm-dd):').setFontWeight('bold');
  sh.getRange('B1').setNumberFormat('@').setValue(semana);
  const r = sh.getRange(3, 1, valores.length, cab.length);
  r.setValues(valores).setBackgrounds(fondos).setFontSize(8)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, '#FFFFFF', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(3, 1, 1, cab.length).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.getRange(4, 1, 7, 1).setHorizontalAlignment('left').setFontWeight('bold');
  sh.setColumnWidth(1, 110); sh.setColumnWidths(2, n, 46);
  sh.getRange(11, cab.length - 1).setValue('Total CEAN').setFontWeight('bold');
  sh.getRange(11, cab.length).setValue(totalCean).setFontWeight('bold');

  const ley = [
    ['● hay actividad reservada', '#FFFFFF'], ['Voluntario', TURNOS_COLORES.voluntario],
    ['CEAN', TURNOS_COLORES.proveedor], ['Turno sin asignar', TURNOS_COLORES.pendiente],
    ['Obligatorio sin personal', TURNOS_COLORES.sinPersonal],
    ['Actividad sin personal', TURNOS_COLORES.actividadSola], ['No obligatorio', TURNOS_COLORES.gris]
  ];
  sh.getRange(13, 1, ley.length, 1).setValues(ley.map(x => [x[0]]))
    .setBackgrounds(ley.map(x => [x[1]])).setFontSize(8);
}

// =============================== MENÚ Y DISPARADORES =======================

function turnos_menu() {
  SpreadsheetApp.getUi().createMenu('Turnos')
    .addItem('Generar esta semana', 'turnos_generarEsta')
    .addItem('Generar la semana que viene', 'turnos_generarProxima')
    .addItem('Actualizar todo ahora', 'turnos_diario')
    .addSeparator()
    .addItem('Pasar a CEAN los turnos sin voluntario', 'turnos_pasarPendientes')
    .addToUi();
}

function turnos_generarEsta() {
  const s = turnosGenerarSemana_(new Date());
  turnos_pintarCuadrante(s);
  turnosHoja_(TURNOS_HOJAS.PEDIDO).getRange('B1').setValue(s);
}

function turnos_generarProxima() {
  const d = new Date(); d.setDate(d.getDate() + 7);
  const s = turnosGenerarSemana_(d);
  turnos_pintarCuadrante(s);
  turnosHoja_(TURNOS_HOJAS.PEDIDO).getRange('B1').setValue(s);
}

/** Cada mañana: regenera esta semana y la siguiente, pasa pendientes a CEAN y repinta. */
function turnos_diario() {
  const hoy = new Date(), prox = new Date(); prox.setDate(prox.getDate() + 7);
  turnosGenerarSemana_(hoy);
  turnosGenerarSemana_(prox);
  turnos_pasarPendientes();
  turnos_pintarCuadrante();
}

/** Al asignar a alguien o cambiar la semana del cuadrante, se repinta. */
function turnos_alEditar(e) {
  const hoja = e.range.getSheet().getName();
  if (hoja === TURNOS_HOJAS.TURNOS && e.range.getColumn() <= 11 && e.range.getLastColumn() >= 11) {
    turnos_pintarCuadrante();
  } else if (hoja === TURNOS_HOJAS.CUADRANTE && e.range.getA1Notation() === 'B1') {
    turnos_pintarCuadrante(String(e.value || ''));
  }
}

/** EJECUTAR UNA VEZ desde el editor. Crea las pestañas, los disparadores y genera dos semanas. */
function turnos_instalar() {
  const ss = SpreadsheetApp.getActive();

  const shT = turnosHoja_(TURNOS_HOJAS.TURNOS);
  shT.getRange(1, 1, 1, TURNOS_CAB.length).setValues([TURNOS_CAB])
    .setFontWeight('bold').setBackground(TURNOS_COLORES.cabecera).setFontColor('#FFFFFF');
  shT.setFrozenRows(1);
  shT.hideColumns(1, 2);

  const shV = turnosHoja_(TURNOS_HOJAS.VOLUNTARIOS);
  if (shV.getLastRow() < 1) {
    shV.getRange(1, 1, 2, 5).setValues([
      ['nombre', 'teléfono', 'email', 'activo', 'notas'],
      [TURNOS.PROVEEDOR, '', '', 'sí', 'Empresa de servicios: contrato por horas']
    ]);
    shV.getRange(1, 1, 1, 5).setFontWeight('bold');
    shV.setFrozenRows(1);
  }
  const lista = SpreadsheetApp.newDataValidation()
    .requireValueInRange(shV.getRange('A2:A'), true).setAllowInvalid(true).build();
  shT.getRange('K2:K').setDataValidation(lista);

  const shA = turnosHoja_(TURNOS_HOJAS.AJUSTES);
  if (shA.getLastRow() < 1) {
    shA.getRange(1, 1, 1, 3).setValues([['fecha (aaaa-mm-dd)', 'modo', 'nota']]).setFontWeight('bold');
    shA.getRange('A2:A').setNumberFormat('@');
    shA.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['ajustada', 'completa'], true).build());
  }

  const shP = turnosHoja_(TURNOS_HOJAS.PEDIDO);
  shP.getRange('A1').setValue('Semana (lunes):').setFontWeight('bold');
  shP.getRange('B1').setNumberFormat('@');
  shP.getRange('D1').setValue('Horas CEAN:').setFontWeight('bold');
  shP.getRange('E1').setFormula('=SUMIFS(Turnos!G:G,Turnos!B:B,B1,Turnos!K:K,"' + TURNOS.PROVEEDOR + '")')
    .setFontWeight('bold');
  shP.getRange('A3').setFormula('=IFERROR(QUERY(Turnos!A:N,"select C,D,E,F,G,H,I,N where B=\'"&B1&"\' and K=\'' +
    TURNOS.PROVEEDOR + '\' order by C,E",1),"Sin horas de ' + TURNOS.PROVEEDOR + ' esta semana")');

  ScriptApp.getProjectTriggers().forEach(t => {
    if (['turnos_menu', 'turnos_alEditar', 'turnos_diario'].indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('turnos_menu').forSpreadsheet(ss).onOpen().create();
  ScriptApp.newTrigger('turnos_alEditar').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('turnos_diario').timeBased().everyDays(1).atHour(7).create();

  turnos_diario();
  turnos_generarEsta();
}


// ================================ API WEB ==================================
// La web (turnos.html) llama al backend con { accion: 'turnos_…', pin, … }.
// En doPost del backend basta con desviar esas peticiones a turnos_api(p).

function turnosSalida_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function turnosPinCorrecto_(pin) {
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get('turnos_fallos') || 0);
  if (fallos >= 10) throw new Error('Demasiados intentos fallidos. Espera 15 minutos.');
  const bueno = PropertiesService.getScriptProperties().getProperty('TURNOS_PIN') || TURNOS.PIN_POR_DEFECTO;
  if (String(pin || '').trim() !== String(bueno)) {
    cache.put('turnos_fallos', String(fallos + 1), 900);
    return false;
  }
  return true;
}

function turnos_api(p) {
  try {
    if (!turnosPinCorrecto_(p.pin)) return turnosSalida_({ error: 'PIN incorrecto.' });
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      switch (p.accion) {
        case 'turnos_entrar':
          return turnosSalida_({ ok: true });
        case 'turnos_leer':
          return turnosSalida_(turnosSemanaWeb_(p.semana, true));
        case 'turnos_asignar':
          turnosAsignar_(p.id, p.asignado, p.notas);
          return turnosSalida_(turnosSemanaWeb_(p.semana, false));
        case 'turnos_modo':
          turnosCambiarModo_(p.fecha, p.modo);
          return turnosSalida_(turnosSemanaWeb_(p.semana, true));
        default:
          return turnosSalida_({ error: 'Acción desconocida.' });
      }
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    return turnosSalida_({ error: String(e.message || e) });
  }
}

/** Datos de una semana para la web. Si regenerar, recalcula antes con las reservas actuales. */
function turnosSemanaWeb_(semanaTxt, regenerar) {
  const base = semanaTxt ? turnosDesdeTexto_(semanaTxt, 720) : new Date();
  const semana = regenerar ? turnosGenerarSemana_(base) : turnosFecha_(turnosLunes_(base));
  const lunes = turnosDesdeTexto_(semana, 720);
  const reservas = turnosLeerReservas_();
  const ajustes = turnosLeerAjustes_();

  const dias = [];
  for (let d = 0; d < 7; d++) {
    const dia = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + d, 12);
    const dow = dia.getDay(), f = turnosFecha_(dia);
    const finde = TURNOS.DIAS_PROGRAMACION.indexOf(dow) >= 0;
    dias.push({
      fecha: f, dow: dow, nombre: TURNOS_DIAS[dow],
      obligatorio: turnosObligatorio_(dow),
      finde: finde,
      modo: finde ? (ajustes[f] || TURNOS.MODO_FINDE) : '',
      objetivo: finde ? TURNOS.OBJETIVO_FINDE[dow] : 0,
      actividades: (reservas[f] || []).map(a => ({
        ini: a.ini, fin: a.fin, espacio: String(a.espacio || ''), entidad: String(a.entidad || '')
      }))
    });
  }

  const sh = turnosHoja_(TURNOS_HOJAS.TURNOS);
  const filas = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, TURNOS_CAB.length).getDisplayValues().filter(r => r[1] === semana) : [];
  const turnos = filas.map(r => ({
    id: r[0], fecha: r[2], ini: turnosMin_(r[4]), fin: turnosMin_(r[5]),
    turno: r[7], tarea: r[8], tipo: r[9], asignado: r[10], alertas: r[12], notas: r[13]
  }));

  const shV = turnosHoja_(TURNOS_HOJAS.VOLUNTARIOS);
  const voluntarios = shV.getLastRow() > 1
    ? shV.getRange(2, 1, shV.getLastRow() - 1, 4).getDisplayValues()
        .filter(r => r[0] && r[0] !== TURNOS.PROVEEDOR && String(r[3]).toLowerCase() !== 'no')
        .map(r => r[0]) : [];

  return { ok: true, semana: semana, proveedor: TURNOS.PROVEEDOR, dias: dias, turnos: turnos, voluntarios: voluntarios };
}

function turnosAsignar_(id, asignado, notas) {
  const sh = turnosHoja_(TURNOS_HOJAS.TURNOS);
  if (sh.getLastRow() < 2) throw new Error('No hay turnos generados.');
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(r => r[0]);
  const i = ids.indexOf(String(id));
  if (i < 0) throw new Error('Ese turno ya no existe: la programación ha cambiado. Recarga la semana.');
  const nombre = String(asignado || '').trim();
  sh.getRange(i + 2, 11).setNumberFormat('@').setValue(nombre);
  if (notas !== undefined) sh.getRange(i + 2, 14).setNumberFormat('@').setValue(String(notas || '').trim());

  // Si es alguien nuevo, se añade a la lista de voluntarios
  if (nombre && nombre !== TURNOS.PROVEEDOR) {
    const shV = turnosHoja_(TURNOS_HOJAS.VOLUNTARIOS);
    const lista = shV.getLastRow() > 1
      ? shV.getRange(2, 1, shV.getLastRow() - 1, 1).getDisplayValues().map(r => r[0].toLowerCase()) : [];
    if (lista.indexOf(nombre.toLowerCase()) < 0) shV.appendRow([nombre, '', '', 'sí', 'Alta desde la web']);
  }
}

function turnosCambiarModo_(fecha, modo) {
  const f = String(fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error('Fecha no válida.');
  modo = modo === 'completa' ? 'completa' : 'ajustada';
  const sh = turnosHoja_(TURNOS_HOJAS.AJUSTES);
  const n = sh.getLastRow();
  const fechas = n > 1 ? sh.getRange(2, 1, n - 1, 1).getDisplayValues().map(r => r[0]) : [];
  const i = fechas.indexOf(f);
  if (modo === TURNOS.MODO_FINDE) {
    if (i >= 0) sh.deleteRow(i + 2);
  } else if (i >= 0) {
    sh.getRange(i + 2, 2).setValue(modo);
  } else {
    sh.appendRow(["'" + f, modo, 'Cambiado desde la web']);
  }
}
