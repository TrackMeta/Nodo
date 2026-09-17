const $ = (id) => document.getElementById(id);

// Cuándo fue, en cristiano. "hace 3 h" dice más que una fecha ISO.
function hace(iso) {
  if (!iso) return "nunca";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? "s" : ""}`;
}

function pintar(ultimo, d) {
  const box = $("estado");
  box.className = "estado";
  if (!d) { box.textContent = "Sin revisar todavía."; return; }

  // El silencio también se cuenta: si la última pasada fue hace mucho, algo pasa
  // (Chrome cerrado, PC apagada, extensión desactivada). Mejor decirlo que fingir
  // que todo va bien.
  const viejo = ultimo && (Date.now() - new Date(ultimo).getTime()) > 12 * 3600 * 1000;
  const mal = d.roto || (d.fallos || 0) > 0 || viejo;
  box.classList.add(mal ? "mal" : "ok");

  const lineas = [];
  if (d.roto) lineas.push(`<b>⚠️ Algo se rompió</b>${d.nota ? d.nota : ""}`);
  else if (viejo) lineas.push("<b>⚠️ Lleva mucho sin revisar</b>¿Estuvo Chrome cerrado?");
  else lineas.push("<b>✅ Funcionando</b>");

  if (d.pendientes != null) {
    lineas.push(`${d.leidas ?? 0} de ${d.pendientes} guías leídas${d.fallos ? ` · ${d.fallos} no se pudieron` : ""}`);
  }
  if (d.movidos) lineas.push(`📦 ${d.movidos} llegaron a la agencia — ya se les avisó`);
  if (d.sin_saldo) lineas.push(`🔴 ${d.sin_saldo} entregados SIN el saldo pagado`);
  if (d.nota && !d.roto) lineas.push(d.nota);

  box.innerHTML = lineas.join("<br>") + `<div class="cuando">Última revisión: ${hace(ultimo)} (${d.motivo || "—"})</div>`;
}

async function cargar() {
  const { secreto, cadaHoras, ultimo, ultimoDetalle } = await chrome.storage.local.get(
    ["secreto", "cadaHoras", "ultimo", "ultimoDetalle"]);
  $("secreto").value = secreto || "";
  $("horas").value = cadaHoras || 4;
  pintar(ultimo, ultimoDetalle);
}

$("guardar").onclick = async () => {
  const secreto = $("secreto").value.trim();
  const cadaHoras = Math.min(24, Math.max(1, Number($("horas").value) || 4));
  await chrome.storage.local.set({ secreto, cadaHoras });
  await chrome.runtime.sendMessage({ t: "reloj" });
  $("guardar").textContent = "Guardado";
  setTimeout(() => ($("guardar").textContent = "Guardar"), 1500);
};

$("ahora").onclick = async () => {
  const b = $("ahora");
  b.disabled = true; b.textContent = "Revisando…";
  // Puede tardar minutos: se va a una guía cada seis segundos a propósito.
  await chrome.runtime.sendMessage({ t: "ahora" });
  b.disabled = false; b.textContent = "Revisar ahora";
  await cargar();
};

cargar();
