// ═══════════════════════════════════════════════════════════════════
// Nodo · folder-bar.js — Carpetas de verdad, componente compartido
//
// Una sola implementación de "carpetas" para todas las secciones del panel
// (productos, campañas, secuencias, plantillas, respuestas, campos, flujos).
// Antes cada página repetía su propio enredo de chips + "+ Carpeta" + borrar.
//
// Modelo: los items siguen guardando el NOMBRE de la carpeta en item.folder
// (compat total). La metadata (color, emoji, orden) vive en la tabla `folders`
// keyed por (channel_id, tipo, nombre). Renombrar = update en `folders` +
// cascade al texto de los items. Si la tabla `folders` aún no existe
// (migración 0061 sin aplicar), cae a modo texto: deriva las carpetas de los
// items, sin color/emoji/orden, y Gestionar avisa que falta la migración.
//
// Uso:
//   const F = await mountFolders({
//     el: $("folders"), tipo: "product", table: "products",
//     channelId: st.channelId, items: () => st.list, onChange: renderCards });
//   F.filter(list)  → lista filtrada por la carpeta activa
//   F.meta(nombre)  → { color, emoji } | null   (para pintar el chip del item)
//   F.current       → "__all" | "__none" | "<nombre>"
//   F.reload()      → re-lee + re-pinta
//   F.setChannel(id)→ cambia de canal
//   F.picker({ current, onPick }) → <button> chip para el editor del item
// ═══════════════════════════════════════════════════════════════════
import { supa, toast, icon, askText, confirmDialog } from "./shell.js";

const PALETTE = ["#378ADD","#1D9E75","#D4537E","#BA7517","#7F77DD","#D85A30","#0EA5A5","#888780"];
const EMOJIS  = ["📁","👟","💊","🎁","🔥","⭐","🛒","📦","💎","🎯","🏷️","✨","📚","🧴","👕","🍫"];

let styled = false;
function ensureStyle(){
  if (styled) return; styled = true;
  const s = document.createElement("style");
  s.textContent = `
  .nodo-folder .fdot{width:9px;height:9px;border-radius:50%;flex:none}
  .nodo-folder .femo{font-size:13px;line-height:1}
  .fb-modal-back{position:fixed;inset:0;background:var(--overlay,rgba(15,17,26,.55));display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}
  .fb-modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:min(560px,96vw);max-height:88vh;display:flex;flex-direction:column;box-shadow:var(--shadow-3,0 20px 60px rgba(0,0,0,.35))}
  .fb-modal h3{margin:0;padding:18px 20px 6px;font-size:17px;font-weight:700}
  .fb-modal .fb-sub{padding:0 20px 10px;color:var(--muted);font-size:12.5px}
  .fb-rows{overflow-y:auto;padding:6px 12px 4px}
  .fb-row{display:flex;align-items:center;gap:9px;padding:8px 6px;border-radius:10px;border:1px solid transparent}
  .fb-row+.fb-row{border-top:1px solid var(--border)}
  .fb-row.drag{opacity:.4}
  .fb-row.over{border-color:var(--brand);background:var(--brand-bg,rgba(99,102,241,.08))}
  .fb-grip{color:var(--muted);cursor:grab;flex:none;display:flex}
  .fb-grip svg{width:17px;height:17px}
  .fb-emoji{width:30px;height:30px;flex:none;border:1px solid var(--border);border-radius:8px;background:var(--surface-2,var(--surface));font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer}
  .fb-name{flex:1;min-width:0;height:34px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2,var(--surface));color:inherit;padding:0 10px;font-size:14px;font-family:inherit}
  .fb-sw{display:flex;gap:5px;flex:none}
  .fb-sw span{width:17px;height:17px;border-radius:50%;cursor:pointer}
  .fb-sw span.on{outline:2px solid currentColor;outline-offset:2px}
  .fb-del{width:32px;height:32px;flex:none;border:none;background:transparent;color:var(--red);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .fb-del:hover{background:var(--red-bg,rgba(226,84,74,.12))}
  .fb-del svg{width:16px;height:16px}
  .fb-add{margin:6px 14px 4px;height:38px;border:1px dashed var(--border-strong,var(--border));background:transparent;color:var(--muted);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-family:inherit}
  .fb-add:hover{border-color:var(--brand);color:var(--brand)}
  .fb-acts{display:flex;justify-content:flex-end;gap:9px;padding:12px 20px 18px;border-top:1px solid var(--border);margin-top:6px}
  .fb-btn{height:38px;padding:0 16px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2,var(--surface));color:inherit;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
  .fb-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}
  .fb-epop{position:absolute;z-index:10000;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:8px;box-shadow:var(--shadow-2,0 10px 30px rgba(0,0,0,.28));display:grid;grid-template-columns:repeat(8,1fr);gap:3px;width:260px}
  .fb-epop button{width:28px;height:28px;border:none;background:transparent;border-radius:7px;font-size:16px;cursor:pointer}
  .fb-epop button:hover{background:var(--brand-bg,rgba(99,102,241,.12))}
  .fb-epop .fb-erow{grid-column:1/-1;display:flex;gap:6px;margin-top:4px}
  .fb-epop .fb-erow input{flex:1;height:30px;border:1px solid var(--border);border-radius:7px;background:var(--surface-2,var(--surface));color:inherit;padding:0 8px;font-size:13px;font-family:inherit}
  .fpick{position:absolute;z-index:10000;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:6px;box-shadow:var(--shadow-2,0 10px 30px rgba(0,0,0,.28));min-width:200px;max-height:300px;overflow-y:auto}
  .fpick button{display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;color:inherit;padding:8px 10px;border-radius:8px;font-size:13.5px;cursor:pointer;text-align:left;font-family:inherit}
  .fpick button:hover{background:var(--brand-bg,rgba(99,102,241,.10))}
  .fpick .fdot{width:9px;height:9px;border-radius:50%;flex:none}
  `;
  document.head.appendChild(s);
}

export async function mountFolders(opts){
  ensureStyle();
  const S = {
    el: opts.el, tipo: opts.tipo, table: opts.table,
    channelId: opts.channelId, items: opts.items || (()=>[]),
    onChange: opts.onChange || (()=>{}),
    current: "__all", metas: [], hasTable: true,
  };

  async function load(){
    S.metas = [];
    const { data, error } = await supa.from("folders")
      .select("id,nombre,color,emoji,orden")
      .eq("channel_id", S.channelId).eq("tipo", S.tipo).order("orden");
    if (error) { S.hasTable = false; }
    else { S.hasTable = true; S.metas = data || []; }
    // Fusiona nombres que existen como texto en items pero aún no en `folders`
    // (p.ej. carpeta creada por otro flujo, o migración a medio aplicar).
    const known = new Set(S.metas.map(m=>m.nombre));
    const extra = [...new Set((S.items()||[]).map(x=>x.folder).filter(f=>f && String(f).trim() && !known.has(f)))];
    extra.forEach((nombre,i)=> S.metas.push({ nombre, color:null, emoji:null, orden: S.metas.length+i, _ghost:true }));
    S.metas.sort((a,b)=> (a.orden||0)-(b.orden||0) || String(a.nombre).localeCompare(b.nombre));
    // Si el filtro activo apunta a una carpeta que ya no existe → vuelve a Todos.
    if (S.current!=="__all" && S.current!=="__none" && !S.metas.some(m=>m.nombre===S.current)) S.current="__all";
  }

  function count(v){
    const list = S.items()||[];
    if (v==="__all") return list.length;
    if (v==="__none") return list.filter(x=>!x.folder).length;
    return list.filter(x=>x.folder===v).length;
  }

  function chip(v, label, meta){
    const on = S.current===v ? " on" : "";
    let inner = "";
    if (meta){
      if (meta.color) inner += `<span class="fdot" style="background:${esc(meta.color)}"></span>`;
      else inner += icon("folder");
      if (meta.emoji) inner += `<span class="femo">${esc(meta.emoji)}</span>`;
    }
    inner += esc(label);
    return `<button class="nodo-folder${on}" data-f="${esc(v)}">${inner}<span class="cnt">${count(v)}</span></button>`;
  }

  function extraChip(t){
    const on = S.current===t.v ? " on" : "";
    const cls = t.cls ? " "+t.cls : "";
    const cnt = (typeof t.count==="function"? t.count(): t.count);
    return `<button class="nodo-folder${cls}${on}" data-f="${esc(t.v)}">${t.icon?t.icon:""}${esc(t.label)}${cnt==null?"":`<span class="cnt">${cnt}</span>`}</button>`;
  }
  function render(){
    const extra = (opts.extraTabs ? (opts.extraTabs()||[]) : []);
    const trailing = (opts.trailingTabs ? (opts.trailingTabs()||[]) : []);
    const chips = [ chip("__all", opts.labelAll||"Todos", null),
      ...extra.map(extraChip),
      chip("__none", opts.labelNone||"Sin carpeta", null),
      ...S.metas.map(m=> chip(m.nombre, m.nombre, m)),
      ...trailing.map(extraChip) ];
    S.el.innerHTML = chips.join("")
      + `<button class="nodo-folder add" data-act="new">+ Carpeta</button>`
      + `<button class="nodo-folder" data-act="manage" style="gap:5px">${icon("edit")}Gestionar</button>`;
    S.el.querySelectorAll(".nodo-folder[data-f]").forEach(b=> b.onclick=()=>{ S.current=b.dataset.f; render(); S.onChange(); });
    S.el.querySelector('[data-act="new"]').onclick = createFolder;
    S.el.querySelector('[data-act="manage"]').onclick = openManage;
  }

  async function ensureRow(nombre){
    // Garantiza una fila en `folders` para ese nombre (al crear/asignar).
    if (!S.hasTable) return;
    const orden = S.metas.length;
    await supa.from("folders").insert({ channel_id:S.channelId, tipo:S.tipo, nombre, orden }).select("id").maybeSingle().then(()=>{},()=>{});
  }

  async function createFolder(){
    const n = (await askText({ title:"Nueva carpeta", label:"Nombre de la carpeta", placeholder:"Ej. Cursos", confirmText:"Crear" }))?.trim();
    if (!n) return;
    if (S.metas.some(m=>m.nombre===n)) { toast("Ya existe una carpeta con ese nombre", true); return; }
    if (S.hasTable){
      const { error } = await supa.from("folders").insert({ channel_id:S.channelId, tipo:S.tipo, nombre:n, orden:S.metas.length });
      if (error){ toast(/relation|does not exist/.test(error.message)?"Falta aplicar la migración 0061":error.message, true); }
    }
    await load(); S.current = n; render(); S.onChange();
  }

  // ── Gestionar (modal): renombrar, color, emoji, reordenar, borrar ──
  function openManage(){
    if (!S.hasTable){
      toast("Aplica la migración 0061 para color, emoji y orden", true);
    }
    const rows = S.metas.map(m=>({ id:m.id||null, nombre:m.nombre, _orig:m.nombre, color:m.color||null, emoji:m.emoji||null, orden:m.orden||0, _del:false, _new:false }));
    const back = document.createElement("div"); back.className="fb-modal-back";
    back.innerHTML = `<div class="fb-modal">
      <h3>Gestionar carpetas</h3>
      <div class="fb-sub">Renombra, dale color y emoji, arrástralas para ordenar. Borrar una manda sus items a “Sin carpeta”.</div>
      <div class="fb-rows" id="fbRows"></div>
      <button class="fb-add" id="fbAdd">${icon("plus")} Nueva carpeta</button>
      <div class="fb-acts"><button class="fb-btn" id="fbCancel">Cancelar</button><button class="fb-btn primary" id="fbSave">Guardar</button></div>
    </div>`;
    document.body.appendChild(back);
    const rowsEl = back.querySelector("#fbRows");
    let dragIdx = null;

    function paint(){
      rowsEl.innerHTML = "";
      rows.filter(r=>!r._del).forEach((r)=>{
        const idx = rows.indexOf(r);
        const el = document.createElement("div"); el.className="fb-row"; el.draggable=true;
        el.innerHTML = `<span class="fb-grip" aria-hidden="true">⋮⋮</span>
          <button class="fb-emoji" data-emoji>${r.emoji?esc(r.emoji):`<span style="color:var(--muted);font-size:13px">🙂</span>`}</button>
          <input class="fb-name" value="${esc(r.nombre)}" placeholder="Nombre" />
          <div class="fb-sw">${PALETTE.map(c=>`<span data-c="${c}" style="background:${c}" class="${r.color===c?'on':''}"></span>`).join("")}</div>
          <button class="fb-del" title="Eliminar">${icon("trash")}</button>`;
        el.querySelector(".fb-name").oninput = (e)=> r.nombre = e.target.value;
        el.querySelectorAll(".fb-sw span").forEach(sw=> sw.onclick=()=>{ r.color = (r.color===sw.dataset.c?null:sw.dataset.c); paint(); });
        el.querySelector("[data-emoji]").onclick = (e)=> openEmoji(e.currentTarget, (em)=>{ r.emoji=em; paint(); });
        el.querySelector(".fb-del").onclick = ()=>{ r._del=true; paint(); };
        el.addEventListener("dragstart", ()=>{ dragIdx=idx; el.classList.add("drag"); });
        el.addEventListener("dragend", ()=>{ dragIdx=null; el.classList.remove("drag"); rowsEl.querySelectorAll(".over").forEach(x=>x.classList.remove("over")); });
        el.addEventListener("dragover", (e)=>{ e.preventDefault(); el.classList.add("over"); });
        el.addEventListener("dragleave", ()=> el.classList.remove("over"));
        el.addEventListener("drop", (e)=>{ e.preventDefault(); el.classList.remove("over"); if(dragIdx===null||dragIdx===idx) return;
          const moved = rows.splice(dragIdx,1)[0]; rows.splice(idx,0,moved); paint(); });
        rowsEl.appendChild(el);
      });
    }
    paint();
    back.querySelector("#fbAdd").onclick = ()=>{ rows.push({ id:null, nombre:"", _orig:null, color:null, emoji:null, orden:rows.length, _del:false, _new:true }); paint();
      const inputs=rowsEl.querySelectorAll(".fb-name"); inputs[inputs.length-1]?.focus(); };
    const close = ()=> back.remove();
    back.querySelector("#fbCancel").onclick = close;
    back.onclick = (e)=>{ if(e.target===back) close(); };
    back.querySelector("#fbSave").onclick = async ()=>{
      const live = rows.filter(r=>!r._del);
      // Validaciones: nombres no vacíos ni repetidos.
      for (const r of live){ r.nombre=(r.nombre||"").trim(); if(!r.nombre){ toast("Ponle nombre a todas las carpetas", true); return; } }
      const names = live.map(r=>r.nombre.toLowerCase());
      if (new Set(names).size !== names.length){ toast("Hay carpetas con el mismo nombre", true); return; }
      if (!S.hasTable){
        // Modo texto: solo cascada de renombres/borrados sobre item.folder.
        for (const r of rows){
          if (r._del && r._orig){ await supa.from(S.table).update({ folder:null }).eq("channel_id",S.channelId).eq("folder",r._orig); }
          else if (r._orig && r.nombre!==r._orig){ await supa.from(S.table).update({ folder:r.nombre }).eq("channel_id",S.channelId).eq("folder",r._orig); }
        }
        close(); await load(); render(); S.onChange(); toast("Carpetas actualizadas ✓"); return;
      }
      try{
        // Borrados: quita la fila + manda sus items a Sin carpeta.
        for (const r of rows.filter(r=>r._del)){
          if (r.id) await supa.from("folders").delete().eq("id", r.id);
          if (r._orig) await supa.from(S.table).update({ folder:null }).eq("channel_id",S.channelId).eq("folder",r._orig);
        }
        // Altas / actualizaciones / orden.
        for (let i=0;i<live.length;i++){
          const r = live[i];
          if (r._new || !r.id){
            await supa.from("folders").insert({ channel_id:S.channelId, tipo:S.tipo, nombre:r.nombre, color:r.color, emoji:r.emoji, orden:i });
          } else {
            await supa.from("folders").update({ nombre:r.nombre, color:r.color, emoji:r.emoji, orden:i }).eq("id", r.id);
            if (r._orig && r.nombre!==r._orig){
              await supa.from(S.table).update({ folder:r.nombre }).eq("channel_id",S.channelId).eq("folder",r._orig);
            }
          }
        }
        close(); await load(); render(); S.onChange(); toast("Carpetas actualizadas ✓");
      } catch(e){ toast(e.message||"No se pudo guardar", true); }
    };
  }

  function openEmoji(anchor, cb){
    document.querySelectorAll(".fb-epop").forEach(x=>x.remove());
    const pop = document.createElement("div"); pop.className="fb-epop";
    pop.innerHTML = EMOJIS.map(e=>`<button data-e="${e}">${e}</button>`).join("")
      + `<button data-e="" title="Sin emoji" style="color:var(--muted)">✕</button>`
      + `<div class="fb-erow"><input placeholder="pega otro emoji" maxlength="4"/></div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth-272)+"px"; pop.style.top = (r.bottom+6)+"px";
    pop.querySelectorAll("button[data-e]").forEach(b=> b.onclick=()=>{ cb(b.dataset.e||null); pop.remove(); });
    const inp = pop.querySelector("input");
    inp.onkeydown = (e)=>{ if(e.key==="Enter"){ const v=inp.value.trim(); if(v){ cb(v); pop.remove(); } } };
    setTimeout(()=>{ const off=(e)=>{ if(!pop.contains(e.target)){ pop.remove(); document.removeEventListener("mousedown",off);} }; document.addEventListener("mousedown",off); },30);
  }

  // ── Picker para el editor del item (chip desplegable) ──────────────
  function picker(pOpts){
    const cur = pOpts.current || null;
    const meta = cur ? S.metas.find(m=>m.nombre===cur) : null;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "nodo-folder";
    btn.style.cssText = "gap:7px";
    const paintBtn = (name)=>{
      const m = name ? S.metas.find(x=>x.nombre===name) : null;
      let h="";
      if (name){ if(m&&m.color) h+=`<span class="fdot" style="background:${esc(m.color)}"></span>`; else h+=icon("folder"); if(m&&m.emoji) h+=`<span class="femo">${esc(m.emoji)}</span>`; h+=esc(name); }
      else { h = `${icon("folder")}<span style="color:var(--muted)">Sin carpeta</span>`; }
      btn.innerHTML = h + `<span style="color:var(--muted)">${icon("chevron")}</span>`;
    };
    paintBtn(cur);
    btn.onclick = ()=>{
      document.querySelectorAll(".fpick").forEach(x=>x.remove());
      const pop = document.createElement("div"); pop.className="fpick";
      const opt = (name)=>{ const m=name?S.metas.find(x=>x.nombre===name):null;
        return `<button data-n="${name?esc(name):''}">${name?(m&&m.color?`<span class="fdot" style="background:${esc(m.color)}"></span>`:icon("folder")):`${icon("folder")}`}${m&&m.emoji?`<span class="femo">${esc(m.emoji)}</span>`:""}${name?esc(name):"<span style='color:var(--muted)'>Sin carpeta</span>"}</button>`; };
      pop.innerHTML = opt(null) + S.metas.map(m=>opt(m.nombre)).join("")
        + `<button data-new style="color:var(--brand)">${icon("plus")} Nueva carpeta</button>`;
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      pop.style.left = Math.min(r.left, innerWidth-220)+"px"; pop.style.top=(r.bottom+6)+"px";
      pop.querySelectorAll("button[data-n]").forEach(b=> b.onclick=()=>{ const v=b.dataset.n||null; paintBtn(v); pop.remove(); pOpts.onPick&&pOpts.onPick(v); });
      pop.querySelector("[data-new]").onclick = async ()=>{ pop.remove();
        const n=(await askText({title:"Nueva carpeta",label:"Nombre",placeholder:"Ej. Cursos",confirmText:"Crear"}))?.trim();
        if(!n) return;
        if(!S.metas.some(m=>m.nombre===n)) await ensureRow(n);
        await load(); paintBtn(n); pOpts.onPick&&pOpts.onPick(n); };
      setTimeout(()=>{ const off=(e)=>{ if(!pop.contains(e.target)&&e.target!==btn){ pop.remove(); document.removeEventListener("mousedown",off);} }; document.addEventListener("mousedown",off); },30);
    };
    return btn;
  }

  await load(); render();
  return {
    get current(){ return S.current; },
    channelId(){ return S.channelId; },
    filter(list){ if(S.current==="__all") return list; if(S.current==="__none") return list.filter(x=>!x.folder); return list.filter(x=>x.folder===S.current); },
    meta(name){ return S.metas.find(m=>m.nombre===name) || null; },
    metas(){ return S.metas.slice(); },
    reload: async ()=>{ await load(); render(); },
    repaint: ()=>render(),
    setCurrent: (v)=>{ S.current=v; render(); },
    setChannel: async (id)=>{ S.channelId=id; S.current="__all"; await load(); render(); },
    ensureFolder: ensureRow,
    picker,
  };
}

function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
