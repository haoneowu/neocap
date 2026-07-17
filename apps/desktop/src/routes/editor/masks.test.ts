import { describe, expect, it } from "vitest";
import type { FrameLayoutEvent } from "~/utils/tauri";

import {
	defaultMaskSegment,
	encodeMaskEffect,
	getMaskCoordinateSpace,
	getMaskEffect,
	getMaskEffectAmount,
	maskStateToOutput,
} from "./masks";

describe("mask effects", () => {
	it("defaults new sensitive masks to a fully obscuring blur", () => {
		const segment = defaultMaskSegment(0, 1);

		expect(getMaskEffect(segment)).toBe("blur");
		expect(getMaskEffectAmount(segment)).toBe(16);
		expect(segment.opacity).toBe(1);
		expect(segment.coordinateSpace).toBe("displayContent");
	});

	it("preserves legacy pixelation values", () => {
		const segment = defaultMaskSegment(0, 1);
		segment.pixelation = 18;

		expect(getMaskEffect(segment)).toBe("pixelate");
		expect(getMaskEffectAmount(segment)).toBe(18);
	});

	it("encodes blur as a privacy-safe legacy pixelation fallback", () => {
		const segment = defaultMaskSegment(0, 1);
		segment.pixelation = encodeMaskEffect("blur", 24);

		expect(segment.pixelation).toBe(1024);
		expect(getMaskEffect(segment)).toBe("blur");
		expect(getMaskEffectAmount(segment)).toBe(24);
	});

	it("keeps effect amounts within the supported range", () => {
		const segment = defaultMaskSegment(0, 1);
		segment.pixelation = encodeMaskEffect("pixelate", Number.NaN);

		expect(getMaskEffectAmount(segment)).toBe(16);
		expect(encodeMaskEffect("pixelate", 1)).toBe(4);
		expect(encodeMaskEffect("blur", 100)).toBe(1080);
	});

	it("maps display-content masks through the current rendered screen bounds", () => {
		const segment = defaultMaskSegment(0, 1);
		segment.center = { x: 0.25, y: 0.75 };
		segment.size = { x: 0.2, y: 0.1 };
		const layout: FrameLayoutEvent = {
			display: [-240, 80, 1680, 1160],
			display_content: [-240, 80, 1680, 1160],
			camera: null,
			output_width: 1920,
			output_height: 1080,
		};

		expect(maskStateToOutput(segment, 0.5, layout)).toEqual({
			position: { x: 0.125, y: 0.8240740740740741 },
			size: { x: 0.2, y: 0.1 },
		});
	});

	it("keeps missing coordinate-space fields on legacy output-canvas semantics", () => {
		const segment = defaultMaskSegment(0, 1);
		const legacy = { ...segment, coordinateSpace: undefined };
		const layout: FrameLayoutEvent = {
			display: [-240, 80, 1680, 1160],
			display_content: [-240, 80, 1680, 1160],
			camera: null,
			output_width: 1920,
			output_height: 1080,
		};

		expect(getMaskCoordinateSpace(legacy)).toBe("output");
		expect(maskStateToOutput(legacy, 0.5, layout)).toEqual({
			position: { x: 0.5, y: 0.5 },
			size: { x: 0.35, y: 0.35 },
		});
	});
});
