export type CaptionExportFormat = "srt" | "vtt";

export interface CaptionExportCue {
	startMs: number;
	endMs: number;
	text: string;
}

const DOUBLE_QUOTE = String.fromCharCode(34);
const INVALID_FILE_NAME_CHARS = new Set([
	"<",
	">",
	":",
	DOUBLE_QUOTE,
	"/",
	"\\",
	"|",
	"?",
	"*",
]);

function formatTimestamp(ms: number, separator: "," | ".") {
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.floor((ms % 3_600_000) / 60_000);
	const seconds = Math.floor((ms % 60_000) / 1000);
	const milliseconds = ms % 1000;

	return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}${separator}${milliseconds.toString().padStart(3, "0")}`;
}

function normalizeVttCueText(text: string) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Produces a stable, non-overlapping cue sequence after millisecond rounding.
 * When two source ranges collide, preserve the later cue's start when possible
 * by shortening the preceding cue; an exact-start collision shifts the later
 * cue forward by at least one millisecond.
 */
export function normalizeCaptionExportCues(cues: CaptionExportCue[]) {
	const normalized: CaptionExportCue[] = [];

	for (const sourceCue of [...cues].sort(
		(a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
	)) {
		if (
			!Number.isFinite(sourceCue.startMs) ||
			!Number.isFinite(sourceCue.endMs) ||
			sourceCue.text.trim().length === 0
		) {
			continue;
		}

		const cue = {
			...sourceCue,
			startMs: Math.max(0, Math.round(sourceCue.startMs)),
			endMs: Math.max(0, Math.round(sourceCue.endMs)),
		};
		cue.endMs = Math.max(cue.endMs, cue.startMs + 1);

		const previous = normalized.at(-1);
		if (previous && cue.startMs < previous.endMs) {
			const shortenedPreviousEnd = Math.max(previous.startMs + 1, cue.startMs);
			if (shortenedPreviousEnd < previous.endMs) {
				previous.endMs = shortenedPreviousEnd;
			}

			if (cue.startMs < previous.endMs) {
				cue.startMs = previous.endMs;
				cue.endMs = Math.max(cue.endMs, cue.startMs + 1);
			}
		}

		normalized.push(cue);
	}

	return normalized;
}

export function formatCaptionCuesAsSrt(cues: CaptionExportCue[]) {
	const normalized = normalizeCaptionExportCues(cues);
	if (normalized.length === 0) return "";

	return `${normalized
		.map(
			(cue, index) =>
				`${index + 1}\n${formatTimestamp(cue.startMs, ",")} --> ${formatTimestamp(cue.endMs, ",")}\n${cue.text}`,
		)
		.join("\n\n")}\n`;
}

export function formatCaptionCuesAsVtt(cues: CaptionExportCue[]) {
	const normalized = normalizeCaptionExportCues(cues);
	if (normalized.length === 0) return "WEBVTT\n";

	return `WEBVTT\n\n${normalized
		.map(
			(cue, index) =>
				`${index + 1}\n${formatTimestamp(cue.startMs, ".")} --> ${formatTimestamp(cue.endMs, ".")}\n${normalizeVttCueText(cue.text)}`,
		)
		.join("\n\n")}\n`;
}

export function formatCaptionCues(
	cues: CaptionExportCue[],
	format: CaptionExportFormat,
) {
	return format === "srt"
		? formatCaptionCuesAsSrt(cues)
		: formatCaptionCuesAsVtt(cues);
}

export function captionExportDefaultPath(
	name: string,
	format: CaptionExportFormat,
) {
	const cleanedName = name
		.trim()
		.split("")
		.map((char) => {
			const code = char.charCodeAt(0);
			return INVALID_FILE_NAME_CHARS.has(char) || code < 32 ? "-" : char;
		})
		.join("")
		.replace(/\s+/g, " ")
		.replace(/\.+$/g, "")
		.slice(0, 120)
		.trim();

	return `${cleanedName || "captions"}.${format}`;
}
