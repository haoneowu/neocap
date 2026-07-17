import type { FrameLayoutEvent, XY } from "~/utils/tauri";
import maskEffectContract from "../../../../../crates/project/mask-effects.json";

export type MaskKind = "sensitive" | "highlight";
export type MaskEffect = "blur" | "pixelate";
export type MaskCoordinateSpace = "output" | "displayContent";

// Older versions interpret encoded blur as strong pixelation, keeping masked content private.
const {
	blurEncodingOffset: MASK_BLUR_ENCODING_OFFSET,
	defaultAmount: DEFAULT_MASK_EFFECT_AMOUNT,
	minAmount: MIN_MASK_EFFECT_AMOUNT,
	maxAmount: MAX_MASK_EFFECT_AMOUNT,
} = maskEffectContract;

export type MaskScalarKeyframe = {
	time: number;
	value: number;
};

export type MaskVectorKeyframe = {
	time: number;
	x: number;
	y: number;
};

export type MaskKeyframes = {
	position: MaskVectorKeyframe[];
	size: MaskVectorKeyframe[];
	intensity: MaskScalarKeyframe[];
};

export type MaskSegment = {
	start: number;
	end: number;
	track: number;
	enabled: boolean;
	maskType: MaskKind;
	coordinateSpace: MaskCoordinateSpace;
	center: XY<number>;
	size: XY<number>;
	feather: number;
	opacity: number;
	pixelation: number;
	darkness: number;
	fadeDuration: number;
	keyframes: MaskKeyframes;
};

type PersistedMaskSegment = Omit<MaskSegment, "coordinateSpace"> & {
	coordinateSpace?: MaskCoordinateSpace;
};

export type MaskState = {
	position: XY<number>;
	size: XY<number>;
};

export type MaskCoordinateTransform = {
	origin: XY<number>;
	scale: XY<number>;
};

const normalizeMaskEffectAmount = (amount: number) => {
	if (!Number.isFinite(amount) || amount <= 0) {
		return DEFAULT_MASK_EFFECT_AMOUNT;
	}
	return Math.min(
		Math.max(amount, MIN_MASK_EFFECT_AMOUNT),
		MAX_MASK_EFFECT_AMOUNT,
	);
};

export const encodeMaskEffect = (effect: MaskEffect, amount: number) => {
	const normalizedAmount = normalizeMaskEffectAmount(amount);
	return effect === "blur"
		? MASK_BLUR_ENCODING_OFFSET + normalizedAmount
		: normalizedAmount;
};

export const getMaskEffect = (segment: MaskSegment): MaskEffect =>
	segment.pixelation >= MASK_BLUR_ENCODING_OFFSET ? "blur" : "pixelate";

export const getMaskEffectAmount = (segment: MaskSegment) => {
	const storedAmount = Number.isFinite(segment.pixelation)
		? segment.pixelation
		: DEFAULT_MASK_EFFECT_AMOUNT;
	const decodedAmount =
		getMaskEffect(segment) === "blur"
			? storedAmount - MASK_BLUR_ENCODING_OFFSET
			: storedAmount;
	return normalizeMaskEffectAmount(decodedAmount);
};

export const defaultMaskSegment = (
	start: number,
	end: number,
): MaskSegment => ({
	start,
	end,
	track: 0,
	enabled: true,
	maskType: "sensitive",
	coordinateSpace: "displayContent",
	center: { x: 0.5, y: 0.5 },
	size: { x: 0.35, y: 0.35 },
	feather: 0.1,
	opacity: 1,
	pixelation: encodeMaskEffect("blur", DEFAULT_MASK_EFFECT_AMOUNT),
	darkness: 0.5,
	fadeDuration: 0,
	keyframes: { position: [], size: [], intensity: [] },
});

/**
 * Older projects omitted coordinateSpace and therefore retain their original
 * output-canvas semantics. New masks use displayContent so they remain glued
 * to a sensitive screen region while the screen zooms or enters a split view.
 */
export const getMaskCoordinateSpace = (segment: {
	coordinateSpace?: MaskCoordinateSpace;
}): MaskCoordinateSpace => segment.coordinateSpace ?? "output";

export const getMaskCoordinateTransform = (
	segment: { coordinateSpace?: MaskCoordinateSpace },
	layout: FrameLayoutEvent | null | undefined,
): MaskCoordinateTransform => {
	if (getMaskCoordinateSpace(segment) !== "displayContent" || !layout) {
		return { origin: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };
	}

	const [left, top, right, bottom] = layout.display_content;
	const width = Math.max(0, right - left);
	const height = Math.max(0, bottom - top);
	if (
		layout.output_width <= 0 ||
		layout.output_height <= 0 ||
		!width ||
		!height
	) {
		return { origin: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };
	}

	return {
		origin: {
			x: left / layout.output_width,
			y: top / layout.output_height,
		},
		scale: {
			x: width / layout.output_width,
			y: height / layout.output_height,
		},
	};
};

export const maskStateToOutput = (
	segment: PersistedMaskSegment,
	time: number | undefined,
	layout: FrameLayoutEvent | null | undefined,
): MaskState => {
	const state = evaluateMask(segment, time);
	const transform = getMaskCoordinateTransform(segment, layout);
	return {
		position: {
			x: transform.origin.x + state.position.x * transform.scale.x,
			y: transform.origin.y + state.position.y * transform.scale.y,
		},
		size: {
			x: state.size.x * transform.scale.x,
			y: state.size.y * transform.scale.y,
		},
	};
};

export const evaluateMask = (
	segment: Pick<MaskSegment, "center" | "size">,
	_time?: number,
): MaskState => {
	const position = {
		x: Math.min(Math.max(segment.center.x, 0), 1),
		y: Math.min(Math.max(segment.center.y, 0), 1),
	};
	const size = {
		x: Math.min(Math.max(segment.size.x, 0.01), 2),
		y: Math.min(Math.max(segment.size.y, 0.01), 2),
	};
	return { position, size };
};

const sortByTime = <T extends { time: number }>(items: T[]) =>
	[...items].sort((a, b) => a.time - b.time);

const timeMatch = (a: number, b: number) => Math.abs(a - b) < 1e-3;

export const upsertVectorKeyframe = (
	keyframes: MaskVectorKeyframe[],
	time: number,
	value: XY<number>,
) => {
	const existingIndex = keyframes.findIndex((k) => timeMatch(k.time, time));
	if (existingIndex >= 0) {
		const next = [...keyframes];
		next[existingIndex] = {
			...next[existingIndex],
			time,
			x: value.x,
			y: value.y,
		};
		return sortByTime(next);
	}
	return sortByTime([...keyframes, { time, x: value.x, y: value.y }]);
};

export const upsertScalarKeyframe = (
	keyframes: MaskScalarKeyframe[],
	time: number,
	value: number,
) => {
	const existingIndex = keyframes.findIndex((k) => timeMatch(k.time, time));
	if (existingIndex >= 0) {
		const next = [...keyframes];
		next[existingIndex] = { ...next[existingIndex], time, value };
		return sortByTime(next);
	}
	return sortByTime([...keyframes, { time, value }]);
};

export const removeKeyframeAt = <T extends { time: number }>(
	items: T[],
	time: number,
) => items.filter((k) => !timeMatch(k.time, time));
