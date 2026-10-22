/*
 * SIGTAP Explorador — ficha legível (protótipo).
 *
 * Sections:
 *   1. Utilities (DOM, escaping, number and code formatting)
 *   2. Reading settings (text size, Legível/Original)
 *   3. Text case and description cleaning
 *   4. Data loading (index, catalog, lookups, per-group files)
 *   5. Search, filters and the procedure list
 *   6. Ficha: header, Classificação, Atributos, Valores
 *   7. Relation tabs: model, tab bar, tables, each tab's content
 *   8. Dialogs (Fonte e validação, Explorar CID/CBO)
 *   9. Startup
 */

// ---------------------------------------------------------------------------
// 1. Utilities
// ---------------------------------------------------------------------------

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const intFormat = new Intl.NumberFormat('pt-BR');
const moneyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const fmt = (n) => intFormat.format(n);
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

/** Lowercase without accents, for accent-insensitive matching. */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** 0407020179 → 04.07.02.017-9 (SIGTAP mask). Other strings pass through. */
function maskProcedure(code) {
  const c = String(code ?? '');
  if (!/^\d{10}$/.test(c)) return c;
  return `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}

/** 2701 → 27.01 (habilitação mask). */
function maskHabilitacao(code) {
  return /^\d{4}$/.test(code) ? `${code.slice(0, 2)}.${code.slice(2)}` : code;
}

const ICON_PATHS = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 9M3 3v7h7"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  file: '<path d="M14 2H5v20h14V7zm0 0v5h5M8 12h8M8 16h6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  report: '<path d="M5 3h10l4 4v14H5zM9 12h6M9 16h6M9 8h3"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.file}</svg>`;
}

function replaceIconPlaceholders(root = document) {
  $$('[data-icon]', root).forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------------------
// 2. Reading settings (persisted in localStorage, always inside try/catch)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'sigtap-explorador:leitura';
const SIZE_PX = { s: 14, m: 15, l: 17 };
const TEXT_MODES = ['legivel', 'original'];

const settings = loadSettings();

function loadSettings() {
  const defaults = { size: 'm', textMode: 'legivel', lastTab: null, collapsed: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      size: SIZE_PX[saved.size] ? saved.size : defaults.size,
      textMode: TEXT_MODES.includes(saved.textMode) ? saved.textMode : defaults.textMode,
      lastTab: typeof saved.lastTab === 'string' ? saved.lastTab : null,
      collapsed: saved.collapsed && typeof saved.collapsed === 'object' ? saved.collapsed : {},
    };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

function applyReadingSettings() {
  document.documentElement.style.setProperty('--base', `${SIZE_PX[settings.size]}px`);
  $$('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === settings.size)));
  $$('[data-case]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.case === settings.textMode)));
}

function setTextSize(size) {
  settings.size = size;
  saveSettings();
  applyReadingSettings();
}

function setTextMode(mode) {
  if (settings.textMode === mode) return;
  settings.textMode = mode;
  saveSettings();
  applyReadingSettings();
  if (!state.db) return;   // still loading: the first render uses the new mode
  renderList({ keepScroll: true });
  if (state.detail) rerenderDetailKeepingScroll();
}

// ---------------------------------------------------------------------------
// 3. Text case ("Legível") and description cleaning
// ---------------------------------------------------------------------------

const ACRONYMS = new Set(`
  SUS HIV AIDS HTLV HPV HCV HBV DNA RNA PCR UTI UCI UCO CAPS AD OPM OPME AIH APAC BPA SIA SIH
  CNES CID CBO TC RM RX ECG EEG EMG PET SPECT TSH T3 T4 HDL LDL VLDL PSA CEA ABO RH HLA ELISA
  VDRL FTA-ABS BCG SAMU ESF NASF PICS PEP TB DST IST UBS UPA PAB MAC FAEC SADT SVO CER ESB ACS
  IMC LCR FSH LH HCG CPAP BIPAP AVC IAM DPOC DRC TRS SIGTAP SISREG G6PD ANTI-HBS ANTI-HCV
  CMV EBV HAV HEV ASO PTH ACTH ADH AMH NK CD4 CD8 OCT IVUS CPRE EDA TIPS DIU FIV
  OCI AASI UI SA SH SP CEO PCD DPA DPAC TLSO CTLSO LSO LLA LMC BAAR HGH PTFE YAG GNRH LHRH BNP
  NT-PROBNP BCR-ABL LF-LAM SNC UAA UAI ADTM ANTI-HBE ANTI-HBC ANTI-HDV ANTI-HAV HDV PICC TAVI PAAF CNS SRAG ENMG
  UNACON CACON ANVISA TAP TGO TGP AST ALT ASLO DHEA DHEAS FISH IGRA ILTB NAT LDV IRF LRF AMIU CDI TDO
  GUNA VISAT POP POPS UCINCO UCINCA LPA UICC GIST NIHSS SINAN DWI DTPA CEAF MAV ISH PDET PABD ADA
`.trim().split(/\s+/));

/**
 * An all-caps word alone in parentheses right after the words it abbreviates
 * is an acronym defined inline: "tratamento diretamente observado (TDO)",
 * "pressão arterial invasiva (PAI)". Plural/gender markers such as "(ES)",
 * "(ÕES)" never count.
 */
const INFLECTION_MARKERS = new Set('S ES AS OS IS NS AIS EIS OIS UIS OES AES AOS RES ZES IES A O'.split(' '));
const INITIALS_STOPWORDS = new Set('de da do das dos e em a o as os na no nas nos para por com ou'.split(' '));

function isInlineAcronym(token, text, offset) {
  if (!/^\p{Lu}{2,6}$/u.test(token) || text[offset - 1] !== '(' || text[offset + token.length] !== ')') return false;
  const target = norm(token);
  if (INFLECTION_MARKERS.has(target.toUpperCase())) return false;
  const words = norm(text.slice(Math.max(0, offset - 200), offset - 1)).split(/[^a-z0-9]+/).filter(Boolean);
  const initials = (list) => list.map((w) => w[0]).join('');
  for (let k = 2; k <= Math.min(words.length, target.length + 4); k += 1) {
    const tail = words.slice(-k);
    if (initials(tail) === target || initials(tail.filter((w) => !INITIALS_STOPWORDS.has(w))) === target) return true;
  }
  return false;
}

/** Canonical mixed-case spellings (take precedence over ACRONYMS). */
const MIXED_CASE = new Map([
  ['IGG', 'IgG'], ['IGM', 'IgM'], ['IGA', 'IgA'], ['IGE', 'IgE'],
  ['PREP', 'PrEP'], ['HBSAG', 'HBsAg'], ['HBEAG', 'HBeAg'], ['HBS', 'HBs'], ['HBC', 'HBc'], ['HBE', 'HBe'],
  ['CAPSI', 'CAPSi'], ['QPCR', 'qPCR'], ['RHO', 'RhO'], ['PH', 'pH'],
]);

/** Vowel-less tokens are abbreviations (SNC, BCR, PCDT) and stay in caps, except units. */
const UNITS = new Set('MG MCG ML DL MM CM KM KG GR GM NM HZ MHZ MMHG HG HS QTD'.split(' '));
const VOWEL = /[AEIOUYÁÉÍÓÚÂÊÔÃÕÀÈÌÒÙÜ]/;

/**
 * Nouns after which A, E or O is a designator, not a word:
 * "vitamina A", "hepatite E", "tipo A", "antiestreptolisina O" (accents removed).
 */
const DESIGNATOR_NOUNS = new Set(`
  VITAMINA HEPATITE HEPATITES TIPO GRUPO IMUNOGLOBULINA FATOR PROTEINA ANTIGENO CLASSE ZONA FASE
  NIVEL CATEGORIA BIOSSIMILAR BIOSIMILAR ANTI ESTREPTOLISINA ANTIESTREPTOLISINA SOROTIPO SUBTIPO
  HEMOFILIA COMPONENTE MODALIDADE PORTE SEGMENTO LINFOCITOS
`.trim().split(/\s+/));

/** Of those, the nouns where "E"/"O" before another word is still the designator ("antígeno E do vírus"). */
const STRONG_DESIGNATOR_NOUNS = new Set('VITAMINA HEPATITE HEPATITES IMUNOGLOBULINA ANTIGENO ESTREPTOLISINA ANTIESTREPTOLISINA SOROTIPO SUBTIPO'.split(' '));

const ROMAN_NUMERAL = /^(?:XX|X?(?:IX|IV|V?I{1,3}|V))$|^X$/;
const WORD = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;
// A sentence starts the text, follows . ! ? (not the last dot of "M.A.P.A.") or a paragraph
// break, which may be followed by a list dash.
const SENTENCE_START = /(^[^\p{L}\p{N}]*|(?<!\.\p{L})[.!?]\s+|\n[^\p{L}\p{N}\n]*)(\p{Ll})/gu;

/**
 * Short tokens already in mixed case in the base (qPCR, HBs, mCi) were written
 * that way on purpose. Longer ones ("tRANSPLANTE") are typos and get normal casing.
 */
const isMixedCase = (token) => token.length <= 5 && /\p{Ll}/u.test(token) && /\p{Lu}/u.test(token)
  && !/^\p{Lu}\P{Lu}*$/u.test(token);

/** True when the token at offset sits inside an open "( … )". */
function insideParentheses(text, offset) {
  const open = text.lastIndexOf('(', offset);
  return open > text.lastIndexOf(')', offset) && text.indexOf(')', offset) > open;
}

/**
 * A, E, O are Portuguese words ("a", "e", "o") unless they name something
 * after a designator noun: "hepatite A", "imunoglobulina E (IgE)",
 * "biossimilar A)", and further letters of such a list ("hepatites A, B, C, E e…").
 * Before another word they stay words when that word is an infinitive ("zona
 * a ser examinada", "grupo a identificar") or, for E/O, after a noun that also
 * takes "e" as a conjunction ("hemofilia e inibidor", "em grupo e dinâmicas").
 */
function isDesignatorLetter(upper, text, offset) {
  const before = text.slice(0, offset);
  if (/(?:^|[^\p{L}])\p{Lu},\s*\p{Lu},\s*$/u.test(before)) return true;   // a list: "hepatites A, B, C, E e…"
  const noun = norm(before.match(/(\p{L}+)[\s-]*$/u)?.[1] || '').toUpperCase();
  if (!DESIGNATOR_NOUNS.has(noun)) return false;
  const after = text.slice(offset + 1);
  if (/^\s*(?:$|[),\-.;:(/\n])/.test(after)) return true;
  const nextWord = norm(after.match(/^\s*(\p{L}+)/u)?.[1] || '').toUpperCase();
  if (upper === 'A') return !/(?:AR|ER|IR|OR)$/.test(nextWord);
  return STRONG_DESIGNATOR_NOUNS.has(noun);
}

/**
 * A one-letter token. B, C, D… Z (everything but A, E, O) are never words in
 * Portuguese and always stay in caps: "hepatite C", "linfócitos T", "C/", "(S)".
 * A/E/O stay in caps as designators ("vitamina A", see isDesignatorLetter) and
 * in dotted abbreviations ("M.A.P.A."); otherwise they are words. "à", "é" are words.
 */
function caseLetter(letter, text, offset) {
  const upper = letter.toUpperCase();
  if (!/^[A-Z]$/.test(upper)) return letter.toLowerCase();
  if (!'AEO'.includes(upper)) return upper;
  const next = text[offset + 1] || '';
  const dotted = /\p{L}\.$/u.test(text.slice(0, offset)) || (next === '.' && /\p{L}/u.test(text[offset + 2] || ''));
  return dotted || isDesignatorLetter(upper, text, offset) ? upper : letter.toLowerCase();
}

function caseToken(token, offset = 0, text = token) {
  const upper = token.toUpperCase();
  if (MIXED_CASE.has(upper)) return MIXED_CASE.get(upper);
  if (ACRONYMS.has(upper)) return upper;
  if (isInlineAcronym(token, text, offset)) return token;
  if (isMixedCase(token)) return token;
  if (/\d/.test(token)) return token;                 // COVID-19, B12, T4…
  if (ROMAN_NUMERAL.test(upper)) return upper;        // tipo II, grau IV
  if (token.includes('-')) return caseCompound(token);
  if (token.length === 1) return caseLetter(token, text, offset);
  if (/^\p{Lu}{2,6}$/u.test(upper) && !VOWEL.test(upper)) {
    // SNC, BCR, PCDT; units (mg, ml) only outside parentheses: "(MG)" is a state or an acronym.
    if (!UNITS.has(upper) || insideParentheses(text, offset)) return upper;
  }
  return token.toLowerCase();
}

/** HLA-A, anti-SS-B, anti-HIV, dividindo-o: one-letter parts are designators unless they are pronouns. */
function caseCompound(token) {
  const out = [];
  for (const part of token.split('-')) {
    if (part.length !== 1) { out.push(caseToken(part)); continue; }
    const pronoun = /[AEOÀ-ÿ]/i.test(part) && /^\p{Ll}+$/u.test(out.at(-1) || '');
    out.push(pronoun ? part.toLowerCase() : part.toUpperCase());
  }
  return out.join('-');
}

const sentenceCaseMemo = new Map();

/** Sentence case that keeps acronyms, codes, designators and roman numerals. Memoised. */
function sentenceCase(text) {
  let result = sentenceCaseMemo.get(text);
  if (result === undefined) {
    result = text
      .replace(WORD, (token, offset) => caseToken(token, offset, text))
      .replace(SENTENCE_START, (match, before, letter) => before + letter.toUpperCase());
    sentenceCaseMemo.set(text, result);
  }
  return result;
}

/**
 * Official SIGTAP style: no lowercase letter at all and at least two words.
 * Anything else (mixed case, or one all-caps token such as "CNRAC") is shown
 * exactly as in the base, so Legível never re-cases text that was already cased.
 */
function isAllCapsText(text) {
  if (/\p{Ll}/u.test(text)) return false;
  const words = text.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  if (words.length >= 2) return true;
  // One word: re-case ordinary words (ENTERECTOMIA, AMNIOCENTESE), never
  // acronyms or short codes (CNRAC, SAMU): not listed, and 6+ letters or 4+ with 2 vowels (YOGA, ENEMA).
  const word = words[0] || '';
  const letters = word.replace(/[^\p{L}]/gu, '');
  const vowels = (letters.match(new RegExp(VOWEL.source, 'g')) || []).length;
  if (word.toUpperCase().split(/[-/]/).some((part) => ACRONYMS.has(part))) return false;   // UCI-PED, UTI-Q
  return (letters.length >= 6 && vowels >= 1) || (letters.length >= 4 && vowels >= 2);
}

/** Text as shown on screen, following the "Texto" reading control. Legível only changes letter case. */
function display(text) {
  if (text == null) return '';
  const s = String(text);
  if (settings.textMode === 'original') return s;
  return isAllCapsText(s) ? sentenceCase(s) : s;
}

/**
 * The base wraps long text at a fixed width with `||`. A `||` run is a real
 * paragraph break only after sentence-ending punctuation (. : ; ! ?) or when
 * it is 4 pipes or longer; any other run is a wrap inside a sentence and
 * becomes one space (and so never starts a capitalised sentence).
 */
const PIPE_RUN = /\s*(\|{2,})\s*/g;

function pipeRun(match, pipes, offset, text) {
  const before = text.slice(0, offset).trimEnd();
  return pipes.length >= 4 || /[.:;!?]$/.test(before) ? '\n' : ' ';
}

/** `||` runs are paragraph breaks or spaces (see PIPE_RUN), single `|` become spaces, spaces collapse. */
function cleanDescription(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(PIPE_RUN, pipeRun)
    .replace(/\|/g, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// 4. Data loading
// ---------------------------------------------------------------------------

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Falha ao carregar ${path} (${response.status})`);
  return response.json();
}

/** Fetch a file once and share the promise; retry on the next call after a failure. */
function loadOnce(path) {
  let promise = null;
  return () => {
    if (!promise) promise = fetchJSON(path).catch((error) => { promise = null; throw error; });
    return promise;
  };
}

const loadCatalog = loadOnce('./data/catalog.json');
const loadLookups = loadOnce('./data/lookups.json');
const loadValidation = loadOnce('./data/validation.json');

const groupCache = new Map();

function loadGroup(code) {
  const key = code.slice(0, 2);
  if (!groupCache.has(key)) {
    const promise = fetchJSON(`./data/group-${key}.json`).catch((error) => { groupCache.delete(key); throw error; });
    groupCache.set(key, promise);
  }
  return groupCache.get(key);
}

// ---------------------------------------------------------------------------
// 5. Search, filters and the procedure list
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const SHORT_GROUP_NAMES = {
  '01': 'Promoção e prevenção', '02': 'Diagnóstico', '03': 'Procedimentos clínicos',
  '04': 'Procedimentos cirúrgicos', '05': 'Transplantes', '06': 'Medicamentos',
  '07': 'Órteses, próteses e materiais', '08': 'Ações complementares', '09': 'Cuidados integrados',
};

const state = {
  db: null,               // data/index.json
  relationIndex: null,    // data/relations-index.json (CID/CBO reverse filters)
  all: [],                // [code, name, normalizedName]
  nameByCode: new Map(),  // procedure code → official name
  filtered: [],
  page: 0,
  selected: null,
  detail: null,           // { ctx, tabs, activeTab, activeSub }
  ticket: 0,              // guards against out-of-order detail loads
};

function competenciaLabel() {
  const c = state.db.competencia;
  return `${c.slice(4)}/${c.slice(0, 4)}`;
}

function fillOptions(select, items, placeholder) {
  select.innerHTML = `<option value="">${esc(placeholder)}</option>`
    + items.map(([code, name]) => `<option value="${esc(code)}">${esc(code.slice(-2))} – ${esc(name)}</option>`).join('');
}

function updateSubgroups() {
  const group = $('#group').value;
  fillOptions($('#subgroup'), group ? state.db.hierarchy.subgroups[group] : [], group ? 'Todos os sub-grupos' : 'Selecione um grupo');
  $('#subgroup').disabled = !group;
  updateForms();
}

function updateForms() {
  const subgroup = $('#subgroup').value;
  fillOptions($('#form'), subgroup ? state.db.hierarchy.forms[subgroup] : [], subgroup ? 'Todas as formas' : 'Selecione um sub-grupo');
  $('#form').disabled = !subgroup;
}

function syncURL() {
  const params = new URLSearchParams();
  if ($('#search').value) params.set('q', $('#search').value);
  for (const [id, key] of [['group', 'g'], ['subgroup', 's'], ['form', 'f'], ['cid', 'cid'], ['cbo', 'cbo']]) {
    if ($(`#${id}`).value) params.set(key, $(`#${id}`).value);
  }
  if (state.selected) params.set('p', state.selected);
  if (state.detail && state.detail.activeTab !== 'descricao') params.set('aba', state.detail.activeTab);
  const query = params.toString();
  try {
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
  } catch {
    /* sandboxed frames may forbid history changes */
  }
}

// --- CID / CBO reverse filters ---

const relationCode = (s) => norm(s).replace(/[^a-z0-9]/g, '');

function relationEntryMatches(entry, query) {
  return relationCode(entry[0]).startsWith(relationCode(query))
    || query.split(/\s+/).every((term) => norm(entry[1]).includes(term));
}

/**
 * Set of procedure codes linked to the CID/CBO in the filter, or null when empty.
 * A suggestion picked from the list ("C17 — name") is an exact code. A typed
 * code also takes its subcodes ("C17" → C17, C170…C179); other text matches
 * codes and names.
 */
function relationMatches(kind, value) {
  const query = norm(value.trim());
  if (!query) return null;
  const entries = state.relationIndex[kind];
  const picked = query.includes(' — ');
  const code = relationCode(query.split(' — ')[0]);
  const exact = entries.filter((e) => relationCode(e[0]) === code);
  let matches;
  if (picked && exact.length) matches = exact;
  else if (exact.length) matches = entries.filter((e) => relationCode(e[0]).startsWith(code));
  else matches = entries.filter((e) => relationEntryMatches(e, query));
  return new Set(matches.flatMap((e) => e[2]));
}

function relationSuggestions(kind) {
  const id = kind.toLowerCase();
  const query = norm($(`#${id}`).value.trim());
  const list = $(`#${id}-options`);
  if (!query) { list.innerHTML = ''; return; }
  list.innerHTML = state.relationIndex[kind]
    .filter((e) => relationEntryMatches(e, query))
    .slice(0, 60)
    .map((e) => `<option value="${esc(e[0])} — ${esc(display(e[1]))}"></option>`)
    .join('');
}

// --- Filtering ---

/**
 * { match, prefix } for the search box. A masked code ("04.07", "04.07.02.017-9")
 * is a prefix; plain digits match anywhere in the code, prefix matches listed first.
 */
/** A code pasted with its name: "04.07.02.017-9 - ENTERECTOMIA", "0407020179 enterectomia". */
const CODE_WITH_NAME = /^(\d{2}(?:\.\d{2}){1,3}(?:\.\d{3}(?:-\d)?)?|\d{6,10})(?:\s*-\s*|\s+)\p{L}/u;

function searchMatcher() {
  // Dashes pasted from documents (‐ – — −) count as the hyphen of the code mask.
  let query = norm($('#search').value.trim()).replace(/[\u2010-\u2015\u2212]/g, '-');
  if (!query) return { match: () => true };
  const pastedCode = query.match(CODE_WITH_NAME);
  if (pastedCode) query = pastedCode[1];
  const digits = query.replace(/[.\-\s]/g, '');
  if (/^\d+$/.test(digits)) {
    const masked = /[.-]/.test(query) || Boolean(pastedCode);
    const prefix = (p) => p[0].startsWith(digits);
    return masked ? { match: prefix } : { match: (p) => p[0].includes(digits), prefix };
  }
  const terms = query.split(/\s+/);
  return { match: (p) => terms.every((t) => p[2].includes(t)) };
}

function hasActiveFilters() {
  return Boolean($('#search').value.trim() || $('#group').value || $('#cid').value.trim() || $('#cbo').value.trim());
}

function filter({ preferred = null, mobile = false, focusName = false } = {}) {
  const prefix = $('#form').value || $('#subgroup').value || $('#group').value;
  const search = searchMatcher();
  const cid = relationMatches('CID', $('#cid').value);
  const cbo = relationMatches('CBO', $('#cbo').value);

  state.filtered = state.all.filter((p) => p[0].startsWith(prefix)
    && (!cid || cid.has(p[0]))
    && (!cbo || cbo.has(p[0]))
    && search.match(p));
  if (search.prefix) {
    state.filtered = [...state.filtered.filter(search.prefix), ...state.filtered.filter((p) => !search.prefix(p))];
  }

  // A new search starts on page 1 (keeping the open ficha if it still matches);
  // only an explicit procedure (URL, link) jumps to the page that holds it.
  const keep = preferred || state.selected;
  state.selected = state.filtered.some((p) => p[0] === keep) ? keep : (state.filtered[0]?.[0] || null);
  const index = preferred ? state.filtered.findIndex((p) => p[0] === state.selected) : 0;
  state.page = index > 0 ? Math.floor(index / PAGE_SIZE) : 0;

  const n = state.filtered.length;
  $('#result-count').textContent = plural(n, 'procedimento', 'procedimentos');
  $('#result-context').textContent = hasActiveFilters() ? ' com os filtros atuais' : ' na base completa';
  updateSidebarState();
  if (!mobile) setMobileDetail(false);

  renderList();
  if (state.selected) {
    showDetail(state.selected, { mobile, focusName });
  } else {
    state.detail = null;
    state.ticket += 1;
    $('#detail').innerHTML = `<div class="empty-detail">${icon('search')}<h2>Nenhum procedimento encontrado</h2><p>Experimente outro termo ou limpe os filtros para consultar toda a base.</p></div>`;
  }
  syncURL();
}

function updateSidebarState() {
  const group = $('#group').value;
  $$('.group-button').forEach((button) => {
    const active = button.dataset.group === group;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#all-groups').classList.toggle('active', !hasActiveFilters());
}

function resetFilters() {
  for (const id of ['search', 'cid', 'cbo', 'group']) $(`#${id}`).value = '';
  relationSuggestions('CID');
  relationSuggestions('CBO');
  updateSubgroups();
}

function reset() {
  resetFilters();
  state.selected = null;
  filter();
}

// --- List ---

function listRow([code, name], full) {
  const selected = code === state.selected;
  return `<button type="button" class="proc-row${selected ? ' selected' : ''}" data-code="${code}" aria-pressed="${selected}" title="${maskProcedure(code)} ${esc(display(name))}">
      <span class="proc-code">${maskProcedure(code)}</span>
      <span class="proc-name${full ? ' full' : ''}">${esc(display(name))}</span>
    </button>`;
}

/** Characters two names share from the start ("Atividades educativas da população sobre a temática…"). */
const NAME_CLAMP_SAFE = 30;

function sharedStart(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return i;
}

/**
 * List names are clamped to two lines. A name that starts like another name
 * on the same page is shown whole, or the two would look identical (the part
 * that tells them apart comes at the end).
 */
function namesToShowWhole(rows) {
  return rows.map(([, , a], i) => rows.some(([, , b], j) => j !== i && sharedStart(a, b) >= NAME_CLAMP_SAFE));
}

function renderList({ keepScroll = false } = {}) {
  const results = $('#results');
  const start = state.page * PAGE_SIZE;
  const rows = state.filtered.slice(start, start + PAGE_SIZE);
  const scroll = results.scrollTop;

  const whole = namesToShowWhole(rows);
  results.innerHTML = rows.length
    ? rows.map((row, i) => listRow(row, whole[i])).join('')
    : `<div class="empty-results">${icon('search')}<strong>Nenhum resultado por aqui.</strong>
         <p>Busque por um nome mais curto ou confira os filtros selecionados.</p>
         <button type="button" id="empty-reset">Limpar busca e filtros</button></div>`;
  results.scrollTop = keepScroll ? scroll : 0;
  if (!keepScroll) centerSelectedRow(results);

  const total = state.filtered.length;
  const range = $('#list-range');
  range.textContent = rows.length && total > PAGE_SIZE ? `${fmt(start + 1)}–${fmt(start + rows.length)}` : '';
  range.title = range.textContent ? `Itens ${fmt(start + 1)} a ${fmt(start + rows.length)} de ${fmt(total)}` : '';
  $('#page-label').textContent = total ? `Página ${state.page + 1} de ${Math.ceil(total / PAGE_SIZE)}` : 'Nenhum resultado';
  setPagerState($('#prev'), $('#next'), state.page === 0, start + PAGE_SIZE >= total);
  $('#empty-reset')?.addEventListener('click', () => {
    reset();
    $('#search').focus();   // the button that had focus is gone
  });
}

/** Disable pager buttons without dropping keyboard focus on <body>. */
function setPagerState(prev, next, atStart, atEnd) {
  const focused = document.activeElement;
  prev.disabled = atStart;
  next.disabled = atEnd;
  if (focused === prev && atStart && !atEnd) next.focus();
  if (focused === next && atEnd && !atStart) prev.focus();
}

/**
 * Scroll only the list (never the page) so the selected row is visible,
 * roughly centred and with a whole row at the top edge.
 */
function centerSelectedRow(results) {
  const row = $('.proc-row.selected', results);
  if (!row) return;
  const r = row.getBoundingClientRect();
  const c = results.getBoundingClientRect();
  if (r.top >= c.top && r.bottom <= c.bottom) return;
  const target = results.scrollTop + r.top - c.top - (c.height - r.height) / 2;
  const tops = $$('.proc-row', results).map((el) => results.scrollTop + el.getBoundingClientRect().top - c.top);
  const snapped = tops.filter((top) => top <= target + 1).pop() ?? 0;
  results.scrollTop = Math.round(snapped);
}

function markSelectedRow(code) {
  $$('.proc-row').forEach((row) => {
    const yes = row.dataset.code === code;
    row.classList.toggle('selected', yes);
    row.setAttribute('aria-pressed', String(yes));
  });
}

function select(code, { mobile = true } = {}) {
  state.selected = code;
  markSelectedRow(code);
  showDetail(code, { mobile });
  syncURL();
}

function setMobileDetail(on) {
  $('#workspace').classList.toggle('mobile-detail', on);
}

const isMobileLayout = () => window.matchMedia('(max-width: 760px)').matches;

/** Open a procedure from a link inside the ficha (compatibilidades, origem); focus its name. */
function openLinkedProcedure(code) {
  if (!state.nameByCode.has(code)) { toast(`Procedimento ${maskProcedure(code)} não está nesta base.`); return; }
  if (!state.filtered.some((p) => p[0] === code)) resetFilters();
  filter({ preferred: code, mobile: isMobileLayout(), focusName: true });
}

// ---------------------------------------------------------------------------
// 6. Ficha: header + Classificação + Atributos + Valores
// ---------------------------------------------------------------------------

const EMPTY_TITLE = 'Sem informação nesta competência';

function emptyValue(title = EMPTY_TITLE) {
  return `<span class="empty" title="${esc(title)}"><span aria-hidden="true">—</span><span class="sr-only">${esc(title)}</span></span>`;
}

function value(text, title = '') {
  if (text == null || text === '') return emptyValue();
  return `<span${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
}

/** One item per line, like a list; two or more items get a leading marker. items: [{ text, title }] */
function listValue(items) {
  if (!items.length) return emptyValue();
  return `<ul class="value-list${items.length > 1 ? ' multi' : ''}">${items.map(({ text, title }) => `<li${title ? ` class="has-tip" title="${esc(title)}"` : ''}>${esc(text)}</li>`).join('')}</ul>`;
}

function formatAge(months) {
  if (months == null) return null;
  if (months < 12) return `${fmt(months)} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(months / 12);
  return `${fmt(years)} ${years === 1 ? 'ano' : 'anos'}`;
}

function ageValue(p, field) {
  if (p.idade_minima === 9999 && p.idade_maxima === 9999) return value('Não se aplica', '9999 na base');
  return value(formatAge(p[field]));
}

function quantityValue(q) {
  if (q === 9999) return emptyValue('Sem quantidade máxima definida (9999 na base)');
  return value(q == null ? null : fmt(q));
}

function moneyValue(n) {
  return n == null ? emptyValue() : esc(moneyFormat.format(n));
}

/** Everything the ficha needs about one procedure, with relation helpers. */
function buildContext(p, catalog, lookups) {
  return {
    p,
    lk: lookups,
    sig: p.sigtap || {},
    tabsData: p.sigtap?.tabs || {},
    rel: (kind) => (p.relations[kind] || []).map((i) => catalog[i]).filter(Boolean),
  };
}

function hierarchyNames(code) {
  const h = state.db.hierarchy;
  const find = (list, key) => (list || []).find((x) => x[0] === key);
  return {
    group: find(h.groups, code.slice(0, 2)),
    subgroup: find(h.subgroups[code.slice(0, 2)], code.slice(0, 4)),
    form: find(h.forms[code.slice(0, 4)], code.slice(0, 6)),
  };
}

function fieldRow(label, html) {
  return `<div class="field-row"><dt>${label}</dt><dd>${html}</dd></div>`;
}

/** Full-width header: code, copy button and competência on one line, the name below. */
function renderFichaHeader({ p }) {
  return `
    <header class="ficha-header">
      <button type="button" class="back-list" data-action="back">${icon('left')} Voltar aos procedimentos</button>
      <div class="ficha-code-row">
        <span class="ficha-code" aria-label="Código ${maskProcedure(p.codigo)}">${maskProcedure(p.codigo)}</span>
        <button type="button" class="copy-button" data-action="copy" data-code="${p.codigo}" title="Copiar código (somente números)">${icon('copy')}<span>Copiar código</span></button>
        <p class="ficha-meta">Competência ${competenciaLabel()}</p>
      </div>
      <h2 class="ficha-name" tabindex="-1">${esc(display(p.nome))}</h2>
    </header>`;
}

function renderClassificacao({ p }) {
  const { group, subgroup, form } = hierarchyNames(p.codigo);
  const item = (entry) => (entry ? value(`${entry[0].slice(-2)} – ${display(entry[1])}`) : emptyValue());
  return `
    <section class="box box-classificacao" aria-labelledby="box-classificacao">
      <h3 class="box-title" id="box-classificacao">Classificação</h3>
      <dl class="fields">
        ${fieldRow('Grupo', group ? `<span class="group-chip" data-group="${esc(group[0])}">${esc(group[0])}</span>${esc(display(group[1]))}` : emptyValue())}
        ${fieldRow('Sub-Grupo', item(subgroup))}
        ${fieldRow('Forma de Organização', item(form))}
      </dl>
    </section>`;
}

function renderAtributos(ctx) {
  const { p, lk, sig } = ctx;
  const names = (kind) => ctx.rel(kind).map(([, name]) => ({ text: display(name) }));
  const atributos = ctx.rel('ATRIBUTO_COMPLEMENTAR').map(([code, name]) => ({
    text: display(name),
    title: display(cleanDescription(lk.detalhe[code]?.[1])) || `Atributo ${code}`,
  }));
  const rubrica = sig.rubrica ? lk.rubrica[sig.rubrica] : null;
  const financiamento = lk.financiamento[p.financiamento_codigo] || p.financiamento_nome;

  return `
    <section class="box box-atributos" aria-labelledby="box-atributos">
      <h3 class="box-title" id="box-atributos">Atributos</h3>
      <dl class="fields">
        ${fieldRow('Modalidade de Atendimento', listValue(names('MODALIDADE')))}
        ${fieldRow('Complexidade', value(lk.complexidade[p.complexidade]))}
        ${fieldRow('Financiamento', value(financiamento, p.financiamento_codigo ? `Código ${p.financiamento_codigo}` : ''))}
        ${fieldRow('Sub-Tipo de Financiamento', value(rubrica && display(rubrica), sig.rubrica ? `Rubrica ${sig.rubrica}` : ''))}
        ${fieldRow('Instrumento de Registro', listValue(names('INSTRUMENTO')))}
        ${fieldRow('Sexo', value(lk.sexo[p.sexo] ?? p.sexo))}
        ${fieldRow('Média de Permanência', value(sig.dias_permanencia == null ? null : plural(sig.dias_permanencia, 'dia', 'dias')))}
        ${fieldRow('Tempo de Permanência', value(sig.tempo_permanencia == null ? null : plural(sig.tempo_permanencia, 'dia', 'dias'), 'QT_TEMPO_PERMANENCIA (dias)'))}
        ${fieldRow('Quantidade Máxima', quantityValue(p.quantidade_maxima))}
        ${fieldRow('Idade Mínima', ageValue(p, 'idade_minima'))}
        ${fieldRow('Idade Máxima', ageValue(p, 'idade_maxima'))}
        ${fieldRow('Pontos', value(sig.pontos == null ? null : fmt(sig.pontos)))}
        ${fieldRow('Atributos Complementares', listValue(atributos))}
      </dl>
    </section>`;
}

function renderValores({ p }) {
  const hasHospitalar = p.valor_sh != null || p.valor_sp != null;
  const totalHospitalar = hasHospitalar ? (p.valor_sh || 0) + (p.valor_sp || 0) : null;
  const row = (label, amount, total = false) =>
    `<div class="money-row${total ? ' total' : ''}"><dt>${label}</dt><dd>${amount}</dd></div>`;
  return `
    <section class="box box-valores" aria-labelledby="box-valores">
      <h3 class="box-title" id="box-valores">Valores</h3>
      <div class="valores">
        <dl class="money-col" aria-label="Ambulatorial">
          ${row('Serviço Ambulatorial (SA)', moneyValue(p.valor_sa))}
          ${row('Total Ambulatorial', moneyValue(p.valor_sa), true)}
        </dl>
        <dl class="money-col" aria-label="Hospitalar">
          ${row('Serviço Hospitalar (SH)', moneyValue(p.valor_sh))}
          ${row('Serviço Profissional (SP)', moneyValue(p.valor_sp))}
          ${row('Total Hospitalar <small>SH + SP</small>', moneyValue(totalHospitalar), true)}
        </dl>
      </div>
    </section>`;
}

/**
 * Show a procedure's ficha. When that ficha is already on screen (a filter
 * changed but kept the selection, or its row was clicked again) it is left as
 * it is: open tab, table filters, open families and scroll stay.
 */
function showDetail(code, { mobile = false, focusName = false } = {}) {
  if (state.detail?.ctx.p.codigo !== code) {
    openDetail(code, { mobile, focusName });
    return;
  }
  if (mobile) {
    setMobileDetail(true);
    if (isMobileLayout()) $('#workspace').scrollIntoView({ block: 'start' });
  }
  if (focusName) $('.ficha-name')?.focus({ preventScroll: true });
}

async function openDetail(code, { mobile = false, focusName = false } = {}) {
  const ticket = ++state.ticket;
  // Until the new ficha is ready nothing may act on the previous one
  // (Legível/Original, tab clicks, the URL's "aba").
  state.detail = null;
  if (mobile) setMobileDetail(true);
  $('#detail').innerHTML = `<div class="loading-state">Carregando a ficha de ${maskProcedure(code)}…</div>`;
  try {
    const [group, catalog, lookups] = await Promise.all([loadGroup(code), loadCatalog(), loadLookups()]);
    if (ticket !== state.ticket) return;
    const p = group[code];
    if (!p) throw new Error(`Procedimento ${code} ausente em group-${code.slice(0, 2)}.json`);
    const ctx = buildContext(p, catalog, lookups);
    const tabs = buildTabs(ctx);
    state.detail = { ctx, tabs, activeTab: chooseDefaultTab(tabs), activeSub: {} };
    renderDetail();
    $('#detail-panel').scrollTop = 0;
    if (mobile && isMobileLayout()) $('#workspace').scrollIntoView({ block: 'start' });
    if (focusName) $('.ficha-name').focus({ preventScroll: true });
    syncURL();
  } catch (error) {
    if (ticket !== state.ticket) return;
    console.error(error);
    $('#detail').innerHTML = `<div class="empty-detail"><h2>Não foi possível carregar a ficha</h2>
      <p>Verifique sua conexão e tente novamente.</p>
      <button type="button" id="retry" class="text-button">Tentar novamente</button></div>`;
    $('#retry').onclick = () => openDetail(code, { mobile });
  }
}

function renderDetail() {
  const { ctx } = state.detail;
  $('#detail').innerHTML = `
    <article class="ficha" aria-label="Ficha do procedimento">
      ${renderFichaHeader(ctx)}
      <div class="ficha-body">
        ${renderClassificacao(ctx)}
        ${renderValores(ctx)}
        ${renderAtributos(ctx)}
      </div>
      <div class="relations" id="relations">${renderRelations()}</div>
      <p class="legal-note">Vínculos cadastrados não substituem as demais regras.</p>
    </article>`;
  observeTabbar();
}

/**
 * The tab bar sticks to the top of the ficha panel. Its height (1–3 lines,
 * by text size) feeds scroll-padding-top, so a link or button reached with
 * the keyboard is scrolled into view below the bar, not behind it.
 */
const tabbarObserver = new ResizeObserver((entries) => {
  const height = entries.at(-1).target.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--tabbar-h', `${Math.ceil(height)}px`);
});

function observeTabbar() {
  tabbarObserver.disconnect();
  const bar = $('#relations .tabbar');
  if (bar) tabbarObserver.observe(bar);
}

/** Re-render the ficha (e.g. after Legível/Original) keeping scroll, table filters and open families. */
function rerenderDetailKeepingScroll() {
  const panel = $('#detail-panel');
  const scroll = panel.scrollTop;
  const filters = $$('#relations .table-filter').map((input) => input.value);
  const open = $$('#relations details.family').map((family) => family.open);
  state.detail.tabs = buildTabs(state.detail.ctx);
  renderDetail();
  $$('#relations details.family').forEach((family, i) => { family.open = Boolean(open[i]); });
  $$('#relations .table-filter').forEach((input, i) => {
    if (!filters[i]) return;
    input.value = filters[i];
    applyTableFilter(input);
  });
  panel.scrollTop = scroll;
}

// ---------------------------------------------------------------------------
// 7. Relation tabs
// ---------------------------------------------------------------------------

/*
 * A tab is { id, label, sections, enabled, badge }.
 * A section is { id, label, count, render, badge?, inTabCount? }.
 * The tab's badge is the sum of its sections' counts, leaving out sections
 * that re-count the same rows in another unit (inTabCount: false, e.g. CBO
 * families) and with a tab-specific badge where the parts differ in kind
 * (Habilitação). A tab or sub-tab is greyed exactly when it has no rows.
 * Tabs with one section have no sub-tab bar. Descrição shows a badge only when empty.
 */

const TAB_BUILDERS = [
  ['descricao', 'Descrição', descricaoSections],
  ['cid', 'CID', cidSections],
  ['cbo', 'CBO', cboSections],
  ['leito', 'Leito', leitoSections],
  ['servico', 'Serviço/Classificação', servicoSections],
  ['habilitacao', 'Habilitação', habilitacaoSections],
  ['redes', 'Redes', redesSections],
  ['origem', 'Origem', origemSections],
  ['regra', 'Regra Condicionada', regraSections],
  ['renases', 'Renases', renasesSections],
  ['tuss', 'TUSS', tussSections],
  ['compat', 'Compatibilidades', compatSections],
];

/** Tab badges that cannot be a plain sum: { text, title } or null for no badge. */
const TAB_BADGES = {
  descricao: ([texto]) => (texto.count ? null : { text: '0' }),
  habilitacao: ([habilitacoes, grupos, incremento]) => {
    const main = habilitacoes.count + grupos.count;
    const inc = incremento.count;
    const title = `${plural(habilitacoes.count, 'habilitação', 'habilitações')} · ${plural(grupos.count, 'grupo', 'grupos')} · ${plural(inc, 'linha', 'linhas')} de incremento`;
    if (!inc) return { text: fmt(main), title };
    return { text: main ? `${fmt(main)} + ${fmt(inc)} incr.` : `${fmt(inc)} incr.`, title };
  },
};

function buildTabs(ctx) {
  return TAB_BUILDERS.map(([id, label, build]) => {
    const sections = build(ctx);
    const total = sections.reduce((sum, s) => sum + (s.inTabCount === false ? 0 : s.count), 0);
    const enabled = sections.some((s) => s.count > 0);
    const badge = id in TAB_BADGES ? TAB_BADGES[id](sections) : { text: fmt(total) };
    return { id, label, sections, enabled, badge };
  });
}

function chooseDefaultTab(tabs) {
  const byId = Object.fromEntries(tabs.map((t) => [t.id, t]));
  const hasDescription = byId.descricao.sections[0].count > 0;
  const last = byId[settings.lastTab];
  if (last && last.enabled && (last.id !== 'descricao' || hasDescription)) return last.id;
  if (hasDescription) return 'descricao';
  return tabs.find((t) => t.id !== 'descricao' && t.enabled)?.id || 'descricao';
}

function activeTab() {
  return state.detail.tabs.find((t) => t.id === state.detail.activeTab);
}

function activeSection(tab) {
  const chosen = state.detail.activeSub[tab.id];
  return tab.sections.find((s) => s.id === chosen)
    || tab.sections.find((s) => s.count > 0)
    || tab.sections[0];
}

function tabButton({ id, label, badge, enabled }, selected, attr, idPrefix) {
  const countBadge = badge ? `<span class="count"${badge.title ? ` title="${esc(badge.title)}"` : ''}>${esc(badge.text)}</span>` : '';
  return `<button type="button" role="tab" class="tab${enabled ? '' : ' is-empty'}"
      id="${idPrefix}-${id}" ${attr}="${id}"
      aria-selected="${selected}" aria-controls="${idPrefix}-panel"
      tabindex="${selected ? 0 : -1}"${enabled ? '' : ' aria-disabled="true" title="Sem registros nesta competência"'}>
      <span class="tab-label">${label}</span>${countBadge}</button>`;
}

function renderRelations() {
  const tab = activeTab();
  const tabBar = state.detail.tabs
    .map((t) => tabButton(t, t.id === tab.id, 'data-tab', 'tab'))
    .join('');
  return `
    <div class="tabbar" role="tablist" aria-label="Relações do procedimento">${tabBar}</div>
    <div class="tabpanel" id="tab-panel" role="tabpanel" aria-labelledby="tab-${tab.id}">
      ${renderTabContent(tab)}
    </div>`;
}

function renderTabContent(tab) {
  if (tab.sections.length === 1) return tab.sections[0].render();
  const section = activeSection(tab);
  const subBar = tab.sections
    .map((s) => tabButton({ ...s, enabled: s.count > 0, badge: s.badge || { text: fmt(s.count) } }, s.id === section.id, 'data-sub', 'sub'))
    .join('');
  return `
    <div class="subtabs" role="tablist" aria-label="${esc(tab.label)}">${subBar}</div>
    <div class="subpanel" id="sub-panel" role="tabpanel" aria-labelledby="sub-${section.id}">${section.render()}</div>`;
}

/**
 * Choosing the open tab again changes nothing (table filters and open CBO
 * families stay). Focus never scrolls: bringTabsIntoView does the one scroll.
 */
function selectTab(id, { focus = false } = {}) {
  const tab = state.detail.tabs.find((t) => t.id === id);
  if (!tab || !tab.enabled || id === state.detail.activeTab) return;
  state.detail.activeTab = id;
  settings.lastTab = id;
  saveSettings();
  $('#relations').innerHTML = renderRelations();
  observeTabbar();
  if (focus) $(`#tab-${id}`)?.focus({ preventScroll: true });
  bringTabsIntoView();
  syncURL();
}

function selectSub(id, { focus = false } = {}) {
  const tab = activeTab();
  const section = tab.sections.find((s) => s.id === id);
  if (!section || section.count === 0 || section === activeSection(tab)) return;
  state.detail.activeSub[tab.id] = id;
  $('#tab-panel').innerHTML = renderTabContent(tab);
  if (focus) $(`#sub-${id}`)?.focus({ preventScroll: true });
}

/**
 * After choosing a tab, show its content: scroll so the (sticky) tab bar
 * sits at the top of the ficha. The ficha boxes are one scroll up.
 */
function bringTabsIntoView() {
  const relations = $('#relations');
  const top = relations.getBoundingClientRect().top;
  if (isMobileLayout()) {
    if (Math.abs(top) > 4) relations.scrollIntoView({ block: 'start' });
    return;
  }
  // Desktop: scroll only the ficha panel, never the page.
  const panel = $('#detail-panel');
  const offset = top - panel.getBoundingClientRect().top;
  if (Math.abs(offset) > 4) panel.scrollTop += offset;
}

/** Arrow keys / Home / End move between enabled tabs of the same tablist. */
function handleTabKeys(event) {
  const tab = event.target.closest('[role="tab"]');
  if (!tab) return;
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  // Step among all tabs (the focused one may be a greyed tab) and skip the greyed ones.
  const all = $$('[role="tab"]', tab.parentElement);
  const usable = (t) => t.getAttribute('aria-disabled') !== 'true';
  if (!all.some(usable)) return;
  const index = all.indexOf(tab);
  const n = all.length;
  let target = null;
  if (event.key === 'Home') target = all.find(usable);
  else if (event.key === 'End') target = all.findLast(usable);
  else {
    const step = event.key === 'ArrowRight' ? 1 : -1;
    for (let i = 1; i <= n && !target; i += 1) {
      const candidate = all[(((index + step * i) % n) + n) % n];
      if (usable(candidate)) target = candidate;
    }
  }
  event.preventDefault();
  if (target.dataset.tab) selectTab(target.dataset.tab, { focus: true });
  else selectSub(target.dataset.sub, { focus: true });
}

// --- Generic table ---

const FILTER_THRESHOLD = 12;

/**
 * columns: [{ label, className }]
 * rows: [{ cells: [html], search: plain text }]
 */
function dataTable({ columns, rows, caption = '', filterLabel = 'Filtrar nesta lista', tableClass = '' }) {
  const head = columns.map((c) => `<th scope="col"${c.className ? ` class="${c.className}"` : ''}>${c.label}</th>`).join('');
  const body = rows.map((row, i) => `<tr data-search="${esc(norm(row.search))}"${i % 2 ? ' class="alt"' : ''}>${
    row.cells.map((cell, j) => `<td${columns[j].className ? ` class="${columns[j].className}"` : ''} data-label="${esc(columns[j].label)}">${cell}</td>`).join('')
  }</tr>`).join('');
  return `
    <div class="filterable">
      ${caption ? `<p class="table-caption">${caption}</p>` : ''}
      ${rows.length > FILTER_THRESHOLD ? filterBar(rows.length, filterLabel) : ''}
      <div class="table-wrap"><table class="data-table${tableClass ? ` ${tableClass}` : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="no-match" hidden>Nenhum item corresponde ao filtro.</p>
    </div>`;
}

function filterBar(total, label, unit = '') {
  return `<div class="table-tools">
      <input type="search" class="table-filter" placeholder="${esc(label)}…" aria-label="${esc(label)}" autocomplete="off">
      <span class="table-count" aria-live="polite" data-unit="${esc(unit)}">${fmt(total)} de ${fmt(total)}${unit ? ` ${unit}` : ''}</span>
    </div>`;
}

const filterTerms = (text) => norm(text.trim()).split(/\s+/).filter(Boolean);

/**
 * Show the rows of one .filterable table that contain every term; update its
 * own counter, zebra and "no match" note. Nested tables are left alone.
 * Returns the number of rows shown.
 */
function filterRows(container, terms) {
  const rows = $$(':scope > .table-wrap > table > tbody > tr', container);
  let shown = 0;
  for (const row of rows) {
    const match = terms.every((t) => row.dataset.search.includes(t));
    row.hidden = !match;
    if (match) {
      row.classList.toggle('alt', shown % 2 === 1);
      shown += 1;
    }
  }
  setFilterCount(container, shown, rows.length);
  return shown;
}

function setFilterCount(container, shown, total) {
  const count = $(':scope > .table-tools > .table-count', container);
  if (count) count.textContent = `${fmt(shown)} de ${fmt(total)}${count.dataset.unit ? ` ${count.dataset.unit}` : ''}`;
  $(':scope > .no-match', container).hidden = shown > 0;
}

/**
 * CBO families: a family stays visible when the terms match its code (all
 * members shown) or at least one member row; matching families open, and
 * their member tables show only the matching rows, with their own counters.
 */
function filterFamilies(container, terms) {
  const families = $$(':scope > .families > details.family', container);
  let shown = 0;
  for (const family of families) {
    const members = $(':scope > .filterable', family);
    const innerInput = $(':scope > .table-tools > .table-filter', members);
    if (innerInput) innerInput.value = '';
    const byFamily = terms.length > 0 && terms.every((t) => family.dataset.family.includes(t));
    const rows = filterRows(members, byFamily ? [] : terms);
    const visible = byFamily || rows > 0;
    family.hidden = !visible;
    if (terms.length && visible) family.open = true;
    if (visible) shown += 1;
  }
  setFilterCount(container, shown, families.length);
}

function applyTableFilter(input) {
  const container = input.closest('.filterable');
  const terms = filterTerms(input.value);
  if ($(':scope > .families', container)) filterFamilies(container, terms);
  else filterRows(container, terms);
}

const mono = (text) => `<span class="mono">${esc(text)}</span>`;
const emptyNote = (text) => `<p class="empty-note">${esc(text)}</p>`;

function procLink(code) {
  return `<a class="proc-link mono" href="?p=${code}" data-proc="${code}">${maskProcedure(code)}</a>`;
}

/** Code-and-name rows, the most common table shape. */
function codeNameSection(id, label, items, { codeLabel = 'Código', nameLabel = 'Nome', mask = (c) => c, filterLabel } = {}) {
  return {
    id,
    label,
    count: items.length,
    render: () => dataTable({
      filterLabel,
      columns: [{ label: codeLabel, className: 'col-code' }, { label: nameLabel }],
      rows: items.map(([code, name]) => ({
        cells: [mono(mask(code)), name ? esc(display(name)) : emptyValue('Nome não encontrado na base')],
        search: `${code} ${mask(code)} ${name || ''}`,
      })),
    }),
  };
}

// --- Descrição ---

function descricaoSections({ p }) {
  const text = cleanDescription(p.descricao);
  return [{
    id: 'texto',
    label: 'Descrição',
    count: text ? 1 : 0,
    render: () => (text ? `<p class="description">${esc(display(text))}</p>` : emptyNote('Sem descrição nesta base.')),
  }];
}

// --- CID ---

function cidSections(ctx) {
  const all = ctx.rel('CID');
  const principal = all.filter((e) => e[2] === 'CID principal');
  const secundario = all.filter((e) => e[2] !== 'CID principal');
  return [
    codeNameSection('principal', 'Principal', principal),
    codeNameSection('secundario', 'Secundário', secundario),
  ];
}

// --- CBO (with automatic family grouping) ---

function cboSections(ctx) {
  const all = ctx.rel('CBO');
  const totals = ctx.lk.cbo_familia_total;
  const families = new Map();
  for (const entry of all) {
    const family = entry[0].slice(0, 4);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(entry);
  }
  const complete = [...families]
    .filter(([family, members]) => (totals[family] || 0) >= 2 && members.length === totals[family])
    .sort(([a], [b]) => a.localeCompare(b));

  // Ocupações lists every linked CBO: the base does not say which links SIGTAP
  // shows as a "Categoria", so the families are only a second, grouped view.
  const sections = [codeNameSection('ocupacoes', 'Ocupações', all, { filterLabel: 'Filtrar ocupações (código ou nome)' })];
  if (complete.length) {
    const members = complete.reduce((sum, [, list]) => sum + list.length, 0);
    sections.push({
      id: 'categorias',
      label: 'Categorias',
      count: complete.length,
      inTabCount: false,
      badge: {
        text: `${fmt(complete.length)} ${complete.length === 1 ? 'família' : 'famílias'}`,
        title: `${plural(complete.length, 'família completa', 'famílias completas')} · ${plural(members, 'ocupação', 'ocupações')}`,
      },
      render: () => renderCboFamilies(complete, ctx.lk),
    });
  }
  return sections;
}

/** "Médicos em medicina diagnóstica" → "Médicos em Medicina Diagnóstica", as the SIGTAP Categoria list shows it. */
const TITLE_PARTICLES = new Set('a à ao aos as da das de do dos e em na nas no nos o os ou para pela pelas pelo pelos por com sem'.split(' '));
function categoryTitle(text) {
  return text.split(' ').map((word, i) => (i > 0 && TITLE_PARTICLES.has(word.toLowerCase())
    ? word.toLowerCase()
    : word.charAt(0).toUpperCase() + word.slice(1))).join(' ');
}

function renderCboFamilies(families, lk) {
  const memberTotal = families.reduce((sum, [, members]) => sum + members.length, 0);
  const names = lk.cbo_familia_nome || {};
  const items = families.map(([family, members], i) => {
    const name = names[family];
    const preview = members.slice(0, 3).map((m) => display(m[1])).join(', ') + (members.length > 3 ? '…' : '');
    const table = dataTable({
      filterLabel: 'Filtrar nesta categoria',
      columns: [{ label: 'Código', className: 'col-code' }, { label: 'Ocupação' }],
      rows: members.map(([code, n]) => ({ cells: [mono(code), esc(display(n))], search: `${code} ${n}` })),
    });
    return `<details class="family${i % 2 ? ' alt' : ''}" data-family="${esc(norm(`${family} ${name || ''} ${preview}`))}">
        <summary title="${esc(preview)}">
          <span class="family-chevron" aria-hidden="true">${icon('right')}</span>
          <span class="family-name">${family} - ${name ? esc(categoryTitle(name)) : 'Família CBO sem título'}</span>
          <span class="family-count">${plural(members.length, 'ocupação', 'ocupações')}</span>
        </summary>
        ${table}
      </details>`;
  }).join('');
  const showFilter = families.length > FILTER_THRESHOLD || memberTotal > FILTER_THRESHOLD;
  return `
    <div class="filterable">
      ${showFilter ? filterBar(families.length, 'Filtrar categorias', families.length === 1 ? 'categoria' : 'categorias') : ''}
      <div class="families" role="list">
        <div class="families-head" aria-hidden="true"><span></span><span>Categoria</span><span></span></div>
        ${items}
      </div>
      <p class="no-match" hidden>Nenhuma categoria corresponde ao filtro.</p>
      <p class="footnote">Categoria = família CBO (4 primeiros dígitos) com todas as ocupações vinculadas a este procedimento.
        Clique numa categoria para ver as ocupações. Os títulos das famílias não estão na base SIGTAP: vêm do arquivo de famílias da CBO 2002 (Ministério do Trabalho), e o da 2231 da tela do SIGTAP.</p>
    </div>`;
}

// --- Leito ---

function leitoSections({ tabsData, lk }) {
  const items = (tabsData.leito || []).map((code) => [code, lk.tipo_leito[code]]);
  return [codeNameSection('leito', 'Leito', items)];
}

// --- Serviço / Classificação ---

function servicoSections(ctx) {
  const rows = ctx.rel('SERVICO_CLASSIFICACAO').map(([code, name]) => {
    const [servico, classificacao] = code.split('/');
    const cut = name.indexOf(' — ');
    const servicoName = cut >= 0 ? name.slice(0, cut) : '';
    const classificacaoName = cut >= 0 ? name.slice(cut + 3) : name;
    return {
      cells: [
        mono(servico),
        mono(classificacao || ''),
        `${esc(display(classificacaoName))}${servicoName ? `<span class="sub-line">${esc(display(servicoName))}</span>` : ''}`,
      ],
      search: `${code} ${name}`,
    };
  });
  return [{
    id: 'servico',
    label: 'Serviço/Classificação',
    count: rows.length,
    render: () => dataTable({
      tableClass: 'stack-table',
      columns: [{ label: 'Serviço', className: 'col-short' }, { label: 'Classificação', className: 'col-short' }, { label: 'Nome' }],
      rows,
    }),
  }];
}

// --- Habilitação ---

function habilitacaoName(lk, code) {
  return lk.habilitacao[code] ? display(lk.habilitacao[code]) : '';
}

function habilitacaoSections({ tabsData, lk }) {
  const habs = (tabsData.habilitacao || []).map((code) => [code, lk.habilitacao[code]]);
  const grupos = tabsData.grupo_habilitacao || [];
  const incrementos = tabsData.incremento || [];
  return [
    codeNameSection('habilitacoes', 'Habilitações', habs, { mask: maskHabilitacao }),
    { id: 'grupos', label: 'Grupos de habilitação', count: grupos.length, render: () => renderGruposHabilitacao(grupos, lk) },
    { id: 'incremento', label: 'Incremento', count: incrementos.length, inTabCount: false, render: () => renderIncremento(incrementos, lk) },
  ];
}

function renderGruposHabilitacao(grupos, lk) {
  return dataTable({
    tableClass: 'stack-table',
    columns: [{ label: 'Grupo', className: 'col-group' }, { label: 'Descrição' }, { label: 'Habilitações do grupo' }],
    rows: grupos.map(([nu, members]) => {
      const [nome, descricao] = lk.grupo_habilitacao[nu] || ['', ''];
      const memberList = members
        .map((code) => `<li><span class="mono">${maskHabilitacao(code)}</span> – ${esc(habilitacaoName(lk, code))}</li>`)
        .join('');
      return {
        cells: [
          `<span class="mono">${esc(nu)}</span> – ${esc(display(nome).replace(/\b\d{4}\b/g, maskHabilitacao))}`,
          descricao ? esc(display(cleanDescription(descricao))) : emptyValue(),
          `<ul class="cell-list">${memberList}</ul>`,
        ],
        search: `${nu} ${nome} ${descricao} ${members.map((c) => `${c} ${lk.habilitacao[c] || ''}`).join(' ')}`,
      };
    }),
  });
}

function renderIncremento(rows, lk) {
  // One precision per table so the decimal commas line up: 20,0 or 44,88.
  const decimals = rows.some((r) => r.slice(1).some((n) => Math.abs(Math.round(n * 10) - n * 10) > 1e-6)) ? 2 : 1;
  const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const percent = (n) => pct.format(n);
  return dataTable({
    columns: [
      { label: 'Habilitação' },
      { label: '% SH', className: 'num' },
      { label: '% SA', className: 'num' },
      { label: '% SP', className: 'num' },
    ],
    rows: rows.map(([code, sh, sa, sp]) => ({
      cells: [
        `<span class="mono">${maskHabilitacao(code)}</span> – ${esc(habilitacaoName(lk, code))}`,
        percent(sh), percent(sa), percent(sp),
      ],
      search: `${code} ${maskHabilitacao(code)} ${lk.habilitacao[code] || ''}`,
    })),
  });
}

// --- Redes ---

function redesSections({ tabsData, lk }) {
  const rows = (tabsData.redes || []).map((code) => {
    const [nome, rede] = lk.componente_rede[code] || ['', ''];
    const redeNome = lk.rede_atencao[rede] || rede;
    return {
      cells: [esc(display(redeNome)), `<span class="mono">${esc(code)}</span> – ${esc(display(nome))}`],
      search: `${code} ${nome} ${redeNome}`,
    };
  });
  return [{
    id: 'redes',
    label: 'Redes',
    count: rows.length,
    render: () => dataTable({ columns: [{ label: 'Rede de atenção' }, { label: 'Componente' }], rows }),
  }];
}

// --- Origem ---

function origemSections({ tabsData, lk }) {
  const sigtap = tabsData.origem_sigtap || [];
  const siaSih = tabsData.origem_sia_sih || [];
  return [
    {
      id: 'sigtap',
      label: 'Origem SIGTAP',
      count: sigtap.length,
      render: () => dataTable({
        columns: [{ label: 'Código', className: 'col-proc' }, { label: 'Nome' }],
        rows: sigtap.map((code) => {
          const name = state.nameByCode.get(code);
          return { cells: [procLink(code), name ? esc(display(name)) : emptyValue('Nome não encontrado na base')], search: `${code} ${name || ''}` };
        }),
      }),
    },
    {
      id: 'siasih',
      label: 'Origem SIA/SIH',
      count: siaSih.length,
      render: () => dataTable({
        tableClass: 'stack-table',
        columns: [{ label: 'Tipo', className: 'col-short' }, { label: 'Código', className: 'col-code' }, { label: 'Nome' }],
        rows: siaSih.map(([tipo, code, name]) => ({
          cells: [esc(lk.tipo_sia_sih[tipo] || tipo), mono(code), esc(display(name))],
          search: `${tipo} ${code} ${name}`,
        })),
      }),
    },
  ];
}

// --- Regra condicionada ---

function regraSections(ctx) {
  const rows = ctx.rel('REGRA_CONDICIONADA').map(([code, name, descricao]) => ({
    cells: [mono(code), esc(display(name)), descricao ? esc(display(cleanDescription(descricao))) : emptyValue()],
    search: `${code} ${name} ${descricao || ''}`,
  }));
  return [{
    id: 'regra',
    label: 'Regra Condicionada',
    count: rows.length,
    render: () => dataTable({
      tableClass: 'stack-table',
      columns: [{ label: 'Código', className: 'col-short' }, { label: 'Nome', className: 'col-name' }, { label: 'Descrição' }],
      rows,
    }),
  }];
}

// --- Renases / TUSS ---

function renasesSections({ tabsData, lk }) {
  return [codeNameSection('renases', 'Renases', (tabsData.renases || []).map((code) => [code, lk.renases[code]]))];
}

function tussSections({ tabsData }) {
  return [codeNameSection('tuss', 'TUSS', (tabsData.tuss || []).map((item) => (Array.isArray(item) ? item : [item, ''])))];
}

// --- Compatibilidades ---

function compatBadge(tipo, lk) {
  const label = lk.tipo_compatibilidade[String(tipo)];
  return label
    ? `<span class="badge ${String(tipo) === '2' ? 'badge-excl' : 'badge-ok'}">${esc(label)}</span>`
    : `<span class="badge" title="Rótulo do tipo ${tipo} não confirmado na base">Tipo ${tipo}</span>`;
}

function registroLabel(lk, code) {
  return lk.registro[code] || code;
}

/** QT_PERMITIDA exactly as in the base (0 included). */
function compatQuantity(qt) {
  return qt == null ? emptyValue() : fmt(qt);
}

function compatTable(items, { lk, p }, asPrincipal) {
  const self = maskProcedure(p.codigo);
  const caption = `Pares cadastrados com ${self} como ${asPrincipal ? 'principal' : 'compatível'} (rl_procedimento_compativel).
    Tipo 1 = Compatível (tela do SIGTAP); tipos 2, 4 e 5 = Excludente, Compatível Seq e Obrigatória (Nota Técnica CGSI nº 10/2026). O tipo 3 ainda não tem rótulo confirmado.`;
  return dataTable({
    caption,
    tableClass: 'compat-table stack-table',
    columns: [
      { label: 'Procedimento', className: 'col-procname' },
      { label: 'Registro' },
      { label: 'Tipo' },
      { label: 'Qtd. permitida', className: 'num' },
    ],
    rows: items.map(([code, regPrincipal, regCompativel, tipo, qt]) => {
      const name = state.nameByCode.get(code) || '';
      return {
        cells: [
          `${procLink(code)}<span class="sub-line strong">${esc(display(name))}</span>`,
          `${esc(registroLabel(lk, regPrincipal))} <span aria-label="para">→</span> ${esc(registroLabel(lk, regCompativel))}`,
          compatBadge(tipo, lk),
          compatQuantity(qt),
        ],
        search: `${code} ${maskProcedure(code)} ${name} ${registroLabel(lk, regPrincipal)} ${registroLabel(lk, regCompativel)} tipo ${tipo}`,
      };
    }),
  }) + `<p class="footnote">As exceções de compatibilidade existem na base (rl_excecao_compatibilidade, 5 linhas),
    mas não são mostradas neste protótipo. Documento de publicação e data de início (“desde”) não estão na base.</p>`;
}

function compatSections(ctx) {
  const comoPrincipal = ctx.tabsData.compat || [];
  const comoCompativel = ctx.tabsData.compat_de || [];
  return [
    { id: 'principal', label: 'Como principal', count: comoPrincipal.length, render: () => compatTable(comoPrincipal, ctx, true) },
    { id: 'compativel', label: 'Como compatível', count: comoCompativel.length, render: () => compatTable(comoCompativel, ctx, false) },
  ];
}

// --- Detail event delegation ---

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast(`Código ${code} copiado`);
  } catch {
    toast(`Código: ${code} (copie manualmente)`);
  }
}

function setupDetailEvents() {
  const detail = $('#detail');
  detail.addEventListener('click', (event) => {
    const target = event.target.closest('[data-tab], [data-sub], [data-action], [data-proc]');
    if (!target || !state.detail) return;
    // The tablist is re-rendered, so give focus back to the chosen tab.
    if (target.dataset.tab) selectTab(target.dataset.tab, { focus: true });
    else if (target.dataset.sub) selectSub(target.dataset.sub, { focus: true });
    else if (target.dataset.proc) {
      // Ctrl/Cmd/Shift/Alt-click keep the browser's behaviour (new tab or window).
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      openLinkedProcedure(target.dataset.proc);
    }
    else if (target.dataset.action === 'copy') copyCode(target.dataset.code);
    else if (target.dataset.action === 'back') {
      setMobileDetail(false);
      $(`.proc-row[data-code="${state.selected}"]`)?.focus();
    }
  });
  detail.addEventListener('keydown', handleTabKeys);
  detail.addEventListener('input', (event) => {
    if (event.target.matches('.table-filter')) applyTableFilter(event.target);
  });
}

// ---------------------------------------------------------------------------
// 8. Dialogs
// ---------------------------------------------------------------------------

function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const outside = event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    if (outside) dialog.close();
  });
}

function sourceSummary(db) {
  const subgroups = Object.values(db.hierarchy.subgroups).flat().length;
  return `
    <p>Base <strong>SIGTAP ${competenciaLabel()}</strong>, extraída do arquivo DuckDB do projeto. Consulta somente leitura, organizada pela competência.</p>
    <div class="source-stats">
      <div><strong>${fmt(db.total)}</strong><span>procedimentos</span></div>
      <div><strong>${db.hierarchy.groups.length}</strong><span>grupos</span></div>
      <div><strong>${subgroups}</strong><span>sub-grupos</span></div>
    </div>
    <h3>Cobertura dos grupos</h3>
    <div class="table-wrap"><table class="data-table compact"><thead><tr><th scope="col">Grupo</th><th scope="col" class="num">Procedimentos</th></tr></thead><tbody>
      ${db.hierarchy.groups.map(([g, n], i) => `<tr${i % 2 ? ' class="alt"' : ''}><td><span class="mono">${esc(g)}</span> – ${esc(n)}</td><td class="num">${fmt(db.counts[g])}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function validationDetails(validation, db) {
  const checks = validation.checks || {};
  const orphans = Object.entries(checks.orphan_procedure_relations || {});
  const orphanTotal = orphans.reduce((sum, [, n]) => sum + n, 0);
  const items = [
    ['Códigos de procedimento duplicados', checks.duplicate_procedure_keys],
    ['Códigos com tamanho diferente de 10 dígitos', checks.invalid_procedure_code_length],
    [`Vínculos órfãos (em ${orphans.length} tabelas de relação)`, orphanTotal],
    ['Procedimentos fora da hierarquia', checks.web_export_hierarchy_orphans],
    ['Procedimentos exportados para o site', checks.web_export_procedures],
    ['Amostras de relacionamentos conferidas', checks.web_export_relation_samples_match],
  ].filter(([, n]) => n != null);
  const rowCounts = Object.entries(validation.row_counts || {})
    .map(([table, n], i) => `<tr${i % 2 ? ' class="alt"' : ''}><td class="mono">${esc(table)}</td><td class="num">${fmt(n)}</td></tr>`)
    .join('');
  return `
    <h3>Verificações realizadas</h3>
    <div class="table-wrap"><table class="data-table compact"><tbody>
      ${items.map(([label, n], i) => `<tr${i % 2 ? ' class="alt"' : ''}><td>${esc(label)}</td><td class="num">${fmt(n)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="validation-note">${fmt(db.withoutDescription)} procedimentos não possuem descrição na base. A importação ainda não foi reconciliada com os TXT oficiais; essa limitação foi preservada. Competência ${competenciaLabel()}, sem atualização automática.</p>
    ${rowCounts ? `<details class="row-counts"><summary>Linhas por tabela (${validation.table_count ?? ''} tabelas)</summary>
      <div class="table-wrap"><table class="data-table compact"><tbody>${rowCounts}</tbody></table></div></details>` : ''}
    <h3>Identificação da fonte</h3>
    <p>${esc(validation.database || `sigtap_${db.competencia}.duckdb`)} · SHA-256</p>
    <code class="hash">${esc(validation.sha256 || db.sha256)}</code>`;
}

async function openSourceDialog() {
  const dialog = $('#source-dialog');
  $('#source-content').innerHTML = `${sourceSummary(state.db)}<div id="validation-block"><p class="loading-small">Carregando verificações…</p></div>`;
  dialog.showModal();
  try {
    const validation = await loadValidation();
    $('#validation-block').innerHTML = validationDetails(validation, state.db);
  } catch (error) {
    console.error(error);
    $('#validation-block').innerHTML = '<p class="validation-note">Não foi possível carregar data/validation.json.</p>';
  }
}

function setupSourceDialog() {
  const dialog = $('#source-dialog');
  $('#source-button').addEventListener('click', openSourceDialog);
  $('#close-dialog').addEventListener('click', () => dialog.close());
  closeOnBackdrop(dialog);
}

/** "Explorar CIDs / CBOs" dialog: browse every code that has linked procedures. */
function setupRelationBrowser() {
  const dialog = $('#relation-browser');
  const PAGE = 30;
  let kind = 'CID';
  let offset = 0;
  let opener = null;

  function matchingEntries() {
    const query = norm($('#browser-query').value.trim());
    const letter = $('#browser-letter').value;
    return state.relationIndex[kind].filter((e) => (!letter || e[0].startsWith(letter)) && (!query || relationEntryMatches(e, query)));
  }

  function render() {
    const entries = matchingEntries();
    const rows = entries.slice(offset, offset + PAGE);
    $('#browser-count').textContent = entries.length
      ? `${fmt(offset + 1)}–${fmt(offset + rows.length)} de ${fmt(entries.length)} códigos com procedimentos vinculados`
      : 'Nenhum código encontrado. Tente outro termo ou letra.';
    $('#browser-results').innerHTML = rows.map((e, i) => `
      <button type="button" class="browser-result" data-row="${i}">
        <code>${esc(e[0])}</code><span>${esc(display(e[1]))}</span><small>${plural(e[2].length, 'procedimento', 'procedimentos')}</small>
      </button>`).join('');
    $('#browser-results').scrollTop = 0;
    $$('#browser-results button').forEach((button) => {
      button.onclick = () => {
        const entry = rows[Number(button.dataset.row)];
        const input = $(`#${kind.toLowerCase()}`);
        input.value = `${entry[0]} — ${display(entry[1])}`;
        relationSuggestions(kind);
        filter();
        opener = input;   // the "close" handler returns focus to the filled field
        dialog.close();
      };
    });
    setPagerState($('#browser-prev'), $('#browser-next'), offset === 0, offset + PAGE >= entries.length);
    $('#browser-page').textContent = entries.length ? `Página ${Math.floor(offset / PAGE) + 1} de ${Math.ceil(entries.length / PAGE)}` : '0 páginas';
  }

  function open(type, button) {
    kind = type;
    offset = 0;
    opener = button;
    $('#relation-browser-title').textContent = kind === 'CID' ? 'Explorar CIDs' : 'Explorar ocupações (CBO)';
    $('#browser-query').value = '';
    const letters = [...new Set(state.relationIndex[kind].map((e) => e[0][0]))].sort();
    $('#browser-letter').innerHTML = '<option value="">Todas</option>' + letters.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
    $('#browser-letter-field').hidden = kind !== 'CID';
    render();
    dialog.showModal();
    $('#browser-query').focus();
  }

  $('#relation-browser-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => opener?.focus());
  closeOnBackdrop(dialog);
  $('#browser-query').oninput = () => { offset = 0; render(); };
  $('#browser-letter').onchange = () => { offset = 0; render(); };
  $('#browser-prev').onclick = () => { offset = Math.max(0, offset - PAGE); render(); };
  $('#browser-next').onclick = () => { offset += PAGE; render(); };
  $$('[data-browse]').forEach((button) => { button.onclick = () => open(button.dataset.browse, button); });
}

// ---------------------------------------------------------------------------
// 9. Startup
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 11. Relatórios
// ---------------------------------------------------------------------------
//
// Every report is "<vínculo> por procedimento": for each procedure in the
// chosen hierarchy, one row per linked item. Grouping by "Vínculo" turns the
// same rows into the inverse report (e.g. procedimentos por CBO).

const REPORT_PAGE_SIZE = 200;

const pct = (n) => (n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
/** Report money: plain pt-BR number (the header says R$), so columns read and sum cleanly. */
const money = (n) => (n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * cols: vínculo columns. rows(ctx) → array of cell arrays (plain text). The
 * first cell is the vínculo code (grouping key), the second its name.
 * perProcedure: exactly one row per procedure (no vínculo grouping).
 */
const REPORTS = [
  {
    id: 'cbo', title: 'CBO por procedimento', link: 'CBO',
    desc: 'Ocupações (CBO) vinculadas a cada procedimento. Agrupe por vínculo para ver os procedimentos de uma ocupação.',
    cols: ['CBO', 'Ocupação'],
    rows: (ctx) => ctx.rel('CBO').map(([code, name]) => [code, display(name)]),
  },
  {
    id: 'cid', title: 'CID por procedimento', link: 'CID',
    desc: 'Diagnósticos (CID-10) vinculados, com indicação de CID principal ou secundário.',
    cols: ['CID', 'Descrição', 'Tipo'],
    rows: (ctx) => ctx.rel('CID').map(([code, name, cond]) => [code, display(name), cond === 'CID principal' ? 'Principal' : 'Secundário']),
  },
  {
    id: 'habilitacao', title: 'Habilitação por procedimento', link: 'Habilitação',
    desc: 'Habilitações exigidas do estabelecimento, individuais ou em grupo.',
    cols: ['Habilitação', 'Nome', 'Forma'],
    rows: ({ tabsData, lk }) => [
      ...(tabsData.habilitacao || []).map((code) => [maskHabilitacao(code), display(lk.habilitacao[code] || ''), 'Individual']),
      ...(tabsData.grupo_habilitacao || []).flatMap(([group, members]) =>
        members.map((code) => [maskHabilitacao(code), display(lk.habilitacao[code] || ''), `Grupo ${group}`])),
    ],
  },
  {
    id: 'incremento', title: 'Incremento por procedimento', link: 'Habilitação',
    desc: 'Percentuais de incremento sobre SH, SA e SP conforme a habilitação.',
    cols: ['Habilitação', 'Nome', '% SH', '% SA', '% SP'], numeric: [2, 3, 4],
    rows: ({ tabsData, lk }) => (tabsData.incremento || []).map(([code, sh, sa, sp]) =>
      [maskHabilitacao(code), display(lk.habilitacao[code] || ''), pct(sh), pct(sa), pct(sp)]),
  },
  {
    id: 'instrumento', title: 'Instrumento de registro por procedimento', link: 'Instrumento',
    desc: 'Em quais instrumentos (BPA, APAC, AIH…) o procedimento pode ser registrado.',
    cols: ['Código', 'Instrumento de registro'],
    rows: (ctx) => ctx.rel('INSTRUMENTO').map(([code, name]) => [code, display(name)]),
  },
  {
    id: 'servico', title: 'Serviço/Classificação por procedimento', link: 'Serviço',
    desc: 'Serviços e classificações do estabelecimento exigidos para o procedimento.',
    cols: ['Serviço/Class.', 'Nome'],
    rows: (ctx) => ctx.rel('SERVICO_CLASSIFICACAO').map(([code, name]) => [code, display(name)]),
  },
  {
    id: 'leito', title: 'Leito por procedimento', link: 'Leito',
    desc: 'Tipos de leito aceitos para o procedimento.',
    cols: ['Leito', 'Tipo de leito'],
    rows: ({ tabsData, lk }) => (tabsData.leito || []).map((code) => [code, display(lk.tipo_leito[code] || '')]),
  },
  {
    id: 'atributo', title: 'Atributos complementares por procedimento', link: 'Atributo',
    desc: 'Regras adicionais de registro, como “Exige CNS” ou “Inclui valor da anestesia”.',
    cols: ['Código', 'Atributo complementar'],
    rows: (ctx) => ctx.rel('ATRIBUTO_COMPLEMENTAR').map(([code, name]) => [code, display(name)]),
  },
  {
    id: 'compat', title: 'Compatibilidades por procedimento', link: 'Compatível',
    desc: 'Procedimentos que podem ser registrados junto, com instrumento, tipo e quantidade permitida.',
    cols: ['Compatível', 'Nome', 'Registro', 'Tipo', 'Qtd.'], numeric: [4],
    rows: ({ tabsData, lk }) => (tabsData.compat || []).map(([code, regP, regC, tipo, qt]) => [
      maskProcedure(code), display(state.nameByCode.get(code) || ''),
      `${registroLabel(lk, regP)} → ${registroLabel(lk, regC)}`,
      lk.tipo_compatibilidade[String(tipo)] || `Tipo ${tipo}`, qt == null ? '' : fmt(qt),
    ]),
  },
  {
    id: 'renases', title: 'Renases por procedimento', link: 'Renases',
    desc: 'Ações e serviços da Renases relacionados ao procedimento.',
    cols: ['Renases', 'Nome'],
    rows: ({ tabsData, lk }) => (tabsData.renases || []).map((code) => [code, display(lk.renases[code] || '')]),
  },
  {
    id: 'origem', title: 'Origem SIA/SIH por procedimento', link: 'Código SIA/SIH',
    desc: 'Códigos das tabelas antigas (SIA/SIH) que deram origem ao procedimento.',
    cols: ['Código SIA/SIH', 'Nome', 'Tipo'],
    rows: ({ tabsData, lk }) => (tabsData.origem_sia_sih || []).map(([tipo, code, name]) => [code, display(name), lk.tipo_sia_sih[tipo] || tipo]),
  },
  {
    id: 'valores', title: 'Valores e atributos por procedimento', link: 'Texto',
    desc: 'Uma linha por procedimento com complexidade, financiamento, instrumento e os valores da tabela (SA, SH, SP e total hospitalar).',
    perProcedure: true,
    cols: ['Complexidade', 'Financiamento', 'Instrumento', 'SA', 'SH', 'SP', 'Total hospitalar'],
    // Full names for the CSV header and the legend under the summary.
    longCols: ['Complexidade', 'Financiamento', 'Instrumento', 'Serviço Ambulatorial (SA)', 'Serviço Hospitalar (SH)', 'Serviço Profissional (SP)', 'Total Hospitalar (SH + SP)'],
    legend: 'Valores em R$ da tabela SIGTAP. SA = Serviço Ambulatorial (também o total ambulatorial) · SH = Serviço Hospitalar · SP = Serviço Profissional · Total hospitalar = SH + SP.',
    numeric: [3, 4, 5, 6],
    money: [3, 4, 5, 6],
    totals: [3, 6],
    facets: [0, 1, 2],
    // Column bands over the header: [label, span, class]; the first two columns are Código and Procedimento.
    bands: [['', 2, ''], ['', 3, ''], ['Ambulatorial (R$)', 1, 'band-amb'], ['Hospitalar (R$)', 3, 'band-hosp']],
    rows: ({ p, lk, rel }) => [[
      lk.complexidade[p.complexidade] || '',
      lk.financiamento[p.financiamento_codigo] || p.financiamento_nome || '',
      rel('INSTRUMENTO').map(([, name]) => name).join(' · '),
      money(p.valor_sa), money(p.valor_sh), money(p.valor_sp),
      p.valor_sh == null && p.valor_sp == null ? '' : money((p.valor_sh || 0) + (p.valor_sp || 0)),
    ]],
  },
];

const reportState = {
  def: null,
  units: [],         // official hierarchy units chosen in "Buscar na classificação": [code, name]
  facets: {},        // column index → chosen value (Valores report header filters)
  rows: [],          // { code, name, cells }
  withoutLinks: 0,   // procedures in the selection with no row
  procCount: 0,
  page: 0,
  ticket: 0,
};

function renderReportNav() {
  $('#report-count').textContent = String(REPORTS.length);
  $('#reports-button').onclick = () => openReports(null);
}

function renderReportCatalog() {
  $('#report-catalog').innerHTML = `<div class="report-cards">${REPORTS.map((r) => `
    <button type="button" class="report-card" data-report="${r.id}">
      <strong>${esc(r.title)}</strong>
      <span>${esc(r.desc)}</span>
    </button>`).join('')}</div>`;
  $('#report-catalog').onclick = (event) => {
    const card = event.target.closest('[data-report]');
    if (card) openReports(card.dataset.report);
  };
}

function markActiveNav(open) {
  $('#reports-button').classList.toggle('active', open);
  $('#reports-button').setAttribute('aria-pressed', String(open));
}

/** Show the reports area: the catalog (id null) or one report. */
function openReports(id) {
  const def = REPORTS.find((r) => r.id === id) || null;
  $('.explorer').hidden = true;
  $('#news-view').hidden = true;
  markNewsNav(false);
  $('#reports-view').hidden = false;
  $('#all-groups').classList.remove('active');
  $$('.group-button').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
  markActiveNav(true);
  $('#report-catalog-back').hidden = !def;
  if (reportState.def !== def) reportState.facets = {};
  reportState.def = def;
  $('#report-title').textContent = def ? def.title : 'Relatórios';
  $('#report-desc').textContent = def
    ? def.desc
    : 'Escolha um relatório. Todos permitem filtrar por grupo, sub-grupo, forma de organização, procedimento e vínculo, e copiar a tabela para colar no Excel.';
  $('#report-catalog').hidden = Boolean(def);
  $('#report-runner').hidden = !def;
  if (def) {
    $('#r-link-label').textContent = def.link;
    $('#r-link-field').hidden = Boolean(def.perProcedure);
    if (def.perProcedure) $('#r-link').value = '';
    $('#r-groupby').disabled = Boolean(def.perProcedure);
    if (def.perProcedure) {
      reportState.forcedFlat = true;
      $('#r-groupby').value = 'none';
    } else if (reportState.forcedFlat) {
      reportState.forcedFlat = false;
      $('#r-groupby').value = 'proc';
    }
    runReport();
  }
  setReportURL(def ? def.id : 'todos');
  $('#report-title').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

/** Back to the explorer from Relatórios or Novidades. */
function closeReports() {
  if ($('#reports-view').hidden && $('#news-view').hidden) return;
  $('#reports-view').hidden = true;
  $('#news-view').hidden = true;
  $('.explorer').hidden = false;
  markActiveNav(false);
  markNewsNav(false);
  reportState.def = null;
  syncURL();
}

function setReportURL(id) {
  try {
    history.replaceState(null, '', `${location.pathname}?relatorio=${id}`);
  } catch {
    /* sandboxed frames may forbid history changes */
  }
}

/**
 * "Buscar na classificação": finds units of the official SIGTAP hierarchy
 * (grupo, sub-grupo, forma de organização) by name or code. Nothing enters the
 * report until the user ticks a unit, so the report is always a union of
 * official categories the user chose.
 */
function findUnits(query) {
  const raw = query.trim();
  if (!raw) return [];
  const h = state.db.hierarchy;
  const digits = codeDigits(raw);
  const byCode = /^\d{2,6}$/.test(digits);
  // Long terms also match their stem: "oncologia" finds "oncológica", "nefrologia" finds "nefrológico".
  const stems = terms(norm(raw)).map((t) => (t.length >= 7 ? [t, t.slice(0, -2)] : [t]));
  const hit = (code, name) => (byCode ? code.startsWith(digits) && code.length <= Math.max(digits.length, 2)
    : stems.every((alts) => alts.some((t) => norm(name).includes(t))));
  const units = [];
  for (const [g, gName] of h.groups) {
    if (hit(g, gName)) units.push([g, gName]);
    for (const [sg, sgName] of h.subgroups[g] || []) {
      if (hit(sg, sgName)) units.push([sg, sgName]);
      for (const [f, fName] of h.forms[sg] || []) if (hit(f, fName)) units.push([f, fName]);
    }
  }
  return units;
}

function maskUnit(code) {
  return code.match(/.{2}/g).join('.');
}

const unitCount = (code) => state.all.filter((p) => p[0].startsWith(code)).length;
const unitLevel = (code) => ({ 2: 'Grupo', 4: 'Sub-grupo', 6: 'Forma' }[code.length]);

function unitChip([code, name], { selected, removable }) {
  const n = unitCount(code);
  const attrs = removable
    ? `data-remove="${code}" aria-label="Remover ${esc(maskUnit(code))} ${esc(name)}"`
    : `data-toggle="${code}" aria-pressed="${selected}"${n ? '' : ' disabled title="Sem procedimentos nesta competência"'}`;
  return `<button type="button" class="topic-chip${selected ? ' selected' : ''}${n ? '' : ' is-empty'}" data-group="${code.slice(0, 2)}" ${attrs}>
    <span class="topic-level">${unitLevel(code)}</span><span class="mono">${maskUnit(code)}</span> ${esc(name)}
    <span class="topic-count">${n ? plural(n, 'proc.', 'proc.') : 'sem procedimentos'}</span>${removable ? '<span aria-hidden="true" class="topic-x">×</span>' : ''}</button>`;
}

function renderUnitPanel() {
  const box = $('#r-topic-matches');
  const query = $('#r-topic').value.trim();
  const found = findUnits(query);
  const chosen = new Set(reportState.units.map(([c]) => c));
  let html = '';
  if (query) {
    const open = found.filter(([c]) => !chosen.has(c));
    html += found.length && !open.length
      ? `<p>Todos os itens encontrados para “${esc(query)}” já estão no relatório.</p>`
      : found.length
      ? `<div class="topic-head"><p>Itens da classificação oficial com “${esc(query)}”. Marque os que entram no relatório:</p>
          <button type="button" class="link-button" data-toggle-all>Marcar todos</button></div>
         <div class="topic-chips">${open.map((u) => unitChip(u, { selected: false })).join('')}</div>`
      : `<p>Nenhum grupo, sub-grupo ou forma de organização com “${esc(query)}” no nome. Para procurar no nome do procedimento, use o campo Procedimento.</p>`;
  }
  if (reportState.units.length) {
    html += `<div class="topic-head"><p><strong>No relatório:</strong></p><button type="button" class="link-button" data-clear-units>Limpar seleção</button></div>
      <div class="topic-chips">${reportState.units.map((u) => unitChip(u, { selected: true, removable: true })).join('')}</div>`;
  }
  box.hidden = !html;
  box.innerHTML = html;
}

function toggleUnit(code, on) {
  const has = reportState.units.some(([c]) => c === code);
  if (on === undefined) on = !has;
  if (on && !has) {
    const all = findUnits(code.length === 2 ? code : maskUnit(code)).find(([c]) => c === code) || [code, ''];
    reportState.units.push(all);
    reportState.units.sort(([a], [b]) => a.localeCompare(b));
  } else if (!on && has) {
    reportState.units = reportState.units.filter(([c]) => c !== code);
  }
}

function reportFilters() {
  return {
    prefix: $('#r-form').value || $('#r-subgroup').value || $('#r-group').value,
    proc: norm($('#r-proc').value.trim()),
    link: norm($('#r-link').value.trim()),
    groupBy: $('#r-groupby').value,
  };
}

const terms = (q) => q.split(/\s+/).filter(Boolean);
const codeDigits = (s) => s.replace(/[.\-\s/]/g, '');

function procedureMatches([code, , normName], q) {
  if (!q) return true;
  const digits = codeDigits(q);
  if (/^\d+$/.test(digits)) return code.startsWith(digits);
  return terms(q).every((t) => normName.includes(t));
}

function linkMatches(cells, q) {
  if (!q) return true;
  const first = codeDigits(norm(cells[0]));
  if (first.startsWith(codeDigits(q))) return true;
  const text = norm(cells.join(' '));
  return terms(q).every((t) => text.includes(t));
}

async function runReport() {
  const def = reportState.def;
  if (!def) return;
  const ticket = ++reportState.ticket;
  const { prefix, proc, link } = reportFilters();
  renderUnitPanel();
  const units = reportState.units.map(([c]) => c);
  const inUnits = (code) => !units.length || units.some((unit) => code.startsWith(unit));
  const procs = state.all.filter((p) => p[0].startsWith(prefix) && inUnits(p[0]) && procedureMatches(p, proc));
  const groups = [...new Set(procs.map((p) => p[0].slice(0, 2)))];

  $('#report-summary').textContent = groups.length > 1
    ? `Carregando ${groups.length} grupos da base…`
    : 'Gerando relatório…';
  setReportButtons(false);

  let catalog, lookups, groupData;
  try {
    [catalog, lookups, groupData] = await Promise.all([loadCatalog(), loadLookups(), Promise.all(groups.map((g) => loadGroup(g)))]);
  } catch {
    if (ticket === reportState.ticket) $('#report-summary').textContent = 'Não foi possível carregar a base. Verifique a conexão e tente de novo.';
    return;
  }
  if (ticket !== reportState.ticket) return;

  const byGroup = new Map(groups.map((g, i) => [g, groupData[i]]));
  const rows = [];
  let withoutLinks = 0;
  for (const [code, name] of procs) {
    const p = byGroup.get(code.slice(0, 2))?.[code];
    if (!p) continue;
    const items = def.rows(buildContext(p, catalog, lookups)).filter((cells) => linkMatches(cells, link));
    if (!items.length) withoutLinks += 1;
    for (const cells of items) rows.push({ code, name, cells });
  }
  reportState.rows = rows;
  reportState.procCount = procs.length;
  reportState.withoutLinks = withoutLinks;
  reportState.page = 0;
  renderReportTable();
}

/** Header filters (Valores report): a cell matches when it equals the value or lists it ("A · B"). */
function facetRows(rows) {
  const active = Object.entries(reportState.facets).filter(([, v]) => v);
  if (!active.length) return rows;
  return rows.filter((r) => active.every(([i, v]) => r.cells[i] === v || r.cells[i].split(' · ').includes(v)));
}

function facetOptions(i) {
  const values = new Set();
  for (const r of reportState.rows) for (const v of r.cells[i].split(' · ')) if (v) values.add(v);
  return [...values].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Rows in display order for the current grouping. */
function orderedReportRows() {
  const rows = facetRows(reportState.rows);
  if ($('#r-groupby').value !== 'link') return rows;
  return [...rows].sort((a, b) => a.cells[0].localeCompare(b.cells[0], 'pt-BR', { numeric: true }) || a.code.localeCompare(b.code));
}

function reportSummaryText(rows) {
  const def = reportState.def;
  const withLinks = new Set(rows.map((r) => r.code)).size;
  if (def.perProcedure) return `${plural(rows.length, 'procedimento', 'procedimentos')}`;
  const distinct = new Set(rows.map((r) => r.cells[0])).size;
  return `${plural(rows.length, 'vínculo', 'vínculos')} · ${plural(withLinks, 'procedimento', 'procedimentos')} · ${plural(distinct, `${def.link} distinto`, `${def.link} distintos`)}`
    + (reportState.withoutLinks ? ` · ${plural(reportState.withoutLinks, 'procedimento sem vínculo', 'procedimentos sem vínculo')} na seleção` : '');
}

function reportCell(text, i) {
  const def = reportState.def;
  const numeric = def.numeric?.includes(i);
  const isMoney = def.money?.includes(i);
  const cls = [
    i === 0 && !def.perProcedure ? 'mono col-code' : '',
    numeric ? 'num' : '',
    isMoney ? (i === 3 ? 'money band-amb' : 'money band-hosp') : '',
    def.totals?.includes(i) ? 'money-total' : '',
    isMoney && text === '0,00' ? 'money-zero' : '',
  ].filter(Boolean).join(' ');
  return `<td${cls ? ` class="${cls}"` : ''} data-label="${esc(reportState.def.cols[i])}">${text ? esc(text) : '<span class="empty">—</span>'}</td>`;
}

function renderReportTable() {
  const def = reportState.def;
  const groupBy = $('#r-groupby').value;
  const rows = orderedReportRows();
  const pages = Math.max(1, Math.ceil(rows.length / REPORT_PAGE_SIZE));
  reportState.page = Math.min(reportState.page, pages - 1);
  const start = reportState.page * REPORT_PAGE_SIZE;
  const pageRows = rows.slice(start, start + REPORT_PAGE_SIZE);

  $('#report-summary').textContent = rows.length ? reportSummaryText(rows) : 'Nenhum vínculo encontrado com esses filtros.';
  $('#report-legend').textContent = def.legend || '';
  $('#report-legend').hidden = !def.legend;
  setReportButtons(rows.length > 0);
  $('#report-page').textContent = rows.length ? `Linhas ${fmt(start + 1)}–${fmt(start + pageRows.length)} de ${fmt(rows.length)}` : '';
  $('#report-prev').disabled = reportState.page === 0;
  $('#report-next').disabled = reportState.page >= pages - 1;

  if (!rows.length) {
    const facetsOn = Object.values(reportState.facets).some(Boolean);
    $('#report-table').innerHTML = facetsOn
      ? '<p class="empty-note">Nenhuma linha com esses filtros de coluna. <button type="button" class="link-button" data-clear-facets>Limpar filtros de coluna</button></p>'
      : '<p class="empty-note">Ajuste a classificação, o procedimento ou o vínculo para ver resultados.</p>';
    return;
  }

  const procCells = (r) => `<td class="mono col-code">${procLink(r.code)}</td><td>${esc(display(r.name))}</td>`;
  let head;
  let body = '';
  if (groupBy === 'proc' && !def.perProcedure) {
    head = def.cols.map((c, i) => `<th scope="col"${def.numeric?.includes(i) ? ' class="num"' : ''}>${esc(c)}</th>`).join('');
    let current = null;
    let alt = false;
    const totals = new Map();
    for (const r of rows) totals.set(r.code, (totals.get(r.code) || 0) + 1);
    for (const r of pageRows) {
      if (r.code !== current) {
        current = r.code;
        alt = false;
        const total = totals.get(r.code);
        body += `<tr class="group-row"><th scope="rowgroup" colspan="${def.cols.length}">${procLink(r.code)} <span class="group-row-name">${esc(display(r.name))}</span> <span class="group-row-count">${plural(total, 'vínculo', 'vínculos')}</span></th></tr>`;
      }
      body += `<tr${alt ? ' class="alt"' : ''}>${r.cells.map(reportCell).join('')}</tr>`;
      alt = !alt;
    }
  } else if (groupBy === 'link' && !def.perProcedure) {
    const extra = def.cols.slice(2);
    head = `<th scope="col">Código</th><th scope="col">Procedimento</th>${extra.map((c, i) => `<th scope="col"${def.numeric?.includes(i + 2) ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}`;
    let current = null;
    let alt = false;
    const counts = new Map();
    for (const r of rows) counts.set(r.cells[0], (counts.get(r.cells[0]) || 0) + 1);
    for (const r of pageRows) {
      if (r.cells[0] !== current) {
        current = r.cells[0];
        alt = false;
        body += `<tr class="group-row"><th scope="rowgroup" colspan="${2 + extra.length}"><span class="mono">${esc(r.cells[0])}</span> <span class="group-row-name">${esc(r.cells[1])}</span> <span class="group-row-count">${plural(counts.get(current), 'procedimento', 'procedimentos')}</span></th></tr>`;
      }
      body += `<tr${alt ? ' class="alt"' : ''}>${procCells(r)}${r.cells.slice(2).map((c, i) => reportCell(c, i + 2)).join('')}</tr>`;
      alt = !alt;
    }
  } else {
    const thClass = (i) => [def.numeric?.includes(i) ? 'num' : '', def.money?.includes(i) ? (i === 3 ? 'band-amb' : 'band-hosp') : ''].filter(Boolean).join(' ');
    head = `<th scope="col">Código</th><th scope="col">Procedimento</th>${def.cols.map((c, i) => `<th scope="col"${thClass(i) ? ` class="${thClass(i)}"` : ''}>${esc(c)}</th>`).join('')}`;
    if (def.bands) {
      head = `${def.bands.map(([label, span, cls]) => `<th colspan="${span}"${cls ? ` class="band ${cls}"` : ''}>${esc(label)}</th>`).join('')}</tr><tr>${head}`;
    }
    if (def.facets) {
      const select = (i) => `<select class="facet" data-facet="${i}" aria-label="Filtrar ${esc(def.cols[i])}">
        <option value="">Todos</option>${facetOptions(i).map((v) => `<option${reportState.facets[i] === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
      head += `</tr><tr class="facet-row"><td></td><td class="facet-hint">Filtrar colunas:</td>${def.cols.map((c, i) => `<td>${def.facets.includes(i) ? select(i) : ''}</td>`).join('')}`;
    }
    body = pageRows.map((r, i) => `<tr${i % 2 ? ' class="alt"' : ''}>${procCells(r)}${r.cells.map(reportCell).join('')}</tr>`).join('');
  }
  $('#report-table').innerHTML = `<div class="table-wrap"><table class="data-table report-data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Tab-separated, so it pastes into Excel/Sheets as columns. */
async function copyReport() {
  const def = reportState.def;
  const rows = orderedReportRows();
  const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ');
  const lines = [['Código', 'Procedimento', ...def.cols].join('\t')]
    .concat(rows.map((r) => [maskProcedure(r.code), display(r.name), ...r.cells].map(clean).join('\t')));
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    toast(`${plural(rows.length, 'linha copiada', 'linhas copiadas')} — cole no Excel ou no Google Planilhas`);
  } catch {
    toast('Não foi possível copiar automaticamente neste navegador.');
  }
}

function setReportButtons(enabled) {
  for (const id of ['report-copy', 'report-csv', 'report-pdf']) $(`#${id}`).disabled = !enabled;
}

// --- Downloads (CSV and PDF) ---

/**
 * Inside the claude.ai viewer, files go through the "downloads" capability
 * (the viewer confirms the save); on a normal website, a plain <a download>.
 */
async function saveFile(filename, data, mime) {
  const viewer = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (viewer) {
    try {
      await viewer.save({ filename, data });
      toast(`${filename} salvo`);
    } catch (error) {
      if (error?.code !== 'declined') toast('Não foi possível salvar o arquivo neste navegador.');
    }
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportFileName(ext) {
  const def = reportState.def;
  const { prefix } = reportFilters();
  const slug = norm(def.title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `sigtap-${state.db.competencia}-${slug}${prefix ? `-${prefix}` : ''}.${ext}`;
}

/** Human description of the filters, printed on the PDF and as the CSV's first lines. */
function reportFilterLines() {
  const optionText = (id) => { const el = $(`#${id}`); return el.value ? el.selectedOptions[0].textContent : ''; };
  const lines = [];
  if (reportState.units.length) {
    lines.push(`Classificação: ${reportState.units.map(([c, n]) => `${maskUnit(c)} ${n}`).join('; ')}`);
  }
  for (const [i, value] of Object.entries(reportState.facets)) {
    if (value) lines.push(`${reportState.def.cols[i]}: ${value}`);
  }
  const hier = [optionText('r-group'), optionText('r-subgroup'), optionText('r-form')].filter(Boolean);
  if (hier.length || !reportState.units.length) lines.push(`Hierarquia: ${hier.length ? hier.join(' › ') : 'todos os grupos'}`);
  if ($('#r-proc').value.trim()) lines.push(`Procedimento: ${$('#r-proc').value.trim()}`);
  if ($('#r-link').value.trim()) lines.push(`${$('#r-link-label').textContent}: ${$('#r-link').value.trim()}`);
  return lines;
}

function reportSourceLine() {
  return `Fonte: SIGTAP competência ${competenciaLabel()} · base sigtap_${state.db.competencia}.duckdb (SHA-256 ${state.db.sha256.slice(0, 12)}…) · gerado em ${new Date().toLocaleString('pt-BR')}`;
}

async function downloadReportCSV() {
  const def = reportState.def;
  const rows = orderedReportRows();
  // Money as plain numbers (2.224,00) so Excel can sum them; the currency is in the header.
  const cell = (v) => {
    const t = String(v ?? '').replace(/^R\$\s*/u, '');
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  // Semicolon-separated with a BOM: opens in Excel (pt-BR) with accents and columns right.
  const lines = [
    ['Código', 'Procedimento', ...(def.longCols || def.cols)].map(cell).join(';'),
    ...rows.map((r) => [maskProcedure(r.code), display(r.name), ...r.cells].map(cell).join(';')),
  ];
  await saveFile(reportFileName('csv'), '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

const PDF_ROW_LIMIT = 20000;
let pdfLibrary;

/** jsPDF + AutoTable, loaded only when the first PDF is requested. */
function loadPdfLibrary() {
  if (!pdfLibrary) {
    const load = (src) => new Promise((resolve, reject) => {
      const script = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
      document.head.append(script);
    });
    pdfLibrary = load('./vendor/jspdf.umd.min.js')
      .then(() => load('./vendor/jspdf.plugin.autotable.min.js'))
      .catch((error) => { pdfLibrary = null; throw error; });
  }
  return pdfLibrary;
}

/** The built-in PDF fonts cover Latin-1 (all Portuguese accents); swap the few symbols outside it. */
const pdfText = (s) => String(s ?? '').replace(/→/g, '->').replace(/›/g, '>').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/[^\x00-\xff]/g, '?');

async function downloadReportPDF() {
  const def = reportState.def;
  const rows = orderedReportRows();
  if (rows.length > PDF_ROW_LIMIT) {
    toast(`PDF limitado a ${fmt(PDF_ROW_LIMIT)} linhas (este relatório tem ${fmt(rows.length)}). Filtre por grupo ou use o CSV.`);
    return;
  }
  const button = $('#report-pdf');
  button.disabled = true;
  button.lastElementChild.textContent = 'Gerando PDF…';
  try {
    await loadPdfLibrary();
    const { jsPDF } = window.jspdf;
    const wide = def.cols.length + 2 > 5;
    const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const groupBy = def.perProcedure ? 'none' : $('#r-groupby').value;
    const green = [24, 92, 79];

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...green);
    doc.text(pdfText(def.title), 40, 44);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60);
    const width = doc.internal.pageSize.getWidth() - 80;
    const meta = [...reportFilterLines(), reportSummaryText(rows), ...(def.legend ? [def.legend] : []), reportSourceLine()]
      .flatMap((line) => doc.splitTextToSize(pdfText(line), width));
    meta.forEach((line, i) => doc.text(line, 40, 62 + i * 12));

    let head;
    let body = [];
    const colCount = groupBy === 'proc' ? def.cols.length : groupBy === 'link' ? 2 + def.cols.length - 2 : 2 + def.cols.length;
    const groupRow = (text) => [{ content: pdfText(text), colSpan: colCount, styles: { fillColor: [238, 248, 242], textColor: [31, 90, 69], fontStyle: 'bold' } }];
    if (groupBy === 'proc') {
      head = [def.cols];
      let current = null;
      for (const r of rows) {
        if (r.code !== current) { current = r.code; body.push(groupRow(`${maskProcedure(r.code)}  ${display(r.name)}`)); }
        body.push(r.cells);
      }
    } else if (groupBy === 'link') {
      head = [['Código', 'Procedimento', ...def.cols.slice(2)]];
      let current = null;
      for (const r of rows) {
        if (r.cells[0] !== current) { current = r.cells[0]; body.push(groupRow(`${r.cells[0]}  ${r.cells[1]}`)); }
        body.push([maskProcedure(r.code), display(r.name), ...r.cells.slice(2)]);
      }
    } else {
      head = [['Código', 'Procedimento', ...def.cols]];
      if (def.bands) {
        const bandFill = { 'band-amb': [237, 241, 248], 'band-hosp': [253, 243, 236] };
        head.unshift(def.bands.map(([label, span, cls]) => ({
          content: label, colSpan: span, styles: { halign: 'center', fillColor: bandFill[cls] || [255, 255, 255] },
        })));
      }
      body = rows.map((r) => [maskProcedure(r.code), display(r.name), ...r.cells]);
    }
    const clean = (row) => row.map((c) => (typeof c === 'object' ? c : pdfText(c)));
    const numericCols = {};
    const offset = groupBy === 'proc' ? 0 : 2 - (groupBy === 'link' ? 2 : 0);
    for (const i of def.numeric || []) numericCols[i + (groupBy === 'none' ? 2 : offset)] = { halign: 'right', minCellWidth: 64, overflow: 'visible' };
    numericCols[groupBy === 'proc' ? -1 : 0] = { minCellWidth: 70 };   // masked code on one line

    doc.autoTable({
      head: head.map(clean),
      body: body.map(clean),
      startY: 62 + meta.length * 12 + 8,
      margin: { left: 40, right: 40, bottom: 40 },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3, textColor: 30, lineColor: 225, lineWidth: 0.5 },
      headStyles: { fillColor: [241, 233, 218], textColor: 30, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 245, 239] },
      columnStyles: numericCols,
      didParseCell: (cell) => {
        if (cell.section !== 'body' || groupBy !== 'none' || !def.money) return;
        const i = cell.column.index - 2;
        if (def.totals?.includes(i)) cell.cell.styles.fontStyle = 'bold';
        if (def.money.includes(i) && cell.cell.raw === '0,00') cell.cell.styles.textColor = 160;
      },
      didDrawPage: () => {
        const pages = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(110);
        doc.text(pdfText(`SIGTAP ${competenciaLabel()} · ${def.title} · página ${pages}`), 40, doc.internal.pageSize.getHeight() - 20);
      },
    });
    await saveFile(reportFileName('pdf'), doc.output('blob'), 'application/pdf');
  } catch (error) {
    console.error(error);
    toast('Não foi possível gerar o PDF.');
  } finally {
    button.lastElementChild.textContent = 'Baixar PDF';
    button.disabled = !reportState.rows.length;
  }
}

function setupReports() {
  renderReportNav();
  renderReportCatalog();
  fillOptions($('#r-group'), state.db.hierarchy.groups, 'Todos os grupos');

  const fillChild = (parentId, childId, source, placeholderOn, placeholderOff) => {
    const value = $(`#${parentId}`).value;
    fillOptions($(`#${childId}`), value ? source[value] || [] : [], value ? placeholderOn : placeholderOff);
    $(`#${childId}`).disabled = !value;
  };
  const updateRForm = () => fillChild('r-subgroup', 'r-form', state.db.hierarchy.forms, 'Todas as formas', 'Selecione um sub-grupo');
  const updateRSub = () => { fillChild('r-group', 'r-subgroup', state.db.hierarchy.subgroups, 'Todos os sub-grupos', 'Selecione um grupo'); updateRForm(); };

  const clearUnits = () => { reportState.units = []; $('#r-topic').value = ''; };
  $('#r-group').onchange = () => { clearUnits(); updateRSub(); runReport(); };
  $('#r-subgroup').onchange = () => { updateRForm(); runReport(); };
  $('#r-form').onchange = () => runReport();
  $('#r-groupby').onchange = () => { reportState.page = 0; renderReportTable(); };
  let timer;
  for (const id of ['r-proc', 'r-link']) {
    $(`#${id}`).addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runReport, 250); });
  }
  $('#report-prev').onclick = () => { if (reportState.page > 0) { reportState.page -= 1; renderReportTable(); $('#report-table').scrollIntoView({ block: 'nearest' }); } };
  $('#report-next').onclick = () => { reportState.page += 1; renderReportTable(); $('#report-table').scrollIntoView({ block: 'nearest' }); };
  $('#report-copy').onclick = copyReport;
  $('#report-csv').onclick = downloadReportCSV;
  $('#report-pdf').onclick = downloadReportPDF;
  $('#report-catalog-back').onclick = () => openReports(null);
  // Classification finder: typing lists official units; ticking adds them to the report.
  $('#r-topic').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(renderUnitPanel, 150); });
  $('#r-topic-matches').addEventListener('click', (event) => {
    const button = event.target.closest('[data-toggle], [data-remove], [data-toggle-all], [data-clear-units]');
    if (!button) return;
    if (button.dataset.toggle) toggleUnit(button.dataset.toggle);
    else if (button.dataset.remove) toggleUnit(button.dataset.remove, false);
    else if ('toggleAll' in button.dataset) {
      findUnits($('#r-topic').value).filter(([c]) => unitCount(c)).forEach(([c]) => toggleUnit(c, true));
    } else if ('clearUnits' in button.dataset) reportState.units = [];
    // The chosen units replace the Grupo / Sub-Grupo / Forma selects.
    if (reportState.units.length && $('#r-group').value) { $('#r-group').value = ''; updateRSub(); }
    runReport();
  });
  $('#report-back').onclick = closeReports;

  $('#report-table').addEventListener('change', (event) => {
    const select = event.target.closest('[data-facet]');
    if (!select) return;
    reportState.facets[select.dataset.facet] = select.value;
    reportState.page = 0;
    renderReportTable();
    $(`[data-facet="${select.dataset.facet}"]`)?.focus();
  });

  // A procedure code in a report opens its ficha in the explorer.
  $('#report-table').addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-facets]')) {
      reportState.facets = {};
      renderReportTable();
      return;
    }
    const link = event.target.closest('[data-proc]');
    if (!link) return;
    event.preventDefault();
    closeReports();
    openLinkedProcedure(link.dataset.proc);
  });
}

// --- Collapsible sidebar sections ---

function setupSidebarSections() {
  $$('.nav-section').forEach((section) => {
    const key = section.dataset.section;
    const toggle = $('.section-toggle', section);
    const apply = (collapsed) => {
      section.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      $('.section-body', section).hidden = collapsed;
    };
    apply(Boolean(settings.collapsed[key]));
    toggle.addEventListener('click', () => {
      settings.collapsed[key] = !settings.collapsed[key];
      saveSettings();
      apply(settings.collapsed[key]);
    });
  });
}

function renderSidebar() {
  const { hierarchy, counts } = state.db;
  $('#group-nav').innerHTML = hierarchy.groups.map(([g, name]) => `
    <button type="button" class="group-button" data-group="${g}" aria-pressed="false" title="${esc(name)}">
      <span class="group-code">${g}</span>
      <span class="group-name">${esc(SHORT_GROUP_NAMES[g] || name)}</span>
      <span class="group-count">${fmt(counts[g])}</span>
    </button>`).join('');
  $$('#group-nav .group-button').forEach((button) => {
    button.onclick = () => {
      closeReports();
      $('#group').value = button.dataset.group;
      updateSubgroups();
      filter();
    };
  });
}

/** Text size and Legível/Original work while the data is still loading. */
function setupReadingControls() {
  $$('[data-size]').forEach((b) => { b.onclick = () => setTextSize(b.dataset.size); });
  $$('[data-case]').forEach((b) => { b.onclick = () => setTextMode(b.dataset.case); });
}

/**
 * The "?" next to the CID filter opens a small note (a disclosure: Enter or
 * Space toggles it, Escape or a click elsewhere closes it). The inputs keep
 * the note as their description even while it is hidden.
 */
function setupInfoButton() {
  const button = $('#relation-help-button');
  const note = $('#relation-help');
  const toggle = (open) => {
    note.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => toggle(note.hidden));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !note.hidden) toggle(false);
  });
  document.addEventListener('click', (event) => {
    if (!note.hidden && !button.contains(event.target) && !note.contains(event.target)) toggle(false);
  });
}

function setupControls() {
  $('#group').onchange = () => { updateSubgroups(); filter(); };
  $('#subgroup').onchange = () => { updateForms(); filter(); };
  $('#form').onchange = () => filter();
  $('#search').addEventListener('input', () => filter());
  $('#reset').onclick = reset;
  $('#all-groups').onclick = () => { closeReports(); reset(); };
  for (const kind of ['CID', 'CBO']) {
    $(`#${kind.toLowerCase()}`).addEventListener('input', () => { relationSuggestions(kind); filter(); });
  }

  $('#results').addEventListener('click', (event) => {
    const row = event.target.closest('.proc-row');
    if (row) select(row.dataset.code);
  });
  $('#prev').onclick = () => { if (state.page > 0) { state.page -= 1; renderList(); } };
  $('#next').onclick = () => {
    if ((state.page + 1) * PAGE_SIZE < state.filtered.length) { state.page += 1; renderList(); }
  };

  document.addEventListener('keydown', (event) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (event.key === '/' && !typing && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      $('#search').focus();
    }
  });
}

function restoreFromURL() {
  const url = new URLSearchParams(location.search);
  // A field the URL leaves empty keeps whatever was typed while the data loaded.
  for (const [id, key] of [['search', 'q'], ['cid', 'cid'], ['cbo', 'cbo']]) {
    if (url.get(key)) $(`#${id}`).value = url.get(key);
  }
  relationSuggestions('CID');
  relationSuggestions('CBO');
  $('#group').value = url.get('g') || '';
  updateSubgroups();
  $('#subgroup').value = url.get('s') || '';
  updateForms();
  $('#form').value = url.get('f') || '';
  const tab = url.get('aba');
  if (tab && TAB_BUILDERS.some(([id]) => id === tab)) settings.lastTab = tab;
  const news = url.get('novidades');
  if (news) {
    filter();
    openNews(news);
    return;
  }
  const report = url.get('relatorio');
  if (report) {
    filter();
    openReports(report === 'todos' ? null : report);
    return;
  }
  const preferred = url.get('p');
  // On a phone a shared link to a procedure opens its ficha, not the list.
  filter({ preferred, mobile: Boolean(preferred && state.nameByCode.has(preferred) && isMobileLayout()) });
}

/**
 * The workspace fills the viewport below the header and filters
 * (height: calc(100vh - top), min 520px in CSS), so on desktop only the
 * list and the ficha scroll. Re-measure whenever the chrome above changes.
 */
function trackWorkspaceTop() {
  const update = () => {
    const top = $('#workspace').getBoundingClientRect().top + window.scrollY;
    document.documentElement.style.setProperty('--workspace-top', `${Math.round(top)}px`);
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe($('.topbar'));
  observer.observe($('.filters'));
  window.addEventListener('resize', update);
  document.fonts?.ready.then(update);
}

function showStartupError(error) {
  console.error(error);
  $('#result-count').textContent = 'Não foi possível carregar a base';
  $('#results').innerHTML = '<div class="empty-results"><p>Confira sua conexão e recarregue a página.</p><button type="button" id="reload">Tentar novamente</button></div>';
  $('#reload').onclick = () => location.reload();
  $('#group-nav').textContent = 'Base indisponível';
}

// ---------------------------------------------------------------------------
// 12. Novidades da competência
// ---------------------------------------------------------------------------
//
// data/novidades/<AAAAMM>.json is built by scripts/build_novidades.py from the
// previous and the current export (so every change comes from the base); the
// portarias come from the competência's Nota Técnica (fontes/notas-tecnicas).

const NEWS_TABS = [
  ['alterados', 'Alterados'],
  ['novos', 'Novos'],
  ['revogados', 'Revogados'],
  ['compatibilidades', 'Compatibilidades'],
  ['conferencia', 'Conferência nota × base'],
];

const newsState = { index: null, data: null, tab: 'alterados', comp: null };
const loadNewsIndex = loadOnce('./data/novidades/index.json');

function markNewsNav(open) {
  $('#news-button').classList.toggle('active', open);
  $('#news-button').setAttribute('aria-pressed', String(open));
}

const compLabel = (c) => `${c.slice(4)}/${c.slice(0, 4)}`;

async function openNews(comp) {
  $('.explorer').hidden = true;
  $('#reports-view').hidden = true;
  markActiveNav(false);
  $('#news-view').hidden = false;
  $('#all-groups').classList.remove('active');
  $$('.group-button').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
  markNewsNav(true);
  $('#news-table').innerHTML = '<p class="empty-note">Carregando novidades…</p>';
  try {
    newsState.index = await loadNewsIndex();
    const target = comp && newsState.index.some((e) => e.competencia === comp) ? comp : newsState.index[0]?.competencia;
    if (!target) throw new Error('sem novidades');
    const [data, lookups, catalog] = await Promise.all([fetchJSON(`./data/novidades/${target}.json`), loadLookups(), loadCatalog()]);
    newsState.data = data;
    newsState.lk = lookups;
    newsState.comp = target;
  } catch {
    $('#news-table').innerHTML = '<p class="empty-note">Não há novidades publicadas para esta base.</p>';
    return;
  }
  try { history.replaceState(null, '', `${location.pathname}?novidades=${newsState.comp}`); } catch { /* sandboxed */ }
  renderNews();
  $('#news-title').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function renderNews() {
  const d = newsState.data;
  const r = d.resumo;
  $('#news-title').textContent = `Novidades da competência ${compLabel(d.competencia)}`;
  $('#news-desc').textContent = `Tudo o que mudou na base SIGTAP de ${compLabel(d.anterior)} para ${compLabel(d.competencia)}, procedimento por procedimento. A portaria de cada mudança vem da nota técnica da competência.`;
  const many = newsState.index.length > 1;
  $('#news-select-wrap').hidden = !many;
  if (many) {
    $('#news-select').innerHTML = newsState.index.map((e) => `<option value="${e.competencia}"${e.competencia === d.competencia ? ' selected' : ''}>${compLabel(e.competencia)}</option>`).join('');
  }
  const conf = d.conferencia || [];
  const divergences = conf.reduce((n, c) => n + c.so_na_base.length + c.so_na_nota.length, 0);
  $('#news-source').innerHTML = d.nota
    ? `<div class="news-note">
        <div><strong>Nota Técnica ${esc(d.nota.orgao)} nº ${esc(d.nota.numero)} de ${esc(d.nota.data)}</strong>
          <span>Documento oficial que acompanha a competência e informa as portarias.</span></div>
        <a class="report-back" href="./${esc(d.nota.caminho)}" target="_blank" rel="noopener">${icon('file')}<span>Abrir nota técnica (PDF)</span></a>
        <span class="news-check ${divergences ? 'warn' : 'ok'}">${divergences ? `${plural(divergences, 'divergência', 'divergências')} entre nota e base` : 'Nota e base conferem'}</span>
      </div>`
    : '<div class="news-note"><span>Sem nota técnica cadastrada para esta competência: as mudanças vêm só da comparação entre as bases.</span></div>';
  const counts = {
    alterados: r.alterados, novos: r.novos, revogados: r.revogados,
    compatibilidades: `+${fmt(r.compat_incluidas)} / −${fmt(r.compat_removidas)}`,
    conferencia: d.conferencia ? (divergences ? fmt(divergences) : 'ok') : '—',
  };
  $('#news-tabs').innerHTML = NEWS_TABS.map(([id, label]) => `<button type="button" role="tab" class="news-tab" data-news-tab="${id}" aria-selected="${id === newsState.tab}">
      <span>${label}</span><span class="count">${typeof counts[id] === 'number' ? fmt(counts[id]) : counts[id]}</span></button>`).join('');
  renderNewsTable();
}

function portariaCell(list, extra = '') {
  const items = (Array.isArray(list) ? list : [list]).filter(Boolean);
  return items.length
    ? items.map((p) => `<span class="portaria">${esc(p)}</span>`).join('') + extra
    : '<span class="empty" title="A nota técnica não lista esta mudança">Sem item na nota</span>';
}

const newsProcCell = (code, name, exists = true) =>
  `<td class="mono col-code">${exists ? procLink(code) : esc(maskProcedure(code))}</td><td>${esc(display(name))}</td>`;

/** One changed field as readable text: "Serviço Ambulatorial (SA): 10,00 → 12,00". */
function changeValue(kind, v) {
  const lk = newsState.lk;
  if (v == null || v === '') return '—';
  switch (kind) {
    case 'money': return moneyFormat.format(v);
    case 'complexidade': return lk.complexidade[v] || v;
    case 'financiamento': return lk.financiamento[v] ? `${v} - ${lk.financiamento[v]}` : v;
    case 'sexo': return lk.sexo[v] || v;
    case 'idade': return v === 9999 ? 'Não se aplica' : formatAge(v);
    case 'quantidade': return v === 9999 ? 'Sem limite (9999)' : fmt(v);
    case 'dias': return plural(v, 'dia', 'dias');
    case 'int': return fmt(v);
    case 'rubrica': return lk.rubrica[v] ? `${v} - ${lk.rubrica[v]}` : v;
    default: return display(v);
  }
}

function tabItemText(tab, item) {
  const lk = newsState.lk;
  switch (tab) {
    case 'leito': return `${item} - ${lk.tipo_leito[item] || ''}`;
    case 'renases': return `${item} - ${lk.renases[item] || ''}`;
    case 'redes': return `${item} - ${(lk.componente_rede[item] || [''])[0]}`;
    case 'incremento': return `${maskHabilitacao(item[0])} - ${lk.habilitacao[item[0]] || ''} (SH ${item[1]}%, SA ${item[2]}%, SP ${item[3]}%)`;
    case 'origem_sia_sih': return `${lk.tipo_sia_sih[item[0]] || item[0]} ${item[1]} - ${item[2]}`;
    case 'grupo_habilitacao': return `Grupo ${item[0]}: ${item[1].map(maskHabilitacao).join(', ')}`;
    default: return Array.isArray(item) ? item.join(' - ') : String(item);
  }
}

function changeLines(m) {
  if (m.tipo === 'descricao') {
    return `<li><strong>${esc(m.campo)}</strong> alterada
      <details class="news-desc"><summary>ver antes e depois</summary>
        <p><b>Antes:</b> ${esc(display(cleanDescription(m.antes || '')) || '—')}</p>
        <p><b>Depois:</b> ${esc(display(cleanDescription(m.depois || '')) || '—')}</p></details></li>`;
  }
  if (m.tipo === 'lista' || m.tipo === 'tab') {
    const text = (item) => (m.tipo === 'lista'
      ? `${m.relacao === 'HABILITACAO' ? maskHabilitacao(item[0]) : item[0]} - ${display(item[1] || '')}${m.relacao === 'CID' && item[2] ? ` (${item[2] === 'CID principal' ? 'principal' : 'secundário'})` : ''}`
      : tabItemText(m.tab, item));
    return `<li><strong>${esc(m.campo)}</strong><ul class="news-diff">
      ${m.incluidos.map((i) => `<li class="add"><span aria-label="incluído">+</span> ${esc(text(i))}</li>`).join('')}
      ${m.removidos.map((i) => `<li class="del"><span aria-label="removido">−</span> ${esc(text(i))}</li>`).join('')}</ul></li>`;
  }
  return `<li><strong>${esc(m.campo)}:</strong> <span class="before">${esc(changeValue(m.tipo, m.antes))}</span> → <span class="after">${esc(changeValue(m.tipo, m.depois))}</span></li>`;
}

/** Rows of the active tab: { html, csv: [...], search } */
function newsRows() {
  const d = newsState.data;
  const lk = newsState.lk;
  switch (newsState.tab) {
    case 'novos':
      return {
        head: ['Código', 'Procedimento', 'Portaria'],
        rows: d.novos.map((n) => ({ html: `${newsProcCell(n.codigo, n.nome)}<td>${portariaCell(n.portarias)}</td>`, csv: [maskProcedure(n.codigo), display(n.nome), n.portarias.join('; ')] })),
      };
    case 'revogados':
      return {
        head: ['Código', 'Procedimento', 'Portaria'],
        rows: d.revogados.map((n) => ({ html: `${newsProcCell(n.codigo, n.nome, false)}<td>${portariaCell(n.portarias)}</td>`, csv: [maskProcedure(n.codigo), display(n.nome), n.portarias.join('; ')] })),
      };
    case 'alterados':
      return {
        head: ['Código', 'Procedimento', 'O que mudou', 'Portaria'],
        rows: d.alterados.map((a) => ({
          html: `${newsProcCell(a.codigo, a.nome)}<td><ul class="news-changes">${a.mudancas.map(changeLines).join('')}</ul></td><td>${portariaCell(a.portarias)}</td>`,
          csv: [maskProcedure(a.codigo), display(a.nome), a.mudancas.map((m) => m.campo).join('; '), a.portarias.join('; ')],
        })),
      };
    case 'compatibilidades':
      return {
        head: ['Situação', 'Principal', 'Compatível', 'Registro', 'Tipo', 'Qtd.', 'Portaria'],
        rows: d.compatibilidades.map((c) => {
          const [p, o, regP, regC, tipo, qt] = c.par;
          const cell = (code) => `${state.nameByCode.has(code) ? procLink(code) : esc(maskProcedure(code))}<span class="sub-line">${esc(display(state.nameByCode.get(code) || nameFromNews(code)))}</span>`;
          const extra = c.decorrente_de ? `<span class="sub-line">decorrente da revogação de ${esc(maskProcedure(c.decorrente_de))}</span>` : '';
          return {
            html: `<td><span class="badge ${c.situacao === 'incluida' ? 'badge-ok' : 'badge-excl'}">${c.situacao === 'incluida' ? 'Incluída' : 'Removida'}</span></td>
              <td>${cell(p)}</td><td>${cell(o)}</td><td>${esc(registroLabel(lk, regP))} → ${esc(registroLabel(lk, regC))}</td>
              <td>${compatBadge(tipo, lk)}</td><td class="num">${qt == null ? '—' : fmt(qt)}</td><td>${portariaCell(c.portaria, extra)}</td>`,
            csv: [c.situacao === 'incluida' ? 'Incluída' : 'Removida', maskProcedure(p), maskProcedure(o), `${registroLabel(lk, regP)} -> ${registroLabel(lk, regC)}`,
              lk.tipo_compatibilidade[String(tipo)] || `Tipo ${tipo}`, qt ?? '', c.portaria || ''],
          };
        }),
      };
    default: {
      const conf = d.conferencia || [];
      return {
        head: ['Item', 'Só na base', 'Só na nota', 'Observação'],
        rows: conf.map((c) => ({
          html: `<td><strong>${esc(c.item)}</strong></td>
            <td>${c.so_na_base.length ? esc(c.so_na_base.join(', ')) : '<span class="news-check ok">nenhum</span>'}</td>
            <td>${c.so_na_nota.length ? esc(c.so_na_nota.join(', ')) : '<span class="news-check ok">nenhum</span>'}</td>
            <td>${esc(c.observacao || '')}</td>`,
          csv: [c.item, c.so_na_base.join(' '), c.so_na_nota.join(' '), c.observacao || ''],
        })),
      };
    }
  }
}

function nameFromNews(code) {
  return newsState.data.revogados.find((r) => r.codigo === code)?.nome || '';
}

function renderNewsTable() {
  $$('[data-news-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.newsTab === newsState.tab)));
  const { head, rows } = newsRows();
  const q = terms(norm($('#news-filter').value.trim()));
  const visible = rows.filter((r) => !q.length || q.every((t) => norm(r.csv.join(' ')).includes(t)));
  $('#news-count').textContent = `${fmt(visible.length)} de ${fmt(rows.length)} ${rows.length === 1 ? 'item' : 'itens'}`;
  $('#news-table').innerHTML = visible.length
    ? `<div class="table-wrap"><table class="data-table report-data news-data"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${visible.map((r, i) => `<tr${i % 2 ? ' class="alt"' : ''}>${r.html}</tr>`).join('')}</tbody></table></div>`
    : '<p class="empty-note">Nada nesta lista com esse filtro.</p>';
}

async function downloadNewsCSV() {
  const { head, rows } = newsRows();
  const cell = (v) => { const t = String(v ?? ''); return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const lines = [head.map(cell).join(';'), ...rows.map((r) => r.csv.map(cell).join(';'))];
  await saveFile(`sigtap-novidades-${newsState.comp}-${newsState.tab}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

async function setupNews() {
  $('#news-button').onclick = () => openNews(null);
  $('#news-back').onclick = closeReports;
  $('#news-select').onchange = () => openNews($('#news-select').value);
  $('#news-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-news-tab]');
    if (!tab) return;
    newsState.tab = tab.dataset.newsTab;
    renderNewsTable();
  });
  let timer;
  $('#news-filter').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(renderNewsTable, 200); });
  $('#news-csv').onclick = downloadNewsCSV;
  $('#news-table').addEventListener('click', (event) => {
    const link = event.target.closest('[data-proc]');
    if (!link) return;
    event.preventDefault();
    closeReports();
    openLinkedProcedure(link.dataset.proc);
  });
  try {
    const index = await loadNewsIndex();
    if (index[0]) $('#news-meta').textContent = compLabel(index[0].competencia);
  } catch {
    $('#news-button').hidden = true;   // no novidades published yet
  }
}

async function init() {
  replaceIconPlaceholders();
  applyReadingSettings();
  setupReadingControls();
  setupInfoButton();
  trackWorkspaceTop();
  setupDetailEvents();
  try {
    [state.db, state.relationIndex] = await Promise.all([fetchJSON('./data/index.json'), fetchJSON('./data/relations-index.json')]);
  } catch (error) {
    showStartupError(error);
    return;
  }
  state.all = state.db.procedures.map(([code, name]) => [code, name, norm(name)]);
  state.nameByCode = new Map(state.db.procedures);

  const { hierarchy } = state.db;
  $('#edition').textContent = competenciaLabel();
  const subgroupTotal = Object.values(hierarchy.subgroups).flat().length;
  $('#base-count').textContent = String(hierarchy.groups.length);
  $('#base-count').title = `${hierarchy.groups.length} grupos, ${subgroupTotal} sub-grupos`;
  fillOptions($('#group'), hierarchy.groups, 'Todos os grupos');
  renderSidebar();
  setupSidebarSections();
  setupReports();
  setupNews();
  setupControls();
  setupSourceDialog();
  setupRelationBrowser();
  restoreFromURL();
}

init();
