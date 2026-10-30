// 💱 Símbolo de cada moneda: el MISMO catálogo que el panel ofrece en Ajustes → Moneda (config.html, CURRENCIES).
// (24-oct) Antes el motor solo sabía «S/» y «$» (USD): un bot en pesos mexicanos le escribía al cliente «Son *S/ 199*».
export const SIMBOLOS: Record<string, string> = {
  PEN: "S/", USD: "$", MXN: "$", COP: "$", ARS: "$", CLP: "$", BOB: "Bs", EUR: "€", BRL: "R$", UYU: "$U",
  PYG: "₲", VES: "Bs", GTQ: "Q", CRC: "₡", DOP: "RD$", HNL: "L", NIO: "C$", PAB: "B/.", GBP: "£", CAD: "$",
};

// (30-oct) El NOMBRE de las monedas cuyo símbolo es «$» a secas: con «$ 999» la IA no sabe de qué país es y lo sacaba
// del saludo («$999 COP» a un cliente de la versión de México).
const NOMBRE_DOLAR_PESO: Record<string, string> = {
  USD: "dólares (USD)", MXN: "pesos mexicanos (MXN)", COP: "pesos colombianos (COP)", ARS: "pesos argentinos (ARS)",
  CLP: "pesos chilenos (CLP)", CAD: "dólares canadienses (CAD)",
};
export function nombreMonedaAmbigua(cur?: string | null): string | null {
  return NOMBRE_DOLAR_PESO[String(cur ?? "").trim().toUpperCase()] ?? null;
}

// Sin moneda configurada = soles (así nacieron todos los bots); un código que no está en la lista sale tal cual («JPY 500»).
export function simboloMoneda(cur?: string | null): string {
  const c = String(cur ?? "").trim().toUpperCase();
  if (!c) return "S/";
  return SIMBOLOS[c] ?? c;
}

// Monedas que separan los miles con PUNTO: «$49.900» (Colombia), «$9.990» (Chile). (25-oct: el bot escribía
// «Son *$ 49900*» y «faltan $19900»; en Perú, México y dólares no se toca nada.)
const MILES_CON_PUNTO = new Set(["COP", "CLP", "ARS", "PYG", "UYU", "VES", "BOB", "BRL", "EUR", "CRC"]);
export function agruparMiles(texto: string, cur?: string | null): string {
  if (!MILES_CON_PUNTO.has(String(cur ?? "").trim().toUpperCase())) return texto;
  const pun = (d: string) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  // Solo cifras que son PLATA: detrás de un signo de moneda («$ 49900», «*$49900*») o delante de «pesos»/«COP»…
  // Un celular o una cuenta no llevan ninguna de las dos cosas. Ya agrupadas o con decimales, se dejan.
  return String(texto ?? "")
    .replace(/((?:R\$|\$U|\$|€|₲|₡|Bs\.?)\s?\*?)(\d{4,})(?![\d.,]?\d)/g, (_m, s: string, d: string) => s + pun(d))
    .replace(/(?<![\d.,])(\d{4,})(?![\d.,]?\d)(\*?\s*(?:pesos|COP|CLP|ARS|reales|bol[ií]vares|guaran[ií]es|colones|euros)(?![\p{L}]))/giu,
      (_m, d: string, r: string) => pun(d) + r);
}
// ¿El texto dice este precio? «49.900», «49,900» y «49900» son lo mismo: la IA escribe los miles a su manera y el
// motor buscaba la cifra pegada («49900») — no la hallaba y pegaba la lista de precios otra vez (25-oct, Colombia).
export const sinMiles = (t: unknown) => String(t ?? "").replace(/(\d)[.,](?=\d{3}(?!\d))/g, "$1");
export function dicePrecio(texto: unknown, precio: unknown): boolean {
  return sinMiles(String(texto ?? "").replace(/[*_~`]/g, "")).includes(String(precio));
}

// ¿El texto ya trae un monto con su moneda? «S/ 10», «$199», «€ 5», «199 pesos», «10 soles»…
export const RE_MONTO_CON_MONEDA =
  /(?:s\/|r\$|rd\$|\$u|c\$|b\/\.|\$|€|£|₲|₡|(?:^|[^\p{L}])bs\.?|(?:^|[^\p{L}])q)\s*\d|\d[\d.,]*\s*(?:soles|pesos|d[oó]lares|euros|reales|bolivianos|quetzales|colones|guaran[ií]es|lempiras|c[oó]rdobas|balboas|libras)(?![\p{L}])/iu;
