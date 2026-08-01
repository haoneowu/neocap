import type {
	CaptionSegment,
	SegmentRecordings,
	TimelineSegment,
} from "~/utils/tauri";
import {
	type CaptionExportCue,
	captionExportDefaultPath,
	formatCaptionCuesAsSrt,
	formatCaptionCuesAsVtt,
	normalizeCaptionExportCues,
} from "./caption-export-core";
import { getCaptionTextFromWords } from "./caption-text";
import { mapCaptionsToEditedTimeline } from "./captions";

export {
	type CaptionExportCue,
	type CaptionExportFormat,
	captionExportDefaultPath,
	formatCaptionCues,
	formatCaptionCuesAsSrt,
	formatCaptionCuesAsVtt,
	normalizeCaptionExportCues,
} from "./caption-export-core";

const DOUBLE_QUOTE = String.fromCharCode(34);

function millisecondsFromSeconds(seconds: number) {
	return Math.max(0, Math.round(seconds * 1000));
}

function textFromCaptionSegment(segment: CaptionSegment) {
	const words = segment.words ?? [];
	if (words.length > 0) return getCaptionTextFromWords(words);
	return segment.text;
}

function cueRangeFromCaptionSegment(segment: CaptionSegment) {
	const words = segment.words ?? [];
	const firstWord = words[0];
	const lastWord = words[words.length - 1];
	return {
		start: firstWord?.start ?? segment.start,
		end: lastWord?.end ?? segment.end,
	};
}

function normalizeCueText(text: string) {
	return text
		.replace(/\r\n?/g, "\n")
		.split("")
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code === 10 || (code >= 32 && code !== 127);
		})
		.join("")
		.split("\n")
		.map((line) => line.trim().replace(/\s+/g, " "))
		.filter((line) => line.length > 0)
		.join("\n")
		.trim();
}

function cueFromCaptionSegment(
	segment: CaptionSegment,
): CaptionExportCue | null {
	const text = normalizeCueText(textFromCaptionSegment(segment));
	const { start, end } = cueRangeFromCaptionSegment(segment);

	if (
		text.length === 0 ||
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		end <= start
	) {
		return null;
	}

	const startMs = millisecondsFromSeconds(start);
	const roundedEndMs = millisecondsFromSeconds(end);
	const endMs = roundedEndMs <= startMs ? startMs + 1 : roundedEndMs;

	return { startMs, endMs, text };
}

export function createCaptionExportCues(
	segments: CaptionSegment[],
	timelineSegments: TimelineSegment[],
	recordingSegments: SegmentRecordings[],
): CaptionExportCue[] {
	return normalizeCaptionExportCues(
		mapCaptionsToEditedTimeline(segments, timelineSegments, recordingSegments)
			.map(cueFromCaptionSegment)
			.filter((cue): cue is CaptionExportCue => cue !== null),
	);
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest;

	describe("caption exports", () => {
		const recordings = [{ display: { duration: 8 } } as SegmentRecordings];

		it("formats projected edited timeline cues as SRT", () => {
			const cues = createCaptionExportCues(
				[
					{
						id: "caption",
						start: 1,
						end: 5,
						text: "hello world",
						words: [
							{ text: "hello", start: 1.1114, end: 1.4446 },
							{ text: "world", start: 4.2, end: 4.6 },
						],
					},
				],
				[
					{ start: 1, end: 2, timescale: 1, recordingSegment: 0 },
					{ start: 4, end: 6, timescale: 1, recordingSegment: 0 },
				],
				recordings,
			);

			expect(formatCaptionCuesAsSrt(cues)).toBe(
				"1\n00:00:00,111 --> 00:00:00,445\nhello\n\n2\n00:00:01,200 --> 00:00:01,600\nworld\n",
			);
		});

		it("formats VTT with escaped cue text", () => {
			expect(
				formatCaptionCuesAsVtt([
					{
						startMs: 0,
						endMs: 1250,
						text: "Cap <Rend> & fast --> captions",
					},
				]),
			).toBe(
				"WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.250\nCap &lt;Rend&gt; &amp; fast --&gt; captions\n",
			);
		});

		it("cleans invalid filenames and falls back when empty", () => {
			expect(
				captionExportDefaultPath(["bad/name:", DOUBLE_QUOTE].join(""), "srt"),
			).toBe("bad-name--.srt");
			expect(captionExportDefaultPath("...", "vtt")).toBe("captions.vtt");
		});

		it("skips empty and invalid cues", () => {
			const cues = createCaptionExportCues(
				[
					{
						id: "empty",
						start: 0,
						end: 1,
						text: " ",
						words: [],
					},
					{
						id: "backwards",
						start: 2,
						end: 1,
						text: "backwards",
						words: [],
					},
					{
						id: "valid",
						start: 1,
						end: 1.0001,
						text: "valid",
						words: [],
					},
				],
				[{ start: 0, end: 8, timescale: 1, recordingSegment: 0 }],
				recordings,
			);

			expect(cues).toEqual([{ startMs: 1000, endMs: 1001, text: "valid" }]);
		});
	});
}
