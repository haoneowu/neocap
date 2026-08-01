import type { CaptionWord } from "~/utils/tauri";

export const MIN_CAPTION_WORD_DURATION_SECONDS = 0.01;

const CJK_CAPTION_CHARACTER = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const CAPTION_ATTACHING_PUNCTUATION = new Set([
	"，",
	"。",
	"！",
	"？",
	"、",
	"；",
	"：",
	"）",
	"」",
	"』",
	"”",
	"’",
	",",
	".",
	"!",
	"?",
	";",
	":",
	")",
	"]",
	"}",
]);

/**
 * Converts a caption field into editable words without requiring spaces in
 * Chinese. CJK glyphs are individual timing units; punctuation stays with the
 * preceding unit so a short-form caption never flashes a bare comma or stop.
 */
export function tokenizeCaptionText(text: string): string[] {
	const tokens: string[] = [];

	for (const run of text.trim().split(/\s+/)) {
		if (!run) continue;

		let latinBuffer = "";
		const flushLatin = () => {
			if (latinBuffer) tokens.push(latinBuffer);
			latinBuffer = "";
		};

		for (const character of Array.from(run)) {
			if (CJK_CAPTION_CHARACTER.test(character)) {
				flushLatin();
				tokens.push(character);
			} else if (CAPTION_ATTACHING_PUNCTUATION.has(character)) {
				flushLatin();
				const previous = tokens.at(-1);
				if (previous) tokens[tokens.length - 1] = `${previous}${character}`;
				else tokens.push(character);
			} else {
				latinBuffer += character;
			}
		}

		flushLatin();
	}

	return tokens;
}

function clamp(value: number, lower: number, upper: number) {
	return Math.min(Math.max(value, lower), upper);
}

function validSegmentDuration(start: number, end: number) {
	return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function normalizeCaptionWordTimings(
	words: CaptionWord[],
	segmentStart: number,
	segmentEnd: number,
): CaptionWord[] {
	if (words.length === 0 || !validSegmentDuration(segmentStart, segmentEnd)) {
		return words.map((word) => ({ ...word }));
	}

	const minimumDuration = Math.min(
		MIN_CAPTION_WORD_DURATION_SECONDS,
		(segmentEnd - segmentStart) / words.length,
	);
	let previousEnd = segmentStart;

	return words.map((word, index) => {
		const wordsRemaining = words.length - index - 1;
		const latestEnd = segmentEnd - minimumDuration * wordsRemaining;
		const latestStart = latestEnd - minimumDuration;
		const requestedStart = Number.isFinite(word.start)
			? word.start
			: previousEnd;
		const start = clamp(requestedStart, previousEnd, latestStart);
		const requestedEnd = Number.isFinite(word.end)
			? word.end
			: start + minimumDuration;
		const end = clamp(requestedEnd, start + minimumDuration, latestEnd);
		previousEnd = end;

		return { ...word, start, end };
	});
}

export type CaptionWordTimingUpdate = Partial<
	Pick<CaptionWord, "start" | "end">
>;

export function updateCaptionWordTiming(
	words: CaptionWord[],
	wordIndex: number,
	update: CaptionWordTimingUpdate,
	segmentStart: number,
	segmentEnd: number,
): CaptionWord[] {
	const normalized = normalizeCaptionWordTimings(
		words,
		segmentStart,
		segmentEnd,
	);
	if (
		wordIndex < 0 ||
		wordIndex >= normalized.length ||
		!validSegmentDuration(segmentStart, segmentEnd)
	) {
		return normalized;
	}

	const minimumDuration = Math.min(
		MIN_CAPTION_WORD_DURATION_SECONDS,
		(segmentEnd - segmentStart) / normalized.length,
	);
	const current = normalized[wordIndex];
	if (!current) return normalized;

	const previousEnd = normalized[wordIndex - 1]?.end ?? segmentStart;
	const nextStart = normalized[wordIndex + 1]?.start ?? segmentEnd;
	let start = current.start;
	let end = current.end;

	if (Number.isFinite(update.start)) {
		start = clamp(update.start as number, previousEnd, end - minimumDuration);
	}
	if (Number.isFinite(update.end)) {
		end = clamp(update.end as number, start + minimumDuration, nextStart);
	}

	return normalized.map((word, index) =>
		index === wordIndex ? { ...word, start, end } : word,
	);
}

export function syncCaptionWordsWithText(
	text: string,
	existingWords: CaptionWord[] | undefined,
	start: number,
	end: number,
): CaptionWord[] {
	const tokens = tokenizeCaptionText(text);

	if (tokens.length === 0) return [];

	const baseWords = existingWords ?? [];
	if (baseWords.length === tokens.length && baseWords.length > 0) {
		return normalizeCaptionWordTimings(
			baseWords.map((word, index) => ({
				...word,
				text: tokens[index] ?? word.text,
			})),
			start,
			end,
		);
	}

	const duration = Math.max(end - start, 0);
	const step = duration / tokens.length;

	return normalizeCaptionWordTimings(
		tokens.map((text, index) => ({
			text,
			start: start + step * index,
			end: index === tokens.length - 1 ? end : start + step * (index + 1),
		})),
		start,
		end,
	);
}
