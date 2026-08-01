import type { AspectRatio } from "~/utils/tauri";

export type ExportResolutionOption = {
	label: string;
	value: string;
	width: number;
	height: number;
};

const profiles = {
	wide: [
		{ label: "1280×720", value: "1280x720", width: 1280, height: 720 },
		{ label: "1920×1080", value: "1920x1080", width: 1920, height: 1080 },
		{ label: "3840×2160", value: "3840x2160", width: 3840, height: 2160 },
	],
	vertical: [
		{ label: "720×1280", value: "720x1280", width: 720, height: 1280 },
		{ label: "1080×1920", value: "1080x1920", width: 1080, height: 1920 },
		{ label: "2160×3840", value: "2160x3840", width: 2160, height: 3840 },
	],
	square: [
		{ label: "720×720", value: "720x720", width: 720, height: 720 },
		{ label: "1080×1080", value: "1080x1080", width: 1080, height: 1080 },
		{ label: "2160×2160", value: "2160x2160", width: 2160, height: 2160 },
	],
	classic: [
		{ label: "960×720", value: "960x720", width: 960, height: 720 },
		{ label: "1440×1080", value: "1440x1080", width: 1440, height: 1080 },
		{ label: "2880×2160", value: "2880x2160", width: 2880, height: 2160 },
	],
	tall: [
		{ label: "540×720", value: "540x720", width: 540, height: 720 },
		{ label: "810×1080", value: "810x1080", width: 810, height: 1080 },
		{ label: "1620×2160", value: "1620x2160", width: 1620, height: 2160 },
	],
} satisfies Record<AspectRatio, ExportResolutionOption[]>;

/**
 * Presets are explicit output dimensions rather than a generic "720p" label.
 * This matters for portrait and square projects: the renderer uses the given
 * base dimensions to preserve the requested social-media canvas exactly.
 */
export function getExportResolutionOptions(
	aspectRatio: AspectRatio | null | undefined,
): ExportResolutionOption[] {
	return profiles[aspectRatio ?? "wide"];
}

export function isExportResolutionOption(
	resolution: Pick<ExportResolutionOption, "width" | "height">,
	options: ExportResolutionOption[],
) {
	return options.some(
		(option) =>
			option.width === resolution.width && option.height === resolution.height,
	);
}
