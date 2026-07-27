// ═══════════════════════════════════════════════════════════════════
// Nodo · check-est-sync.ts — RED DE SEGURIDAD de las tablas EST.
//
// QUÉ ES: la tabla que define cada estado de un pedido (si es venta, cuánta
// plata entró = `cobro`, si es pérdida, y su zona) vive DUPLICADA:
//   · panel/orders.js                       → la usa el PANEL (fuente de verdad)
//   · supabase/functions/_shared/order-stats.ts → el ESPEJO que usa el BACKEND
//     (el resumen diario de Telegram).
// Son dos mundos distintos (JS del navegador vs TS de Supabase) que no comparten
// código, así que la tabla se copia a mano en los dos. Si un día cambias un
// estado en una y te olvidas de la otra, el Dashboard y el resumen de Telegram
// dirían números DISTINTOS de la misma venta, en silencio. Ya pasó dos veces.
//
// QUÉ HACE: importa las dos tablas y las compara estado por estado. Si difieren
// en algún campo que afecta la plata, IMPRIME qué difiere y SALE con código 1
// (falla). Corre solo en cada push desde .github/workflows/est-sync.yml — no hay
// que ejecutarlo a mano.
//
// NO compara `label` ni `tono`: son presentación y viven solo en el panel a
// propósito (el backend no los necesita).
// ═══════════════════════════════════════════════════════════════════

import { EST as FRONT } from "../panel/orders.js";
import { EST as BACK } from "../supabase/functions/_shared/order-stats.ts";

// deno-lint-ignore no-explicit-any
type AnyEst = Record<string, any>;

// Los únicos campos que DEBEN coincidir: los que deciden si es venta y cuánta
// plata cuenta. Se normaliza para que "ausente" y `false`/`nada`/`null` sean lo
// mismo (las dos tablas omiten campos de formas distintas a propósito).
function normaliza(e: AnyEst) {
  return {
    venta: !!e?.venta,
    cobro: e?.cobro ?? "nada",
    perdido: !!e?.perdido,
    zona: e?.zona ?? null,
  };
}

const front = FRONT as AnyEst;
const back = BACK as AnyEst;
const problemas: string[] = [];

// 1) El mismo conjunto de estados en las dos.
for (const k of Object.keys(front)) {
  if (!(k in back)) problemas.push(`Estado "${k}" existe en orders.js pero FALTA en order-stats.ts`);
}
for (const k of Object.keys(back)) {
  if (!(k in front)) problemas.push(`Estado "${k}" existe en order-stats.ts pero FALTA en orders.js`);
}

// 2) Los mismos valores en los campos que importan.
for (const k of Object.keys(front)) {
  if (!(k in back)) continue;
  const a = normaliza(front[k]) as Record<string, unknown>;
  const b = normaliza(back[k]) as Record<string, unknown>;
  for (const campo of ["venta", "cobro", "perdido", "zona"] as const) {
    if (a[campo] !== b[campo]) {
      problemas.push(
        `Estado "${k}" · ${campo}: ${JSON.stringify(a[campo])} en orders.js ` +
        `pero ${JSON.stringify(b[campo])} en order-stats.ts`,
      );
    }
  }
}

if (problemas.length) {
  console.error("❌ Las tablas EST están DESINCRONIZADAS:\n");
  for (const p of problemas) console.error("   · " + p);
  console.error(
    `\n${problemas.length} diferencia(s). El panel y el resumen de Telegram contarían ` +
    `la misma venta distinto.\nAlinea panel/orders.js y ` +
    `supabase/functions/_shared/order-stats.ts para que coincidan.`,
  );
  Deno.exit(1);
}

console.log(
  `✅ Tablas EST sincronizadas: ${Object.keys(front).length} estados coinciden ` +
  `en venta/cobro/perdido/zona.`,
);
