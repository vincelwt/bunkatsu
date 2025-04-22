# bunkatsu 🗾✂️ – learner‑friendly Japanese tokenizer

`bunkatsu` (“division; segmentation” in Japanese) turns raw Japanese text
into **human‑sized word chunks**.  It builds on top of
[kuromojin](https://github.com/ikatyang/kuromojin)—which exposes the
industrial‑strength [Kuromoji](https://www.atilika.org/) dictionary—but then
repairs many of the overly fine‑grained splits that trip up language
learners.

Why not use Kuromoji directly?
-----------------------------

* Kuromoji treats every grammatical morpheme as its own token.  The passive
  verb 「**食べられ**る」 becomes four pieces `(食べ)(ら)(れ)(る)`, which makes it hard
  to look up in a dictionary.
* Common colloquial contractions such as 「ちゃった」 or sentence endings like
  「じゃん」 are also broken apart.

`bunkatsu` patches these cases (currently ~40 heuristic rules) so you get one
token **per semantically useful unit**, while still exposing the raw sub‑tokens
for features such as furigana or fine‑grained grammar pop‑ups.

Installation
------------

```bash
npm i bunkatsu  # or pnpm / yarn / bun add
```

Usage
-----

```ts
import { segmentJapanese } from "bunkatsu";

(async () => {
  const segments = await segmentJapanese("食べられちゃったんだよ！");
  console.log(segments.map((s) => s.segment));
  // → [ '食べられちゃった', 'ん', 'だよ', '！' ]
})();
```

API
---

```ts
async function segmentJapanese(
  text: string,
  options?: {
    /** Skip the merge pass and return every raw morpheme */
    fullBreakdown?: boolean;

    /** Options forwarded verbatim to kuromojin.getTokenizer() */
    kuromojiBuilderOptions?: import("kuromojin").TokenizerBuilderOptions;
  }
): Promise<SegmentedToken[]>;

interface SegmentedToken {
  segment: string;   // final surface form (after merging)
  isWordLike: boolean; // true ≅ POS ≠ 記号
  index: number;      // position in the returned array
  start: number;      // start offset in the original string
  end: number;        // end offset (exclusive)
  subTokenCount: number; // how many Kuromoji morphemes were merged
}
```

Advanced usage
--------------

* The low‑level helpers `mergeTokens()` and `shouldMergeForward()` are
  re‑exported so you can craft your own segmentation strategy.
* A cached Kuromoji tokenizer is created lazily on the first call.  If you
  need a custom dictionary, just pass `kuromojiBuilderOptions` **once** (e.g.
  `{ dicPath: "/path/to/ipadic" }`).  Subsequent calls must omit the option or
  provide the exact same one.

Contributing
------------

1. Add failing example to the test suite.
2. Append a new early‑return line to `shouldMergeForward()`.
3. Profit.

Licence
-------

MIT
