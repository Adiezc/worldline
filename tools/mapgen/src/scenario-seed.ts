// Builds packages/scenarios/modern-2026/seed.json (ScenarioSeed) for the Modern Day scenario (1 January 2026).
//
// Inputs:
//   - start.json (countries, owners, controllers) from scenario-modern.ts
//   - World Bank API: GDP (NY.GDP.MKTP.CD), population (SP.POP.TOTL), military spending (MS.MIL.XPND.CD),
//     WGI political stability (GOV_WGI_PV.EST, source 3). Cached in tools/mapgen/data/raw/worldbank/.
//     For each country we take the latest non-empty value from 2018–2025.
//   - Hand-maintained data in the scenario folder: leaders, agendas, organizations, treaties, wars,
//     sanctions, relations, calendar, formables, world-brief.md, rules.md.
//
// Hand estimates (no usable World Bank value), all in USD billions / millions of people:
//   TWN  GDP 800, pop 23.4, military 19 (Taiwan is not covered by the World Bank)
//   PRK  GDP 28 (Bank of Korea-style estimate), military 4.0
//   SOL  Somaliland: GDP 3.0, pop 4.5, military 0.1
//   CYN  Northern Cyprus: GDP 5.0, pop 0.38 (Turkish garrison handled via military adjustment)
//   KAS  Siachen Glacier (garrison only): GDP 0.01, pop 0.005
//   PGA  Spratly Is. (outposts only): GDP 0.01, pop 0.002
//   VAT  Vatican: GDP 0.3, pop 0.0008
//   ERI  Eritrea GDP 2.5; SDS South Sudan GDP 5.5 (WB series stop before 2018)
//   Military spending where WB has no figure, or only a stale one (pre-2022: AFG, CUB, PRK, QAT, SDN, UZB),
//   these estimates take precedence: ARE 24, QAT 12, SYR 1.0, YEM 1.0, VEN 2.0, CUB 1.5,
//   SDN 3.0, MMR 4.0, UZB 2.5, TKM 0.7, LAO 0.2, LBY 3.0, AFG 0.5, ERI 0.4, BRN 0.5, DJI 0.2, PSX 0.3,
//   SDS 0.2, SOL 0.1, KOS (WB) — microstates and island states without armies get token coast-guard/police
//   figures (see MIL_EST below); anything else missing falls back to 1.2% of GDP.
//
// Flags: "iso:" codes from Natural Earth's ISO_A2(_EH) via tools/mapgen/src/flags.ts; Somaliland and
// Northern Cyprus have historical-style flags drawn in the client (hist:somaliland, hist:trnc); the
// Siachen and Spratly garrison areas get generated flags.
//
// G7: the EU also attends G7 summits as a non-enumerated member; G20: the EU and AU are members too, but
// organisation members must be country tags, so only the 19 countries are listed.

import { join } from "node:path";
import {
  deriveFlag,
  relKey,
  type CalendarEntry,
  type Country,
  type Formable,
  type MapMeta,
  type Organization,
  type Sanction,
  type ScenarioSeed,
  type ScenarioStart,
  type Treaty,
  type War,
} from "@worldline/shared";
import { flagFor } from "./flags.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const SCEN = join(ROOT, "packages", "scenarios", "modern-2026");
const RAW = join(import.meta.dir, "..", "data", "raw", "worldbank");

const start = (await Bun.file(join(SCEN, "start.json")).json()) as ScenarioStart;
const TAGS = start.countries.map((c) => c.tag);
const TAGSET = new Set(TAGS);
const warnings: string[] = [];
const warn = (msg: string) => warnings.push(msg);

// ---------- World Bank ----------

interface WbRow {
  countryiso3code: string;
  country: { id: string; value: string };
  date: string;
  value: number | null;
}

async function wb(indicator: string, source?: number): Promise<Map<string, number>> {
  const file = join(RAW, `${indicator}.json`);
  let body: unknown;
  if (await Bun.file(file).exists()) body = await Bun.file(file).json();
  else {
    const url =
      `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000&date=2018:2025` +
      (source ? `&source=${source}` : "");
    console.log(`fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`World Bank ${indicator}: HTTP ${res.status}`);
    body = await res.json();
    await Bun.write(file, JSON.stringify(body));
  }
  const rows = (Array.isArray(body) ? body[1] : null) as WbRow[] | null;
  if (!rows) throw new Error(`World Bank ${indicator}: unexpected response ${JSON.stringify(body).slice(0, 200)}`);
  const best = new Map<string, { date: string; value: number }>();
  for (const r of rows) {
    const code = r.countryiso3code || r.country.id;
    if (!code || r.value == null || !Number.isFinite(r.value)) continue;
    const prev = best.get(code);
    if (!prev || r.date > prev.date) best.set(code, { date: r.date, value: r.value });
  }
  return new Map([...best].map(([k, v]) => [k, v.value]));
}

// World Bank code -> our tag where they differ.
const WB_TO_TAG: Record<string, string> = { XKX: "KOS", PSE: "PSX", SSD: "SDS" };
const toTags = (m: Map<string, number>) => {
  const out = new Map<string, number>();
  for (const [code, v] of m) out.set(WB_TO_TAG[code] ?? code, v);
  return out;
};

const gdpWb = toTags(await wb("NY.GDP.MKTP.CD"));
const popWb = toTags(await wb("SP.POP.TOTL"));
const milWb = toTags(await wb("MS.MIL.XPND.CD"));
const pvWb = toTags(await wb("GOV_WGI_PV.EST", 3));

// Estimates (USD bn / millions).
const GDP_EST: Record<string, number> = { TWN: 800, PRK: 28, SOL: 3.0, CYN: 5.0, KAS: 0.01, PGA: 0.01, VAT: 0.3, ERI: 2.5, SDS: 5.5 };
const POP_EST: Record<string, number> = { TWN: 23.4, SOL: 4.5, CYN: 0.38, KAS: 0.005, PGA: 0.002, VAT: 0.0008 };
const MIL_EST: Record<string, number> = {
  TWN: 19, PRK: 4.0, ARE: 24, QAT: 12, SYR: 1.0, YEM: 1.0, VEN: 2.0, CUB: 1.5, SDN: 3.0, MMR: 4.0, UZB: 2.5,
  TKM: 0.7, LAO: 0.2, LBY: 3.0, AFG: 0.5, ERI: 0.4, BRN: 0.5, DJI: 0.2, PSX: 0.3, SDS: 0.2, SOL: 0.1, CYN: 0.1,
  KAS: 0.05, PGA: 0.02, BHS: 0.1, BRB: 0.04, ATG: 0.03, BTN: 0.04, COM: 0.03, MDV: 0.1, STP: 0.003, TON: 0.01,
  SUR: 0.05, SLB: 0.01, VUT: 0.01, WSM: 0.005, FSM: 0.003, KIR: 0.002, MHL: 0.002, NRU: 0.001, PLW: 0.002,
  TUV: 0.001, DMA: 0.005, GRD: 0.005, KNA: 0.005, LCA: 0.005, VCT: 0.005, AND: 0.005, LIE: 0.002, MCO: 0.005,
  SMR: 0.002, VAT: 0.001, CRI: 0.3, ISL: 0.06, PAN: 0.5,
};

// Stability overrides for countries in active conflict or acute crisis on 1 Jan 2026 (0–100).
const STABILITY_SET: Record<string, number> = {
  SDN: 8, MMR: 14, HTI: 10, SDS: 15, YEM: 12, SOM: 18, SYR: 30, UKR: 45, RUS: 55, PSX: 15, LBY: 25, MLI: 20,
  BFA: 18, NER: 25, COD: 20, AFG: 30, ISR: 45, IRN: 30, VEN: 22, LBN: 32, MDG: 30, GNB: 25, NPL: 35, BGD: 35,
  ETH: 28, CAF: 22, PAK: 30, NGA: 28, CMR: 30, TCD: 25, SOL: 55, CYN: 65, TWN: 72, KAS: 40, PGA: 40, VAT: 95,
  KOS: 55, PRK: 55, CUB: 40, TZA: 40, GEO: 40, SRB: 45, PER: 35, BOL: 40, ECU: 35,
};

// Military index adjustments (added after the log scaling): manpower, nuclear arsenals, combat experience,
// or spending that understates (or overstates) real capability.
const MIL_ADJ: Record<string, number> = {
  RUS: 8, CHN: 5, IND: 6, PRK: 18, PAK: 10, ISR: 8, IRN: 12, TUR: 8, UKR: 6, KOR: 5, EGY: 14, VNM: 6, DEU: -4,
  GBR: 2, FRA: 3, SAU: -5, ARE: 2, KWT: -6, QAT: -6, OMN: -4, SGP: -2, ERI: 10, ETH: 6, SYR: 5, MMR: 6,
  AZE: 5, ARM: 3, POL: 3, FIN: 4, CYN: 8, TWN: 4, IRQ: 2, CUB: 5, VEN: 4, BLR: 5, SDN: 4,
};
const NUCLEAR = new Set(["USA", "RUS", "CHN", "GBR", "FRA", "IND", "PAK", "ISR", "PRK"]);
const WAR_EXHAUSTION: Record<string, number> = { RUS: 35, UKR: 55 };

// ---------- Hand data ----------

const leaders = (await Bun.file(join(SCEN, "leaders.json")).json()) as Record<string, { government: string; leader: string }>;
const agendas = (await Bun.file(join(SCEN, "agendas.json")).json()) as Record<string, { persona: string; goals: string[] }>;
const orgsRaw = (await Bun.file(join(SCEN, "organizations.json")).json()) as (Omit<Organization, "members"> & { members: string[] | string })[];
const treatiesRaw = (await Bun.file(join(SCEN, "treaties.json")).json()) as Treaty[];
const warsRaw = (await Bun.file(join(SCEN, "wars.json")).json()) as War[];
const sanctionsRaw = (await Bun.file(join(SCEN, "sanctions.json")).json()) as Sanction[];
const relationsRaw = (await Bun.file(join(SCEN, "relations.json")).json()) as [string, string, number][];
const calendarRaw = (await Bun.file(join(SCEN, "calendar.json")).json()) as CalendarEntry[];
const formablesRaw = (await Bun.file(join(SCEN, "formables.json")).json()) as Formable[];
const worldBrief = (await Bun.file(join(SCEN, "world-brief.md")).text()).trim();
const rules = (await Bun.file(join(SCEN, "rules.md")).text()).trim();

for (const t of Object.keys(leaders)) if (!TAGSET.has(t)) warn(`leaders.json: unknown tag ${t}`);
for (const t of Object.keys(agendas)) if (!TAGSET.has(t)) warn(`agendas.json: unknown tag ${t}`);

// ---------- Regions and template agendas ----------

type Region =
  | "eu" | "euEast" | "westNonEu" | "balkans" | "postSoviet" | "centralAsia" | "gulf" | "levant" | "northAfrica"
  | "westAfrica" | "centralAfrica" | "eastAfrica" | "southernAfrica" | "southAsia" | "southeastAsia" | "eastAsia"
  | "pacific" | "caribbean" | "centralAmerica" | "southAmerica" | "northAmerica" | "oceania";

const REGION_LIST: Record<Region, string> = {
  eu: "AUT BEL CYP DEU DNK ESP FRA GRC IRL ITA LUX MLT NLD PRT SWE HRV SVN",
  euEast: "BGR CZE EST FIN HUN LTU LVA POL ROU SVK",
  westNonEu: "GBR NOR CHE ISL LIE AND MCO SMR VAT",
  balkans: "ALB BIH KOS MKD MNE SRB",
  postSoviet: "UKR BLR MDA GEO ARM AZE RUS",
  centralAsia: "KAZ KGZ TJK TKM UZB AFG MNG",
  gulf: "SAU ARE QAT KWT BHR OMN YEM IRN IRQ",
  levant: "ISR PSX LBN SYR JOR TUR CYN",
  northAfrica: "EGY LBY TUN DZA MAR MRT",
  westAfrica: "SEN GMB GNB GIN SLE LBR CIV GHA TGO BEN NGA MLI BFA NER CPV",
  centralAfrica: "CMR CAF TCD COG COD GAB GNQ STP",
  eastAfrica: "SDN SDS ETH ERI DJI SOM SOL KEN UGA RWA BDI TZA",
  southernAfrica: "AGO ZMB ZWE MWI MOZ BWA NAM ZAF LSO SWZ MDG MUS SYC COM",
  southAsia: "IND PAK BGD NPL BTN LKA MDV KAS",
  southeastAsia: "MMR THA LAO KHM VNM MYS SGP IDN PHL BRN TLS PGA",
  eastAsia: "CHN JPN KOR PRK TWN",
  pacific: "PNG FJI SLB VUT WSM TON KIR TUV NRU MHL FSM PLW",
  caribbean: "CUB HTI DOM JAM BHS BRB TTO ATG DMA GRD KNA LCA VCT",
  centralAmerica: "GTM BLZ HND SLV NIC CRI PAN",
  southAmerica: "COL VEN ECU PER BOL BRA ARG CHL PRY URY GUY SUR",
  northAmerica: "USA CAN MEX",
  oceania: "AUS NZL",
};
const REGION = new Map<string, Region>();
for (const [r, list] of Object.entries(REGION_LIST) as [Region, string][])
  for (const t of list.split(" ")) {
    if (!TAGSET.has(t)) warn(`region list: unknown tag ${t}`);
    REGION.set(t, r);
  }
for (const t of TAGS) if (!REGION.has(t)) warn(`no region for ${t}`);

const REGION_TEXT: Record<Region, { where: string; goals: string[] }> = {
  eu: { where: "an EU member worried about US tariffs, Russian hybrid threats and populist pressure at home", goals: ["Raise defence spending toward new NATO targets", "Shield exporters from US tariffs", "Keep supporting Ukraine within EU consensus", "Manage migration and populist pressure"] },
  euEast: { where: "an EU and NATO state on the eastern flank that sees Russia as the main threat", goals: ["Strengthen deterrence against Russia", "Secure energy independence from Russia", "Attract investment and EU funds", "Keep US forces engaged in the region"] },
  westNonEu: { where: "a prosperous European state outside the EU, closely tied to the single market", goals: ["Protect its economic ties with the EU", "Contribute to European security", "Preserve its sovereignty and niche role"] },
  balkans: { where: "a Western Balkan state seeking EU membership amid ethnic tensions and Russian, Chinese and Gulf influence", goals: ["Advance EU accession", "Attract investment and stem emigration", "Keep ethnic tensions in check"] },
  postSoviet: { where: "a post-Soviet state navigating between Russia and the West", goals: ["Reduce dependence on Russia without provoking it", "Attract Western investment", "Secure energy and transit routes"] },
  centralAsia: { where: "a landlocked Central Asian state balancing Russia, China, Turkey and the West", goals: ["Diversify trade routes and partners", "Attract investment in resources and transit", "Keep domestic control and stability"] },
  gulf: { where: "a Gulf state whose fortunes hinge on oil and gas, Iran-Saudi rivalry and US security ties", goals: ["Protect energy revenue", "Diversify the economy", "Avoid being drawn into regional wars"] },
  levant: { where: "an eastern Mediterranean state shaped by the Gaza war, Syrian transition and Israeli-Iranian rivalry", goals: ["Shield itself from regional spillover", "Secure aid and investment", "Keep internal order"] },
  northAfrica: { where: "a North African state focused on migration, energy and Sahel spillover", goals: ["Secure energy and investment deals with Europe", "Control migration and borders", "Contain jihadist spillover from the Sahel"] },
  westAfrica: { where: "a West African state facing jihadist spillover from the Sahel, debt and youthful frustration", goals: ["Contain jihadist threats on its borders", "Attract investment and create jobs", "Keep ECOWAS cohesion"] },
  centralAfrica: { where: "a Central African state dependent on oil or minerals and wary of rebel groups", goals: ["Secure revenue from oil and minerals", "Contain armed groups", "Keep the ruling elite secure"] },
  eastAfrica: { where: "an East African or Horn state amid Sudan's war, al-Shabaab and Red Sea rivalries", goals: ["Contain spillover from regional wars", "Attract Gulf, Chinese and Western investment", "Keep internal security"] },
  southernAfrica: { where: "a southern African state focused on growth, debt and climate shocks", goals: ["Attract investment in mining and energy", "Manage debt and food security", "Deepen SADC and AfCFTA integration"] },
  southAsia: { where: "a South Asian state balancing India, China and the Gulf", goals: ["Balance India and China for investment", "Stabilise the economy and debt", "Create jobs for a young population"] },
  southeastAsia: { where: "a Southeast Asian state hedging between China and the US", goals: ["Balance US and Chinese ties", "Settle US tariff terms", "Keep ASEAN centrality and stability"] },
  eastAsia: { where: "an East Asian state amid US-China rivalry", goals: ["Balance its great-power neighbours", "Protect trade and investment flows"] },
  pacific: { where: "a Pacific island state facing climate change and competition between China and the West for influence", goals: ["Secure climate finance and adaptation", "Leverage Chinese and Western competition for aid", "Protect fisheries"] },
  caribbean: { where: "a Caribbean state reliant on tourism and remittances, exposed to hurricanes and US policy", goals: ["Secure climate resilience funding", "Manage US migration and visa pressure", "Contain gang and drug violence"] },
  centralAmerica: { where: "a Central American state shaped by migration, gangs and US pressure", goals: ["Keep good terms with Washington on migration", "Reduce gang and cartel violence", "Attract nearshoring investment"] },
  southAmerica: { where: "a South American state dependent on commodities and facing organised crime", goals: ["Grow commodity exports to China and the West", "Fight organised crime", "Stay out of the US-Venezuela confrontation"] },
  northAmerica: { where: "a North American state tied to the USMCA economy", goals: ["Protect USMCA access", "Strengthen border security"] },
  oceania: { where: "a Pacific democracy anchored to the US alliance", goals: ["Stabilise trade with China", "Deepen Pacific partnerships"] },
};

const CONFLICT = new Set(["COD", "SDS", "CAF", "MOZ", "NGA", "CMR", "TCD", "BFA", "NER", "MLI", "SOM", "ETH", "YEM", "LBY", "SDN", "MMR", "HTI", "IRQ", "SYR", "PAK", "COL", "ECU"]);
const MICRO = new Set(["AND", "LIE", "MCO", "SMR", "VAT", "NRU", "TUV", "PLW", "MHL", "KIR", "FSM", "KNA", "DMA", "GRD", "LCA", "VCT", "ATG", "TON", "WSM", "STP", "SYC", "MDV", "COM", "CPV"]);

type GovKind = "junta" | "monarchy" | "oneParty" | "dominantParty" | "authoritarian" | "divided" | "transitional" | "democracy";

function govKind(gov: string): GovKind {
  const g = gov.toLowerCase();
  if (g.includes("junta") || g.includes("military-led")) return "junta";
  if (g.includes("divided")) return "divided";
  if (g.includes("one-party")) return "oneParty";
  if (g.includes("absolute") || g.includes("dominant monarch") || g.includes("emirate")) return "monarchy";
  if (g.includes("dominant party")) return "dominantParty";
  if (g.includes("authoritarian") || g.includes("dominant") || g.includes("military-dominated") || g.includes("theocratic")) return "authoritarian";
  if (g.includes("transition") || g.includes("interim") || g.includes("caretaker")) return "transitional";
  return "democracy";
}

const GOV_TEXT: Record<GovKind, { lead: string; goal: string }> = {
  junta: { lead: "Its military rulers put regime survival and sovereignty first and court new partners against Western pressure.", goal: "Entrench military rule and delay a return to civilian government" },
  monarchy: { lead: "Its monarchy seeks stability, investment and security guarantees.", goal: "Preserve the ruling family's authority" },
  oneParty: { lead: "Its ruling party prioritises regime continuity and controlled growth.", goal: "Maintain party control while delivering growth" },
  dominantParty: { lead: "Its long-dominant ruling party prioritises continuity, development and keeping the opposition weak.", goal: "Keep the ruling party's grip on power" },
  authoritarian: { lead: "Its strongman government prioritises regime security and transactional deals.", goal: "Keep the ruling elite secure and opposition contained" },
  divided: { lead: "Rival authorities contest power.", goal: "Survive and win outside backing against rivals" },
  transitional: { lead: "Its transitional government is steering toward new elections.", goal: "Deliver a credible transition and elections" },
  democracy: { lead: "Its democratic government focuses on growth, jobs and stability.", goal: "Deliver growth and win the next election" },
};

function templateAgenda(tag: string, name: string, gov: string): { persona: string; goals: string[] } {
  const region = REGION.get(tag) ?? "southAmerica";
  const r = REGION_TEXT[region];
  const k = govKind(gov);
  if (MICRO.has(tag))
    return {
      persona: `${name} is a small state that relies on diplomacy, international law and larger partners. It is ${r.where}.`,
      goals: [r.goals[0]!, "Gain partners and a voice in international forums"],
    };
  const goals = [r.goals[0]!, r.goals[1] ?? GOV_TEXT[k].goal];
  if (CONFLICT.has(tag)) goals.push("Contain insurgency and armed groups at home");
  else goals.push(GOV_TEXT[k].goal);
  return { persona: `${name} is ${r.where}. ${GOV_TEXT[k].lead}`, goals };
}

// ---------- Countries ----------

const usaMil = (milWb.get("USA") ?? 950e9) / 1e9;
const MIL_UNIT = 0.1; // log scale over spending in units of $100M, so small militaries still register
const milIndex = (bn: number) => (100 * Math.log10(1 + bn / MIL_UNIT)) / Math.log10(1 + usaMil / MIL_UNIT);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const roundSig = (v: number) => (v >= 100 ? Math.round(v) : v >= 1 ? round1(v) : Math.round(v * 1000) / 1000);

let withWb = 0;
const estimated: string[] = [];
const countries: Country[] = start.countries.map((c) => {
  const tag = c.tag;
  const est: string[] = [];
  const gdpRaw = gdpWb.get(tag);
  const gdp = gdpRaw != null ? gdpRaw / 1e9 : (est.push("gdp"), GDP_EST[tag]);
  const popRaw = popWb.get(tag);
  const population = popRaw != null ? popRaw / 1e6 : (est.push("population"), POP_EST[tag]);
  if (gdp == null) throw new Error(`no GDP for ${tag}`);
  if (population == null) throw new Error(`no population for ${tag}`);
  const milRaw = milWb.get(tag);
  let milBn: number;
  if (MIL_EST[tag] != null) (milBn = MIL_EST[tag]!), est.push("military");
  else if (milRaw != null && milRaw > 0) milBn = milRaw / 1e9;
  else (milBn = gdp * 0.012), est.push("military(1.2% GDP)"), warn(`military spending for ${tag} defaulted to 1.2% of GDP`);
  const military = Math.round(clamp(milIndex(milBn) + (MIL_ADJ[tag] ?? 0), 0, 100));

  const pv = pvWb.get(tag);
  let stability = pv != null ? 12 + ((pv + 2.5) * 73) / 4 : 50;
  if (pv == null && STABILITY_SET[tag] == null) warn(`no stability data for ${tag}, using 50`);
  if (STABILITY_SET[tag] != null) stability = STABILITY_SET[tag]!;
  stability = Math.round(clamp(stability, 5, 95));

  if (est.length) estimated.push(`${tag}(${est.join(",")})`);
  else withWb++;

  const lead = leaders[tag];
  if (!lead) warn(`no leader entry for ${tag}; using defaults`);
  const government = lead?.government ?? "Republic";
  const leader = lead?.leader ?? "Head of state";
  const agenda = agendas[tag] ?? templateAgenda(tag, c.name, government);

  const country: Country = {
    tag,
    name: c.name,
    color: c.color,
    government,
    leader,
    gdp: roundSig(gdp),
    population: roundSig(population),
    stability,
    military,
    warExhaustion: WAR_EXHAUSTION[tag] ?? 0,
    agenda,
    alive: true,
  };
  if (NUCLEAR.has(tag)) country.nuclear = true;
  return country;
});

// ---------- Flags ----------

const FLAG_OVERRIDES: Record<string, string> = { KOS: "iso:xk", PSX: "iso:ps", TWN: "iso:tw", SOL: "hist:somaliland", CYN: "hist:trnc" };
for (const c of countries) {
  const flag = (await flagFor(c.tag, FLAG_OVERRIDES)) ?? (["KAS", "PGA"].includes(c.tag) ? deriveFlag(c.color, c.tag) : undefined);
  if (!flag) throw new Error(`no flag for ${c.tag}`);
  c.flag = flag;
}

// ---------- Tag helpers ----------

const NON_UN = new Set(["TWN", "KOS", "SOL", "CYN", "PSX", "VAT", "KAS", "PGA"]);
const EU = orgsRaw.find((o) => o.id === "eu")!.members as string[];
const GROUPS: Record<string, string[]> = { "@UN": TAGS.filter((t) => !NON_UN.has(t)), "@EU": EU };

function tags(list: string[] | string, where: string): string[] {
  const arr = typeof list === "string" ? [list] : list;
  const out: string[] = [];
  for (const t of arr) {
    if (GROUPS[t]) out.push(...GROUPS[t]!);
    else if (TAGSET.has(t)) out.push(t);
    else warn(`${where}: unknown tag ${t} (dropped)`);
  }
  return [...new Set(out)];
}

// ---------- Organisations ----------

const organizations: Organization[] = orgsRaw.map((o) => {
  const where = `org ${o.id}`;
  const members = tags(o.members, where);
  return {
    ...o,
    members,
    observers: tags(o.observers, `${where} observers`),
    suspended: tags(o.suspended, `${where} suspended`).filter((t) => members.includes(t) || (warn(`${where}: suspended ${t} is not a member`), false)),
    candidates: o.candidates.filter((c) => TAGSET.has(c.tag) || (warn(`${where}: unknown candidate ${c.tag}`), false)),
    bodies: o.bodies.map((b) => ({
      ...b,
      seats: tags(b.seats, `${where}/${b.id} seats`),
      ...(b.veto ? { veto: tags(b.veto, `${where}/${b.id} veto`) } : {}),
    })),
  };
});
const un = organizations.find((o) => o.id === "un")!;
if (un.members.length !== 193) warn(`UN has ${un.members.length} members, expected 193`);

// ---------- Treaties, wars, sanctions ----------

const treaties: Treaty[] = treatiesRaw.map((t) => ({ ...t, members: tags(t.members, `treaty ${t.id}`) }));
const wars: War[] = warsRaw.map((w) => ({
  ...w,
  attackers: tags(w.attackers, `war ${w.id}`),
  defenders: tags(w.defenders, `war ${w.id}`),
}));
const sanctions: Sanction[] = sanctionsRaw.map((s) => {
  if (!TAGSET.has(s.target)) warn(`sanction ${s.id}: unknown target ${s.target}`);
  return { ...s, by: tags(s.by, `sanction ${s.id}`).filter((t) => t !== s.target) };
});

// ---------- Relations ----------

const relations: Record<string, number> = {};
for (const [a, b, v] of relationsRaw) {
  if (!TAGSET.has(a) || !TAGSET.has(b)) { warn(`relation ${a}-${b}: unknown tag`); continue; }
  if (a === b) { warn(`relation ${a}-${b}: self`); continue; }
  const key = relKey(a, b);
  if (key in relations) warn(`relation ${key} listed twice (keeping first)`);
  else relations[key] = clamp(Math.round(v), -100, 100);
}

// ---------- Calendar and formables ----------

const calendar: CalendarEntry[] = calendarRaw
  .map((e) => ({ ...e, countries: tags(e.countries, `calendar "${e.title}"`) }))
  .sort((x, y) => x.date.localeCompare(y.date));
const meta = (await Bun.file(join(ROOT, "packages", "mapdata", "public", "map", "provinces.json")).json()) as MapMeta;

// Formables: a fixed identity over the start territory of `countries` plus any named regions.
type FormableRaw = Omit<Formable, "provinces" | "formers"> & {
  formers?: string[];
  /** Named regions of other countries. */
  regions?: { owner: string; names: string[] }[];
  /** Whole modern map units held by someone else at the start (e.g. a colony). */
  units?: string[];
};
const formables: Formable[] = (formablesRaw as unknown as FormableRaw[]).map((f) => {
  const countries = tags(f.countries, `formable ${f.name}`);
  const members = new Set(countries.map((t) => TAGS.indexOf(t)));
  const provinces = start.owners.flatMap((o, id) => (id > 0 && members.has(o) ? [id] : []));
  for (const r of f.regions ?? []) {
    const owner = TAGS.indexOf(r.owner);
    for (const name of r.names) {
      const p = meta.provinces.find((x) => x.name === name && start.owners[x.id] === owner);
      if (p) provinces.push(p.id);
      else warn(`formable ${f.name}: no region "${name}" held by ${r.owner}`);
    }
  }
  if (!/^#[0-9a-f]{6}$/i.test(f.color)) warn(`formable ${f.name}: bad colour ${f.color}`);
  for (const u of f.units ?? []) {
    const ids = meta.provinces.filter((x) => x.defaultOwner === u).map((x) => x.id);
    if (!ids.length) warn(`formable ${f.name}: no map unit ${u}`);
    provinces.push(...ids);
  }
  const { regions: _regions, units: _units, ...rest } = f;
  return { ...rest, countries, formers: tags(f.formers ?? f.countries, `formable ${f.name} formers`), provinces: [...new Set(provinces)] };
});

// ---------- Territorial disputes ----------
// disputes.json names regions as the map does, held by `holder` at the start ("*" = all of them).

const disputesRaw = (await Bun.file(join(SCEN, "disputes.json")).json()) as { claimant: string; holder: string; regions: string[] | "*"; note: string }[];
const disputes = disputesRaw.flatMap((d) => {
  if (!TAGSET.has(d.claimant) || !TAGSET.has(d.holder)) {
    warn(`dispute ${d.claimant}→${d.holder}: unknown tag`);
    return [];
  }
  const holder = TAGS.indexOf(d.holder);
  const held = meta.provinces.filter((p) => start.owners[p.id] === holder);
  const provinces = d.regions === "*"
    ? held.map((p) => p.id)
    : d.regions.flatMap((name) => {
      const p = held.find((x) => x.name === name);
      if (!p) warn(`dispute ${d.claimant}→${d.holder}: no region "${name}" held by ${d.holder}`);
      return p ? [p.id] : [];
    });
  return provinces.length ? [{ claimant: d.claimant, provinces, note: d.note }] : [];
});

// ---------- Assemble and validate ----------

const seed: ScenarioSeed = {
  id: "modern-2026",
  name: "Modern Day",
  date: "2026-01-01",
  description: "The world as it stands on New Year's Day 2026: a war in Ukraine, a fragile Gaza ceasefire, tariff wars and an AI boom. Write the next chapter.",
  theme: "modern",
  countries,
  owners: start.owners,
  controllers: start.controllers,
  relations,
  treaties,
  wars,
  sanctions,
  organizations,
  calendar,
  worldBrief,
  rules,
  formables,
  disputes,
};

const errors: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) errors.push(msg); };
check(seed.countries.length === start.countries.length, "country count differs from start.json");
seed.countries.forEach((c, i) => {
  check(c.tag === start.countries[i]!.tag, `country ${i} tag mismatch`);
  for (const k of ["gdp", "population", "stability", "military", "warExhaustion"] as const)
    check(Number.isFinite(c[k]) && c[k] >= 0, `${c.tag}.${k} is not a finite non-negative number (${c[k]})`);
  for (const k of ["stability", "military", "warExhaustion"] as const) check(c[k] <= 100, `${c.tag}.${k} > 100`);
  check(!!c.agenda.persona && c.agenda.goals.length > 0, `${c.tag} has an empty agenda`);
});
const known = (t: string, where: string) => check(TAGSET.has(t), `${where}: unknown tag ${t}`);
for (const o of organizations) {
  for (const t of [...o.members, ...o.observers, ...o.suspended, ...o.candidates.map((c) => c.tag)]) known(t, `org ${o.id}`);
  for (const b of o.bodies) for (const t of [...b.seats, ...(b.veto ?? [])]) known(t, `org ${o.id}/${b.id}`);
}
for (const t of treaties) t.members.forEach((m) => known(m, `treaty ${t.id}`));
for (const w of wars) [...w.attackers, ...w.defenders].forEach((m) => known(m, `war ${w.id}`));
for (const s of sanctions) [s.target, ...s.by].forEach((m) => known(m, `sanction ${s.id}`));
for (const k of Object.keys(relations)) k.split("|").forEach((m) => known(m, `relation ${k}`));
for (const e of calendar) e.countries.forEach((m) => known(m, `calendar ${e.title}`));
for (const f of formables) f.countries.forEach((m) => known(m, `formable ${f.name}`));
check(seed.owners.length === seed.controllers.length, "owners/controllers length mismatch");
for (const arr of [seed.owners, seed.controllers])
  for (const v of arr) if (v >= seed.countries.length) { errors.push(`province owner index ${v} out of range`); break; }

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}

await Bun.write(join(SCEN, "seed.json"), JSON.stringify(seed));

const nAgenda = countries.filter((c) => agendas[c.tag]).length;
console.log(
  `seed.json: ${countries.length} countries (${withWb} fully from World Bank, ${estimated.length} with estimates: ${estimated.join(" ")})`,
);
console.log(
  `  ${nAgenda} hand-written agendas, ${Object.keys(leaders).length} leader entries, ${organizations.length} orgs, ${treaties.length} treaties, ` +
    `${wars.length} wars, ${sanctions.length} sanctions, ${Object.keys(relations).length} relations, ${calendar.length} calendar entries, ` +
    `${formables.length} formables, ${warnings.length} warnings`,
);
