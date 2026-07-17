import type { CaptionWord } from "~/utils/tauri";

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
		return baseWords.map((word, index) => ({
			...word,
			text: tokens[index] ?? word.text,
		}));
	}

	const duration = Math.max(end - start, 0);
	const step = duration / tokens.length;

	return tokens.map((text, index) => ({
		text,
		start: start + step * index,
		end: index === tokens.length - 1 ? end : start + step * (index + 1),
	}));
}
