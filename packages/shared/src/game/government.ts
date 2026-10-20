// Structured reading of a nation's free-text government and leader, for display. Scenario data
// holds labels like "Federal presidential republic (dominant party)" or "Marxist-Leninist one-party
// state (pro-Chinese)"; this picks out the form, the system and the notable traits the label itself
// states. It never judges a government beyond its label.

export type TraitTone = "neutral" | "ideology" | "warning" | "danger";

export interface GovernmentTraits {
  /** Republic, Monarchy, One-party state, Military rule, Theocracy, Transitional, Divided, or Government. */
  form: string;
  /** Presidential, Parliamentary, Semi-presidential, Absolute, Constitutional, Directorial… */
  system?: string;
  traits: { label: string; tone: TraitTone }[];
}

const has = (s: string, re: RegExp) => re.test(s);

function formOf(g: string) {
  if (has(g, /\b(divided|disputed)\b/)) return "Divided";
  // Led by its interim nature ("Interim caretaker government"); otherwise that is a trait of the form.
  if (has(g, /^(transitional|interim)\b/)) return "Transitional";
  if (has(g, /\btheocratic\b/)) return "Theocracy";
  if (has(g, /\b(junta|military (dictatorship|republic|-?led|government))\b|^military|^revolutionary military/)) return "Military rule";
  if (has(g, /\bone-party\b|\btotalitarian\b/)) return "One-party state";
  if (has(g, /\b(monarchy|emirate|sultanate|principality|co-principality|kingdom)\b/)) return "Monarchy";
  if (has(g, /\b(republic|presidency|co-presidency)\b/)) return "Republic";
  if (has(g, /\bfederation\b/)) return "Federation";
  if (has(g, /\bdictatorship\b/)) return "Dictatorship";
  // A presidency without a monarch is a republic, whatever else the label says.
  if (has(g, /\bpresidential\b/)) return "Republic";
  if (has(g, /\bstate\b/)) return "State";
  return "Government";
}

function systemOf(g: string) {
  if (has(g, /\bsemi-presidential\b/)) return "Semi-presidential";
  if (has(g, /\babsolute\b/)) return "Absolute";
  if (has(g, /\bdirectorial\b|\bcollegiate\b/)) return "Directorial";
  if (has(g, /\bparliamentary\b/)) return "Parliamentary";
  if (has(g, /\bpresidential\b|\bpresidency\b/)) return "Presidential";
  if (has(g, /\bconstitutional\b/)) return "Constitutional";
  return undefined;
}

/** Explicit markers in the label, strongest first. */
const MARKERS: [RegExp, string, TraitTone][] = [
  [/marxist-leninist/, "Marxist-Leninist", "ideology"],
  [/\bjuche\b/, "Juche", "ideology"],
  [/\bsocialist\b/, "Socialist", "ideology"],
  [/\bcorporatist\b/, "Corporatist", "ideology"],
  [/\bapartheid\b|white-minority/, "White-minority rule", "danger"],
  [/\btotalitarian\b/, "Totalitarian", "danger"],
  [/\bmartial law\b/, "Martial law", "danger"],
  [/\b(authoritarian|dictatorship|personalist)\b/, "Authoritarian", "danger"],
  [/\bcivil war\b|\bin secession\b/, "Civil war", "danger"],
  [/military-(backed|dominated)|military tutelage|army tutelage|under military/, "Military influence", "warning"],
  [/\b(transitional|interim|caretaker|provisional)\b|council of state/, "Transitional", "warning"],
  [/\bdominan(t|ce)\b|\bstrong prince\b/, "Dominant power", "warning"],
  [/guided democracy/, "Guided democracy", "warning"],
  [/\bparliament suspended\b/, "Parliament suspended", "warning"],
  [/\bunrecognised\b|recognised only by/, "Unrecognised", "warning"],
  [/\bcolonial empire\b/, "Colonial empire", "neutral"],
  [/\b(neutral|non-aligned)\b/, "Neutral", "neutral"],
  [/\belective\b/, "Elective", "neutral"],
  [/\bconfessional\b/, "Confessional", "neutral"],
];

export function governmentTraits(government: string): GovernmentTraits {
  const g = government.toLowerCase();
  const form = formOf(g);
  let system = systemOf(g);
  // "Absolute monarchy" and "one-party state" already say it all; avoid "Monarchy · Constitutional" twins.
  if (form === "Monarchy" && system === "Constitutional" && has(g, /\bparliamentary\b/)) system = "Parliamentary";
  const traits: GovernmentTraits["traits"] = [];
  if (has(g, /\bfederal\b|\bfederation\b|\bfederated\b/)) traits.push({ label: "Federal", tone: "neutral" });
  for (const [re, label, tone] of MARKERS) if (re.test(g) && !traits.some((t) => t.label === label)) traits.push({ label, tone });
  // Markers that only repeat the form: a one-party or military state is authoritarian by definition.
  const repeats = new Set(form === "One-party state" || form === "Military rule" ? ["Authoritarian"] : form === "Transitional" ? ["Transitional"] : []);
  return { form, system, traits: traits.filter((t) => !repeats.has(t.label)) };
}

/**
 * Leaders as name and title: "Daniel Noboa (President)" → {name, title}; several office-holders are
 * separated by ";" ("King Hussein; Wasfi al-Tal (Prime Minister)"). Entries without a bracketed
 * title keep the whole text as the name.
 */
export function parseLeaders(leader: string): { name: string; title?: string }[] {
  return leader.split(";").map((part) => {
    const s = part.trim();
    const m = s.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    return m && m[1] ? { name: m[1], title: m[2] } : { name: s };
  }).filter((l) => l.name);
}
