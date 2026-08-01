import type { CaptionSegment, CaptionWord } from "~/utils/tauri";
import { getCaptionTextFromWords } from "./caption-text";

const SHORT_FORM_PAUSE_SECONDS = 0.18;
const SHORT_FORM_MAX_HAN_CHARACTERS = 8;
const SHORT_FORM_MIN_HAN_CHARACTERS = 4;
const SHORT_FORM_MAX_LATIN_WORDS = 4;
const SHORT_FORM_MIN_LATIN_WORDS = 2;
const SHORT_FORM_BOUNDARY_PUNCTUATION = /[。！？；!?;.]/u;
const HAN_CHARACTER = /\p{Script=Han}/gu;

function countHanCharacters(text: string) {
	return text.match(HAN_CHARACTER)?.length ?? 0;
}

function isShortFormBoundary(
	word: CaptionWord,
	nextWord: CaptionWord | undefined,
) {
	if (SHORT_FORM_BOUNDARY_PUNCTUATION.test(word.text)) return true;
	return (
		nextWord !== undefined &&
		nextWord.start - word.end >= SHORT_FORM_PAUSE_SECONDS
	);
}

/**
 * Splits word-timed transcription segments into short, display-ready phrases.
 * It deliberately preserves the ASR words and timestamps: the editor can still
 * re-project captions after trim/reorder without another transcription pass.
 */
export function segmentCaptionsForShortForm(
	segments: CaptionSegment[],
): CaptionSegment[] {
	return segments.flatMap((segment) => {
		if (!segment.words || segment.words.length === 0) return [segment];

		const result: CaptionSegment[] = [];
		let phraseWords: CaptionWord[] = [];
		let phraseHanCharacters = 0;
		let phraseHasHan = false;

		const flush = () => {
			if (phraseWords.length === 0) return;
			const first = phraseWords[0];
			const last = phraseWords[phraseWords.length - 1];
			if (!first || !last) return;

			result.push({
				...segment,
				id: `${segment.id}:short:${result.length}`,
				start: first.start,
				end: last.end,
				text: getCaptionTextFromWords(phraseWords),
				words: phraseWords,
			});
			phraseWords = [];
			phraseHanCharacters = 0;
			phraseHasHan = false;
		};

		for (let index = 0; index < segment.words.length; index += 1) {
			const word = segment.words[index];
			if (!word) continue;
			const nextWord = segment.words[index + 1];
			const hanCharacters = countHanCharacters(word.text);
			phraseWords.push(word);
			phraseHanCharacters += hanCharacters;
			phraseHasHan ||= hanCharacters > 0;

			const unitCount = phraseHasHan ? phraseHanCharacters : phraseWords.length;
			const minUnits = phraseHasHan
				? SHORT_FORM_MIN_HAN_CHARACTERS
				: SHORT_FORM_MIN_LATIN_WORDS;
			const maxUnits = phraseHasHan
				? SHORT_FORM_MAX_HAN_CHARACTERS
				: SHORT_FORM_MAX_LATIN_WORDS;

			if (
				unitCount >= maxUnits ||
				(unitCount >= minUnits && isShortFormBoundary(word, nextWord))
			) {
				flush();
			}
		}

		flush();
		return result;
	});
}
