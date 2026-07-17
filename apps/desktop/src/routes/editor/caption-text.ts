import type { CaptionWord } from "~/utils/tauri";

const CAPTION_ATTACHING_PUNCTUATION = new Set([
	",",
	".",
	"!",
	"?",
	";",
	":",
	"%",
	")",
	"]",
	"}",
	"'",
	"’",
	"、",
	"。",
	"！",
	"？",
	"；",
	"：",
	"，",
]);

function isHanText(text: string) {
	return /\p{Script=Han}/u.test(text);
}

export function getCaptionTextFromWords(words: CaptionWord[]) {
	let text = "";

	for (const word of words) {
		const wordText = word.text.trim();
		if (wordText.length === 0) continue;

		const joinsChineseText = isHanText(text) && isHanText(wordText);
		if (
			text.length > 0 &&
			!CAPTION_ATTACHING_PUNCTUATION.has(wordText.charAt(0)) &&
			!joinsChineseText
		) {
			text += " ";
		}
		text += wordText;
	}

	return text;
}
