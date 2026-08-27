/* ═══════════════════════════════════════════════════════════════════════════
 * Nodo · AUDITORÍA DE NÚMEROS  (reusable)
 * ───────────────────────────────────────────────────────────────────────────
 * Recalcula el dinero del canal DESDE LA BASE, con una implementación propia,
 * y contrasta tres cosas:
 *   1. INVARIANTES: reglas que deben cumplirse siempre (un regalo no puede
 *      costar más de S/0, lo cobrado no puede superar el total, un pedido
 *      cancelado no puede seguir con stock reservado…).
 *   2. COHERENCIA entre secciones: el Dashboard, el Embudo, Compras, Pedidos y
 *      Rendimiento tienen que contar LO MISMO. Si dos pantallas dan cifras
 *      distintas del mismo hecho, una miente.
 *   3. DEFINICIONES: ticket = ingresos/ventas, ROAS = cobrado/gasto, etc.
 *
 * No importa `orders.js` a propósito: si reusara sus fórmulas, repetiría sus
 * errores y todo cuadraría siempre. Acá se recalcula desde los datos crudos.
 *
 * USO (consola del panel logueado):
 *   const src = await (await fetch("/Nodo/scripts/auditoria-numeros.js")).text();
 *   (0,eval)(src); const r = await NodoAudit.run();
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const BASE = "https://ahoxdyffbwjlshmdezwi.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFob3hkeWZmYndqbHNobWRlendpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDU4MTksImV4cCI6MjA5ODYyMTgxOX0.4iY3gl1ZhxILv1kPF8-NYd4a0_MeAZmkyLqxx2BMW-Q";
  let CH = localStorage.getItem("nodo.channelId"); try { CH = JSON.parse(CH); } catch (_) {}
  const token = () => { try { return JSON.parse(localStorage.getItem("sb-ahoxdyffbwjlshmdezwi-auth-token")).access_token; } catch (_) { return null; } };
  const H = () => ({ apikey: ANON, Authorization: "Bearer " + token(), "Content-Type": "application/json" });
  const sel = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { headers: H() }).then((r) => r.json());
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // ── Modelo de estados (copiado del contrato de negocio, no del código) ────
  // venta   = cuenta como venta en el embudo/dashboard
  // cobro   = cuánta plata entró: todo | adelanto | nada
  // perdido = la venta se cayó
  const EST = {
    confirmada:        { venta: true,  cobro: "todo",     perdido: false, tipo: "digital" },
    pendiente:         { venta: false, cobro: "nada",     perdido: false, tipo: "digital" },
    anulada:           { venta: false, cobro: "nada",     perdido: true,  tipo: "digital" },
    carrito:           { venta: false, cobro: "nada",     perdido: false, tipo: "?" },
    confirmado:        { venta: true,  cobro: "nada",     perdido: false, tipo: "lima" },
    en_reparto:        { venta: true,  cobro: "nada",     perdido: false, tipo: "lima" },
    reprogramado:      { venta: true,  cobro: "nada",     perdido: false, tipo: "lima" },
    entregado_cobrado: { venta: true,  cobro: "todo",     perdido: false, tipo: "lima" },
    rechazado:         { venta: true,  cobro: "nada",     perdido: true,  tipo: "lima" },
    esperando_adelanto:{ venta: false, cobro: "nada",     perdido: false, tipo: "provincia" },
    adelanto_validado: { venta: true,  cobro: "adelanto", perdido: false, tipo: "provincia" },
    por_despachar:     { venta: true,  cobro: "adelanto", perdido: false, tipo: "provincia" },
    despachado:        { venta: true,  cobro: "adelanto", perdido: false, tipo: "provincia" },
    en_agencia:        { venta: true,  cobro: "adelanto", perdido: false, tipo: "provincia" },
    saldo_pagado:      { venta: true,  cobro: "todo",     perdido: false, tipo: "provincia" },
    recogido:          { venta: true,  cobro: "todo",     perdido: false, tipo: "provincia" },
    no_recogido:       { venta: true,  cobro: "adelanto", perdido: true,  tipo: "provincia" },
    cancelado:         { venta: false, cobro: "nada",     perdido: true,  tipo: "?" },
  };

  const bumps = (o) => Array.isArray(o.order_bumps) ? o.order_bumps : [];
  const total = (o) => r2(Number(o.amount || 0) + bumps(o).reduce((a, b) => a + Number(b.precio || 0), 0));
  const adelanto = (o) => {
    const s = o.shipping || {};
    const real = Number(s.adelanto_abonado ?? s.pago_acreditado_adelanto);
    return (Number.isFinite(real) && real > 0) ? real : (Number(s.adelanto || 0) || 0);
  };
  const cobrado = (o) => {
    const m = EST[o.estado]; if (!m) return 0;
    if (m.cobro === "todo") return total(o);
    if (m.cobro === "adelanto") return Math.min(adelanto(o), total(o));
    return 0;
  };
  const porCobrar = (o) => {
    const m = EST[o.estado]; if (!m || m.perdido || !m.venta) return 0;
    return Math.max(0, r2(total(o) - cobrado(o)));
  };

  const F = [];   // hallazgos
  const nota = (grav, area, msg, detalle) => F.push({ grav, area, msg, detalle: detalle ?? "" });

  async function run() {
    if (!CH) throw new Error("Sin canal. Abre el panel logueado.");
    const [orders, products, contacts, chs] = await Promise.all([
      sel("orders", `select=*&channel_id=eq.${CH}&order=created_at`),
      sel("products", `select=id,nombre,tipo,config&channel_id=eq.${CH}`),
      sel("contacts", `select=id,wa_id,nombre,stage&channel_id=eq.${CH}`),
      sel("channels", `select=id,nombre,entregas,pedidos_config,moneda&id=eq.${CH}`),
    ]);
    const ch = (chs || [])[0] || {};
    const prod = {}; for (const p of products || []) prod[p.id] = p;

    // ── LIBRO MAYOR independiente ─────────────────────────────────────────
    const L = {
      pedidos: orders.length, ventas: 0, perdidos: 0, noVenta: 0,
      ingresos: 0, porCobrar: 0, totalComprometido: 0,
      porEstado: {}, porZona: { lima: 0, provincia: 0, digital: 0, otro: 0 },
      ingresosPorZona: { lima: 0, provincia: 0, digital: 0, otro: 0 },
      porProducto: {},
    };
    for (const o of orders) {
      const m = EST[o.estado];
      L.porEstado[o.estado] = (L.porEstado[o.estado] || 0) + 1;
      if (!m) { nota("alto", "estados", `Pedido con estado DESCONOCIDO "${o.estado}"`, o.id); continue; }
      const z = (o.shipping?.zona) || (m.tipo === "digital" ? "digital" : "otro");
      const zk = ["lima", "provincia", "digital"].includes(z) ? z : "otro";
      L.porZona[zk]++;
      const c = cobrado(o);
      L.ingresos = r2(L.ingresos + c);
      L.ingresosPorZona[zk] = r2(L.ingresosPorZona[zk] + c);
      L.porCobrar = r2(L.porCobrar + porCobrar(o));
      if (m.venta && !m.perdido) L.ventas++;
      if (m.perdido) L.perdidos++;
      if (!m.venta) L.noVenta++;
      if (m.venta && !m.perdido) L.totalComprometido = r2(L.totalComprometido + total(o));
      const pid = o.product_id || "_none";
      const P = (L.porProducto[pid] ||= { nombre: prod[pid]?.nombre || "(sin producto)", ventas: 0, ingresos: 0, unidades: 0 });
      if (m.venta && !m.perdido) { P.ventas++; P.ingresos = r2(P.ingresos + c); }

      // ── INVARIANTES por pedido ──
      if (cobrado(o) > total(o) + 0.001) nota("alto", "dinero", `Cobrado (${cobrado(o)}) MAYOR que el total (${total(o)})`, `${o.estado} · ${o.id}`);
      if (Number(o.amount) < 0) nota("alto", "dinero", `amount negativo (${o.amount})`, o.id);
      for (const b of bumps(o)) {
        if (b.regalo && Number(b.precio || 0) > 0) nota("alto", "regalo", `Regalo con precio ${b.precio} (debería ser 0)`, `${b.nombre} · ${o.id}`);
        if (!b.regalo && !(Number(b.precio) > 0)) nota("medio", "extra", `Extra pagado con precio ${b.precio}`, `${b.nombre} · ${o.id}`);
      }
      if (m.venta && !m.perdido && total(o) <= 0) nota("alto", "dinero", `Venta por S/0`, `${o.estado} · ${o.id}`);
      const s = o.shipping || {};
      // Stock: si se descontó y el pedido se cayó, tiene que estar devuelto
      if (m.perdido && s.stock_descontado && !s.stock_devuelto) nota("alto", "stock", `Pedido ${o.estado} con stock SIN devolver`, o.id);
      if (!m.perdido && s.stock_devuelto === true && s.stock_descontado !== true) nota("medio", "stock", `Pedido vivo con stock devuelto`, `${o.estado} · ${o.id}`);
      // Adelanto: no puede superar el total
      if (adelanto(o) > total(o) + 0.001) nota("alto", "dinero", `Adelanto (${adelanto(o)}) mayor que el total (${total(o)})`, o.id);
      // Provincia despachada sin adelanto cobrado
      if (["despachado", "en_agencia"].includes(o.estado) && adelanto(o) <= 0) nota("medio", "provincia", `Despachado sin adelanto registrado`, o.id);
      // Saldo del shipping coherente con lo que falta
      if (m.tipo === "provincia" && s.saldo != null && s.saldo !== "" && m.cobro === "adelanto") {
        const esperado = r2(total(o) - adelanto(o));
        if (Math.abs(Number(s.saldo) - esperado) > 0.01) {
          nota("medio", "dinero", `shipping.saldo=${s.saldo} pero total−adelanto=${esperado}`, `${o.estado} · ${o.id}`);
        }
      }
    }

    // ── INVARIANTES de conjunto ───────────────────────────────────────────
    const sumaEstados = Object.values(L.porEstado).reduce((a, b) => a + b, 0);
    if (sumaEstados !== L.pedidos) nota("alto", "conteo", `La suma por estado (${sumaEstados}) ≠ total de pedidos (${L.pedidos})`);
    const sumaZonas = Object.values(L.porZona).reduce((a, b) => a + b, 0);
    if (sumaZonas !== L.pedidos) nota("alto", "conteo", `La suma por zona (${sumaZonas}) ≠ total de pedidos (${L.pedidos})`);
    const sumaIngZona = r2(Object.values(L.ingresosPorZona).reduce((a, b) => a + b, 0));
    if (Math.abs(sumaIngZona - L.ingresos) > 0.01) nota("alto", "dinero", `Ingresos por zona (${sumaIngZona}) ≠ ingresos totales (${L.ingresos})`);
    L.ticket = L.ventas ? r2(L.ingresos / L.ventas) : 0;

    // ── Contactos: la etapa tiene que seguir a los pedidos ────────────────
    const porContacto = {};
    for (const o of orders) (porContacto[o.contact_id] ||= []).push(o);
    for (const c of contacts || []) {
      const os = porContacto[c.id] || [];
      const tieneVenta = os.some((o) => EST[o.estado]?.venta && !EST[o.estado]?.perdido);
      const todasCaidas = os.length > 0 && os.every((o) => EST[o.estado]?.perdido || !EST[o.estado]?.venta);
      if (tieneVenta && !["comprado", "confirmado"].includes(c.stage)) {
        nota("medio", "embudo", `Contacto con venta viva pero etapa "${c.stage}"`, `${c.nombre || c.wa_id}`);
      }
      if (todasCaidas && os.some((o) => EST[o.estado]?.perdido) && c.stage === "comprado") {
        nota("medio", "embudo", `Contacto sin ninguna venta viva pero etapa "comprado"`, `${c.nombre || c.wa_id}`);
      }
    }

    // ── Stock: lo reservado tiene que cuadrar con los movimientos ─────────
    const movPorProd = {};
    for (const o of orders) {
      const s = o.shipping || {};
      if (!Array.isArray(s.stock_mov)) continue;
      const vivo = s.stock_descontado === true && s.stock_devuelto !== true;
      if (!vivo) continue;
      for (const mv of s.stock_mov) {
        const k = `${mv.product_id}|${mv.key}`;
        movPorProd[k] = (movPorProd[k] || 0) + (Number(mv.unidades) || 0);
      }
    }
    L.reservado = movPorProd;

    return { canal: ch.nombre, libro: L, hallazgos: F, orders, products, contacts };
  }

  window.NodoAudit = { run, EST, total, cobrado, porCobrar, adelanto };
  console.log("%c[audit]", "color:#0a7;font-weight:bold", "Listo. Corre:  await NodoAudit.run()");
})();
