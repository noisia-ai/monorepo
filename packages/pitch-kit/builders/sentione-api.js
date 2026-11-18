// sentione-api.js · totales del tablero de SentiOne sin descargar menciones.
//
// Se pega con javascript_tool en la pestaña del usuario, con su permiso, sobre el panel del proyecto
// (#/dashboards/show/<id>). Guía y reglas: packages/pitch-kit/SENTIONE.md §4B.
//
// 1. Pega este archivo completo. Devuelve 'instalado'.
// 2. Pulsa refrescar en el panel. La app hace sus llamadas y aquí se capturan los NOMBRES de sus
//    encabezados y la plantilla del cuerpo. __sentione.ready() dice qué falta.
// 3. await __sentione.poll('source/total', {topicId: ID, from: MS_UTC, to: MS_UTC, language: [...]})
// 4. Comprueba que el filtro movió el total: __sentione.moved(...) compara contra la misma llamada
//    sin el filtro. Un parámetro mal escrito no da error, devuelve el total sin filtrar.
// 5. __sentione.download('archivo.csv', texto) para sacar resultados largos: la salida de
//    javascript_tool se corta a unos 1,200 caracteres.
//
// Los valores de los encabezados viven solo en esta página. Nada aquí los imprime ni los devuelve:
// no agregues un return que los exponga.
(() => {
  if (window.__sentione) return 'ya estaba instalado';
  const hdr = {};          // nombre -> valor, solo en memoria de la página
  const tpl = {};          // ruta -> último cuerpo que mandó la app
  const NEED = ['X-API-KEY', 'X-API-DEVICE-ID'];

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const setH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, url) { this.__url = String(url); return open.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (!this.__own && /^(accept|x-api-key|x-api-device-id)$/i.test(k)) hdr[k] = v;
    return setH.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const m = !this.__own && this.__url && this.__url.match(/\/api\/([a-z/]+)/i);
    if (m && typeof body === 'string') { try { tpl[m[1]] = JSON.parse(body); } catch (e) {} }
    return send.apply(this, arguments);
  };

  const call = (path, body) => new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.__own = true;
    x.open('POST', '/api/' + path);
    x.setRequestHeader('Content-Type', 'application/json');
    x.setRequestHeader('Accept', hdr['Accept'] || 'application/json');
    for (const k of NEED) if (hdr[k]) x.setRequestHeader(k, hdr[k]);
    x.onload = () => resolve([x.status, x.responseText]);
    x.onerror = () => resolve([0, '']);
    const base = tpl[path] || tpl['source/total'] || {
      sentiment: [], group: [], granulation: null, mentionType: [], type: 'all', tags: [],
      textFilter: null, sourceId: null, influenceScores: [], preciseIds: null, timezone: null,
    };
    x.send(JSON.stringify(Object.assign({}, base, { path }, body)));
  });

  const poll = async (path, body, tries = 40, every = 1500) => {
    for (let i = 0; i < tries; i++) {
      const [status, text] = await call(path, body);
      if (status === 401) return { error: 401, hint: 'faltan encabezados: refresca el panel' };
      let j; try { j = JSON.parse(text); } catch (e) { return { error: status, hint: 'respuesta sin JSON' }; }
      if (j.success !== false && (j.progress === undefined || j.progress === 1)) return j;
      await new Promise((r) => setTimeout(r, every));
    }
    return { error: 'timeout' };
  };

  // Suma de source/total: el resultado viene por grupo de fuente.
  const total = (j) => (j && j.result && typeof j.result === 'object')
    ? Object.values(j.result).reduce((a, b) => a + (Number(b) || 0), 0) : null;

  const moved = async (path, body, filterKey) => {
    const withF = total(await poll(path, body));
    const without = Object.assign({}, body); delete without[filterKey];
    const sinF = total(await poll(path, without));
    return { con_filtro: withF, sin_filtro: sinF, se_movio: withF !== null && withF !== sinF };
  };

  const download = (name, text) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    return 'descargado: ' + name;
  };

  const ready = () => ({
    encabezados: NEED.filter((k) => hdr[k]).length + ' de ' + NEED.length,
    plantillas: Object.keys(tpl),
  });

  window.__sentione = { call, poll, total, moved, download, ready };
  return 'instalado';
})();
