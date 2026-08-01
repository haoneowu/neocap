import { describe, expect, it } from "vitest";
import {
	normalizeCaptionWordTimings,
	syncCaptionWordsWithText,
	updateCaptionWordTiming,
} from "./caption-word-editing";

describe("syncCaptionWordsWithText", () => {
	it("preserves Chinese word-level timing when a no-space caption is edited", () => {
		const words = syncCaptionWordsWithText("你好，世界", undefined, 2, 4);

		expect(words).toEqual([
			{ text: "你", start: 2, end: 2.5 },
			{ text: "好，", start: 2.5, end: 3 },
			{ text: "世", start: 3, end: 3.5 },
			{ text: "界", start: 3.5, end: 4 },
		]);
	});

	it("re-times all words after an edit changes the word count", () => {
		const words = syncCaptionWordsWithText(
			"我想去 Apple Store",
			[
				{ text: "我", start: 10, end: 10.6 },
				{ text: "想", start: 10.6, end: 11.2 },
			],
			10,
			12,
		);

		expect(words.map((word) => word.text)).toEqual([
			"我",
			"想",
			"去",
			"Apple",
			"Store",
		]);
		expect(words[0]?.start).toBe(10);
		expect(words.at(-1)?.end).toBe(12);
		for (let index = 1; index < words.length; index++) {
			expect(words[index - 1]?.end).toBeLessThanOrEqual(
				words[index]?.start ?? Number.POSITIVE_INFINITY,
			);
		}
	});

	it("keeps direct timing edits inside phrase bounds and away from neighbours", () => {
		const words = [
			{ text: "我", start: 10, end: 10.5 },
			{ text: "们", start: 10.5, end: 11 },
			{ text: "走", start: 11, end: 11.5 },
		];

		const startEdited = updateCaptionWordTiming(words, 1, { start: 8 }, 10, 12);
		expect(startEdited[1]?.start).toBe(10.5);

		const endEdited = updateCaptionWordTiming(
			startEdited,
			1,
			{ end: 99 },
			10,
			12,
		);
		expect(endEdited[1]?.end).toBe(11);
		expect(endEdited[0]?.end).toBeLessThanOrEqual(endEdited[1]?.start ?? 0);
		expect(endEdited[1]?.end).toBeLessThanOrEqual(endEdited[2]?.start ?? 0);
	});

	it("normalizes malformed imported timings before they are persisted", () => {
		const words = normalizeCaptionWordTimings(
			[
				{ text: "一", start: 8, end: 11 },
				{ text: "二", start: 9, end: 9.1 },
			],
			10,
			12,
		);

		expect(words[0]?.start).toBeGreaterThanOrEqual(10);
		expect(words.at(-1)?.end).toBeLessThanOrEqual(12);
		for (let index = 0; index < words.length; index++) {
			expect(words[index]?.end).toBeGreaterThan(words[index]?.start ?? 0);
			if (index > 0) {
				expect(words[index - 1]?.end).toBeLessThanOrEqual(
					words[index]?.start ?? 0,
				);
			}
		}
	});
});
