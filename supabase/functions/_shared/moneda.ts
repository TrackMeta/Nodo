// 💱 Símbolo de cada moneda: el MISMO catálogo que el panel ofrece en Ajustes → Moneda (config.html, CURRENCIES).
// (24-oct) Antes el motor solo sabía «S/» y «$» (USD): un bot en pesos mexicanos le escribía al cliente «Son *S/ 199*».
export const SIMBOLOS: Record<string, string> = {
  PEN: "S/", USD: "$", MXN: "$", COP: "$", ARS: "$", CLP: "$", BOB: "Bs", EUR: "€", BRL: "R$", UYU: "$U",
  PYG: "₲", VES: "Bs", GTQ: "Q", CRC: "₡", DOP: "RD$", HNL: "L", NIO: "C$", PAB: "B/.", GBP: "£", CAD: "$",
};

// Sin moneda configurada = soles (así nacieron todos los bots); un código que no está en la lista sale tal cual («JPY 500»).
export function simboloMoneda(cur?: string | null): string {
  const c = String(cur ?? "").trim().toUpperCase();
  if (!c) return "S/";
  return SIMBOLOS[c] ?? c;
}

// ¿El texto ya trae un monto con su moneda? «S/ 10», «$199», «€ 5», «199 pesos», «10 soles»…
export const RE_MONTO_CON_MONEDA =
  /(?:s\/|r\$|rd\$|\$u|c\$|b\/\.|\$|€|£|₲|₡|(?:^|[^\p{L}])bs\.?|(?:^|[^\p{L}])q)\s*\d|\d[\d.,]*\s*(?:soles|pesos|d[oó]lares|euros|reales|bolivianos|quetzales|colones|guaran[ií]es|lempiras|c[oó]rdobas|balboas|libras)(?![\p{L}])/iu;
