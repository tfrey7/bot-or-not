// Region-inference lookup tables. Pure data — no logic.
//
// Subreddit inclusion rule: a sub is mapped to a country when its primary
// audience is in that country (national subs, city subs, country-specific
// gaming/meme/cricket subs, country-language subs). Global subs where one
// country dominates (r/cricket, r/worldnews) are NOT included — too noisy.
// Diaspora/regional umbrella subs (r/desimemes covers IN+PK+BD) are skipped.

export interface RegionInfo {
  flag: string;
  label: string;
  utcOffsets: number[];
}

export const BON_REGION_INFO: Record<string, RegionInfo> = {
  IN: { flag: "🇮🇳", label: "India", utcOffsets: [5, 6] }, // IST is +5:30
  PK: { flag: "🇵🇰", label: "Pakistan", utcOffsets: [5] },
  BD: { flag: "🇧🇩", label: "Bangladesh", utcOffsets: [6] },
  CN: { flag: "🇨🇳", label: "China", utcOffsets: [8] },
  RU: { flag: "🇷🇺", label: "Russia", utcOffsets: [3] },
  ID: { flag: "🇮🇩", label: "Indonesia", utcOffsets: [7, 8] },
  PH: { flag: "🇵🇭", label: "Philippines", utcOffsets: [8] },
  TH: { flag: "🇹🇭", label: "Thailand", utcOffsets: [7] },
  VN: { flag: "🇻🇳", label: "Vietnam", utcOffsets: [7] },
  MY: { flag: "🇲🇾", label: "Malaysia", utcOffsets: [8] },
  SG: { flag: "🇸🇬", label: "Singapore", utcOffsets: [8] },
  KR: { flag: "🇰🇷", label: "Korea", utcOffsets: [9] },
  JP: { flag: "🇯🇵", label: "Japan", utcOffsets: [9] },
  BR: { flag: "🇧🇷", label: "Brazil", utcOffsets: [-3, -4] },
  MX: { flag: "🇲🇽", label: "Mexico", utcOffsets: [-6] },
  AR: { flag: "🇦🇷", label: "Argentina", utcOffsets: [-3] },
  CO: { flag: "🇨🇴", label: "Colombia", utcOffsets: [-5] },
  CL: { flag: "🇨🇱", label: "Chile", utcOffsets: [-3, -4] },
  DE: { flag: "🇩🇪", label: "Germany", utcOffsets: [1, 2] },
  FR: { flag: "🇫🇷", label: "France", utcOffsets: [1, 2] },
  ES: { flag: "🇪🇸", label: "Spain", utcOffsets: [1, 2] },
  IT: { flag: "🇮🇹", label: "Italy", utcOffsets: [1, 2] },
  NL: { flag: "🇳🇱", label: "Netherlands", utcOffsets: [1, 2] },
  PL: { flag: "🇵🇱", label: "Poland", utcOffsets: [1, 2] },
  PT: { flag: "🇵🇹", label: "Portugal", utcOffsets: [0, 1] },
  SE: { flag: "🇸🇪", label: "Sweden", utcOffsets: [1, 2] },
  GR: { flag: "🇬🇷", label: "Greece", utcOffsets: [2, 3] },
  RO: { flag: "🇷🇴", label: "Romania", utcOffsets: [2, 3] },
  UA: { flag: "🇺🇦", label: "Ukraine", utcOffsets: [2, 3] },
  GB: { flag: "🇬🇧", label: "UK", utcOffsets: [0, 1] },
  IE: { flag: "🇮🇪", label: "Ireland", utcOffsets: [0, 1] },
  CA: { flag: "🇨🇦", label: "Canada", utcOffsets: [-5, -6, -7, -8] },
  US: { flag: "🇺🇸", label: "USA", utcOffsets: [-5, -6, -7, -8] },
  AU: { flag: "🇦🇺", label: "Australia", utcOffsets: [8, 9, 10, 11] },
  NZ: { flag: "🇳🇿", label: "New Zealand", utcOffsets: [12, 13] },
  TR: { flag: "🇹🇷", label: "Turkey", utcOffsets: [3] },
  IR: { flag: "🇮🇷", label: "Iran", utcOffsets: [3, 4] },
  SA: { flag: "🇸🇦", label: "Saudi Arabia", utcOffsets: [3] },
  IL: { flag: "🇮🇱", label: "Israel", utcOffsets: [2, 3] },
  EG: { flag: "🇪🇬", label: "Egypt", utcOffsets: [2] },
  NG: { flag: "🇳🇬", label: "Nigeria", utcOffsets: [1] },
  KE: { flag: "🇰🇪", label: "Kenya", utcOffsets: [3] },
  ZA: { flag: "🇿🇦", label: "South Africa", utcOffsets: [2] },
};

// Lower-cased sub names (without "r/") -> region code from BON_REGION_INFO.
export const BON_REGION_SUBS: Record<string, string> = {
  // India
  india: "IN",
  indiaspeaks: "IN",
  indianpeoplefacebook: "IN",
  indiangaming: "IN",
  indiangamers: "IN",
  indianmemes: "IN",
  askindia: "IN",
  unitedstatesofindia: "IN",
  indianteenagers: "IN",
  jeeneetards: "IN",
  cricketshitpost: "IN",
  indianfood: "IN",
  librandu: "IN",
  bangalore: "IN",
  mumbai: "IN",
  delhi: "IN",
  hyderabad: "IN",
  chennai: "IN",
  kolkata: "IN",
  pune: "IN",
  kerala: "IN",
  ahmedabad: "IN",
  bollywood: "IN",
  indianboysontinder: "IN",
  indiandiscussion: "IN",
  indiansocial: "IN",
  developersindia: "IN",
  indianstreetbets: "IN",
  indiainvestments: "IN",

  // Pakistan
  pakistan: "PK",
  pakistanigaming: "PK",
  karachi: "PK",
  lahore: "PK",
  islamabad: "PK",
  chutyapa: "PK",
  pakistanfood: "PK",
  pakcricket: "PK",
  pakistanijournalism: "PK",

  // Bangladesh
  bangladesh: "BD",
  dhaka: "BD",

  // China
  china: "CN",
  sino: "CN",
  china_irl: "CN",
  shanghai: "CN",
  beijing: "CN",
  chinesefood: "CN",
  learnchinese: "CN",

  // Russia
  russia: "RU",
  askarussian: "RU",
  moscow: "RU",
  stpetersburgru: "RU",
  askrussia: "RU",
  russianpolitics: "RU",

  // Indonesia
  indonesia: "ID",
  jakarta: "ID",
  indogaming: "ID",
  indomemes: "ID",
  bandung: "ID",
  surabaya: "ID",

  // Philippines
  philippines: "PH",
  casualph: "PH",
  manilaworld: "PH",
  studentsph: "PH",
  manila: "PH",
  phgamers: "PH",

  // Thailand
  thailand: "TH",
  bangkok: "TH",
  chiangmai: "TH",

  // Vietnam
  vietnam: "VN",
  hanoi: "VN",
  saigon: "VN",
  hochiminhcity: "VN",

  // Malaysia
  malaysia: "MY",
  malaysiansgaming: "MY",
  kualalumpur: "MY",
  bolehland: "MY",

  // Singapore
  singapore: "SG",
  asksingapore: "SG",
  singaporeraw: "SG",

  // Korea
  korea: "KR",
  seoul: "KR",
  korea_travel: "KR",
  livingkorea: "KR",

  // Japan
  japan: "JP",
  japanlife: "JP",
  tokyo: "JP",
  osaka: "JP",
  japannews: "JP",

  // Brazil
  brasil: "BR",
  brazil: "BR",
  brasilivre: "BR",
  desabafos: "BR",
  saopaulo: "BR",
  riodejaneiro: "BR",
  brasilnoticias: "BR",
  futebol: "BR",
  conversas: "BR",

  // Mexico
  mexico: "MX",
  mexicocity: "MX",
  askmexico: "MX",
  republicamx: "MX",
  monterrey: "MX",

  // Argentina
  argentina: "AR",
  republicaargentina: "AR",
  buenosaires: "AR",
  argentinamemes: "AR",
  charruasunidos: "AR",

  // Colombia
  colombia: "CO",
  bogota: "CO",
  medellin: "CO",

  // Chile
  chile: "CL",
  santiago: "CL",

  // Germany
  de: "DE",
  germany: "DE",
  berlin: "DE",
  munich: "DE",
  hamburg: "DE",
  cologne: "DE",
  ich_iel: "DE",
  fragreddit: "DE",

  // France
  france: "FR",
  askfrance: "FR",
  paris: "FR",
  rance: "FR",

  // Spain
  spain: "ES",
  es: "ES",
  madrid: "ES",
  barcelona: "ES",
  spaniards: "ES",
  askspain: "ES",

  // Italy
  italy: "IT",
  italyinformatica: "IT",
  rome: "IT",
  milano: "IT",

  // Netherlands
  netherlands: "NL",
  thenetherlands: "NL",
  amsterdam: "NL",

  // Poland
  poland: "PL",
  polska: "PL",
  warsaw: "PL",

  // Portugal
  portugal: "PT",
  lisbon: "PT",
  porto: "PT",

  // Sweden
  sweden: "SE",
  stockholm: "SE",
  svenskpolitik: "SE",

  // Greece
  greece: "GR",
  athens: "GR",

  // Romania
  romania: "RO",
  bucharest: "RO",

  // Ukraine
  ukraine: "UA",
  kyiv: "UA",

  // UK
  unitedkingdom: "GB",
  askuk: "GB",
  london: "GB",
  casualuk: "GB",
  britishproblems: "GB",
  manchester: "GB",
  birmingham: "GB",
  glasgow: "GB",
  edinburgh: "GB",
  scotland: "GB",
  wales: "GB",
  ukpolitics: "GB",

  // Ireland
  ireland: "IE",
  dublin: "IE",
  irishpolitics: "IE",

  // Canada
  canada: "CA",
  onguardforthee: "CA",
  toronto: "CA",
  vancouver: "CA",
  montreal: "CA",
  ottawa: "CA",
  calgary: "CA",
  canadahousing: "CA",
  canadapolitics: "CA",
  metacanada: "CA",

  // USA — most US politics subs are too generic to count (and they're bait
  // for overseas operators anyway). City subs are reasonably US-coded.
  losangeles: "US",
  nyc: "US",
  chicago: "US",
  houston: "US",
  philadelphia: "US",
  phoenix: "US",
  sandiego: "US",
  dallas: "US",
  sanfrancisco: "US",
  boston: "US",
  seattle: "US",
  denver: "US",
  miami: "US",
  atlanta: "US",
  texas: "US",
  california: "US",
  florida: "US",
  newyork: "US",
  newyorkcity: "US",

  // Australia
  australia: "AU",
  sydney: "AU",
  melbourne: "AU",
  brisbane: "AU",
  perth: "AU",
  ausfinance: "AU",
  australianpolitics: "AU",
  straya: "AU",

  // New Zealand
  newzealand: "NZ",
  auckland: "NZ",
  wellington: "NZ",
  christchurch: "NZ",

  // Turkey
  turkey: "TR",
  turkiye: "TR",
  istanbul: "TR",
  ankara: "TR",

  // Iran
  iran: "IR",
  persian: "IR",
  tehran: "IR",

  // Saudi Arabia
  saudiarabia: "SA",
  riyadh: "SA",

  // Israel
  israel: "IL",
  telaviv: "IL",

  // Egypt
  egypt: "EG",
  cairo: "EG",

  // Nigeria
  nigeria: "NG",
  lagos: "NG",

  // Kenya
  kenya: "KE",
  nairobi: "KE",

  // South Africa
  southafrica: "ZA",
  capetown: "ZA",
  johannesburg: "ZA",
};

// ─────────────────────────────────────────────────────────────────────────────
// Text-based region signals (script detection + transliteration markers)
//
// Scripts are unambiguous: any Devanagari in a user's writing strongly implies
// South Asia; any Cyrillic implies Russia/Ukraine; etc. We count code-points
// in each Unicode block and let the inferrer weight them.
//
// Language markers are word-level — used to disambiguate within a script (e.g.
// "Cyrillic" splits across RU/UA, but `привет` is Russian-specific) or to
// catch Latin-script regional dialects (Hinglish, Brazilian Portuguese, etc).
// Tokens are word-boundary matched, case-insensitive. Pick distinctive tokens
// 4+ chars long where possible to keep false positives down.

export interface ScriptRange {
  name: string;
  range: [number, number];
  regions: string[];
}

export const BON_SCRIPT_RANGES: ScriptRange[] = [
  { name: "devanagari", range: [0x0900, 0x097f], regions: ["IN"] },
  { name: "bengali", range: [0x0980, 0x09ff], regions: ["IN", "BD"] },
  { name: "gurmukhi", range: [0x0a00, 0x0a7f], regions: ["IN"] }, // Punjabi
  { name: "gujarati", range: [0x0a80, 0x0aff], regions: ["IN"] },
  { name: "tamil", range: [0x0b80, 0x0bff], regions: ["IN"] },
  { name: "telugu", range: [0x0c00, 0x0c7f], regions: ["IN"] },
  { name: "kannada", range: [0x0c80, 0x0cff], regions: ["IN"] },
  { name: "malayalam", range: [0x0d00, 0x0d7f], regions: ["IN"] },
  // Arabic script: used by Arabic (multi-country) and Urdu (Pakistan). We
  // can't distinguish without word-level analysis — split votes across the
  // most common Arabic-script countries.
  {
    name: "arabic",
    range: [0x0600, 0x06ff],
    regions: ["PK", "SA", "EG", "IR"],
  },
  { name: "cyrillic", range: [0x0400, 0x04ff], regions: ["RU", "UA"] },
  { name: "cjk", range: [0x4e00, 0x9fff], regions: ["CN", "JP"] },
  { name: "hiragana", range: [0x3040, 0x309f], regions: ["JP"] },
  { name: "katakana", range: [0x30a0, 0x30ff], regions: ["JP"] },
  { name: "hangul", range: [0xac00, 0xd7af], regions: ["KR"] },
  { name: "thai", range: [0x0e00, 0x0e7f], regions: ["TH"] },
  { name: "greek", range: [0x0370, 0x03ff], regions: ["GR"] },
  { name: "hebrew", range: [0x0590, 0x05ff], regions: ["IL"] },
];

export interface LanguageMarker {
  label: string;
  regions: string[];
  pattern: RegExp;
}

export const BON_LANGUAGE_MARKERS: Record<string, LanguageMarker> = {
  hinglish: {
    label: "Hinglish",
    regions: ["IN"],
    pattern:
      /\b(bhai|bhaiya|yaar|yaaar|matlab|thoda|acha|achha|haina|nahin|chalo|arrey|arre|saala|saale|paisa|bahut|samjha|samajh|karoge|karta|karte|lakh|crore|kya|kyu|kyon|kaise|bhencho|chutiya|behen|bhabhi|didi|chai|rupees|paneer|biryani|namaste|dosti)\b/gi,
  },
  brazilianPortuguese: {
    label: "BR Portuguese",
    regions: ["BR"],
    // Distinguish from European Portuguese via dialect-specific slang.
    pattern:
      /\b(galera|mano|treta|bagulho|trampo|moleque|valeu|saudade|você|vocês|legal|caraca|caralho|porra|caralhinho|bicho|massa)\b/gi,
  },
  russianWords: {
    label: "Russian",
    regions: ["RU"],
    pattern:
      /\b(привет|спасибо|пожалуйста|почему|который|конечно|хорошо|товарищ)\b/giu,
  },
  ukrainianWords: {
    label: "Ukrainian",
    regions: ["UA"],
    pattern: /\b(привіт|дякую|чому|який|звичайно|добре|друже)\b/giu,
  },
  tagalog: {
    label: "Tagalog",
    regions: ["PH"],
    pattern:
      /\b(kasi|naman|talaga|kahit|kapag|magkano|puwede|salamat|kumusta|mahal|kuya|ate|ganyan|sige)\b/gi,
  },
  mexicanSpanish: {
    label: "MX Spanish",
    regions: ["MX"],
    pattern: /\b(güey|wey|chido|neta|chamba|padrísimo|mande|órale)\b/gi,
  },
  argentinianSpanish: {
    label: "AR Spanish",
    regions: ["AR"],
    pattern:
      /\b(che|boludo|pelotudo|quilombo|laburar|pibe|guacho|bondi|chamuyo)\b/gi,
  },
};
