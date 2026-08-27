/* Vuelca los chats de la simulación como texto plano, para leerlos completos.
   Uso en la consola del panel logueado:
     const t = await window.__dumpChats();      // todos
     const t = await window.__dumpChats("N7");  // uno
   Deja el texto en window.__CHATS (y lo trocea en window.__CHUNKS). */
(function () {
  const BASE = "https://ahoxdyffbwjlshmdezwi.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFob3hkeWZmYndqbHNobWRlendpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDU4MTksImV4cCI6MjA5ODYyMTgxOX0.4iY3gl1ZhxILv1kPF8-NYd4a0_MeAZmkyLqxx2BMW-Q";
  let CH = localStorage.getItem("nodo.channelId"); try { CH = JSON.parse(CH); } catch (_) {}
  const token = () => { try { return JSON.parse(localStorage.getItem("sb-ahoxdyffbwjlshmdezwi-auth-token")).access_token; } catch (_) { return null; } };
  const H = () => ({ apikey: ANON, Authorization: "Bearer " + token() });
  const sel = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { headers: H() }).then((r) => r.json());

  window.__dumpChats = async function (filtroWa) {
    const cs = await sel("contacts", `select=id,wa_id,nombre,stage,bot_activo&channel_id=eq.${CH}&order=wa_id.asc`);
    const out = [];
    for (const c of cs) {
      if (filtroWa && !String(c.wa_id).includes(filtroWa)) continue;
      const ms = await sel("messages", `select=direction,content,ts,type&contact_id=eq.${c.id}&order=ts.asc&limit=200`);
      const os = await sel("orders", `select=estado,amount,shipping,order_bumps,created_at&contact_id=eq.${c.id}&order=created_at.asc`);
      out.push(`\n${"═".repeat(78)}\n${c.wa_id} · ${c.nombre || "(sin nombre)"} · etapa=${c.stage}${c.bot_activo === false ? " · BOT EN PAUSA" : ""}`);
      for (const o of os) {
        const s = o.shipping || {};
        out.push(`  PEDIDO ${o.estado} S/${o.amount} zona=${s.zona || "?"} ${s.opcion || ""} ${s.variante ? "[" + s.variante + "]" : ""}${(o.order_bumps || []).length ? " bumps:" + o.order_bumps.map((b) => `${b.nombre}@${b.precio}${b.regalo ? "(regalo)" : ""}`).join(",") : ""}`);
      }
      out.push("─".repeat(78));
      for (const m of ms) {
        const t = m.content?.text || m.content?.caption || (m.type ? `[${m.type}]` : "");
        const quien = m.direction === "in" ? "CLIENTE" : "BOT   ";
        out.push(`${quien} │ ${String(t).replace(/\n/g, "\n       │ ")}`);
      }
    }
    const txt = out.join("\n");
    window.__CHATS = txt;
    const N = 14000, ch = [];
    for (let i = 0; i < txt.length; i += N) ch.push(txt.slice(i, i + N));
    window.__CHUNKS = ch;
    return `${cs.length} contactos · ${txt.length} chars · ${ch.length} trozos (window.__CHUNKS)`;
  };
  return "listo";
})();
