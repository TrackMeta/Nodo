// ═══════════════════════════════════════════════════════════════════
//  Partes de lo que era Ajustes (31-oct, Rodrigo: «desaparece Ajustes»)
//  · «Nombre y logo» + «País y moneda» → Negocio, pestaña «Nombre, país y moneda»
//  · Meta + Google Sheets + uso de Supabase → Conexiones (antes Canales)
//  config.html quedó solo para reenviar enlaces viejos (y el regreso de Google).
// ═══════════════════════════════════════════════════════════════════
import { supa, toast, icon, confirmDialog } from "./shell.js";
const $ = (id) => document.getElementById(id);
// (28-oct) Ajustes pregunta el PAÍS del negocio, no la zona horaria: «America/Lima · UTC-5» no le dice nada a nadie.
// Cada país guarda la zona de su capital en channels.timezone (el motor la sigue leyendo igual). Los países con
// varias zonas dejan elegir la suya en «¿Tu negocio está en otra zona de …?».
const PAISES_TZ=[
  ["PE","🇵🇪","Perú","America/Lima"],["MX","🇲🇽","México","America/Mexico_City"],["CO","🇨🇴","Colombia","America/Bogota"],
  ["CL","🇨🇱","Chile","America/Santiago"],["AR","🇦🇷","Argentina","America/Argentina/Buenos_Aires"],["EC","🇪🇨","Ecuador","America/Guayaquil"],
  ["BO","🇧🇴","Bolivia","America/La_Paz"],["VE","🇻🇪","Venezuela","America/Caracas"],["PY","🇵🇾","Paraguay","America/Asuncion"],
  ["UY","🇺🇾","Uruguay","America/Montevideo"],["CR","🇨🇷","Costa Rica","America/Costa_Rica"],["PA","🇵🇦","Panamá","America/Panama"],
  ["GT","🇬🇹","Guatemala","America/Guatemala"],["SV","🇸🇻","El Salvador","America/El_Salvador"],["HN","🇭🇳","Honduras","America/Tegucigalpa"],
  ["NI","🇳🇮","Nicaragua","America/Managua"],["DO","🇩🇴","Rep. Dominicana","America/Santo_Domingo"],["PR","🇵🇷","Puerto Rico","America/Puerto_Rico"],
  ["ES","🇪🇸","España","Europe/Madrid"],["US","🇺🇸","Estados Unidos","America/New_York"],["BR","🇧🇷","Brasil","America/Sao_Paulo"],
];
const ZONAS_EXTRA={
  MX:[["America/Mexico_City","Centro (CDMX, Guadalajara, Monterrey)"],["America/Cancun","Quintana Roo (Cancún)"],["America/Mazatlan","Pacífico (Sinaloa, Nayarit)"],["America/Hermosillo","Sonora"],["America/Tijuana","Baja California (Tijuana)"]],
  US:[["America/New_York","Este (Nueva York, Miami)"],["America/Chicago","Centro (Chicago, Texas)"],["America/Denver","Montaña (Denver)"],["America/Los_Angeles","Pacífico (Los Ángeles)"]],
  BR:[["America/Sao_Paulo","Brasilia (São Paulo, Río)"],["America/Manaus","Amazonas (Manaos)"]],
  ES:[["Europe/Madrid","Península (Madrid)"],["Atlantic/Canary","Canarias"]],
  CL:[["America/Santiago","Continental (Santiago)"],["America/Punta_Arenas","Magallanes (Punta Arenas)"]],
};
// (29-oct) La moneda sale del país (no se elige): la de cada país.
const MONEDA_PAIS={PE:"PEN",MX:"MXN",CO:"COP",CL:"CLP",AR:"ARS",EC:"USD",BO:"BOB",VE:"USD",PY:"PYG",UY:"UYU",CR:"CRC",PA:"USD",GT:"GTQ",SV:"USD",HN:"HNL",NI:"NIO",DO:"DOP",PR:"USD",ES:"EUR",US:"USD",BR:"BRL"};
const paisDeZona=(tz)=>{ for(const p of PAISES_TZ){ if(p[3]===tz || (ZONAS_EXTRA[p[0]]||[]).some(z=>z[0]===tz)) return p[0]; } return null; };

const LOGO={ claude:"../assets/apps/claude.png", chatgpt:"../assets/apps/chatgpt.png", meta:"../assets/apps/meta.png", sheets:"../assets/apps/sheets.png" };
const st = { channelId:null, parte:null, box:null, channel:{}, secrets:{}, pendingLogo:null };
// Escribe en channels y COMPRUEBA que tocó la fila: `channels` es solo-admin por RLS, así que a
// un operador el UPDATE le afecta 0 filas sin error y el panel decía «guardado» sin guardar.
async function updCanal(patch){
  const { data, error }=await supa.from("channels").update(patch).eq("id",st.channelId).select("id");
  if(!error && !(data&&data.length)) return { error:{ message:"No se guardó: solo un administrador puede cambiar esto" } };
  return { error };
}
function esc(s){ return (s??"").toString().replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

// ── Uso de Supabase (barra del DUEÑO de la plataforma) ──────────────
// Llama a owner_usage() (RPC blindada: solo platform_admins). Si el usuario
// no es dueño, la función levanta excepción → el panel queda vacío/oculto.
const _MB=1024*1024;
const SUPA_PLANS={ free:{db:500*_MB, st:1024*_MB}, pro:{db:8*1024*_MB, st:100*1024*_MB} };
let _usoData=null;
function fmtBytes(b){ b=Number(b||0); if(b>=1024*_MB) return (b/(1024*_MB)).toFixed(2)+" GB"; if(b>=_MB) return (b/_MB).toFixed(1)+" MB"; if(b>=1024) return Math.round(b/1024)+" KB"; return b+" B"; }
function usoBar(label,used,limit){
  const pct=Math.min(100,(Number(used||0)/limit)*100);
  const cls=pct>=90?"r":pct>=70?"a":"g";
  const col=cls==="r"?"var(--red)":cls==="a"?"var(--amber)":"var(--green)";
  const pctTxt=pct<0.1?"< 0.1":pct.toFixed(pct<10?1:0);
  return `<div class="ubar"><div class="ub-top"><span class="ub-l">${label}</span><span class="ub-n">${fmtBytes(used)} / ${fmtBytes(limit)}</span></div>
    <div class="ub-track"><div class="ub-fill ${cls}" style="width:${pct.toFixed(1)}%"></div></div>
    <div class="ub-pct" style="color:${col}">${pctTxt}% usado</div></div>`;
}
async function renderUso(){
  const box=$("usoPanel"); if(!box) return;
  try{
    const { data, error }=await supa.rpc("owner_usage");
    if(error || !data){ box.innerHTML=""; return; }   // no es dueño → sin panel
    _usoData=data; drawUso();
  }catch(_){ box.innerHTML=""; }
}
function drawUso(){
  const box=$("usoPanel"); if(!box||!_usoData) return;
  const plan=localStorage.getItem("nodo.supaplan")||"free";
  const L=SUPA_PLANS[plan]||SUPA_PLANS.free;
  box.innerHTML=`<div class="uso">
    <div class="uso-hd"><h3>Uso de Supabase</h3><span class="tag">Dueño</span>
      <div class="uso-plan">
        <button data-p="free" class="${plan==="free"?"on":""}">Plan Gratis</button>
        <button data-p="pro" class="${plan==="pro"?"on":""}">Plan Pro</button>
      </div>
    </div>
    <p class="uso-sub">Espacio que ocupa Nodo en tu proyecto de Supabase. Cuando una barra pase ~80%, conviene subir al plan Pro.</p>
    <div class="uso-bars">
      ${usoBar("Base de datos", _usoData.db_bytes, L.db)}
      ${usoBar("Almacenamiento", _usoData.storage_bytes, L.st)}
    </div>
    <div class="uso-foot">${Number(_usoData.storage_files||0).toLocaleString("es-PE")} archivo(s) guardados.</div>
  </div>`;
  box.querySelectorAll(".uso-plan button").forEach(b=> b.onclick=()=>{ localStorage.setItem("nodo.supaplan", b.dataset.p); drawUso(); });
}

async function loadCfg(){
  const gen=(st.gen=(st.gen||0)+1);   // guardia anti-carrera al cambiar de bot
  // (1-nov, Rodrigo: «cambiar a Nombre, país y moneda es muy lento») Antes eran 4 pedidos en fila (~1,6 s): las 3
  // lecturas del canal van ahora a la vez, y el estado de las claves (una función del servidor, ~0,7-0,9 s) solo se
  // pide para Conexiones, la única parte que lo usa.
  const uno=(cols)=>supa.from("channels").select(cols).eq("id",st.channelId).maybeSingle().then(r=>r,()=>({}));
  const pSecretos = st.parte==="negocio" ? Promise.resolve(null)
    : callFn("channel-config",{ action:"status", channel_id:st.channelId }).then(r=>r?.secrets||{},()=>({}));
  const [r0, tcR, mrR, secretos] = await Promise.all([
    uno("nombre,logo_url,ia_provider,pixel_id,page_id,ad_account_id,ads_sync_error,buffer_default_seg,timezone,moneda,gsheets,negocio,ia_perfiles,entregas"),
    uno("usd_rate"), uno("moneda_reporte"), pSecretos ]);
  let { data:ch, error:chErr } = r0;
  if(chErr){ ({ data:ch, error:chErr } = await supa.from("channels").select("nombre,logo_url,ia_provider,pixel_id,page_id,buffer_default_seg,timezone,gsheets,negocio,ia_perfiles").eq("id",st.channelId).maybeSingle()); }
  if(chErr){ ({ data:ch, error:chErr } = await supa.from("channels").select("nombre,logo_url,ia_provider,pixel_id,page_id,buffer_default_seg,timezone,gsheets").eq("id",st.channelId).maybeSingle()); }
  if(chErr){ ({ data:ch } = await supa.from("channels").select("nombre,ia_provider,pixel_id,page_id,buffer_default_seg").eq("id",st.channelId).maybeSingle()); }
  if(gen!==st.gen) return;   // cambiaste de bot mientras cargaba: esta carga ya no manda
  st.channel = ch || {};
  // El tipo de cambio (0089) y la moneda de los reportes (0141) se piden APARTE a propósito: son columnas nuevas y si
  // se pidieran junto al resto, un proyecto sin la migración tiraría el select entero al fallback.
  if(tcR?.data) st.channel.usd_rate=tcR.data.usd_rate;
  if(mrR?.data) st.channel.moneda_reporte=mrR.data.moneda_reporte;
  if(secretos) st.secrets=secretos; else if(!st.secrets) st.secrets={};
  render();
}

// La página dueña dice qué parte va y dónde; cada parte se pinta en su propia caja con su h2 y su Guardar, así
// puede volver a pintarse sola (Google Sheets al cambiar de método, País y moneda tras guardar) sin borrar a las demás.
function render(){
  const b=st.box; if(!b || !b.isConnected) return;   // te fuiste de la página o de la pestaña mientras cargaba
  b.classList.add("ajx");
  if(st.parte==="negocio"){
    renderDatos(b);
  } else {
    b.innerHTML=`<div id="secMeta"></div><div id="secSheets" class="sec"></div><div id="usoPanel" class="sec"></div>`;
    renderPixel($("secMeta")); renderGsheets($("secSheets")); renderUso();
  }
}

// parte: "negocio" (nombre y logo + país y moneda; va en Negocio) o "conexiones" (Meta, Google Sheets y uso de
// Supabase; va en Conexiones). Se vuelve a llamar al cambiar de bot.
export async function montarAjustes(box, parte, channelId){
  if(!document.getElementById("ajxCss")){
    const l=document.createElement("link"); l.id="ajxCss"; l.rel="stylesheet"; l.href=new URL("./ajustes-partes.css?v=4", import.meta.url).href;
    document.head.appendChild(l);
  }
  st.box=box; st.parte=parte; st.channelId=channelId;
  if(channelId) await loadCfg();   // loadCfg termina en render(), que no pinta si ya desmontaron
}

// La página cambió a otra pestaña: lo que todavía esté cargando ya no debe pintar encima.
export function desmontarAjustes(){ st.box=null; }

// Retorno del login de Google: gsheets-callback vuelve con ?gs=… a la página vieja de Ajustes, que lo pasa a Conexiones.
// Se llama ANTES de montarAjustes(…, "conexiones").
export async function volverDeGoogle(channelId){
  st.channelId=channelId;
  // Retorno del login de Google (gsheets-callback redirige con ?gs=...).
  let gsRet=new URLSearchParams(location.search).get("gs");
  if(gsRet){
    st.gsMethod="oauth";
    // 🔒 Google ya dio el permiso, pero queda PENDIENTE hasta que lo confirme esta sesión (la
    // del mismo usuario que inició la conexión): así un tercero al que le pasaron el enlace de
    // Google no conecta su cuenta en un canal ajeno. Ver gsheets-connect → `confirmar`.
    if(gsRet==="confirmar"){
      const gc=new URLSearchParams(location.search).get("gc")||"";
      history.replaceState(null,"",location.pathname);   // el código no se queda en la barra
      try{
        const r=await callFn("gsheets-connect",{ confirmar:gc, channel_id:st.channelId });
        gsRet=r.hoja||"ok";
      }catch(e){ gsRet=""; toast(e.message||"No se pudo terminar de conectar Google. Reintenta.",true); }
    }
    if(!gsRet){ /* ya se avisó arriba */ }
    else if(gsRet==="ok") toast("Google conectado");
    else if(gsRet==="creada") toast("Google conectado — te creé la hoja «Ventas Nodo» con sus 3 pestañas");
    else if(gsRet==="recreada") toast("Tu hoja anterior ya no existía: te creé una nueva con sus 3 pestañas");
    else if(gsRet==="sin_refresh") toast("Google no devolvió permiso permanente. Reintenta y acepta todos los permisos.",true);
    else if(gsRet==="expirado") toast("El enlace expiró, vuelve a conectar.",true);
    else if(gsRet==="sin_guardar") toast("Google dio el permiso pero no pudimos guardarlo acá. Reintenta; si sigue, avísanos.",true);
    else toast("No se pudo conectar con Google. Reintenta.",true);
    history.replaceState(null,"",location.pathname);
  }
}

// ── Entregas movidas a la sección Negocio → Entrega y logística (negocio.html).

// Monedas frecuentes (código ISO + símbolo + país). Igual que en Productos.
const CURRENCIES=[
  ["PEN","S/","Perú — Sol"],["USD","$","EE. UU. — Dólar"],["MXN","$","México — Peso"],
  ["COP","$","Colombia — Peso"],["ARS","$","Argentina — Peso"],["CLP","$","Chile — Peso"],
  ["BOB","Bs","Bolivia — Boliviano"],["EUR","€","Europa — Euro"],["BRL","R$","Brasil — Real"],
  ["UYU","$U","Uruguay — Peso"],["PYG","₲","Paraguay — Guaraní"],["VES","Bs","Venezuela — Bolívar"],
  ["GTQ","Q","Guatemala — Quetzal"],["CRC","₡","Costa Rica — Colón"],["DOP","RD$","Rep. Dominicana — Peso"],
  ["HNL","L","Honduras — Lempira"],["NIO","C$","Nicaragua — Córdoba"],["PAB","B/.","Panamá — Balboa"],
  ["GBP","£","Reino Unido — Libra"],["CAD","$","Canadá — Dólar"],
];
// ── Nombre, país y moneda (Negocio) ──────────────────────────────────
// (31-oct, Rodrigo: «ordénala») Una sola pantalla corta con UN Guardar: «Tu bot» (logo + nombre), «País y hora» y
// «Moneda» (moneda de tus reportes + tipo de cambio). Antes eran «Nombre y logo» con su vista previa del sidebar y
// su Guardar, y debajo «País y moneda» en tres tarjetas con otro Guardar: dos botones para una misma página.
// El "Retraso de respuesta del bot" se movió a IA › Vendedor IA.
function renderDatos(b){
  if(!b) return;   // ya cambiaste de sección mientras esto cargaba: no hay dónde pintar
  const c=st.channel||{};
  const tz = c.timezone || "America/Lima";
  const mon = c.moneda || "PEN";
  const logo=c.logo_url||"../assets/logo-128.png";
  const urlVal=(c.logo_url||"").startsWith("data:")?"":(c.logo_url||"");
  // 📊 La moneda de los reportes vale para Inicio y Rendimiento, en cualquier navegador (antes: botón «Ver en
  // dólares» de Inicio, guardado solo en ese navegador). Vacío = la de tu país.
  let repElegida = c.moneda_reporte==="USD" ? "USD" : "";
  st.pendingLogo=null; st.removeLogo=false;
  b.innerHTML=`
    <h2>Nombre, país y moneda</h2><p class="sub">Cómo se llama este bot, dónde está tu negocio y en qué moneda ves tus números.</p>
    <div class="card">
      <div class="chd"><span class="ico">${icon("edit")}</span><span class="nm">Tu bot</span></div>
      <div class="dbot">
        <button type="button" class="dlogo" id="d_drop" title="Cambiar el logo (o suelta una imagen acá)"><img id="d_logo" src="${esc(logo)}" alt=""/><span class="dcam">${icon("camera","")}</span></button>
        <div class="dbot-f">
          <label for="d_nombre">Nombre del bot</label>
          <input class="in" id="d_nombre" value="${esc(c.nombre||"")}" maxlength="40" autocomplete="off"/>
          <div class="dlinks">
            <button type="button" class="linkish" id="d_cambiar">Cambiar logo</button>
            <button type="button" class="linkish" id="d_url">${urlVal?"Ocultar la URL":"Pegar una URL"}</button>
            <button type="button" class="linkish" id="d_quitar" style="color:var(--muted)">Usar el de Nodo</button>
          </div>
          <input class="in" id="d_logoUrl" value="${esc(urlVal)}" placeholder="https://.../logo.png" style="margin-top:8px;${urlVal?"":"display:none"}"/>
        </div>
      </div>
      <p class="fhelp" style="margin-top:12px">Así ves este bot en el panel y en el selector de bots. Tus clientes no lo ven.</p>
      <input type="file" id="d_file" accept="image/png,image/jpeg,image/webp" hidden/>
    </div>
    <div class="card">
      <div class="chd"><span class="ico">${icon("globe")}</span><span class="nm">País y hora</span></div>
      <label>País</label>
      <select class="in" id="g_pais" style="max-width:340px">${PAISES_TZ.map(([cd,fl,nm])=>`<option value="${cd}" ${cd===(paisDeZona(tz)||"")?"selected":""}>${nm}</option>`).join("")}${paisDeZona(tz)?"":`<option value="" selected>Otra zona (${esc(tz)})</option>`}</select>
      <div id="g_zonaBox" style="margin-top:10px"></div>
      <div class="dline" id="g_hora"></div>
      <p class="fhelp">Tus reportes y avisos usan su hora. Las versiones de otros países usan la de su país.</p>
    </div>
    <div class="card">
      <div class="chd"><span class="ico" style="background:var(--green-bg);color:var(--green)">${icon("dollar")}</span><span class="nm">Moneda</span></div>
      <div id="g_repBox">
        <label>Tus reportes en</label>
        <div class="opts" id="g_rep"></div>
        <p class="fhelp">Para Inicio y Rendimiento. Tus clientes siguen viendo y pagando en su moneda.</p>
      </div>
      <div class="dline" id="g_tcVal" style="margin-top:14px"></div>
      <details id="g_tcMas" style="margin-top:8px;display:none"><summary style="cursor:pointer;font-size:12.5px;color:var(--brand);font-weight:600">Ver las demás monedas</summary><div id="g_tcLista"></div></details>
    </div>
    <div class="acts"><button class="btn primary" id="d_guardar" disabled>Guardar</button></div>`;

  // ── Logo ──
  const pintaLogo=(src)=>{ $("d_logo").src=src||"../assets/logo-128.png"; };
  const logoAhora=()=> st.pendingLogo || (st.removeLogo ? "" : ($("d_logoUrl").value.trim() || (String(c.logo_url||"").startsWith("data:")?String(c.logo_url):"")));
  $("d_drop").onclick=()=>$("d_file").click();
  $("d_cambiar").onclick=()=>$("d_file").click();
  $("d_file").onchange=(e)=>handleLogoFile(e.target.files[0],(d)=>{ pintaLogo(d); revisa(); });
  // Arrastrar y soltar: es como se mueve un logo de verdad, sin pasar por el explorador.
  const dz=$("d_drop");
  ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,(e)=>{ e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,(e)=>{ e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop",(e)=>{ const f=e.dataTransfer?.files?.[0]; if(f) handleLogoFile(f,(d)=>{ pintaLogo(d); revisa(); }); });
  $("d_url").onclick=()=>{ const i=$("d_logoUrl"); const ver=i.style.display==="none"; i.style.display=ver?"":"none"; $("d_url").textContent=ver?"Ocultar la URL":"Pegar una URL"; if(ver) i.focus(); };
  $("d_logoUrl").oninput=()=>{ st.pendingLogo=null; st.removeLogo=false; pintaLogo($("d_logoUrl").value.trim()); revisa(); };
  // «Usar el de Nodo» manda logo_url:null a propósito: si el actual es una imagen subida, vaciar la URL no alcanza
  // (el guardado conserva la imagen justo para no borrarla sin querer).
  $("d_quitar").onclick=()=>{ st.pendingLogo=null; st.removeLogo=true; $("d_logoUrl").value=""; pintaLogo(""); revisa(); };
  $("d_nombre").oninput=()=>revisa();

  // ── País y hora ── la zona es la de la capital, o la que elija si su país tiene varias. Sin país reconocido, la de antes.
  let zonaElegida=tz;
  const pintaZona=()=>{
    const cd=$("g_pais").value, extra=ZONAS_EXTRA[cd]||[];
    if(cd){ const cap=PAISES_TZ.find(p=>p[0]===cd)[3]; if(paisDeZona(zonaElegida)!==cd) zonaElegida=cap; }
    $("g_zonaBox").innerHTML = extra.length>1
      ? `<details ${zonaElegida!==extra[0][0]?"open":""}><summary style="cursor:pointer;font-size:12.5px;color:var(--brand);font-weight:600">¿Tu negocio está en otra zona horaria de ${esc(PAISES_TZ.find(p=>p[0]===cd)[2])}?</summary>
          <select class="in" id="g_zona" style="max-width:340px;margin-top:8px">${extra.map(([z,l])=>`<option value="${z}" ${z===zonaElegida?"selected":""}>${esc(l)}</option>`).join("")}</select></details>`
      : "";
    const gz=$("g_zona"); if(gz) gz.onchange=()=>{ zonaElegida=gz.value; pintaHora(); revisa(); };
    pintaHora();
  };
  const NOM={PEN:"Sol",USD:"Dólar",MXN:"Peso mexicano",COP:"Peso colombiano",ARS:"Peso argentino",CLP:"Peso chileno",UYU:"Peso uruguayo",DOP:"Peso dominicano",EUR:"Euro",BRL:"Real"};
  const pintaHora=()=>{
    let h=""; try{ h=new Date().toLocaleTimeString("es-PE",{ timeZone:zonaElegida, hour:"numeric", minute:"2-digit" }); }catch(_){}
    const m=monedaElegida(), cu=CURRENCIES.find(x=>x[0]===m)||["",m,m];
    $("g_hora").innerHTML = (h ? `${icon("clock","di")} Tu hora ahora: <b>${esc(h)}</b><span class="dsep"></span>` : "") + `${icon("dollar","di")} Cobras en <b>${esc(cu[1])} ${esc(NOM[m]||String(cu[2]).replace(/^.*— /,""))}</b>`;
  };
  // 💵 La moneda sale del país (Otra zona → la que ya tenía).
  const monedaElegida=()=>MONEDA_PAIS[$("g_pais").value]||mon;

  // ── Moneda ── 💱 El tipo de cambio no se escribe: lo baja el scheduler cada día (tabla tipos_cambio). Se muestra el
  // último de cada moneda; sin la tabla todavía, el que tenga el bot.
  let _cambios={};
  supa.from("tipos_cambio").select("fecha,moneda,por_usd").order("fecha",{ascending:false}).limit(60)
    .then(({data})=>{ for(const r of (data||[])) if(!_cambios[r.moneda]) _cambios[r.moneda]=r; if($("g_tcVal")) pintaMoneda(); }, ()=>{});
  const cambioDe=(m)=>_cambios[m]?Number(_cambios[m].por_usd):(m===mon&&Number(st.channel?.usd_rate)>0?Number(st.channel.usd_rate):null);
  const pintaMoneda=()=>{
    const m=monedaElegida(), cu=CURRENCIES.find(x=>x[0]===m)||["",m,m];
    // Si tu país ya cobra en dólares no hay nada que elegir (la lista de monedas igual sirve).
    $("g_repBox").style.display = m==="USD" ? "none" : "";
    const nomPlural={PEN:"Soles",MXN:"Pesos mexicanos",COP:"Pesos colombianos",ARS:"Pesos argentinos",CLP:"Pesos chilenos",UYU:"Pesos uruguayos",DOP:"Pesos dominicanos",EUR:"Euros",BRL:"Reales"}[m]||String(cu[2]).replace(/^.*— /,"");
    const tick=icon("check","tick");
    $("g_rep").innerHTML=
      `<button type="button" class="opt ${repElegida?"":"on"}" data-r="">${tick}<b>${esc(cu[1])} ${esc(nomPlural)}</b><span>La de tu país.</span></button>`+
      `<button type="button" class="opt ${repElegida==="USD"?"on":""}" data-r="USD">${tick}<b>$ Dólares</b><span>Con el cambio del día de cada venta.</span></button>`;
    $("g_rep").querySelectorAll(".opt").forEach(x=> x.onclick=()=>{ repElegida=x.dataset.r; pintaMoneda(); revisa(); });
    const tcv=cambioDe(m), fe=_cambios[m]?.fecha;
    let feTxt=""; try{ if(fe) feTxt=new Date(fe+"T12:00:00Z").toLocaleDateString("es-PE",{ day:"numeric", month:"long" }); }catch(_){}
    $("g_tcVal").innerHTML = m==="USD" ? `${icon("dollar","di")} Tu negocio usa dólares: no necesita tipo de cambio.`
      : tcv ? `${icon("refresh","di")} Tipo de cambio: <b>1 USD = ${esc(cu[1])} ${esc(tcv.toLocaleString("es-PE",{ maximumFractionDigits: tcv<100?2:0 }))}</b>${feTxt?` · al ${esc(feTxt)}`:""}. Se actualiza solo cada día.`
      : `${icon("refresh","di")} El tipo de cambio se actualiza solo durante el día.`;
    pintaLista(m, cu[1]);
  };
  // 🌎 Las 19 monedas que Nodo baja cada día (tipos_cambio), plegadas: cuánto vale un dólar en cada una y, si tu negocio
  // no es en dólares, cuánto vale cada una en tu moneda — que es lo que Nodo hace al convertir (pasa por el dólar).
  const pintaLista=(m, sym)=>{
    const filas=Object.values(_cambios).filter(r=>r.moneda!=="USD" && Number(r.por_usd)>0);
    $("g_tcMas").style.display = filas.length ? "" : "none";
    if(!filas.length) return;
    const tuyo=Number(_cambios[m]?.por_usd)||0, enTuya = m!=="USD" && tuyo>0;
    const f=(n)=>Number(n).toLocaleString("es-PE",{ maximumFractionDigits: n<1?4:(n<100?2:0) });
    const orden=["PEN","MXN","COP","CLP","ARS","BOB","BRL","UYU","PYG","VES","CRC","GTQ","HNL","NIO","DOP","PAB","EUR","GBP","CAD"];
    const pos=(x)=>{ const i=orden.indexOf(x); return i<0?99:i; };   // la tuya primero, después por cercanía
    filas.sort((a,b)=>(a.moneda===m?-1:b.moneda===m?1:0) || pos(a.moneda)-pos(b.moneda));
    $("g_tcLista").innerHTML=`<table class="tclist"><thead><tr><th>Moneda</th><th class="r">1 USD =</th>${enTuya?`<th class="r">En ${esc(sym)}</th>`:""}</tr></thead><tbody>${filas.map(r=>{
      const c=CURRENCIES.find(x=>x[0]===r.moneda)||[r.moneda,r.moneda,r.moneda], v=Number(r.por_usd);
      const nom=String(c[2]).replace(/ — /," · ");
      return `<tr class="${r.moneda===m?"yo":""}"><td>${esc(nom)} <span class="cod">${esc(r.moneda)}</span></td><td class="r">${esc(c[1])} ${esc(f(v))}</td>${enTuya?`<td class="r">${r.moneda===m?"—":esc(sym)+" "+esc(f(tuyo/v))}</td>`:""}</tr>`;
    }).join("")}</tbody></table><p class="fhelp" style="margin-top:8px">Valores de hoy. Nodo convierte cada venta y cada gasto con el de su día.</p>`;
  };
  $("g_pais").onchange=()=>{ pintaZona(); pintaMoneda(); revisa(); }; pintaZona(); pintaMoneda();

  // ── Un solo Guardar ── nace apagado y se enciende solo si algo cambió: así se ve de un vistazo si queda algo sin guardar.
  const foto=()=>JSON.stringify([$("d_nombre").value.trim(), logoAhora(), $("g_pais").value, zonaElegida, repElegida]);
  const ini=foto();
  function revisa(){ const btn=$("d_guardar"); if(btn) btn.disabled = !$("d_nombre").value.trim() || foto()===ini; }
  $("d_guardar").onclick=async(e)=>{
    const btn=e.currentTarget;
    const nombre=$("d_nombre").value.trim();
    if(!nombre){ toast("El nombre no puede estar vacío",true); return; }
    // 🌎 Cambiar de país: los productos que ya venden siguen en el país de antes (con su moneda y su hora). Si no,
    // un bot de Perú que pasa a «México» empezaría a cobrar en pesos lo que vendía en soles.
    const paisAntes=paisDeZona(tz), paisNuevo=$("g_pais").value||paisAntes;
    let fijar=false;
    if(paisAntes && paisNuevo && paisAntes!==paisNuevo){
      const nA=(PAISES_TZ.find(p=>p[0]===paisAntes)||[])[2]||paisAntes, nN=(PAISES_TZ.find(p=>p[0]===paisNuevo)||[])[2]||paisNuevo;
      if(!await confirmDialog({ title:"Cambiar tu país",
        message:`Tus reportes y avisos pasan a la hora de ${nN}. Los productos que ya tienes se quedan como versiones de ${nA}: siguen cobrando en ${mon} con la hora de ${nA}. Los productos nuevos serán de ${nN}.`,
        confirmText:"Cambiar" })) return;
      fijar=true;
    }
    btn.disabled=true; btn.textContent="Guardando…";
    const listo=()=>{ btn.textContent="Guardar"; revisa(); };
    if(fijar){
      try{
        const { data:ps }=await supa.from("products").select("id, config").eq("channel_id",st.channelId);
        for(const p of (ps||[])){
          const cfg={ ...(p.config||{}) }; if(cfg.pais) continue;
          cfg.pais=paisAntes; if(!cfg.moneda && mon!==(MONEDA_PAIS[paisAntes]||"")) cfg.moneda=mon;
          await supa.from("products").update({ config:cfg }).eq("id",p.id);
        }
      }catch(_){ listo(); toast("No se pudieron fijar tus productos al país de antes",true); return; }
    }
    // El campo de URL va VACÍO cuando el logo actual es una imagen subida (data-URI): si solo cambias el nombre y
    // guardas, se mandaba logo_url:null y el logo se borraba. Se conserva.
    const logoActual=String(c.logo_url||"");
    const logo_url = st.removeLogo ? null
      : (st.pendingLogo || ($("d_logoUrl").value.trim() || (logoActual.startsWith("data:") ? logoActual : null)));
    const monNueva=monedaElegida(), tc=cambioDe(monNueva);
    const patch={ nombre, logo_url, timezone:zonaElegida, moneda:monNueva,
      usd_rate: (monNueva!=="USD" && tc>0) ? +tc.toFixed(4) : null,
      moneda_reporte: (repElegida==="USD" && monNueva!=="USD") ? "USD" : null };
    let { error }=await updCanal(patch), avisado=false;
    // Sin la migración 0141 se guarda lo demás y se dice qué falta.
    if(error && /moneda_reporte/.test(error.message)){
      delete patch.moneda_reporte; ({ error }=await updCanal(patch));
      if(!error){ avisado=true; toast("Guardado; falta aplicar la migración 0141 para la moneda de tus reportes",true); }
    }
    if(error){ listo(); toast(error.message,true); return; }
    Object.assign(st.channel, patch); st.pendingLogo=null; st.removeLogo=false;
    // El nombre y el logo también están arriba en la barra y en el selector de bot: sin tocarlos, decía «guardado»
    // y seguía el nombre y el logo viejos hasta recargar.
    const src=logo_url||"../assets/logo-128.png";
    for(const id of ["nodoLogo","nodoBotLogo"]){ const el=document.getElementById(id); if(el) el.src=src; }
    for(const id of ["nodoBrandName","nodoBotName"]){ const el=document.getElementById(id); if(el) el.textContent=nombre; }
    const opt=document.querySelector(`#nodoBot option[value="${st.channelId}"]`); if(opt) opt.textContent=nombre;
    window.dispatchEvent(new CustomEvent("nodo:marca",{ detail:{ nombre, logo_url } }));
    if(!avisado) toast("Guardado");
    renderDatos(b);   // la página recuerda lo guardado (si no, un segundo cambio de país no avisaba)
  };
}

// ── Google Sheets (vía Apps Script — sin claves ni Google Cloud) ─────
// El usuario pega un mini-script en su propia hoja y lo publica como "app
// web"; eso da una URL a la que Nodo hace POST con cada fila. Simple y gratis.
const GS_SCRIPT = `function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = data.hoja ? (ss.getSheetByName(data.hoja) || ss.insertSheet(data.hoja)) : ss.getSheets()[0];
  var fila = data.fila || {}, buscar = data.buscar || {};
  var headers = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  function col(name) {
    var i = headers.indexOf(name);
    if (i === -1) { headers.push(name); sh.getRange(1, headers.length).setValue(name); i = headers.length - 1; }
    return i;
  }
  if (headers.join('') === '') { headers = Object.keys(buscar).concat(Object.keys(fila)); if (headers.length) sh.getRange(1, 1, 1, headers.length).setValues([headers]); }
  Object.keys(buscar).forEach(col); Object.keys(fila).forEach(col);

  if (data.accion === 'update') {
    var last = sh.getLastRow();
    var rows = last > 1 ? sh.getRange(2, 1, last - 1, headers.length).getValues() : [];
    for (var r = 0; r < rows.length; r++) {
      var match = true;
      for (var b in buscar) { if (String(rows[r][headers.indexOf(b)]) !== String(buscar[b])) { match = false; break; } }
      if (match) {
        Object.keys(fila).forEach(function (k) { sh.getRange(r + 2, headers.indexOf(k) + 1).setValue(fila[k]); });
        return out({ ok: true, updated: r + 2 });
      }
    }
    var merged = {}; for (var x in buscar) merged[x] = buscar[x]; for (var y in fila) merged[y] = fila[y];
    sh.appendRow(headers.map(function (h) { return merged[h] !== undefined ? merged[h] : ''; }));
    return out({ ok: true, appended: true });
  }

  sh.appendRow(headers.map(function (h) { return fila[h] !== undefined ? fila[h] : ''; }));
  return out({ ok: true });
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }`;
// Solo un ID válido de Sheets ([A-Za-z0-9_-]). Sin esto, un valor crudo con /, ?, # se
// interpolaba sin encodear en el path de la API (inyección de segmentos/query, mismo host).
function sheetIdFrom(v){ if(/^\s*[a-z][a-z0-9+.-]*:/i.test(v||"") && !/^\s*https:\/\/docs\.google\.com\//i.test(v)) return ""; // «javascript:…/d/x» pasaba y quedaba de enlace en «Abrir»
  const m=(v||"").match(/\/d\/([a-zA-Z0-9-_]+)/); const raw=m?m[1]:(v||"").trim(); return /^[a-zA-Z0-9_-]+$/.test(raw)?raw:""; }
function renderGsheets(b){
  const g=(st.channel&&st.channel.gsheets)||{};
  const curMode = g.mode || (g.webhook_url ? "apps_script" : (g.google_email ? "oauth" : null));
  const method = st.gsMethod || curMode || "oauth";
  // El encabezado va como en las demás pestañas (h2 + subtítulo). Antes repetía el logo y el
  // nombre «Google Sheets» justo debajo de la pestaña que ya dice «Google Sheets» con el mismo
  // logo: dos veces lo mismo, a dos centímetros.
  b.innerHTML=`
    <h2>Google Sheets</h2>
    <p class="sub">Cada venta cerrada se escribe sola en tu hoja. También puedes escribir en ella desde un flujo con el nodo ${icon("sheet")} Google Sheets.</p>
    ${g.last_error?`<div style="display:flex;gap:10px;align-items:flex-start;background:var(--red-bg,#2c1615);border:1px solid var(--red);border-radius:11px;padding:11px 13px;margin:0 0 12px;font-size:12.5px;line-height:1.5;color:var(--text)"><span style="color:var(--red);font-weight:800;flex:none">${icon("alert")}</span><div><b>La última venta no llegó a tu hoja.</b> ${esc(g.last_error)}${g.last_error_at?` <span style="color:var(--muted)">(${esc(new Date(g.last_error_at).toLocaleString("es-PE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}))})</span>`:""}<br>Si Google revocó el acceso, vuelve a conectar la cuenta abajo. El cartel se apaga solo cuando una venta vuelva a sincronizar.</div></div>`:""}
    <div class="seg">
      <button class="${method==='oauth'?'on':''}" data-gm="oauth">${icon("link")} Acceder con Google <span class="mut">recomendado</span></button>
      <button class="${method==='apps_script'?'on':''}" data-gm="apps_script">${icon("note")} Apps Script <span class="mut">avanzado</span></button>
    </div>
    <div id="gsBody"></div>`;
  b.querySelectorAll("[data-gm]").forEach(btn=> btn.onclick=()=>{ st.gsMethod=btn.dataset.gm; renderGsheets(b); });
  if(method==="oauth") renderGsOauth($("gsBody"), g); else renderGsScript($("gsBody"), g);
}

// ── Método 1: Acceder con Google (OAuth) ────────────────────────────
function renderGsOauth(box, g){
  const connected = g.mode==="oauth" && g.google_email;
  box.innerHTML=`
    <div class="card ${connected?'on':''}">
      <div class="chd">
        <span class="ico" style="background:transparent;border:1px solid var(--border)"><img src="${LOGO.sheets}" alt=""/></span>
        <div><div class="nm">Acceder con Google</div><div class="desc" style="margin:2px 0 0">Un clic y listo, sin claves ni scripts.</div></div>
        <span class="badge ${connected?'on':''}" style="margin-left:auto">${connected?'Conectada':'Sin conectar'}</span>
      </div>
      ${connected?`
        <div class="desc" style="margin-top:12px">Conectada con <b>${esc(g.google_email)}</b>.</div>
        <div id="gsoEstado"></div>
        <label>Enlace de la hoja donde escribir</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="in" id="gso_url" value="${esc(g.spreadsheet_url||'')}" placeholder="https://docs.google.com/spreadsheets/d/1AbC.../edit" style="flex:1;min-width:0"/>
          ${g.spreadsheet_url?`<a class="btn" id="gsoOpen" href="${esc(g.spreadsheet_url)}" target="_blank" rel="noopener"
             style="flex:none;display:inline-flex;align-items:center;gap:7px;text-decoration:none">${icon("link")} Abrir</a>`:""}
        </div>
        <div style="border:1px solid var(--border);border-radius:11px;padding:12px 13px;margin-top:14px;font-size:12.5px;color:var(--muted);line-height:1.6">
          <b style="color:var(--text)">No tienes que preparar nada.</b> Nodo usa tres pestañas en tu hoja:
          <div class="tabpills">
            <span class="tabpill"><i style="background:#8c5cb3"></i>Digital</span>
            <span class="tabpill"><i style="background:#2b80ff"></i>Lima</span>
            <span class="tabpill"><i style="background:#1c9e75"></i>Provincia</span>
          </div>
          Una fila por <b>venta cobrada</b>; lo que está en proceso o se cayó no entra.
        </div>
        <div class="acts" style="margin-top:14px">
          <button class="btn primary" id="gsoSave">Guardar hoja</button>
          <button class="btn" id="gsoTest">Revisar las pestañas</button>
          <button class="btn" id="gsoNew">${icon("plus")} Crear una hoja nueva</button>
          <button class="btn danger" id="gsoDisc" style="margin-left:auto">Desconectar</button>
        </div>`
      :`
        <div class="desc" style="margin-top:12px">Inicia sesión con la cuenta de Google dueña de tu hoja y dale permiso. Nodo escribirá las filas por ti. La primera vez Google puede mostrar “app no verificada” → <b>Avanzado → Continuar</b> (es tu propia app, es seguro).</div>
        <div class="acts"><button class="btn primary" id="gsoConnect">${icon("link")} Conectar con Google</button></div>`}
      <div class="desc" id="gsoOut" style="margin-top:12px"></div>
    </div>`;
  const conn=$("gsoConnect");
  if(conn) conn.onclick=async(e)=>{
    e.target.disabled=true; const old=e.target.textContent; e.target.textContent="Abriendo Google…";
    try{ const r=await callFn("gsheets-connect",{ channel_id:st.channelId }); if(r&&r.url) location.href=r.url; else throw new Error(r?.detalle||"no se pudo iniciar"); }
    catch(err){ $("gsoOut").innerHTML=`<span style="color:var(--red)">${esc(err.message||"error")}</span>${/sin_configurar|CLIENT_ID/.test(err.message||"")?" — falta que el administrador configure el cliente OAuth de Google.":""}`; e.target.disabled=false; e.target.textContent=old; }
  };
  // Guardar la hoja la PREPARA sola: pegas el enlace y ya está lista. Pedirle
  // al usuario que cree pestañas y tipee encabezados a mano era regalarle un
  // trabajo que la app puede hacer en un segundo (y que se hace mal).
  const save=$("gsoSave");
  if(save) save.onclick=async(e)=>{
    const url=$("gso_url").value.trim(); const id=sheetIdFrom(url);
    if(!id){ toast("Pega el enlace de la hoja",true); return; }
    const out=$("gsoOut"); out.innerHTML="";
    await saveGsheets(e.target, { ...g, connected:true, mode:"oauth", spreadsheet_url:url, spreadsheet_id:id });
    await prepararHoja(id, out);
  };
  const test=$("gsoTest");
  if(test) test.onclick=async(e)=>{
    const id=sheetIdFrom($("gso_url").value.trim()); if(!id){ toast("Guarda primero la hoja",true); return; }
    const out=$("gsoOut"); e.target.disabled=true; const old=e.target.textContent; e.target.textContent="Preparando…";
    await prepararHoja(id, out);
    e.target.disabled=false; e.target.textContent=old;
  };
  const prepararHoja=async(id,out)=>{
    out.innerHTML=`<span style="color:var(--muted)">Preparando tu hoja…</span>`;
    try{
      const r=await callFn("gsheets-test",{ preparar:true, channel_id:st.channelId, spreadsheet_id:id });
      if(!r||!r.ok){ out.innerHTML=`<span style="color:var(--red)">${esc((r&&r.detalle)||"No se pudo preparar la hoja")}</span>`; return; }
      const nuevas=(r.creadas||[]);
      out.innerHTML=`<span style="color:var(--green)">Tu hoja está lista.</span>
        ${nuevas.length?`Se crearon las pestañas <b>${nuevas.map(esc).join("</b>, <b>")}</b>.`
                       :`Las pestañas <b>Digital</b>, <b>Lima</b> y <b>Provincia</b> ya estaban.`}
        Los encabezados quedaron puestos y la primera fila fija.`;
    }catch(err){ out.innerHTML=`<span style="color:var(--red)">${esc(err.message||"error")}</span>`; }
  };
  // Crear la hoja desde acá: conectar Google daba solo el PERMISO y había que crear la hoja en
  // Drive y pegar el enlace. La vieja no se borra: solo dejan de llegarle ventas.
  const crearNueva=async(btn, sinPreguntar)=>{
    const tiene=!!g.spreadsheet_id;
    if(tiene && !sinPreguntar && !await confirmDialog({ title:"Crear una hoja nueva",
      message:"Se crea una hoja nueva con las pestañas Digital, Lima y Provincia en orden, y las ventas empiezan a ir ahí. La hoja actual no se borra: se queda en tu Drive con lo que ya tiene.",
      confirmText:"Crear hoja" })) return;
    const out=$("gsoOut"); const old=btn?btn.innerHTML:""; if(btn){ btn.disabled=true; btn.textContent="Creando…"; }
    out.innerHTML=`<span style="color:var(--muted)">Creando tu hoja en Google…</span>`;
    try{
      const r=await callFn("gsheets-test",{ crear:true, channel_id:st.channelId });
      if(!r||!r.ok) throw new Error((r&&r.detalle)||"No se pudo crear la hoja");
      st.channel.gsheets={ ...(st.channel.gsheets||{}), spreadsheet_id:r.spreadsheet_id, spreadsheet_url:r.spreadsheet_url };
      delete st.channel.gsheets.last_error; delete st.channel.gsheets.last_error_at;
      toast(`Listo: «${r.titulo}» creada y conectada`);
      render();
    }catch(err){ out.innerHTML=`<span style="color:var(--red)">${esc(err.message||"error")}</span>`; if(btn){ btn.disabled=false; btn.innerHTML=old; } }
  };
  const nueva=$("gsoNew"); if(nueva) nueva.onclick=(e)=>crearNueva(e.currentTarget);
  // ¿La hoja guardada sigue existiendo? Una hoja borrada seguía diciendo «Conectada» y cada venta
  // se perdía; el botón «Abrir» llevaba a «el archivo fue eliminado».
  const est=$("gsoEstado");
  if(est){
    const aviso=(txt)=>{ est.innerHTML=`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--red-bg,#2c1615);border:1px solid var(--red);border-radius:11px;padding:11px 13px;margin-top:12px;font-size:12.5px;line-height:1.5;color:var(--text)"><span style="color:var(--red);flex:none">${icon("alert")}</span><div style="flex:1;min-width:200px">${txt}</div><button class="btn primary" id="gsoNew2" style="flex:none">${icon("plus")} Crear una hoja nueva</button></div>`; $("gsoNew2").onclick=(e)=>crearNueva(e.currentTarget, true); };  // la vieja ya no sirve: nada que confirmar
    if(!g.spreadsheet_id) aviso("<b>Todavía no hay una hoja donde escribir.</b> Crea una con un clic, o pega abajo el enlace de una tuya.");
    else callFn("gsheets-test",{ estado:true, channel_id:st.channelId, spreadsheet_id:g.spreadsheet_id }).then(r=>{
      if(!r||!r.ok) return;
      if(r.estado==="no_existe") aviso("<b>La hoja conectada ya no existe</b> (se borró). Las ventas no están llegando a ningún lado.");
      else if(r.estado==="sin_acceso") aviso(`<b>La cuenta ${esc(g.google_email)} no tiene acceso a esta hoja.</b> Compártela con esa cuenta, o crea una nueva.`);
    }).catch(()=>{});
  }
  const disc=$("gsoDisc");
  if(disc) disc.onclick=async(e)=>{
    if(!await confirmDialog({title:"Desconectar Google Sheets",message:"¿Desconectar la cuenta de Google de este bot?",confirmText:"Desconectar",danger:true})) return;
    const btn=e.target; btn.disabled=true; const old=btn.textContent; btn.textContent="Desconectando…";
    // SOLO el backend revoca el refresh token del Vault. Antes el error se tragaba (catch vacío) y
    // se marcaba "Sin conectar" igual → el token seguía VIVO en el Vault mientras la UI decía
    // desconectado. Ahora se surfacea el fallo (ej. un operador no-admin recibe 403) y no se miente.
    let res=null, err=null;
    try{ res=await callFn("gsheets-connect",{ channel_id:st.channelId, disconnect:true }); }catch(ex){ err=ex; }
    btn.disabled=false; btn.textContent=old;
    if(err || (res && res.error)){ toast("No se pudo desconectar: "+((err&&err.message)||(res&&res.error)||"error")+". El token de Google puede seguir activo.",true); return; }
    // El backend ya escribió channels.gsheets CONSERVANDO spreadsheet_id/url/email. Se re-lee fresco
    // en vez de sobrescribir con {connected:false} (que los borraba y forzaba re-pegar la hoja).
    try{ const { data }=await supa.from("channels").select("gsheets").eq("id",st.channelId).maybeSingle(); st.channel.gsheets=(data&&data.gsheets)||{connected:false}; }
    catch(_){ st.channel.gsheets={ ...(st.channel.gsheets||{}), connected:false, mode:null }; }
    toast("Desconectado"); render();
  };
}

// ── Método 2: Apps Script (sin Google Cloud) ────────────────────────
function renderGsScript(box, g){
  const connected=!!(g.mode==="apps_script" && g.webhook_url);
  box.innerHTML=`
    <div class="card ${connected?'on':''}">
      <div class="chd">
        <span class="ico" style="background:transparent;border:1px solid var(--border)"><img src="${LOGO.sheets}" alt=""/></span>
        <div><div class="nm">Conexión por Apps Script</div><div class="desc" style="margin:2px 0 0">Un mini-script en tu hoja recibe las filas. Sin Google Cloud.</div></div>
        <span class="badge ${connected?'on':''}" style="margin-left:auto">${connected?'Conectada':'Sin conectar'}</span>
      </div>
      <div class="steps" style="margin-top:14px">
        <div class="step"><div class="num"></div><div class="st-b">
          <div class="st-t">Abre el editor de scripts de tu hoja</div>
          <div class="st-d">En tu Google Sheet: <b>Extensiones → Apps Script</b>. Borra lo que haya, pega este código y guarda.</div>
          <textarea class="in" id="gs_code" readonly style="margin-top:8px;height:150px;font-family:monospace;font-size:11.5px;white-space:pre;resize:vertical"></textarea>
          <button class="btn" id="copyScript" style="margin-top:8px">Copiar código</button>
        </div></div>
        <div class="step"><div class="num"></div><div class="st-b">
          <div class="st-t">Publícalo como “app web”</div>
          <div class="st-d"><b>Implementar → Nueva implementación → Aplicación web</b>. “Ejecutar como” <b>Yo</b>; “Quién tiene acceso” <b>Cualquier usuario</b>. Copia la URL.</div>
        </div></div>
        <div class="step"><div class="num"></div><div class="st-b">
          <div class="st-t">Pega la URL de la app web</div>
          <div class="st-d">Termina en <code>/exec</code>.</div>
          <input class="in" id="gs_url" style="margin-top:8px" value="${esc(g.webhook_url||'')}" placeholder="https://script.google.com/macros/s/AKfy.../exec"/>
        </div></div>
        <div class="step"><div class="num"></div><div class="st-b">
          <div class="st-t">Pestaña (opcional)</div>
          <input class="in" id="gs_tab" style="margin-top:8px;max-width:280px" value="${esc(g.tab||'')}" placeholder="Ventas"/>
        </div></div>
      </div>
      <div class="acts">
        <button class="btn primary" id="saveGs">${connected?'Guardar cambios':'Conectar'}</button>
        <button class="btn" id="testGs">Probar y escribir fila</button>
        ${connected?`<button class="btn danger" id="discGs" style="margin-left:auto">Desconectar</button>`:""}
      </div>
      <div class="desc" id="gsTestOut" style="margin-top:12px"></div>
    </div>`;
  $("gs_code").value=GS_SCRIPT;
  $("copyScript").onclick=()=>{ navigator.clipboard?.writeText(GS_SCRIPT); toast("Código copiado"); };
  $("saveGs").onclick=async(e)=>{
    const url=$("gs_url").value.trim();
    if(!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(url)){ toast("La URL debe terminar en /exec (app web de Apps Script)",true); return; }
    // {...actual}: sin el spread, conectar por Apps Script borraba spreadsheet_id/google_email de
    // la conexión OAuth previa (el refresh token quedaba huérfano en el Vault sin que la UI lo supiera).
    await saveGsheets(e.target, { ...(st.channel.gsheets||{}), connected:true, mode:"apps_script", webhook_url:url, tab:$("gs_tab").value.trim()||null, last_error:null });
  };
  $("testGs").onclick=testGsheets;
  // Desconectar de VERDAD: `connected:false` ya no lo mira nadie (la insignia sale de mode +
  // webhook_url y el motor de lo mismo), así que seguía «Conectada» y mandando ventas.
  const disc=$("discGs"); if(disc) disc.onclick=async(e)=>{
    if(!await confirmDialog({ title:"Desconectar Apps Script", message:"Las ventas dejan de escribirse en esa hoja. Lo que ya está en ella no se borra.", confirmText:"Desconectar", danger:true })) return;
    saveGsheets(e.target,{ ...(st.channel.gsheets||{}), connected:false, mode:null, webhook_url:null });
  };
}
// Prueba REAL: el backend hace POST de una fila de prueba a tu app web
// (no se puede desde el navegador por CORS de Google).
async function testGsheets(e){
  const btn=e.target, out=$("gsTestOut");
  const url=$("gs_url").value.trim();
  if(!/\/exec/.test(url)){ toast("Primero pega la URL de la app web",true); return; }
  btn.disabled=true; const old=btn.textContent; btn.textContent="Probando…"; out.innerHTML="";
  try{
    const r=await callFn("gsheets-test",{ webhook_url:url, tab:$("gs_tab").value.trim()||null, channel_id:st.channelId });
    if(r&&r.ok){ out.innerHTML=`<span style="color:var(--green)"> Funcionó.</span> Se escribió una fila de prueba en tu hoja. Ya puedes borrarla.`; toast("Google Sheets conectado"); }
    else { out.innerHTML=`<span style="color:var(--red)">La app web respondió pero con error:</span> ${esc((r&&r.detalle)||JSON.stringify(r))}`; }
  }catch(err){
    const msg=(err&&err.message)||"error";
    if(/not found|404|Function not found/i.test(msg)){
      out.innerHTML=`<span style="color:var(--amber)">La comprobación en vivo aún no está desplegada.</span> Guarda la URL igual; funcionará en los flujos.`;
    } else {
      out.innerHTML=`<span style="color:var(--red)">No se pudo escribir:</span> ${esc(msg)}. Revisa que publicaste con acceso “Cualquier usuario”.`;
    }
  } finally { btn.disabled=false; btn.textContent=old; }
}
async function saveGsheets(btn, gs){
  btn.disabled=true; const old=btn.textContent; btn.textContent="Guardando…";
  const { error }=await updCanal({ gsheets:gs });
  btn.disabled=false; btn.textContent=old;
  if(error){ toast(/gsheets|column/.test(error.message)?"Falta aplicar la migración 0014 (gsheets)":error.message,true); return; }
  st.channel.gsheets=gs; toast("Guardado"); render();
}

function downscaleImage(file, size=96){
  return new Promise((res,rej)=>{ const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{ const c=document.createElement("canvas"); c.width=size; c.height=size; const ctx=c.getContext("2d");
      const s=Math.min(size/img.width,size/img.height), w=img.width*s, h=img.height*s;
      ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h); URL.revokeObjectURL(url); res(c.toDataURL("image/png")); };
    img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error("no se pudo leer la imagen")); }; img.src=url; });
}
async function handleLogoFile(file, luego){
  if(!file) return;
  if(!/^image\//.test(file.type||"")){ toast("Eso no es una imagen",true); return; }
  if(file.size>4*1024*1024){ toast("Imagen muy grande (máx 4MB)",true); return; }
  try{ const d=await downscaleImage(file,96); st.pendingLogo=d; st.removeLogo=false; if(typeof luego==="function") luego(d); toast("Imagen cargada — pulsa Guardar"); }
  catch(e){ toast(e.message||"error",true); }
}
// ── Pixel de Meta (CAPI) ────────────────────────────────────────────
// 📊 La sección de Meta son DOS conexiones que van en sentidos OPUESTOS, y apiladas sin
// jerarquía se confundían: una TRAE el gasto (alimenta Rendimiento) y la otra MANDA las
// ventas (para que Meta optimice). Ahora cada una lo dice en su encabezado, lleva su propia
// guía plegada al lado del campo que hay que llenar, y su forma de comprobarla. La guía va
// DENTRO de la tarjeta a propósito: mandar a alguien a otra pantalla a buscar los pasos es
// donde se pierde.
function renderPixel(box){
  const c=st.channel||{}, s=st.secrets||{};
  // (el gasto también se lee con el token de WhatsApp: «Conectado» si hay token —propio o el de WhatsApp—, cuentas y ningún
  //  error de sincronización. Antes miraba solo `ads_token` y decía «Sin conectar» con el gasto bajando cada hora — 7-oct.
  //  El conteo de cuentas lo confirma loadAdAccounts, que actualiza el badge.)
  const adsOn=!!s.ads_token, capiOn=!!(c.pixel_id&&(s.capi_token||s.access_token));   // (el token de WhatsApp también sirve para las ventas — 7-oct)
  box.innerHTML=`
    <h2>Meta</h2>
    <p class="sub">Dos conexiones independientes: el gasto de tus anuncios entra a Nodo, y tus ventas reales salen a Meta.</p>
    <div class="card${adsOn?" on":""}">
      <div class="chd">
        <span class="ico"><img src="${LOGO.meta}" alt="Meta"/></span>
        <div><div class="nm">Gasto de anuncios</div><div class="sub2">Meta &#8594; Nodo</div></div>
        <span class="badge${adsOn?" on":""}" id="adsBadge">${adsOn?"Conectado":"Sin conectar"}</span>
      </div>
      <div class="desc">Trae lo que gastaste en cada anuncio para calcular en <b>Rendimiento</b> cuánto te costó cada venta y tu ganancia real.</div>

      ${c.ads_sync_error?`<div style="display:flex;gap:10px;align-items:flex-start;background:var(--red-bg,#2c1615);border:1px solid var(--red);border-radius:11px;padding:11px 13px;margin:12px 0;font-size:12.5px;line-height:1.5;color:var(--text)"><span style="color:var(--red);font-weight:800;flex:none">${icon("alert")}</span><div><b>Tu token de anuncios dejó de funcionar.</b> ${esc(c.ads_sync_error)}<br>Genera un token nuevo y pégalo abajo para reconectar.</div></div>`:""}

      <details class="guia">
        <summary>${icon("help")} Cómo conectarlo</summary>
        <div class="gb"><div class="steps">
          <div class="step"><div class="num"></div><div class="st-b">
            <div class="st-t">Antes que nada: prueba sin pegar nada</div>
            <div class="st-d">Si ya conectaste WhatsApp, <b>el mismo token puede servir</b>. Toca <b>Buscar mis cuentas</b> con el campo vacío. Si sirve, terminaste acá y te saltas todo lo de abajo.</div></div></div>
          <div class="step"><div class="num"></div><div class="st-b">
            <div class="st-t">Prepara tu app</div>
            <div class="st-d">En <b>developers.facebook.com</b> &#8594; tu app &#8594; <b>Casos de uso</b> &#8594; <b>Agregar casos de uso</b>, filtra por «Anuncios y monetizaci&#243;n» y marca <b>«Medir datos de rendimiento de los anuncios con la API de marketing»</b>. No marques «Crear y administrar anuncios»: ese permite crear y pausar campa&#241;as, y Nodo solo lee. En apps viejas el bot&#243;n se llama <i>Agregar producto &#8594; Marketing API</i>. Sin este paso, <code>ads_read</code> ni siquiera aparece en la lista de permisos del paso siguiente. No dispara ninguna revisi&#243;n de Meta: leer tus propias cuentas no necesita aprobaci&#243;n.</div>
          <div class="step"><div class="num"></div><div class="st-b">
            <div class="st-t">Genera el token</div>
            <div class="st-d">En <b>business.facebook.com</b> &#8594; Configuración del portafolio &#8594; <b>Usuarios del sistema</b> &#8594; <b>Generar token</b>. Caducidad <b>Nunca</b> y <b>marca todas las casillas de permisos</b>: elegir de una lista de nueve nombres técnicos es donde se falla, y Nodo solo usa los de WhatsApp, <code>ads_read</code> y <code>business_management</code> (este último para asignarse solo tus cuentas publicitarias). Copia el token al momento: Meta lo muestra una sola vez.</div></div></div>
          <div class="step"><div class="num"></div><div class="st-b">
            <div class="st-t">Elige qué cuentas sigue este bot</div>
            <div class="st-d">Nodo te lista las que el token puede leer y tú marcas cuáles. Agrega <b>solo las del producto que vende este bot</b>: si le metes la cuenta de otro negocio, le sumas gasto ajeno y su ganancia sale falsa. Y no pongas la misma cuenta en dos bots — cada uno mostraría el gasto entero.</div></div></div>
        </div></div>
      </details>

      <label>Token de lectura ${s.ads_token?'<span class="badge on">Guardado</span>':""}</label>
      <input class="in" type="password" id="s_ads_token" autocomplete="off" placeholder="${s.ads_token?'•••••••• guardado':"pégalo acá, o déjalo vacío para probar el de WhatsApp"}"/>
      <div class="hint">Déjalo <b>vacío</b> y Nodo prueba el token de WhatsApp: si ese trae el permiso de anuncios, sirve el mismo.</div>
      <div class="acts"><button class="btn primary" id="saveAdsToken">Buscar mis cuentas</button></div>
      <div id="adsDescubre" style="margin-top:10px"></div>

      <label>Cuentas que sigue este bot</label>
      <div id="adAccList" style="display:flex;flex-direction:column;gap:8px"><span style="color:var(--faint);font-size:12.5px">Cargando…</span></div>
      <details class="guia">
        <summary>${icon("plus")} Agregar una a mano</summary>
        <div class="gb">
          <div class="hint" style="margin:8px 0 10px">Solo si la tuya no salió en la búsqueda. El <code>act_…</code> está en <b>Ads Manager</b>, arriba a la izquierda, en el selector de cuenta.</div>
          <div class="row" style="align-items:flex-end;gap:8px">
            <div class="f" style="flex:1;margin:0"><input class="in" id="m_ad_acc_new" placeholder="act_1234567890"/></div>
            <div class="f" style="margin:0"><input class="in" id="m_ad_acc_name" placeholder="Nombre (opcional)" style="max-width:170px"/></div>
            <button class="btn" id="addAdAcc">Agregar</button>
          </div>
        </div>
      </details>

      <label>Cada cuánto sincronizar</label>
      <div id="adsFreqWrap" style="display:flex;gap:6px;flex-wrap:wrap"><span style="color:var(--faint);font-size:12.5px">Cargando…</span></div>
      <div class="hint">Cada cuánto Nodo baja el gasto de Meta. También puedes forzarlo desde <b>Rendimiento</b> con el botón «Actualizar».</div>
    </div>

    <div class="card${capiOn?" on":""}">
      <div class="chd">
        <span class="ico"><img src="${LOGO.meta}" alt="Meta"/></span>
        <div><div class="nm">Ventas a Meta</div><div class="sub2">Nodo &#8594; Meta</div></div>
        <span class="badge${capiOn?" on":""}" id="vmBadge">${capiOn?"Conectado":"Sin conectar"}</span>
      </div>
      <div class="desc">Le cuenta a Meta cada venta que vino de un anuncio, para que aprenda a quién mostrarte.</div>

      <div id="vmEstado" style="margin-top:12px"><span style="color:var(--faint);font-size:12.5px">Revisando…</span></div>

      <details class="guia" style="margin-top:14px">
        <summary>${icon("wrench")} Usar otro dataset o token</summary>
        <div class="gb">
          <div class="hint" style="margin:8px 0 10px">Solo si quieres mandar las ventas a un pixel distinto del de tu WhatsApp. Si dejas el token vacío, se usa el de WhatsApp.</div>
          <label>Pixel / dataset ID</label>
          <input class="in" id="m_pixel_id" value="${esc(c.pixel_id)}" placeholder="p. ej. 998798536397963"/>
          <label>Token CAPI ${s.capi_token?'<span class="badge on">Guardado</span>':""}</label>
          <input class="in" type="password" id="s_capi_token" autocomplete="off" placeholder="${s.capi_token?'•••••••• guardado':"vacío = el de WhatsApp"}"/>
          <div class="acts"><button class="btn primary" id="savePixel">Guardar</button></div>
          <div class="sep"></div>
          <label>Evento de prueba</label>
          <div class="hint" style="margin:0 0 10px">Para verlo llegar en vivo sin una venta. El código sale de <b>Events Manager → tu pixel → Probar eventos</b>. <b>Es obligatorio</b>: sin él entraría como una conversión real.</div>
          <div class="row" style="align-items:flex-end;gap:8px">
            <div class="f" style="flex:1;margin:0"><input class="in" id="m_test_code" placeholder="TEST12345"/></div>
            <button class="btn" id="testPixel">Enviar evento de prueba</button>
          </div>
          <div id="testPixelOut" style="margin-top:10px;font-size:13px;line-height:1.5"></div>
        </div>
      </details>
    </div>`;
  $("savePixel").onclick=(e)=>saveChannel(e.target,{ pixel_id:$("m_pixel_id").value, capi_token:$("s_capi_token").value||undefined });
  $("testPixel").onclick=(e)=>testPixel(e.target);
  $("addAdAcc").onclick=addAdAccount;
  $("saveAdsToken").onclick=(e)=>guardarYDescubrirAds(e.target);
  loadAdAccounts(); loadAdsFreq(); loadVentasMeta();
}
// 📈 Ventas a Meta: el estado de verdad (dataset, con qué token, la última venta que llegó, las que faltan) y los dos
// botones que lo arreglan sin ir a Meta — conectar (dataset de la cuenta de WhatsApp + token de WhatsApp) y mandar las
// ventas de la semana que no llegaron. La «prueba» son esas ventas: Meta no tiene ensayo en seco (ver capi-test). 7-oct.
async function loadVentasMeta(){
  const box=$("vmEstado"); if(!box) return;
  let r=null;
  try{ r=await callFn("channel-config",{ action:"ventas_meta_estado", channel_id:st.channelId }); }
  catch(err){ box.innerHTML=`<span style="color:var(--faint);font-size:12.5px">No pude revisar el estado: ${esc(err.message||String(err))}</span>`; return; }
  const fila=(k,v)=>`<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12.5px"><span style="color:var(--muted)">${k}</span><span style="text-align:right">${v}</span></div>`;
  const aviso=(t)=>`<div style="border:1px solid var(--amber);background:rgba(240,169,43,.08);border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.5;color:var(--text);margin-top:10px">${icon("alert")} ${t}</div>`;
  const conectado=!!(r&&r.dataset_id&&r.token);
  const bd=$("vmBadge"); if(bd){ bd.textContent=conectado?"Conectado":"Sin conectar"; bd.classList.toggle("on",conectado); }
  let html="";
  if(!r||!r.dataset_id){
    html = r&&r.whatsapp
      ? `<div class="hint" style="margin:0">Todavía no está conectado. Lo hago en un clic con tu token de WhatsApp: busco el dataset de tu cuenta de WhatsApp Business y, de paso, mando las ventas de esta semana que no llegaron.</div>
         <div class="acts"><button class="btn primary" id="vmConectar">Conectar ventas a Meta</button></div>`
      : `<div class="hint" style="margin:0">Primero conecta WhatsApp en <b>Conexiones</b>: las ventas se conectan con ese mismo token, sin pegar nada más.</div>`;
  }else{
    const tok=r.token==="propio"?"el que pegaste a mano":r.token==="whatsapp"?"el mismo de WhatsApp":"falta";
    const u=r.ultima_venta;
    const ult=u?`${new Date(u.created_at).toLocaleString("es-PE",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"})} · ${u.currency==="PEN"?"S/":esc(u.currency||"")} ${esc(String(u.value??""))}`:"todavía ninguna";
    html = fila("Dataset", esc(r.dataset_id)) + fila("Token", tok) + fila("Última venta enviada", ult);
    if(r.ultimo_fallo) html += aviso(`El último envío falló (${new Date(r.ultimo_fallo.at).toLocaleString("es-PE",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"})}): ${esc(r.ultimo_fallo.error||"")}`);
    if(r.pendientes>0) html += aviso(`<b>${r.pendientes} venta${r.pendientes>1?"s":""} de esta semana no llegaron a Meta.</b> Vinieron de un anuncio y se pueden mandar todavía (Meta acepta hasta 7 días).`)
      + `<div class="acts"><button class="btn primary" id="vmReenviar">Enviarlas ahora</button></div>`;
    else html += `<div class="hint" style="margin-top:8px">Cada venta que viene de un anuncio se manda sola apenas se valida el pago.</div>`;
  }
  box.innerHTML=html;
  const bc=$("vmConectar");
  if(bc) bc.onclick=async()=>{
    bc.disabled=true; const old=bc.textContent; bc.textContent="Conectando…";
    try{
      const c=await callFn("channel-config",{ action:"ventas_meta_conectar", channel_id:st.channelId });
      if(!c||!c.ok){ box.insertAdjacentHTML("beforeend", aviso(esc((c&&c.detalle)||"No se pudo conectar."))); return; }
      const ok=((c.reenvio&&c.reenvio.enviadas)||[]).filter(x=>x.ok).length;
      if(st.channel) st.channel.pixel_id=c.dataset_id; const pi=$("m_pixel_id"); if(pi) pi.value=c.dataset_id||"";
      toast("Ventas a Meta conectadas"+(ok?` · mandé ${ok} venta${ok>1?"s":""} de esta semana`:""));
      await loadVentasMeta();
    }catch(err){ toast(err.message||"No se pudo conectar",true); }
    finally{ bc.disabled=false; bc.textContent=old; }
  };
  const br=$("vmReenviar");
  if(br) br.onclick=async()=>{
    br.disabled=true; const old=br.textContent; br.textContent="Enviando…";
    try{
      const x=await callFn("channel-config",{ action:"ventas_meta_reenviar", channel_id:st.channelId });
      const env=(x&&x.enviadas)||[]; const ok=env.filter(v=>v.ok).length; const mal=env.filter(v=>!v.ok);
      toast(mal.length?`Mandé ${ok} de ${env.length}: ${mal[0].error||"Meta no la aceptó"}`:`Listo · ${ok} venta${ok>1?"s":""} enviada${ok>1?"s":""} a Meta`, !!mal.length);
      await loadVentasMeta();
    }catch(err){ toast(err.message||"No se pudo enviar",true); }
    finally{ br.disabled=false; br.textContent=old; }
  };
}
const ADS_FREQS=[["1h","Cada hora"],["3h","Cada 3h"],["6h","Cada 6h"],["12h","Cada 12h"],["off","Apagada"]];
function renderAdsFreq(current){
  const cur=current||"off"; const box=$("adsFreqWrap"); if(!box) return;
  box.innerHTML=ADS_FREQS.map(([f,l])=>`<button class="btn ${f===cur?'primary':''}" data-f="${f}" style="height:34px;padding:0 13px;font-size:12.5px">${l}</button>`).join("");
  box.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>setAdsFreq(b.dataset.f));
}
async function loadAdsFreq(){
  try{ const r=await callFn("ads-schedule",{ action:"status" }); renderAdsFreq(r?.freq); }
  catch(e){ const box=$("adsFreqWrap"); if(box) box.innerHTML=`<span style="color:var(--faint);font-size:12px">${esc(e.message||"No disponible")}</span>`; }
}
async function setAdsFreq(freq){
  const box=$("adsFreqWrap"); if(box) box.style.opacity=".5";
  try{ const r=await callFn("ads-schedule",{ action:"set", freq }); renderAdsFreq(r?.freq); toast(freq==="off"?"Sincronización apagada":"Frecuencia actualizada"); }
  catch(e){ toast(e.message||"error",true); }
  finally{ if(box) box.style.opacity="1"; }
}
async function loadAdAccounts(){
  const box=$("adAccList"); if(!box) return;
  const { data,error }=await supa.from("ad_accounts").select("id,account_id,nombre").eq("channel_id",st.channelId).order("created_at");
  if(error){ box.innerHTML=`<span style="color:var(--red);font-size:12.5px">${esc(error.message)}</span>`; return; }
  { const s=st.secrets||{}, c=st.channel||{}; const on=!!(data&&data.length) && !!(s.ads_token||s.access_token) && !c.ads_sync_error;
    const bd=$("adsBadge"); if(bd){ bd.textContent=on?"Conectado":"Sin conectar"; bd.classList.toggle("on",on); bd.closest(".card")?.classList.toggle("on",on); } }
  if(!data||!data.length){ box.innerHTML=`<span style="color:var(--faint);font-size:12.5px">Aún no agregaste ninguna cuenta.</span>`; return; }
  box.innerHTML=data.map(a=>`<div style="display:flex;align-items:center;gap:10px;background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:8px 11px">
    <span style="font-family:monospace;font-size:12.5px;color:var(--text)">${esc(a.account_id)}</span>
    ${a.nombre?`<span style="color:var(--muted);font-size:12px">${esc(a.nombre)}</span>`:""}
    <button class="btn" data-del="${a.id}" style="margin-left:auto;height:30px;padding:0 11px;font-size:12px">Quitar</button>
  </div>`).join("");
  // Sin mirar el error, la cuenta simplemente reaparecía al recargar la lista y no había
  // forma de saber por qué no se fue.
  box.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    const { error }=await supa.from("ad_accounts").delete().eq("id",b.dataset.del);
    if(error) toast("No se pudo quitar la cuenta: "+error.message, true);
    loadAdAccounts();
  });
}
// 📊 Pegas el token y Nodo descubre SOLO qué cuentas puede leer, como ya hace con las WABAs
// de WhatsApp. Antes había que copiar el `act_…` del Ads Manager a mano y, si el token estaba
// mal, la pantalla igual decía «Conectado»: el fallo aparecía tres horas después, cuando el
// cron se caía. Acá se sabe al instante y con el motivo exacto (sin permiso / sin cuentas
// asignadas / vencido), que son los tres tropiezos de siempre.
async function guardarYDescubrirAds(btn){
  const tok=$("s_ads_token").value.trim();
  const out=$("adsDescubre"); out.innerHTML="";
  btn.disabled=true; const old=btn.textContent; btn.textContent="Guardando…";
  try{
    // 🔑 PRIMERO se comprueba, DESPUÉS se guarda. Al revés (que fue mi primera versión) un
    // token malo quedaba igual en el Vault: la pantalla mostraba el error pero el cron lo
    // seguía usando cada 3 horas y escribía `ads_sync_error` sin que nadie lo hubiera
    // conectado de verdad. Probado pegando un token inventado.
    btn.textContent="Comprobando…";
    let r=null;
    try{ r=await callFn("channel-config",{ action:"ads_descubrir", channel_id:st.channelId, ...(tok?{token:tok}:{}) }); }
    catch(err){ r={ error:"red", detalle:String(err&&err.message||err) }; }
    if(r&&!r.error&&tok){
      try{ await callFn("channel-config",{ action:"save", channel_id:st.channelId, ads_token:tok }); toast("Token guardado"); }
      catch(err){ toast(err.message||"No se pudo guardar el token",true); return; }
    }
    if(!r||r.error){
      out.innerHTML=`<div style="border:1px solid var(--amber);background:rgba(240,169,43,.08);border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--amber)">${icon("alert")} ${esc(r&&(r.detalle||r.error)||"No se pudo comprobar el token.")}</div>`;
      return;
    }
    if(!r.cuentas||!r.cuentas.length){
      out.innerHTML=`<div style="border:1px solid var(--amber);background:rgba(240,169,43,.08);border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--amber)">${icon("alert")} ${esc(r.motivo||"El token no ve ninguna cuenta publicitaria.")}</div>`;
      return;
    }
    const { data:ya }=await supa.from("ad_accounts").select("account_id").eq("channel_id",st.channelId);
    const tengo=new Set((ya||[]).map(a=>a.account_id));
    out.innerHTML=(r.de_whatsapp?`<div style="border:1px solid var(--green);background:rgba(34,197,94,.08);border-radius:10px;padding:9px 12px;font-size:12.5px;color:var(--green);margin-bottom:8px">${icon("check")} Tu token de WhatsApp ya trae el permiso de anuncios: no necesitas generar otro.</div>`:"")+
      // Nodo tocó algo en la cuenta de Meta del dueño, así que se lo DICE. Un cambio en
      // casa ajena que nadie anuncia es la clase de cosa que después nadie entiende.
      (r.asignadas_por_nodo?`<div style="border:1px solid var(--green);background:rgba(34,197,94,.08);border-radius:10px;padding:9px 12px;font-size:12.5px;color:var(--green);margin-bottom:8px">${icon("check")} No estaban asignadas, así que <b>Nodo se dio acceso de solo lectura</b>. No puede crear, pausar ni gastar nada.</div>`:"")+
      `<div style="font-size:12px;color:var(--muted);margin-bottom:6px">El token puede leer ${r.cuentas.length} cuenta(s). Agrega las que quieras seguir:</div>`+
      r.cuentas.map(a=>`<div style="display:flex;align-items:center;gap:10px;background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:8px 11px;margin-bottom:6px">
        <span style="font-family:monospace;font-size:12.5px">${esc(a.account_id)}</span>
        <span style="color:var(--muted);font-size:12px">${esc(a.nombre||"")}${a.moneda?` · ${esc(a.moneda)}`:""}${a.activa?"":' · <span style="color:var(--amber)">inactiva</span>'}</span>
        ${tengo.has(a.account_id)
          ? `<span style="margin-left:auto;font-size:12px;color:var(--green)">Ya agregada</span>`
          : `<button class="btn" data-add="${esc(a.account_id)}" data-nom="${esc(a.nombre||"")}" style="margin-left:auto;height:30px;padding:0 11px;font-size:12px">Agregar</button>`}
      </div>`).join("");
    out.querySelectorAll("[data-add]").forEach(b=>b.onclick=async()=>{
      const { error }=await supa.from("ad_accounts").upsert({ channel_id:st.channelId, account_id:b.dataset.add, nombre:b.dataset.nom||null },{ onConflict:"channel_id,account_id" });
      if(error){ toast(error.message,true); return; }
      toast("Cuenta agregada"); b.outerHTML=`<span style="margin-left:auto;font-size:12px;color:var(--green)">Ya agregada</span>`;
      loadAdAccounts();
    });
  } finally { btn.disabled=false; btn.textContent=old; }
}
async function addAdAccount(){
  let v=$("m_ad_acc_new").value.trim();
  if(!v){ toast("Escribe el ID de la cuenta (act_…)",true); return; }
  if(!/^act_/.test(v)) v="act_"+v.replace(/^act_/,"");   // acepta con o sin "act_"
  const nombre=$("m_ad_acc_name").value.trim()||null;
  // ⚠️ La MISMA cuenta en dos bots hace que CADA UNO muestre el gasto entero (todo el gasto
  // se lee por canal), o sea uno de los dos con un ROAS y una ganancia inflados. El enganche
  // automático ya no lo hace solo; acá, a mano, no se prohíbe —puede haber un motivo— pero
  // no puede pasar en silencio: se pregunta.
  const { data:enOtro }=await supa.from("ad_accounts").select("channel_id").eq("account_id",v).neq("channel_id",st.channelId).limit(1);
  if(enOtro&&enOtro.length){
    const ok=await confirmDialog({
      title:"Esa cuenta ya está en otro bot",
      message:`${v} ya está conectada en otro de tus bots. Si la pones también acá, los dos van a mostrar el gasto COMPLETO de esa cuenta: uno de los dos tendrá una ganancia y un ROAS inflados. ¿La agrego igual?`,
      confirmText:"Agregar igual", danger:true,
    });
    if(!ok) return;
  }
  const { error }=await supa.from("ad_accounts").upsert({ channel_id:st.channelId, account_id:v, nombre },{ onConflict:"channel_id,account_id" });
  if(error){ toast(error.message,true); return; }
  $("m_ad_acc_new").value=""; $("m_ad_acc_name").value=""; toast("Cuenta agregada"); loadAdAccounts();
}

async function testPixel(btn){
  const out=$("testPixelOut"); out.innerHTML="";
  btn.disabled=true; const old=btn.textContent; btn.textContent="Enviando…";
  try{
    const r=await callFn("capi-test",{ channel_id:st.channelId, test_event_code:$("m_test_code").value||undefined });
    if(r&&r.ok&&r.aviso){
      // Credenciales buenas, pero el clic de anuncio de la prueba es inventado: se dice qué
      // quedó probado y qué no, en vez de pintar un verde que promete de más.
      out.innerHTML=`<span style="color:var(--green)">${icon("check")} Conexión correcta.</span> ${esc(r.aviso)}`;
    } else if(r&&r.ok){
      out.innerHTML=`<span style="color:var(--green)">Meta recibió el evento${r.received?` (${r.received})`:""}.</span> Míralo en <b>Events Manager → Probar eventos</b>.`;
    } else {
      out.innerHTML=`<span style="color:var(--red)">No se pudo: ${esc((r&&r.error)||"error")}</span>`;
    }
  }catch(e){ out.innerHTML=`<span style="color:var(--red)">No se pudo: ${esc(e.message||"error")}</span>`; }
  finally{ btn.disabled=false; btn.textContent=old; }
}

async function saveChannel(btn, fields){
  btn.disabled=true; const old=btn.textContent; btn.textContent="Guardando…";
  try{ await callFn("channel-config",{ action:"save", channel_id:st.channelId, ...fields }); toast("Guardado"); await loadCfg(); }
  catch(e){ toast(e.message||"error",true); }
  finally{ btn.disabled=false; btn.textContent=old; }
}
async function callFn(fn, body){
  const { data, error } = await supa.functions.invoke(fn, { body });
  if(error){ let d=""; try{ d=(await error.context?.json?.())?.detalle||""; }catch{} throw new Error(d||error.message||"error"); }
  return data;
}
