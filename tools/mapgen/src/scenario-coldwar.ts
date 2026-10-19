// Builds packages/scenarios/cold-war-1962/seed.json (ScenarioSeed) for the Cold War scenario (1 October 1962).
//
// Inputs:
//   - The modern base map (packages/mapdata/public/map/provinces.json). Every province is mapped to its
//     October 1962 polity with the rules in `polityOf` below (tables + a few name/latitude rules).
//   - Hand-maintained data in the scenario folder: countries (names, colours, governments, leaders, stats),
//     agendas, organizations, treaties, wars, sanctions, relations, calendar, formables, world-brief.md, rules.md.
//
// Statistics are rough era estimates, not measured data:
//   - GDP in current 1962 US dollars (billions). Western figures follow World Bank / OECD historical series
//     rounded; Soviet-bloc, Chinese, North Korean/Vietnamese and Cuban GDPs are CIA-style dollar estimates and
//     are very uncertain (USSR 280, PRC 47, GDR 25, Poland 20, Czechoslovakia 15, Cuba 3.5).
//   - Population in millions (UN 1962 estimates). Colonial powers include their colonies' populations and
//     GDP (Victoria-style ownership), e.g. UK 53 home + ~29 colonial, Portugal 9 + ~13 (Angola, Mozambique…).
//   - Military index 0–100: USA 100, USSR 95, then scaled by spending, manpower and nuclear status.
//   - Stability 0–100 is a judgement call; internal conflicts (Laos, South Vietnam, Yemen, Congo, Iraq,
//     Algeria's post-independence crisis) are reflected in low values. No interstate war is open on the start
//     date; war exhaustion records recent or ongoing colonial and civil wars.
//
// Flags: polities that still exist use today's flag ("iso:", via Natural Earth ISO codes) unless their
// 1962 flag differed notably; those, and defunct states, use historical flags drawn in the client
// (apps/web/src/flags/historical.ts). Czechoslovakia's flag is today's Czech flag; Libya's 1951 and
// Syria's 1961–63 flags are the ones in use today.
//
// Organisation judgement calls:
//   - UN: 108 seats on 1 Oct 1962; Byelorussia and Ukraine sit separately but are part of SOV on this map, so
//     106 tags are members. Algeria (admitted 8 Oct) and Kuwait (Soviet veto 1961) are candidates.
//   - SEATO and CENTO: `mutualDefense` is false. SEATO's Article IV only obliges members to "meet the common
//     danger in accordance with constitutional processes" and CENTO had no unified command; both acted as
//     consultative security forums. The binding US bilateral treaties are listed separately.
//   - OAS: the Rio Treaty is modelled as a defensive treaty (without Cuba, excluded in January 1962), so the
//     OAS organisation itself carries no mutualDefense flag (which would also call Cuba).
//   - OPEC: Qatar (member since 1961) is a British protected state on this map, so it is not listed.

import { join } from "node:path";
import {
  relKey,
  unproject,
  type CalendarEntry,
  type Country,
  type Formable,
  type MapMeta,
  type Organization,
  type ProvinceMeta,
  type Sanction,
  type ScenarioSeed,
  type Treaty,
  type War,
} from "@worldline/shared";
import { flagFor } from "./flags.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const MAP = join(ROOT, "packages", "mapdata", "public", "map");
const SCEN = join(ROOT, "packages", "scenarios", "cold-war-1962");

const meta = (await Bun.file(join(MAP, "provinces.json")).json()) as MapMeta;
const warnings: string[] = [];
const warn = (msg: string) => warnings.push(msg);

// ---------- Province → 1962 polity ----------

/** Modern adm0 / owner codes absorbed whole into a 1962 polity (checked against adm0 first, then defaultOwner). */
const MERGE: Record<string, string> = {
  // Soviet Union (KAB = Baikonur lease, Crimea is in RUS on the base map).
  RUS: "SOV", UKR: "SOV", BLR: "SOV", LTU: "SOV", LVA: "SOV", EST: "SOV", MDA: "SOV", GEO: "SOV", ARM: "SOV",
  AZE: "SOV", KAZ: "SOV", KAB: "SOV", UZB: "SOV", TKM: "SOV", KGZ: "SOV", TJK: "SOV",
  // Yugoslavia and Czechoslovakia.
  SVN: "YUG", HRV: "YUG", BIH: "YUG", SRB: "YUG", MNE: "YUG", MKD: "YUG", KOS: "YUG",
  CZE: "CSK", SVK: "CSK",
  // Federation of Rhodesia and Nyasaland.
  ZMB: "RNY", ZWE: "RNY", MWI: "RNY",
  // Pakistan includes East Pakistan; Ethiopia includes (federated) Eritrea; Sudan includes the South;
  // Somalia includes former British Somaliland; Cyprus is undivided.
  BGD: "PAK", ERI: "ETH", SDS: "SDN", SOL: "SOM", CYN: "CYP",
  // Siachen glacier: unoccupied in 1962, part of Indian-claimed Kashmir.
  KAS: "IND",
  // Spratlys: the ROC garrisoned Itu Aba (Taiping) from 1956. Paracels stay with the PRC (the RVN held the
  // Crescent group, but the map has one province).
  PGA: "TWN",
  // United Kingdom: colonies, protectorates and protected states.
  KEN: "GBR", UGA: "GBR", GMB: "GBR", BWA: "GBR", LSO: "GBR", SWZ: "GBR", MUS: "GBR", SYC: "GBR",
  GUY: "GBR", BLZ: "GBR", BHS: "GBR", BRB: "GBR", ATG: "GBR", DMA: "GBR", GRD: "GBR", KNA: "GBR", LCA: "GBR", VCT: "GBR",
  MLT: "GBR", BHR: "GBR", QAT: "GBR", ARE: "GBR", BRN: "GBR", SGP: "GBR", MDV: "GBR", HKG: "GBR",
  FJI: "GBR", SLB: "GBR", KIR: "GBR", TUV: "GBR", TON: "GBR",
  VUT: "GBR", // New Hebrides: Anglo-French condominium, given to Britain.
  // France.
  DJI: "FRA", COM: "FRA",
  // Portugal.
  AGO: "PRT", MOZ: "PRT", GNB: "PRT", CPV: "PRT", STP: "PRT", TLS: "PRT", MAC: "PRT",
  // Spain: Spanish Sahara (see SPANISH_SAHARA for the Moroccan-coded parts) and Spanish Guinea.
  SAH: "ESP", GNQ: "ESP",
  // Netherlands.
  SUR: "NLD",
  // Australia: Territory of Papua and New Guinea, Nauru trust territory.
  PNG: "AUS", NRU: "AUS",
  // United States: Trust Territory of the Pacific Islands.
  FSM: "USA", MHL: "USA", PLW: "USA",
  // South Africa: South West Africa mandate.
  NAM: "ZAF",
};

/** Provinces reassigned by name (key "MODERN_OWNER:Province name"). */
const BY_NAME: Record<string, string> = {
  // East Germany. Berlin is merged into Brandenburg on the base map, so West Berlin sits inside the GDR.
  "DEU:Mecklenburg-Vorpommern": "DDR", "DEU:Brandenburg": "DDR", "DEU:Sachsen": "DDR", "DEU:Sachsen-Anhalt": "DDR", "DEU:Thüringen": "DDR",
  // Federation of South Arabia (Aden colony + protectorates; Aden and Ad Dali' are merged into Lahij on the map).
  "YEM:Lahij": "GBR", "YEM:Abyan": "GBR", "YEM:Shabwah": "GBR", "YEM:Hadramawt": "GBR", "YEM:Al Mahrah": "GBR",
  // British North Borneo, Sarawak (and Labuan).
  "MYS:Sabah": "GBR", "MYS:Sarawak": "GBR", "MYS:Labuan": "GBR",
  // Zanzibar protectorate (Unguja and Pemba are one province on the map).
  "TZA:Zanzibar South and Central": "GBR",
  // Okinawa under US administration (Ryukyu Islands).
  "JPN:Okinawa": "USA",
  // West New Guinea: UNTEA from 1 Oct 1962, transfer to Indonesia on 1 May 1963. Kept Dutch until then.
  "IDN:Papua": "NLD", "IDN:Papua Barat": "NLD",
  // 1949 armistice lines.
  "PSX:West Bank": "JOR", "PSX:Gaza Strip": "EGY",
  // Spanish Sahara (Río de Oro and Saguia el-Hamra) coded as Morocco on the base map.
  "MAR:Oued el Dahab": "ESP", "MAR:Laâyoune - Boujdour - Sakia El Hamra": "ESP",
};
// Remaining YEM provinces become the Yemen Arab Republic.
const RENAME: Record<string, string> = { YEM: "YAR" };
const VIETNAM_17TH = 17.0;

const used = new Set<string>();
function polityOf(p: ProvinceMeta): string {
  const key = `${p.defaultOwner}:${p.name}`;
  const keyAdm = `${p.adm0}:${p.name}`;
  if (BY_NAME[key]) return used.add(key), BY_NAME[key];
  if (BY_NAME[keyAdm]) return used.add(keyAdm), BY_NAME[keyAdm];
  if (p.defaultOwner === "VNM") return unproject(p.cx, p.cy)[1] >= VIETNAM_17TH ? "VNM" : "RVN";
  if (MERGE[p.adm0]) return MERGE[p.adm0];
  if (MERGE[p.defaultOwner]) return MERGE[p.defaultOwner];
  return RENAME[p.defaultOwner] ?? p.defaultOwner;
}

const polity = new Map<number, string>();
for (const p of meta.provinces) polity.set(p.id, polityOf(p));
for (const k of Object.keys(BY_NAME)) if (!used.has(k)) throw new Error(`BY_NAME: no province matches ${k}`);

// ---------- Countries ----------

interface CountryData {
  name: string; color?: string; gov: string; leader: string; gdp: number; pop: number; stab: number; mil: number;
}
const data = (await Bun.file(join(SCEN, "countries.json")).json()) as Record<string, CountryData | string>;
delete data._note;
const cdata = data as Record<string, CountryData>;

const owningTags = new Set(polity.values());
for (const t of owningTags) if (!cdata[t]) throw new Error(`province owner ${t} has no entry in countries.json`);
for (const t of Object.keys(cdata)) if (!owningTags.has(t)) throw new Error(`countries.json: ${t} owns no province`);

const TAGS = [...owningTags].sort();
const TAGSET = new Set(TAGS);
const index = new Map(TAGS.map((t, i) => [t, i]));

const owners: number[] = new Array(meta.provinces.length + 1).fill(-1);
for (const p of meta.provinces) owners[p.id] = index.get(polity.get(p.id)!)!;
const controllers = [...owners];

// ---------- Colours ----------

const countryNeighbors = TAGS.map(() => new Set<number>());
for (const p of meta.provinces) for (const n of p.neighbors) {
  const a = owners[p.id], b = owners[n];
  if (a >= 0 && b >= 0 && a !== b) { countryNeighbors[a].add(b); countryNeighbors[b].add(a); }
}
const size = TAGS.map(() => 0);
for (const p of meta.provinces) size[owners[p.id]] += p.areaKm2;

const hsl = (h: number, s: number, l: number) => {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
};
// Vintage palette: lower saturation than the modern scenario, slightly warm.
const palette: number[][] = [];
for (let h = 0; h < 360; h += 12) for (const [s, l] of [[0.3, 0.54], [0.22, 0.64], [0.28, 0.44]]) palette.push(hsl(h, s, l));
const hex = (c: number[]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a: number[], b: number[]) => {
  const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
};

const colors: (number[] | null)[] = TAGS.map((t) => {
  const c = cdata[t].color;
  if (c && !/^#[0-9a-f]{6}$/i.test(c)) throw new Error(`${t}: bad colour ${c}`);
  return c ? parse(c) : null;
});
const order = TAGS.map((_, i) => i).filter((i) => !colors[i]).sort((a, b) => size[b] - size[a]);
const usedColor = new Map<string, number>();
for (const i of order) {
  let best = palette[0], bestScore = -Infinity;
  palette.forEach((c, k) => {
    let near = Infinity;
    for (const n of countryNeighbors[i]) if (colors[n]) near = Math.min(near, dist(c, colors[n]!));
    for (const n of countryNeighbors[i]) for (const m of countryNeighbors[n]) if (m !== i && colors[m]) near = Math.min(near, dist(c, colors[m]!) * 1.6);
    const score = Math.min(near, 400) - (usedColor.get(hex(c)) ?? 0) * 18 + ((i * 7 + k * 13) % 5);
    if (score > bestScore) { bestScore = score; best = c; }
  });
  colors[i] = best;
  usedColor.set(hex(best), (usedColor.get(hex(best)) ?? 0) + 1);
}

const MIN_CONTRAST = 70;
for (let i = 0; i < TAGS.length; i++) for (const n of countryNeighbors[i]) {
  if (n > i && dist(colors[i]!, colors[n]!) < MIN_CONTRAST) {
    warn(`low contrast: ${TAGS[i]} ${hex(colors[i]!)} vs ${TAGS[n]} ${hex(colors[n]!)} (${dist(colors[i]!, colors[n]!).toFixed(0)})`);
  }
}

// ---------- Template agendas ----------

const agendas = (await Bun.file(join(SCEN, "agendas.json")).json()) as Record<string, { persona: string; goals: string[] }>;
for (const t of Object.keys(agendas)) if (!TAGSET.has(t)) warn(`agendas.json: unknown tag ${t}`);

type Region =
  | "westEurope" | "nordic" | "southEurope" | "eastBloc" | "eastAsia" | "southeastAsia" | "southAsia" | "middleEast"
  | "northAfrica" | "westAfrica" | "centralAfrica" | "eastAfrica" | "southernAfrica" | "northAmerica" | "centralAmerica"
  | "caribbean" | "southAmerica" | "oceania";

const REGION_LIST: Record<Region, string> = {
  westEurope: "GBR FRA DEU ITA BEL NLD LUX IRL AUT CHE",
  nordic: "DNK NOR SWE FIN ISL",
  southEurope: "ESP PRT GRC TUR CYP MCO AND SMR LIE VAT",
  eastBloc: "SOV DDR POL CSK HUN BGR ROU ALB MNG YUG",
  eastAsia: "CHN TWN JPN KOR PRK",
  southeastAsia: "VNM RVN LAO KHM THA MMR MYS IDN PHL",
  southAsia: "IND PAK LKA NPL BTN AFG",
  middleEast: "IRN IRQ SYR LBN JOR ISR SAU KWT YAR OMN EGY",
  northAfrica: "MAR DZA TUN LBY SDN",
  westAfrica: "MRT MLI SEN GIN SLE LBR CIV BFA GHA TGO BEN NER NGA",
  centralAfrica: "CMR TCD CAF GAB COG COD RWA BDI",
  eastAfrica: "ETH SOM TZA MDG",
  southernAfrica: "RNY ZAF",
  northAmerica: "USA CAN MEX",
  centralAmerica: "GTM HND SLV NIC CRI PAN",
  caribbean: "CUB HTI DOM JAM TTO",
  southAmerica: "COL VEN ECU PER BOL BRA ARG CHL PRY URY",
  oceania: "AUS NZL WSM",
};
const REGION = new Map<string, Region>();
for (const [r, list] of Object.entries(REGION_LIST) as [Region, string][])
  for (const t of list.split(" ")) {
    if (!TAGSET.has(t)) warn(`region list: unknown tag ${t}`);
    REGION.set(t, r);
  }
for (const t of TAGS) if (!REGION.has(t)) warn(`no region for ${t}`);

const REGION_TEXT: Record<Region, { where: string; goals: string[] }> = {
  westEurope: { where: "a Western European democracy rebuilding prosperity under the American nuclear umbrella", goals: ["Keep the US committed to Europe's defence", "Share in the postwar boom and European integration", "Contain domestic communist and colonial-war pressures"] },
  nordic: { where: "a Nordic state balancing Western ties, neutrality and its Soviet neighbour", goals: ["Avoid provoking the Soviet Union", "Protect its welfare state and trade with Europe", "Support the UN and peacekeeping"] },
  southEurope: { where: "a southern European state on the edge of the Western alliance", goals: ["Secure American aid and bases on favourable terms", "Modernise a poor economy", "Keep domestic order"] },
  eastBloc: { where: "a socialist state in the Soviet sphere", goals: ["Fulfil the plan and raise living standards", "Stay in Moscow's good graces while widening its own room", "Keep the party's monopoly of power"] },
  eastAsia: { where: "an East Asian state on the front line between the communist and Western camps", goals: ["Secure great-power protection", "Industrialise rapidly"] },
  southeastAsia: { where: "a Southeast Asian state caught between communist insurgency, Western alliances and neutralism", goals: ["Keep out of the Indochina wars", "Contain communist insurgents", "Attract foreign aid"] },
  southAsia: { where: "a South Asian state between India, Pakistan and China", goals: ["Balance its larger neighbours", "Secure development aid from both blocs", "Keep domestic stability"] },
  middleEast: { where: "a Middle Eastern state in the 'Arab Cold War' between Nasserism and the monarchies, with oil and Israel at stake", goals: ["Survive Nasserist or royalist subversion", "Secure oil revenue and outside patrons", "Keep the army loyal"] },
  northAfrica: { where: "a newly independent North African state navigating Arab nationalism and ties with France", goals: ["Consolidate independence and national unity", "Secure aid from both blocs", "Settle borders with its neighbours"] },
  westAfrica: { where: "a newly independent West African state", goals: ["Build a nation and an economy from colonial structures", "Choose between the radical Casablanca and moderate Monrovia blocs", "Keep aid flowing from the former colonial power"] },
  centralAfrica: { where: "a newly independent Central African state in the shadow of the Congo crisis", goals: ["Keep the Congo crisis from spilling over", "Secure French or Belgian aid and protection", "Hold the new state together"] },
  eastAfrica: { where: "an East African state amid decolonisation and border disputes", goals: ["Settle colonial-era border disputes", "Attract development aid", "Support the liberation of remaining colonies"] },
  southernAfrica: { where: "a white-minority state in southern Africa facing African nationalism", goals: ["Preserve minority rule", "Contain nationalist movements", "Keep Western trade and support"] },
  northAmerica: { where: "a North American state tied to the US economy and alliance", goals: ["Manage relations with Washington", "Sustain growth and development"] },
  centralAmerica: { where: "a Central American state dominated by landed elites, the army and US fruit and security interests", goals: ["Keep Washington's favour and Alliance for Progress aid", "Contain leftist and Castroist agitation", "Settle border disputes with neighbours"] },
  caribbean: { where: "a Caribbean state in the shadow of the Cuban revolution and the United States", goals: ["Keep good terms with Washington", "Develop tourism and commodity exports", "Contain revolutionary agitation"] },
  southAmerica: { where: "a South American state facing inflation, military politics and the Cuban challenge", goals: ["Secure Alliance for Progress aid", "Contain inflation and labour unrest", "Keep the military out of politics, or in power"] },
  oceania: { where: "a Pacific state anchored to the Western alliance", goals: ["Keep the American and British alliances strong", "Expand trade with Asia and Europe"] },
};

type GovKind = "communist" | "junta" | "monarchy" | "oneParty" | "authoritarian" | "colonialMinority" | "democracy";
function govKind(gov: string): GovKind {
  const g = gov.toLowerCase();
  if (g.includes("marxist") || g.includes("revolutionary socialist")) return "communist";
  if (g.includes("junta") || g.includes("military")) return "junta";
  if (g.includes("absolute")) return "monarchy";
  if (g.includes("white-minority")) return "colonialMinority";
  if (g.includes("one-party") || g.includes("dominant")) return "oneParty";
  if (g.includes("dictatorship") || g.includes("authoritarian")) return "authoritarian";
  return "democracy";
}
const GOV_TEXT: Record<GovKind, { lead: string; goal: string }> = {
  communist: { lead: "Its communist party rules in the name of the working class and follows the bloc line.", goal: "Keep the party's monopoly of power" },
  junta: { lead: "Its officers rule in the name of order and anti-corruption, promising an eventual return to civilian government.", goal: "Keep the army united behind the regime" },
  monarchy: { lead: "Its monarch rules directly and fears revolutionary nationalism.", goal: "Preserve the dynasty's authority" },
  oneParty: { lead: "Its ruling party claims to embody the nation and tolerates little opposition.", goal: "Keep the ruling party's grip on power" },
  authoritarian: { lead: "Its strongman regime prizes order and anti-communism.", goal: "Keep the regime secure and the opposition contained" },
  colonialMinority: { lead: "Its white minority government refuses majority rule.", goal: "Preserve white-minority rule" },
  democracy: { lead: "Its elected government focuses on growth, jobs and stability.", goal: "Deliver growth and win the next election" },
};
const MICRO = new Set(["AND", "LIE", "MCO", "SMR", "VAT", "WSM", "BTN"]);

function templateAgenda(tag: string, name: string, gov: string) {
  const r = REGION_TEXT[REGION.get(tag) ?? "southAmerica"];
  const k = govKind(gov);
  if (MICRO.has(tag)) return { persona: `${name} is a small state that relies on larger protectors and diplomacy. It is ${r.where}.`, goals: [r.goals[0]!, "Preserve its autonomy and traditions"] };
  return { persona: `${name} is ${r.where}. ${GOV_TEXT[k].lead}`, goals: [r.goals[0]!, r.goals[1] ?? GOV_TEXT[k].goal, GOV_TEXT[k].goal] };
}

// ---------- Build countries ----------

const NUCLEAR = new Set(["USA", "SOV", "GBR", "FRA"]);
// Recent or ongoing colonial and civil wars.
const WAR_EXHAUSTION: Record<string, number> = { FRA: 20, DZA: 40, PRT: 15, RVN: 15, LAO: 25, COD: 25, YAR: 10, IRQ: 15, CUB: 5 };

const countries: Country[] = TAGS.map((tag, i) => {
  const d = cdata[tag];
  const c: Country = {
    tag,
    name: d.name,
    color: hex(colors[i]!),
    government: d.gov,
    leader: d.leader,
    gdp: d.gdp,
    population: d.pop,
    stability: d.stab,
    military: d.mil,
    warExhaustion: WAR_EXHAUSTION[tag] ?? 0,
    agenda: agendas[tag] ?? templateAgenda(tag, d.name, d.gov),
    alive: true,
  };
  if (NUCLEAR.has(tag)) c.nuclear = true;
  return c;
});

// ---------- Flags (October 1962) ----------

const FLAGS_1962: Record<string, string> = {
  SOV: "hist:su", DDR: "hist:ddr", YUG: "hist:yu", CSK: "iso:cz", RVN: "hist:rvn", YAR: "hist:yar", RNY: "hist:rny",
  EGY: "hist:uar", IRN: "hist:ir-lion", IRQ: "hist:iq1959", AFG: "hist:af-kingdom", MMR: "hist:mm1948",
  COD: "hist:cd1960", LAO: "hist:la-kingdom", RWA: "hist:rw1962", ETH: "hist:et-imperial", CAN: "hist:ca-ensign",
  ZAF: "hist:za1928", BFA: "hist:upper-volta", BDI: "hist:bi1962", CMR: "hist:cm1961", MRT: "hist:mr1959",
  TZA: "hist:tanganyika", SDN: "hist:sd1956", OMN: "hist:muscat", BGR: "hist:bg1948", ROU: "hist:ro1952",
  ESP: "hist:es1945", GRC: "hist:gr-cross", TWN: "iso:tw", LBY: "iso:ly", SYR: "iso:sy",
};
for (const c of countries) {
  const flag = await flagFor(c.tag, FLAGS_1962);
  if (!flag) throw new Error(`no flag for ${c.tag}`);
  c.flag = flag;
}

// ---------- Hand data ----------

const orgsRaw = (await Bun.file(join(SCEN, "organizations.json")).json()) as Organization[];
const treaties = (await Bun.file(join(SCEN, "treaties.json")).json()) as Treaty[];
const wars = (await Bun.file(join(SCEN, "wars.json")).json()) as War[];
const sanctions = (await Bun.file(join(SCEN, "sanctions.json")).json()) as Sanction[];
const relationsRaw = (await Bun.file(join(SCEN, "relations.json")).json()) as [string, string, number][];
const calendar = ((await Bun.file(join(SCEN, "calendar.json")).json()) as CalendarEntry[]).sort((x, y) => x.date.localeCompare(y.date));
const formables = (await Bun.file(join(SCEN, "formables.json")).json()) as Formable[];
const worldBrief = (await Bun.file(join(SCEN, "world-brief.md")).text()).trim();
const rules = (await Bun.file(join(SCEN, "rules.md")).text()).trim();
const organizations = orgsRaw;

// ---------- Relations: hand pairs, then bloc defaults for pairs not listed ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const relations: Record<string, number> = {};
let nHand = 0;
for (const [a, b, v] of relationsRaw) {
  if (!TAGSET.has(a) || !TAGSET.has(b)) { warn(`relation ${a}-${b}: unknown tag`); continue; }
  if (a === b) { warn(`relation ${a}-${b}: self`); continue; }
  const key = relKey(a, b);
  if (key in relations) warn(`relation ${key} listed twice (keeping first)`);
  else (relations[key] = clamp(Math.round(v), -100, 100)), nHand++;
}
const members = (id: string) => organizations.find((o) => o.id === id)!.members;
const fill = (a: string[], b: string[], v: number) => {
  for (const x of a) for (const y of b) if (x !== y && !(relKey(x, y) in relations)) relations[relKey(x, y)] = v;
};
const NATO = members("nato");
const WARSAW = members("warsaw").filter((t) => t !== "ALB");
fill(NATO, NATO, 45);
fill(WARSAW, WARSAW, 50);
fill(members("eec"), members("eec"), 50);
fill(members("efta"), members("efta"), 40);
fill(NATO, WARSAW, -40);
fill(members("commonwealth"), members("commonwealth"), 20);
const nDefault = Object.keys(relations).length - nHand;

// ---------- Assemble and validate ----------

const seed: ScenarioSeed = {
  id: "cold-war-1962",
  name: "Cold War",
  date: "1962-10-01",
  description:
    "October 1962: the Berlin Wall is a year old, Soviet ships are crowding into Cuban ports, and empires are dissolving across Africa and Asia. Two nuclear superpowers stand closer to the brink than either knows.",
  theme: "coldwar",
  countries,
  owners,
  controllers,
  relations,
  treaties,
  wars,
  sanctions,
  organizations,
  calendar,
  worldBrief,
  rules,
  formables,
};

const errors: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) errors.push(msg); };
const known = (t: string, where: string) => check(TAGSET.has(t), `${where}: unknown tag ${t}`);
const isDate = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

for (const c of countries) {
  for (const k of ["gdp", "population", "stability", "military", "warExhaustion"] as const)
    check(Number.isFinite(c[k]) && c[k] >= 0, `${c.tag}.${k} is not a finite non-negative number (${c[k]})`);
  for (const k of ["stability", "military", "warExhaustion"] as const) check(c[k] <= 100, `${c.tag}.${k} > 100`);
  check(/^#[0-9a-f]{6}$/.test(c.color), `${c.tag}: bad colour ${c.color}`);
  check(!!c.name && !!c.government && !!c.leader, `${c.tag}: missing name/government/leader`);
  check(!!c.agenda.persona && c.agenda.goals.length > 0, `${c.tag} has an empty agenda`);
}
const ids = new Set<string>();
for (const o of organizations) {
  check(!ids.has(o.id), `duplicate org id ${o.id}`), ids.add(o.id);
  for (const t of [...o.members, ...o.observers, ...o.suspended, ...o.candidates.map((c) => c.tag)]) known(t, `org ${o.id}`);
  check(new Set(o.members).size === o.members.length, `org ${o.id}: duplicate members`);
  for (const t of o.suspended) check(o.members.includes(t), `org ${o.id}: suspended ${t} is not a member`);
  for (const t of o.candidates) check(!o.members.includes(t.tag), `org ${o.id}: candidate ${t.tag} is already a member`);
  for (const b of o.bodies) {
    for (const t of [...b.seats, ...(b.veto ?? [])]) known(t, `org ${o.id}/${b.id}`);
    for (const t of b.seats) check(o.members.includes(t), `org ${o.id}/${b.id}: seat ${t} is not a member`);
    for (const t of b.veto ?? []) check(b.seats.includes(t), `org ${o.id}/${b.id}: veto ${t} has no seat`);
  }
  check(Number.isFinite(o.cohesion) && o.cohesion >= 0 && o.cohesion <= 100, `org ${o.id}: bad cohesion`);
}
const un = organizations.find((o) => o.id === "un")!;
check(un.members.length === 106, `UN has ${un.members.length} member tags, expected 106 (108 seats minus BSSR and UkrSSR)`);
check(NATO.length === 15, `NATO has ${NATO.length} members, expected 15`);
for (const t of treaties) { t.members.forEach((m) => known(m, `treaty ${t.id}`)); check(isDate(t.since), `treaty ${t.id}: bad date`); }
for (const w of wars) [...w.attackers, ...w.defenders].forEach((m) => known(m, `war ${w.id}`));
for (const s of sanctions) { [s.target, ...s.by].forEach((m) => known(m, `sanction ${s.id}`)); check(!s.by.includes(s.target), `sanction ${s.id}: target sanctions itself`); }
for (const [k, v] of Object.entries(relations)) {
  k.split("|").forEach((m) => known(m, `relation ${k}`));
  check(Number.isFinite(v) && v >= -100 && v <= 100, `relation ${k}: bad value ${v}`);
}
for (const e of calendar) { e.countries.forEach((m) => known(m, `calendar ${e.title}`)); check(isDate(e.date) && e.date >= seed.date, `calendar ${e.title}: bad date`); }
for (const f of formables) f.countries.forEach((m) => known(m, `formable ${f.name}`));
check(owners.length === meta.provinces.length + 1 && owners[0] === -1, "owners array must be indexed by province id with index 0 = -1");
check(owners.length === controllers.length, "owners/controllers length mismatch");
for (const p of meta.provinces) check(owners[p.id] >= 0 && owners[p.id] < countries.length, `province ${p.id} owner out of range`);
for (const arr of [owners, controllers]) for (const v of arr) check(Number.isInteger(v) && v >= -1 && v < countries.length, `owner index ${v} out of range`);
const owned = countries.map(() => 0);
for (const v of owners) if (v >= 0) owned[v]++;
countries.forEach((c, i) => check(owned[i] > 0, `${c.tag} owns no province`));
const words = worldBrief.split(/\s+/).length;
if (words < 600 || words > 900) warn(`world brief has ${words} words (target 600-900)`);

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of [...new Set(errors)]) console.error(`error: ${e}`);
  process.exit(1);
}

await Bun.write(join(SCEN, "seed.json"), JSON.stringify(seed));

// ---------- Summary ----------

const byOwner = new Map<string, number>();
for (const p of meta.provinces) byOwner.set(polity.get(p.id)!, (byOwner.get(polity.get(p.id)!) ?? 0) + 1);
const top = [...byOwner].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t} ${n}`).join(", ");
const nAgenda = countries.filter((c) => agendas[c.tag]).length;
console.log(`cold-war-1962 seed.json: ${countries.length} countries, ${meta.provinces.length} provinces (most: ${top})`);
console.log(
  `  ${nAgenda} hand-written agendas, ${organizations.length} orgs (UN ${un.members.length} member tags), ${treaties.length} treaties, ` +
    `${wars.length} wars, ${sanctions.length} sanctions, ${Object.keys(relations).length} relations (${nHand} hand-set, ${nDefault} bloc defaults), ` +
    `${calendar.length} calendar entries, ${formables.length} formables, brief ${words} words, ${warnings.length} warnings`,
);
