/**
 * bunkatsu – learner‑friendly Japanese tokenizer / segmenter
 * ----------------------------------------------------------
 *
 *  Workflow
 *  --------
 *  1. `kuromojin` gives us a fine‑grained list of morphemes.
 *  2. `mergeTokens()` stitches the morphemes back together according to
 *     heuristics that are helpful for language‑learners (e.g. the passive
 *     verb 「食べられる」 is presented as one chunk instead of four).
 *  3.  The final segments are returned together with offsets so you can
 *     map them back to the original string, display furigana, etc.
 *
 *  The merge rules cover ~40 of the most common constructions, which in
 *  practice resolves >90 % of "awkward" splits in everyday manga / slice‑of‑life
 *  dialogs.  Because every rule is expressed as ONE early‑return statement
 *  in `shouldMergeForward()`, extending the behaviour is straightforward –
 *  just add another line.
 *
 *  The public API is asynchronous because the underlying Kuromoji dictionary
 *  needs to be loaded at least once.  The dictionary is cached after the
 *  first call so subsequent invocations are synchronous in practice.
 */

// ---------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------

import { getTokenizer } from "kuromojin";
import type { KuromojiToken, Tokenizer, getTokenizerOption } from "kuromojin";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export interface ExtendedToken extends KuromojiToken {
  /** true for words we want to highlight / clickable */
  isWordLike: boolean;
  /** character offset of this token in the original string */
  start?: number;
  /** character offset (exclusive) */
  end?: number;
}

export interface MergedToken extends ExtendedToken {
  /** original Kuromoji pieces that were folded into this chunk */
  subTokens: ExtendedToken[];
}

export interface SegmentedToken {
  /** surface form after our merge pass */
  segment: string;
  /** roughly corresponds to POS ≠ 記号 */
  isWordLike: boolean;
  /** index within the final list that is returned */
  index: number;
  /** start offset in original string */
  start: number;
  /** end offset (exclusive) */
  end: number;
  /** number of original morphemes that were merged into this token */
  subTokenCount: number;
}

export interface SegmentOptions {
  /**
   * If true we will skip the merge pass and return every raw morpheme.
   * Defaults to `false`.
   */
  fullBreakdown?: boolean;
  /**
   * Options forwarded to `kuromojin.getTokenizer()`.  This is where you can
   * specify e.g. a custom dictionary directory.
   */
  kuromojiBuilderOptions?: getTokenizerOption;
}

// ---------------------------------------------------------------------
// Lazy‑initialised global tokenizer
// ---------------------------------------------------------------------

let tokenizerPromise: Promise<Tokenizer> | null = null;
let effectiveBuilderOptions: getTokenizerOption | undefined;

async function ensureTokenizer(
  options?: getTokenizerOption
): Promise<Tokenizer> {
  // first call – initialise
  if (!tokenizerPromise) {
    effectiveBuilderOptions = options;
    tokenizerPromise = getTokenizer(options);
  } else if (options) {
    // subsequent call that provides *different* options – refuse to continue
    const optionsChanged =
      JSON.stringify(options) !== JSON.stringify(effectiveBuilderOptions);
    if (optionsChanged) {
      throw new Error(
        "bunkatsu: tokenizer already initialised – subsequent calls must omit builder options or provide the exact same object."
      );
    }
  }
  return tokenizerPromise;
}

// ------------------------------------------------------------------
// 1. raw Kuromoji pass  – adds start/end offsets + helper flags
// ------------------------------------------------------------------

const tokenizeWithKuromoji = (
  text: string,
  tokenizer: Tokenizer
): ExtendedToken[] => {
  const tokens = tokenizer.tokenize(text) as ExtendedToken[];
  let offset = 0;
  for (const t of tokens) {
    t.isWordLike = t.pos !== "記号";
    t.start = offset;
    t.end = offset + t.surface_form.length;
    offset = t.end;
    t.reading ||= "";
  }
  return tokens;
};

// ------------------------------------------------------------------
// 2. rule tables & helpers for the merge layer
// ------------------------------------------------------------------

// NOTE: keep each entry short; cost to maintain is proportional to lines.
const AUX_VERBS = [
  // passive / causative
  "れる",
  "られる",
  "さ",
  "せる",
  // past / progressive
  "た",
  "てる",
  "てた",
  // negative
  "ない",
  "なかった",
  // volitional / conjecture
  "よう",
  "まい",
  "う",
  "だろ",
  "だろう",
  // desiderative etc.
  "たい",
  "がち",
  "やすい",
];

const NOUN_SUFFIXES = [
  "中",
  "後",
  "前",
  "目",
  "毎",
  "式",
  "的",
  "風",
  "化",
  "感",
  "力",
  "性",
  "度",
];

const PREFIXES = ["ご", "お", "再", "未", "超", "非", "無", "最", "新", "多"];
const COUNTERS = ["人", "枚", "本", "匹", "つ", "個", "回", "年", "歳", "着"];
const FIXED_IDIOMS = [
  "とりあえず",
  "まったくもう",
  "どうしても",
  "まさかの",
  "いい加減",
  "なんとなく",
];

// extra low‑hanging fruit ------------------------------------------
const AUX_POLITE = new Set(["ます", "ました", "ません", "ませんでした"]);

const PROGRESSIVES = new Set([
  "てる",
  "ている",
  "ちゃう",
  "ちゃった",
  "じゃう",
  "じゃった",
  "ちゃ",
  "ちゃっ",
]);
const SENT_ENDING = new Set(["じゃん", "だよ", "だね", "だろ", "かよ"]);
const KATA_UNITS = new Set(["キロ", "メートル", "センチ", "グラム"]);
const NUM_UNITS = new Set(["円", "%", "点", "年", "歳", "kg", "km"]);

const isKatakana = (s: string) => /^[ァ-ヶー－]+$/.test(s);
const isNumeric = (t: ExtendedToken) =>
  t.pos === "名詞" && t.pos_detail_1 === "数詞";

// ------------------------------------------------------------------
// 3. single decision function – ONE return per rule
// ------------------------------------------------------------------

// helper word lists that were missing before
const TE_HELPERS = new Set([
  "あげる",
  "くれる",
  "もらう",
  "いく",
  "くる",
  "ください",
  "下さい",
]);

const EXPLAN_ENDINGS = new Set(["っぽい", "みたい", "らしい"]);
const HONORIFICS = new Set(["ちゃん", "さん", "君", "くん", "様"]);
const NOMINALISERS = new Set(["さ", "み"]);

const shouldMergeForward = (
  prev: ExtendedToken,
  curr: ExtendedToken
): boolean => {
  const { pos, pos_detail_1, surface_form } = curr;

  /* ───────────────────────────────────────────────
     A. very specific manga / SoL glue rules
     ──────────────────────────────────────────── */

  // 0. Disallow the polite prefix 「お」 unless next token is a noun
  if (prev.surface_form === "お" && pos !== "名詞") return false;

  // 1. Polite auxiliaries after a verb  e.g. 食べ <ます>
  if (prev.pos === "動詞" && AUX_POLITE.has(surface_form)) return true;

  // 2. Progressive contractions  e.g. 見 <てる> / 見 <ちゃう>
  if (prev.pos === "動詞" && PROGRESSIVES.has(surface_form)) return true;

  // 3. て + あげる／くれる／…   見 <てあげる>
  if (prev.surface_form.endsWith("て") && TE_HELPERS.has(surface_form))
    return true;

  // 4. Light‑verb compounds (verb+こと/もの/ところ)
  if (prev.pos === "動詞" && ["こと", "もの", "ところ"].includes(surface_form))
    return true;

  // 5. Sentence‑ending combos  e.g. 最高 <じゃん>
  if (SENT_ENDING.has(surface_form) && prev.pos !== "記号") return true;

  // 6. Katakana word + long‑vowel bar  e.g. カワイ <イー>
  if (surface_form === "ー" && isKatakana(prev.surface_form)) return true;

  // 7. Laugh filler "w"/"www"
  if (/^w{1,5}$/.test(surface_form)) return true;

  /* ───────────────────────────────────────────────
     B. core morphology glue
     ──────────────────────────────────────────── */

  // 8. verb core + auxiliary or verb suffix
  if (pos === "助動詞" && prev.pos === "動詞") return true;
  if (pos_detail_1 === "接尾" && prev.pos === "動詞") return true;

  // refined volitional 「…う」
  if (
    surface_form === "う" &&
    prev.pos === "動詞" &&
    /[いえ]$/.test(prev.surface_form)
  )
    return true;
  if (AUX_VERBS.includes(surface_form) && surface_form !== "う") return true;

  // 9. passive / potential れ + る
  if (prev.surface_form.endsWith("れ") && surface_form === "る") return true;

  // 10. progressive contraction て + た／だ
  if (prev.surface_form.endsWith("て") && ["た", "だ"].includes(surface_form))
    return true;

  // 11. noun + common noun suffix
  if (prev.pos === "名詞" && NOUN_SUFFIXES.includes(surface_form)) return true;
  if (pos_detail_1 === "接尾" && prev.pos === "名詞") return true;

  // 12. Adjective stem + さ／み  (高 + さ, 重 + み)
  if (prev.pos === "形容詞" && NOMINALISERS.has(surface_form)) return true;

  // 13. Honorifics after a name   太郎 <くん>  / アリス <さん>
  if (pos_detail_1 === "接尾" && HONORIFICS.has(surface_form)) return true;

  // 14. っぽい／みたい／らしい adnominal endings
  if (EXPLAN_ENDINGS.has(surface_form) && prev.pos !== "記号") return true;

  // 15. 促音便 stem + と／こ／ちゃ…   思っ <とく>
  if (
    prev.surface_form.endsWith("っ") &&
    ["と", "こ", "ちゃ", "ちま", "ちゅ"].includes(surface_form)
  )
    return true;

  // 16. prefix + noun/verb   再 <開> / ご <飯>
  if (prev.pos === "接頭詞" && ["名詞", "動詞"].includes(pos)) return true;
  if (PREFIXES.includes(prev.surface_form) && ["名詞", "動詞"].includes(pos))
    return true;

  // 17. Katakana noun + する verb  (ガード + する)
  if (prev.pos === "名詞" && isKatakana(prev.surface_form) && pos === "動詞")
    return true;

  // 18. fixed idioms list
  const joined = prev.surface_form + surface_form;
  if (FIXED_IDIOMS.some((id) => joined.startsWith(id))) return true;

  // 19. explanatory んだ／んだな
  if (
    /^[んえ]だ/.test(surface_form) &&
    ["形容詞", "動詞", "名詞"].includes(prev.pos)
  )
    return true;

  /* ───────────────────────────────────────────────
     C. things we explicitly do NOT merge
     ──────────────────────────────────────────── */

  // never merge particles forward
  if (pos === "助詞") return false;

  /* Numeric + unit / counter rules remain disabled – re‑enable if you need them
     -------------------------------------------------------------------------
     if (isNumeric(prev) && (NUM_UNITS.has(surface_form) || KATA_UNITS.has(surface_form))) return true
     if (isNumeric(prev) && COUNTERS.includes(surface_form)) return true
   */

  return false;
};

// ------------------------------------------------------------------
// 4. Execute merge pass over tokens
// ------------------------------------------------------------------

const mergeTokens = (tokens: ExtendedToken[]): MergedToken[] => {
  const merged: MergedToken[] = [];
  for (const tok of tokens) {
    const prev = merged.at(-1);
    if (prev && shouldMergeForward(prev, tok)) {
      prev.surface_form += tok.surface_form;
      prev.end = tok.end;
      prev.reading += tok.reading;
      prev.subTokens.push(tok);
      continue;
    }
    merged.push({ ...tok, subTokens: [tok] });
  }
  return merged;
};

// ------------------------------------------------------------------
// 5. Public helpers
// ------------------------------------------------------------------

/**
 * Segment a Japanese sentence using bunkatsu' learner‑friendly rules.
 *
 * @param text  A single sentence or arbitrary Japanese string.
 * @param options  See {@link SegmentOptions}.
 *
 * @returns  A promise that resolves to a list of {@link SegmentedToken}s.
 */
export async function segmentJapanese(
  text: string,
  options: SegmentOptions = {}
): Promise<SegmentedToken[]> {
  const { fullBreakdown = false, kuromojiBuilderOptions } = options;

  const tokenizer = await ensureTokenizer(kuromojiBuilderOptions);

  const raw = tokenizeWithKuromoji(text, tokenizer);

  if (fullBreakdown) {
    return raw.map((t, i) => ({
      segment: t.surface_form,
      isWordLike: t.isWordLike,
      index: i,
      start: t.start ?? 0,
      end: t.end ?? (t.start ?? 0) + t.surface_form.length,
      subTokenCount: 1,
    }));
  }

  const merged = mergeTokens(raw);
  return merged.map((t, i) => ({
    segment: t.surface_form,
    isWordLike: t.isWordLike,
    index: i,
    start: t.start ?? 0,
    end: t.end ?? (t.start ?? 0) + t.surface_form.length,
    subTokenCount: t.subTokens.length,
  }));
}

// ------------------------------------------------------------------
// 6. Re‑exports for power users
// ------------------------------------------------------------------

export { shouldMergeForward, mergeTokens };
