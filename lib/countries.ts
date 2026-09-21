// PawaPay renvoie les pays en ISO alpha-3 (CMR), la base les stocke en alpha-2 (CM).
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  BEN: "BJ", BFA: "BF", CMR: "CM", CIV: "CI", COD: "CD", COG: "CG", ETH: "ET", GAB: "GA",
  GHA: "GH", KEN: "KE", LSO: "LS", MWI: "MW", MOZ: "MZ", NGA: "NG", RWA: "RW", SEN: "SN",
  SLE: "SL", TZA: "TZ", UGA: "UG", ZMB: "ZM", TGO: "TG", GIN: "GN", MLI: "ML", NER: "NE"
};

export function toAlpha2(code: string): string {
  const c = (code || "").trim().toUpperCase();
  if (c.length === 2) return c;
  return ALPHA3_TO_ALPHA2[c] || c;
}
