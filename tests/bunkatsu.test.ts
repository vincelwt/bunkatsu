import { test, expect } from "bun:test";
import { segmentJapanese } from "../index.ts";

test("merges verb + た past tense", async () => {
  const result = await segmentJapanese("食べた。");
  expect(result.map((r) => r.segment)).toEqual(["食べた", "。"]);
});

test("handles colloquial passive/progressive contraction", async () => {
  const result = await segmentJapanese("食べられちゃったんだよ！");
  expect(result.map((r) => r.segment)).toEqual([
    "食べられちゃった",
    "ん",
    "だ",
    "よ",
    "！",
  ]);
});

test("fullBreakdown returns raw morphemes", async () => {
  const merged = await segmentJapanese("食べた。");
  const raw = await segmentJapanese("食べた。", { fullBreakdown: true });
  expect(raw.length).toBeGreaterThan(merged.length);
});
