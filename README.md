<div align="center">

<p align="center">
  <img src="https://github.com/user-attachments/assets/477b9c77-7c8f-43b4-816e-6f3d3cc2cfc5" alt="Abso banner" width=600 />
</p>

</div>

`bunkatsu` (“division; segmentation” in Japanese) turns raw Japanese text
into **human‑sized word chunks**.

It builds on top of
[kuromojin](https://github.com/ikatyang/kuromojin)—which exposes the
great [Kuromoji](https://www.atilika.org/) tokenizer—and then
glues many of the overly fine‑grained splits to make it easier for language learners.

It is currently used by [Lexirise][https://lexirise.app] to segment text parsed from comics.

## Why not use Kuromoji directly?

- Kuromoji treats every grammatical morpheme as its own token. The passive
  verb 「**食べられ**る」 becomes four pieces `(食べ)(ら)(れ)(る)`, which makes it hard
  to look up in a dictionary.
- Common colloquial contractions such as 「ちゃった」 or sentence endings like
  「じゃん」 are also broken apart.

`bunkatsu` patches these cases (currently ~40 heuristic rules) so you get one
token **per semantically useful unit**, while still exposing the raw sub‑tokens
for features such as furigana or fine‑grained grammar pop‑ups.

## Installation

```bash
npm i bunkatsu  # or pnpm / yarn / bun add
```

## Usage

```ts
import { segmentJapanese } from "bunkatsu";

const segments = await segmentJapanese("食べられちゃったんだよ！");
console.log(segments.map((s) => s.segment));
// → [ '食べられちゃった', 'ん', 'だよ', '！' ]
```

## API

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
  segment: string; // final surface form (after merging)
  isWordLike: boolean; // true ≅ POS ≠ 記号
  index: number; // position in the returned array
  start: number; // start offset in the original string
  end: number; // end offset (exclusive)
  subTokenCount: number; // how many Kuromoji morphemes were merged
}
```

## Advanced usage

- The low‑level helpers `mergeTokens()` and `shouldMergeForward()` are
  re‑exported so you can craft your own segmentation strategy.
- A cached Kuromoji tokenizer is created lazily on the first call. If you
  need a custom dictionary, just pass `kuromojiBuilderOptions` **once** (e.g.
  `{ dicPath: "/path/to/ipadic" }`). Subsequent calls must omit the option or
  provide the exact same one.

## Contributing

Contributions are welcome

## Licence

MIT

## Credits

Made by [Vince](https://x.com/cldstart)
