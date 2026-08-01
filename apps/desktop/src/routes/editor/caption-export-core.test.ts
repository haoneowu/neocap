import { describe, expect, it } from "vitest";

import {
	formatCaptionCuesAsSrt,
	normalizeCaptionExportCues,
} from "./caption-export-core";

describe("caption export core", () => {
	it("shortens the preceding cue to avoid a rounded timing overlap", () => {
		const cues = normalizeCaptionExportCues([
			{ startMs: 0, endMs: 1000, text: "first" },
			{ startMs: 800, endMs: 1400, text: "second" },
		]);

		expect(cues).toEqual([
			{ startMs: 0, endMs: 800, text: "first" },
			{ startMs: 800, endMs: 1400, text: "second" },
		]);
	});

	it("shifts an exact-start collision without emitting a zero-duration cue", () => {
		const cues = normalizeCaptionExportCues([
			{ startMs: 0, endMs: 1000, text: "first" },
			{ startMs: 0, endMs: 500, text: "second" },
		]);

		expect(cues).toEqual([
			{ startMs: 0, endMs: 1, text: "second" },
			{ startMs: 1, endMs: 1000, text: "first" },
		]);
	});

	it("formats non-overlapping SRT cues", () => {
		expect(
			formatCaptionCuesAsSrt([
				{ startMs: 0, endMs: 1000, text: "first" },
				{ startMs: 800, endMs: 1400, text: "second" },
			]),
		).toBe(
			"1\n00:00:00,000 --> 00:00:00,800\nfirst\n\n2\n00:00:00,800 --> 00:00:01,400\nsecond\n",
		);
	});
});
