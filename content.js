/*
 * Buscador de causas PJUD — uso personal.
 *
 * Trabaja sobre la página "Consulta Unificada > Búsqueda por Nombre" que tú
 * tienes abierta: rellena el formulario, recorre competencias y tribunales,
 * lee la tabla de resultados (Rol, Fecha, Caratulado, Tribunal) y junta todo.
 *
 * Si aparece un captcha, NO lo resuelve: espera a que tú lo hagas y sigue.
 *
 * El estado se guarda en chrome.storage para que la búsqueda continúe aunque
 * la página se recargue. El panel flotante vive en la ventana principal.
 */
(() => {
  'use strict';
  if (window.__pjudBuscador) return;
  window.__pjudBuscador = true;

  const IS_TOP = window === window.top;
  const KEY = 'pjudState';
  const KEY_HIDDEN = 'pjudPanelHidden';
  const PAUSA_MS = 3000;            // pausa entre búsquedas (no bajarla)
  const ESPERA_RESULTADOS_MS = 30000;
  const MAX_PAGINAS = 50;

  const DEFAULT = {
    status: 'idle',                 // idle | running | paused | stopped | done
    persona: { nombre: '', paterno: '', materno: '', anio: '' },
    filtroTrib: '',
    compsSel: [],
    compIdx: 0,
    tribList: null,
    tribIdx: 0,
    results: [],
    log: [],
    msg: '',
    pending: false,
    available: [],
    allComps: false,
    searches: 0,
    startedAt: 0,
    formVisible: false,
    formSeenAt: 0
  };

  // ------------------------------------------------------------------ utils
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const low = (s) => norm(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const visible = (el) =>
    !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
    getComputedStyle(el).visibility !== 'hidden';

  async function load() {
    const o = await chrome.storage.local.get(KEY);
    return Object.assign({}, DEFAULT, o[KEY] || {});
  }
  // Guarda solo los campos indicados sobre el estado más reciente.
  async function save(patch) {
    const s = await load();
    Object.assign(s, patch);
    await chrome.storage.local.set({ [KEY]: s });
    return s;
  }
  async function addLog(line) {
    const s = await load();
    const log = (s.log || []).concat(`${new Date().toLocaleTimeString()}  ${line}`).slice(-200);
    await save({ log });
  }

  // ------------------------------------------------------------ formulario
  function xpathAll(xp, ctx = document) {
    const r = document.evaluate(xp, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const out = [];
    for (let i = 0; i < r.snapshotLength; i++) out.push(r.snapshotItem(i));
    return out;
  }
  // Busca la etiqueta visible (sin importar mayúsculas, tildes, ":" o "*")
  // y devuelve el primer campo visible que viene después.
  const clean = (s) => low(s).replace(/[:*]/g, '').trim();
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' ');
  const usable = (el) => !!el && (visible(el) || (el.tagName === 'SELECT' && visible(el.parentElement)));
  function nextField(lab, tag) {
    if (lab.tagName === 'LABEL' && lab.htmlFor) {
      const el = document.getElementById(lab.htmlFor);
      if (el && el.tagName.toLowerCase() === tag && usable(el)) return el;
    }
    try {
      const it = document.evaluate(`following::${tag}`, lab, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
      for (let n, i = 0; (n = it.iterateNext()) && i < 40; i++) if (usable(n)) return n;
    } catch (e) { /* el DOM cambió mientras se recorría */ }
    return null;
  }
  function byLabel(text, tag) {
    const target = clean(text);
    for (const lab of document.querySelectorAll('label, span, b, strong, p, div, td, legend, h1, h2, h3, h4, h5, h6')) {
      if (clean(ownText(lab)) !== target || !visible(lab)) continue;
      const f = nextField(lab, tag);
      if (f) return f;
    }
    return null;
  }
  // Alternativa: buscar por id/name del campo.
  function byAttr(tag, re, notRe) {
    for (const el of document.querySelectorAll(tag)) {
      const a = low(`${el.id || ''} ${el.name || ''}`);
      if (re.test(a) && !(notRe && notRe.test(a)) && usable(el)) return el;
    }
    return null;
  }
  function findButton(text) {
    const els = document.querySelectorAll('button, input[type=button], input[type=submit], a.btn');
    for (const el of els) {
      const t = norm(el.value || el.textContent);
      if (t === text && visible(el)) return el;
    }
    return null;
  }
  function findClickable(text) {
    for (const el of xpathAll(`//*[self::a or self::li or self::button or self::span][normalize-space(.)="${text}"]`)) {
      if (visible(el)) return el;
    }
    return null;
  }
  // Navega: menú "Consulta Unificada" y luego pestaña "Búsqueda por Nombre".
  let ultimoIntento = 0;
  async function irAlFormulario() {
    if (Date.now() - ultimoIntento < 4000) return false;
    ultimoIntento = Date.now();
    let tab = findClickable('Búsqueda por Nombre');
    if (!tab) {
      const menu = findClickable('Consulta Unificada');
      if (!menu) return false;
      menu.click();
      for (let i = 0; i < 20 && !tab; i++) { await sleep(500); tab = findClickable('Búsqueda por Nombre'); }
    }
    if (tab) { tab.click(); await sleep(1500); return true; }
    return false;
  }

  function getForm() {
    const paterno = byLabel('Apellido Paterno', 'input') || byAttr('input', /paterno|apepat|ape_pat|apellidop/);
    if (!paterno) return null;
    return {
      nombre: byLabel('Nombre', 'input') || byLabel('Nombres', 'input') ||
              byAttr('input', /nombre/, /apellido|paterno|materno|razon|juridic/),
      paterno,
      materno: byLabel('Apellido Materno', 'input') || byAttr('input', /materno|apemat|ape_mat|apellidom/),
      anio: byLabel('Año', 'input') || byAttr('input', /anio|year|(^|[_ -])ano\b/),
      comp: byLabel('Competencia', 'select') || byAttr('select', /competencia|comp/),
      trib: byLabel('Tribunal', 'select') || byAttr('select', /tribunal|trib/),
      corte: byLabel('Corte', 'select') || byAttr('select', /corte/),
      buscar: findButton('Buscar')
    };
  }
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function setInput(el, v) { if (!el) return; el.focus(); el.value = v || ''; fire(el, 'input'); fire(el, 'change'); el.blur(); }
  function setSelect(el, v) { if (!el) return; el.value = v; fire(el, 'input'); fire(el, 'change'); }
  const opts = (sel) => (sel ? [...sel.options].map((o) => ({ value: o.value, text: norm(o.textContent) })) : []);
  const isPlaceholder = (t) => { const x = low(t); return x === '' || x === '-' || x.startsWith('selecc'); };
  const isTodos = (t) => /^tod[oa]s?\b/.test(low(t));

  async function waitStableOptions(getSel, maxMs = 8000) {
    const t0 = Date.now(); let last = '', same = 0;
    while (Date.now() - t0 < maxMs) {
      await sleep(300);
      const sel = getSel();
      const sig = sel ? opts(sel).map((o) => o.value).join('|') : '';
      if (sig && sig === last) { if (++same >= 3) return; } else same = 0;
      last = sig;
    }
  }

  // ------------------------------------------------------------- resultados
  function findTable() {
    for (const t of document.querySelectorAll('table')) {
      if (!visible(t)) continue;
      const ths = [...t.querySelectorAll('th')].map((th) => low(th.textContent));
      if (ths.some((h) => h.includes('caratulado'))) return t;
    }
    return null;
  }
  function readTable(t) {
    const heads = [...t.querySelectorAll('thead th')].map((th) => low(th.textContent));
    const idx = {};
    for (const k of ['rol', 'fecha', 'caratulado', 'tribunal']) idx[k] = heads.indexOf(k);
    const rows = [];
    for (const tr of t.tBodies[0] ? t.tBodies[0].rows : []) {
      const c = [...tr.cells].map((td) => norm(td.textContent));
      if (c.length < 4) continue;               // fila de "No se han encontrado resultados"
      const get = (k) => (idx[k] >= 0 && idx[k] < c.length ? c[idx[k]] : '');
      const r = { rol: get('rol'), fecha: get('fecha'), caratulado: get('caratulado'), tribunal: get('tribunal') };
      if (r.rol || r.caratulado) rows.push(r);
    }
    return rows;
  }
  const tableSig = (t) => (t && t.tBodies[0] ? t.tBodies[0].innerText.slice(0, 600) : '');
  const tableHasRows = (t) => !!(t && t.tBodies[0] && t.tBodies[0].rows.length);

  function clickNext(t) {
    const scope = t.closest('.dataTables_wrapper') || t.parentElement?.parentElement || document;
    const cands = [...scope.querySelectorAll('a, button, li')].filter((el) => {
      const x = norm(el.textContent);
      return (x === 'Siguiente' || x === '»' || x === '›' || x === '>') && visible(el);
    });
    for (const el of cands) {
      const cls = `${el.className} ${el.parentElement ? el.parentElement.className : ''}`;
      if (/disabled/.test(cls) || el.getAttribute('aria-disabled') === 'true') return false;
      el.click();
      return true;
    }
    return false;
  }

  async function readAllPages() {
    const rows = [];
    for (let p = 0; p < MAX_PAGINAS; p++) {
      const t = findTable();
      if (!t) break;
      rows.push(...readTable(t));
      const before = tableSig(t);
      if (!clickNext(t)) break;
      const t0 = Date.now(); let changed = false;
      while (Date.now() - t0 < 15000) {
        await sleep(400);
        if (tableSig(findTable()) !== before) { changed = true; break; }
      }
      if (!changed) break;
      await sleep(400);
    }
    return rows;
  }

  function captchaVisible() {
    for (const f of document.querySelectorAll('iframe')) {
      const src = f.src || '';
      if (/captcha/i.test(src) && /bframe|challenge/i.test(src) && visible(f) &&
          f.getBoundingClientRect().height > 100) return true;
    }
    const txt = document.body ? document.body.innerText : '';
    return /what code is in the image|testing whether you are a human/i.test(txt);
  }

  async function doSearch() {
    const f = getForm();
    if (!f || !f.buscar) throw new Error('No encontré el botón "Buscar".');
    const t0 = findTable();
    if (t0 && t0.tBodies[0]) t0.tBodies[0].innerHTML = '';   // así sabemos cuándo llega la respuesta
    await save({ pending: true });
    f.buscar.click();

    const start = Date.now(); let avisado = false;
    for (;;) {
      await sleep(500);
      if ((await load()).status !== 'running') return { aborted: true };
      if (captchaVisible()) {
        if (!avisado) { avisado = true; await save({ msg: '⚠️ Apareció un captcha: resuélvelo en la página y la búsqueda sigue sola.' }); }
        continue;
      }
      if (tableHasRows(findTable())) break;
      const seg = Math.round((Date.now() - start) / 1000);
      if (seg > 0 && seg % 3 === 0) {
        const cur = await load();
        await save({ msg: cur.msg.replace(/ · esperando respuesta \d+ s$/, '') + ` · esperando respuesta ${seg} s` });
      }
      if (!avisado && Date.now() - start > ESPERA_RESULTADOS_MS) { await save({ pending: false }); return { timeout: true }; }
    }
    await sleep(500);
    const rows = await readAllPages();
    await save({ pending: false });
    return { rows };
  }

  async function recordAndAdvance(rows, comp, trib, nota) {
    const s = await load();
    const seen = new Set(s.results.map((r) => [r.competencia, r.rol, r.tribunal, r.caratulado].join('|')));
    const nuevos = [];
    for (const r of rows) {
      const full = Object.assign({ competencia: comp.text, tribunalConsultado: trib.text }, r);
      const k = [full.competencia, full.rol, full.tribunal, full.caratulado].join('|');
      if (!seen.has(k)) { seen.add(k); nuevos.push(full); }
    }
    let { compIdx, tribIdx, tribList } = s;
    tribIdx += 1;
    if (!tribList || tribIdx >= tribList.length) { compIdx += 1; tribIdx = 0; tribList = null; }
    await save({ results: s.results.concat(nuevos), compIdx, tribIdx, tribList, searches: (s.searches || 0) + 1 });
    await addLog(`${comp.text} — ${trib.text}: ${nota || (rows.length + ' causa(s)')}`);
  }

  // -------------------------------------------------------- ciclo principal
  async function step() {
    let st = await load();
    if (st.status !== 'running') return;

    let f = getForm();
    if (!f && await irAlFormulario()) f = getForm();
    if (!f) {
      if (IS_TOP && Date.now() - (st.formSeenAt || 0) > 5000) {
        await save({ msg: captchaVisible()
          ? '⚠️ Resuelve el captcha de la página para continuar.'
          : 'Entrando a Consulta Unificada → "Búsqueda por Nombre"… Si no avanza, ábrela tú desde el menú de la izquierda.' });
      }
      await sleep(1500);
      return;
    }
    await save({ formSeenAt: Date.now() });

    // Si se inició sin la lista de competencias cargada, revisar todas.
    if (st.allComps && !st.compsSel.length) {
      const todas = opts(f.comp).filter((o) => !isPlaceholder(o.text));
      if (!todas.length) throw new Error('No encontré el selector de Competencia en la página.');
      st = await save({ compsSel: todas, allComps: false });
      await addLog(`Competencias a revisar: ${todas.map((c) => c.text).join(', ')}`);
    }

    if (st.compIdx >= st.compsSel.length) {
      await save({ status: 'done', msg: `✅ Terminado: ${st.results.length} causa(s) encontradas.` });
      return;
    }
    const comp = st.compsSel[st.compIdx];

    // Si la página se recargó justo después de presionar Buscar, aprovechar ese resultado.
    if (st.pending) {
      if (f.comp && f.comp.value === comp.value && tableHasRows(findTable()) && st.tribList) {
        const rows = await readAllPages();
        await save({ pending: false });
        await recordAndAdvance(rows, comp, st.tribList[st.tribIdx]);
        return;
      }
      await save({ pending: false });
    }

    if (f.comp && f.comp.value !== comp.value) {
      setSelect(f.comp, comp.value);
      await sleep(800);
      await waitStableOptions(() => (getForm() || {}).trib);
      f = getForm();
    }
    if (f.corte) {
      const todas = opts(f.corte).find((o) => isTodos(o.text));
      if (todas && f.corte.value !== todas.value) {
        setSelect(f.corte, todas.value);
        await sleep(800);
        await waitStableOptions(() => (getForm() || {}).trib);
        f = getForm();
      }
    }

    st = await load();
    if (!st.tribList) {
      let list = opts(f.trib).filter((o) => !isPlaceholder(o.text));
      const todos = list.filter((o) => isTodos(o.text));
      if (todos.length) list = [todos[0]];
      else if (st.filtroTrib) list = list.filter((o) => low(o.text).includes(low(st.filtroTrib)));

      if (!list.length && st.filtroTrib) {
        await addLog(`${comp.text}: ningún tribunal contiene "${st.filtroTrib}", se omite.`);
        await save({ compIdx: st.compIdx + 1, tribIdx: 0, tribList: null });
        return;
      }
      if (!list.length) list = [{ value: '', text: '(tribunal por defecto)' }];
      await save({ tribList: list, tribIdx: 0 });
      if (list.length > 1) await addLog(`${comp.text}: se revisarán ${list.length} tribunales.`);
      st = await load();
    }

    const trib = st.tribList[st.tribIdx];
    f = getForm();
    setInput(f.nombre, st.persona.nombre);
    setInput(f.paterno, st.persona.paterno);
    setInput(f.materno, st.persona.materno);
    setInput(f.anio, st.persona.anio);
    if (trib.value && f.trib) { setSelect(f.trib, trib.value); await sleep(300); }

    await save({ msg: `Buscando: ${comp.text} — ${trib.text} (${st.tribIdx + 1}/${st.tribList.length})` });
    const r = await doSearch();
    if (r.aborted) return;
    if (r.timeout) await recordAndAdvance([], comp, trib, 'sin respuesta, se omitió');
    else await recordAndAdvance(r.rows, comp, trib);
    await sleep(PAUSA_MS);
  }

  let busy = false;
  async function loop() {
    if (busy) return;
    busy = true;
    try {
      while ((await load()).status === 'running') { await step(); await sleep(300); }
    } catch (e) {
      console.error('[Buscador PJUD]', e);
      await save({ status: 'paused', msg: `Error: ${e.message}. Presiona "Continuar" para reintentar.` });
    } finally {
      busy = false;
    }
  }

  // Publica si el formulario está visible y qué competencias ofrece.
  // Solo escribe el frame que alguna vez vio el formulario.
  let lastAvail = '', lastVisible = null;
  setInterval(async () => {
    const f = getForm();
    const vis = !!f;
    if (vis !== lastVisible && (vis || lastVisible)) { lastVisible = vis; await save({ formVisible: vis }); }
    if (!f || !f.comp) return;
    const av = opts(f.comp).filter((o) => !isPlaceholder(o.text));
    const sig = JSON.stringify(av);
    if (sig !== lastAvail) { lastAvail = sig; await save({ available: av, formSeenAt: Date.now() }); }
  }, 2000);

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch[KEY] && ch[KEY].newValue && ch[KEY].newValue.status === 'running') loop();
    if (IS_TOP) panel.render();
  });
  loop();

  // ------------------------------------------------------------------ panel
  if (IS_TOP) save({ formVisible: false });      // se recalcula en 2 s
  const panel = IS_TOP ? createPanel() : { render() {} };

  function createPanel() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
        .box { width: 340px; max-height: 80vh; display: flex; flex-direction: column; background: #fff; color: #1d2733;
               border: 1px solid #c9d3de; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.22); overflow: hidden; font-size: 13px; }
        header { background: #12355b; color: #fff; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; }
        header b { font-size: 14px; }
        header button { background: none; border: 0; color: #fff; font-size: 18px; cursor: pointer; line-height: 1; }
        .body { padding: 10px 12px; overflow: auto; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        label { display: block; font-size: 11px; color: #4a5a6b; margin-bottom: 2px; }
        input[type=text] { width: 100%; padding: 6px 7px; border: 1px solid #b8c4d0; border-radius: 6px; font-size: 13px; }
        .full { grid-column: 1 / -1; }
        .comps { margin-top: 8px; border: 1px solid #e1e7ee; border-radius: 6px; padding: 6px 8px; max-height: 120px; overflow: auto; }
        .comps label { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #1d2733; margin: 2px 0; }
        .comps .head { display: flex; justify-content: space-between; font-size: 11px; color: #4a5a6b; margin-bottom: 4px; }
        .comps .head a { color: #12355b; cursor: pointer; text-decoration: underline; }
        .btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .btns button { flex: 1; padding: 7px 8px; border-radius: 6px; border: 1px solid #12355b; background: #12355b; color: #fff; cursor: pointer; font-size: 12px; }
        .btns button.sec { background: #fff; color: #12355b; }
        .btns button:disabled { opacity: .45; cursor: default; }
        .msg { margin-top: 10px; padding: 7px 8px; border-radius: 6px; background: #eef3f8; font-size: 12px; min-height: 18px; }
        .msg.warn { background: #fff4d6; }
        .count { margin-top: 8px; font-weight: 600; }
        .prog { margin-top: 10px; }
        .bar { height: 10px; background: #e4eaf1; border-radius: 6px; overflow: hidden; }
        .bar i { display: block; height: 100%; width: 0; background: #2e7d32; transition: width .4s; }
        .bar.run i { background: linear-gradient(90deg, #2e7d32, #5cb85c, #2e7d32); background-size: 200% 100%; animation: mov 1.2s linear infinite; }
        @keyframes mov { from { background-position: 200% 0; } to { background-position: 0 0; } }
        .ptxt { display: flex; justify-content: space-between; font-size: 11.5px; margin-top: 4px; color: #33414f; }
        .ptxt b { font-size: 13px; color: #1d2733; }
        .res { margin-top: 4px; max-height: 160px; overflow: auto; border-top: 1px solid #e1e7ee; }
        .res div { padding: 4px 0; border-bottom: 1px solid #eef1f4; font-size: 11.5px; }
        .res small { color: #5d6b79; }
        details { margin-top: 8px; font-size: 11px; color: #4a5a6b; }
        pre { white-space: pre-wrap; max-height: 120px; overflow: auto; margin: 4px 0 0; font-size: 10.5px; }
        .note { margin-top: 8px; font-size: 10.5px; color: #6b7886; }
      </style>
      <div class="box">
        <header><b>Buscador de causas</b><button id="min" title="Ocultar">–</button></header>
        <div class="body">
          <div class="grid">
            <div class="full"><label>Nombre(s)</label><input type="text" id="nombre"></div>
            <div><label>Apellido paterno</label><input type="text" id="paterno"></div>
            <div><label>Apellido materno</label><input type="text" id="materno"></div>
            <div><label>Año (opcional)</label><input type="text" id="anio" inputmode="numeric"></div>
            <div><label>Tribunal contiene (opcional)</label><input type="text" id="filtro" placeholder="ej: Santiago"></div>
          </div>
          <div class="comps">
            <div class="head"><span>Competencias</span><span><a id="all">todas</a> · <a id="none">ninguna</a></span></div>
            <div id="complist"><small>Abre "Búsqueda por Nombre" para cargar la lista…</small></div>
          </div>
          <div class="btns">
            <button id="goto" class="sec">Ir al formulario de búsqueda</button>
            <button id="start">Buscar en todo</button>
            <button id="pause" class="sec">Pausar</button>
            <button id="resume">Continuar</button>
            <button id="stop" class="sec">Detener</button>
          </div>
          <div class="btns">
            <button id="csv" class="sec">Descargar Excel (CSV)</button>
            <button id="clear" class="sec">Limpiar</button>
          </div>
          <div class="prog" id="prog">
            <div class="bar" id="bar"><i id="fill"></i></div>
            <div class="ptxt"><b id="pct">0%</b><span id="pdet"></span></div>
          </div>
          <div class="msg" id="msg"></div>
          <div class="count" id="count"></div>
          <div class="res" id="res"></div>
          <details><summary>Registro</summary><pre id="log"></pre></details>
          <div class="note">Uso personal. La búsqueda por nombre puede traer homónimos y no muestra causas reservadas.</div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);

    const $ = (id) => root.getElementById(id);
    let compsSig = '';
    let checked = null;   // valores marcados por el usuario
    let initialized = false;

    chrome.storage.local.get(KEY_HIDDEN).then((o) => { host.style.display = o[KEY_HIDDEN] ? 'none' : ''; });
    chrome.runtime.onMessage.addListener((m) => {
      if (m && m.type === 'toggle') {
        const hide = host.style.display !== 'none';
        host.style.display = hide ? 'none' : '';
        chrome.storage.local.set({ [KEY_HIDDEN]: hide });
      }
    });
    $('min').onclick = () => { host.style.display = 'none'; chrome.storage.local.set({ [KEY_HIDDEN]: true }); };

    const boxes = () => [...$('complist').querySelectorAll('input[type=checkbox]')];
    $('all').onclick = () => boxes().forEach((b) => { b.checked = true; });
    $('none').onclick = () => boxes().forEach((b) => { b.checked = false; });

    $('start').onclick = async () => {
      const persona = {
        nombre: norm($('nombre').value), paterno: norm($('paterno').value),
        materno: norm($('materno').value), anio: norm($('anio').value)
      };
      if (!persona.nombre || !persona.paterno) { alert('Ingresa al menos el nombre y el apellido paterno.'); return; }
      const st = await load();
      const sel = boxes().filter((b) => b.checked).map((b) => b.value);
      const allComps = !st.available.length;          // lista aún no cargada: revisar todas
      const compsSel = allComps ? [] : st.available.filter((c) => sel.includes(c.value));
      if (!allComps && !compsSel.length) { alert('Marca al menos una competencia.'); return; }
      if (allComps) irANombre();
      await save({
        status: 'running', persona, filtroTrib: norm($('filtro').value), compsSel, allComps,
        compIdx: 0, tribList: null, tribIdx: 0, results: [], log: [], msg: 'Iniciando…', pending: false, searches: 0, startedAt: Date.now()
      });
    };
    function irANombre() { ultimoIntento = 0; return irAlFormulario(); }
    $('goto').onclick = async () => {
      if (!(await irANombre())) alert('No encontré el menú "Consulta Unificada". Ábrelo desde el menú de la izquierda (☰) y vuelve a intentar.');
    };
    $('pause').onclick = () => save({ status: 'paused', msg: 'En pausa.' });
    $('resume').onclick = () => save({ status: 'running', msg: 'Continuando…' });
    $('stop').onclick = () => save({ status: 'stopped', msg: 'Búsqueda detenida.', pending: false });
    $('clear').onclick = async () => {
      if (!confirm('¿Borrar los resultados y el registro?')) return;
      await save({ status: 'idle', results: [], log: [], msg: '', compIdx: 0, tribList: null, tribIdx: 0, pending: false, searches: 0, startedAt: 0 });
    };
    $('csv').onclick = async () => {
      const st = await load();
      if (!st.results.length) { alert('No hay resultados para descargar.'); return; }
      const cols = [['competencia', 'Competencia'], ['tribunalConsultado', 'Tribunal consultado'], ['rol', 'Rol'],
        ['fecha', 'Fecha'], ['caratulado', 'Caratulado'], ['tribunal', 'Tribunal']];
      const q = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
      const lines = [cols.map((c) => q(c[1])).join(';')]
        .concat(st.results.map((r) => cols.map((c) => q(r[c[0]])).join(';')));
      const p = st.persona;
      lines.push('', q(`Nombre buscado: ${[p.nombre, p.paterno, p.materno].filter(Boolean).join(' ')}`),
        q(`Fecha de consulta: ${new Date().toLocaleString('es-CL')}`),
        q('Búsqueda por nombre: pueden aparecer homónimos. Las causas reservadas no se muestran.'));
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      const nombre = low([p.nombre, p.paterno, p.materno].join(' ')).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      a.href = URL.createObjectURL(blob);
      a.download = `causas_${nombre}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };

    async function render() {
      const st = await load();
      if (!initialized) {
        initialized = true;
        $('nombre').value = st.persona.nombre || '';
        $('paterno').value = st.persona.paterno || '';
        $('materno').value = st.persona.materno || '';
        $('anio').value = st.persona.anio || '';
        $('filtro').value = st.filtroTrib || '';
        if (st.compsSel.length) checked = new Set(st.compsSel.map((c) => c.value));
      }

      const sig = JSON.stringify(st.available);
      if (sig !== compsSig && st.available.length) {
        if (compsSig) checked = new Set(boxes().filter((b) => b.checked).map((b) => b.value));
        compsSig = sig;
        $('complist').innerHTML = '';
        for (const c of st.available) {
          const l = document.createElement('label');
          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.value = c.value; cb.checked = checked ? checked.has(c.value) : true;
          l.append(cb, document.createTextNode(c.text));
          $('complist').appendChild(l);
        }
      }

      const running = st.status === 'running', paused = st.status === 'paused';
      $('start').disabled = running || paused;
      $('pause').style.display = running ? '' : 'none';
      $('resume').style.display = paused ? '' : 'none';
      $('stop').disabled = !(running || paused);
      [...root.querySelectorAll('input')].forEach((i) => { i.disabled = running; });

      const sinForm = !st.formVisible;
      $('goto').style.display = sinForm && !running ? '' : 'none';
      $('msg').textContent = st.msg || (st.status === 'idle'
        ? (sinForm ? 'No veo el formulario "Búsqueda por Nombre". Presiona "Ir al formulario de búsqueda".'
                   : 'Ingresa el nombre y presiona "Buscar en todo".')
        : '');
      $('msg').className = 'msg' + (/⚠️|Error/.test(st.msg) ? ' warn' : '');
      const total = st.compsSel.length;
      let pct = 0;
      if (st.status === 'done') pct = 100;
      else if (total) {
        const parcial = st.tribList && st.tribList.length ? st.tribIdx / st.tribList.length : 0;
        pct = Math.min(99, Math.floor(((st.compIdx + parcial) / total) * 100));
      }
      $('prog').style.display = st.status === 'idle' ? 'none' : '';
      $('fill').style.width = pct + '%';
      $('bar').className = 'bar' + (running ? ' run' : '');
      $('pct').textContent = pct + '%';
      const partes = [];
      if (total) partes.push(`Competencia ${Math.min(st.compIdx + 1, total)} de ${total}`);
      if (st.tribList && st.tribList.length > 1) partes.push(`tribunal ${st.tribIdx + 1} de ${st.tribList.length}`);
      partes.push(`${st.searches || 0} búsqueda(s)`);
      if (st.startedAt) {
        const s2 = Math.round((Date.now() - st.startedAt) / 1000);
        partes.push(`${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, '0')} min`);
      }
      $('pdet').textContent = partes.join(' · ');
      if (running) root.querySelector('details').open = true;
      $('count').textContent = st.results.length || st.status !== 'idle' ? `${st.results.length} causa(s) encontradas` : '';
      $('res').innerHTML = '';
      for (const r of st.results.slice(-100)) {
        const d = document.createElement('div');
        d.innerHTML = '<b></b> <span></span><br><small></small>';
        d.querySelector('b').textContent = r.rol;
        d.querySelector('span').textContent = r.caratulado;
        d.querySelector('small').textContent = `${r.competencia} · ${r.tribunal} · ${r.fecha}`;
        $('res').appendChild(d);
      }
      $('log').textContent = (st.log || []).join('\n');
    }

    render();
    return { render };
  }
})();
