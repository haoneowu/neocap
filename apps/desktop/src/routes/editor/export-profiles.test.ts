import { describe, expect, it } from "vitest";
import { getExportResolutionOptions } from "./export-profiles";

describe("NeoCap social export profiles", () => {
	it.each([
		["wide", [1280, 720]],
		["vertical", [720, 1280]],
		["square", [720, 720]],
	] as const)("provides an exact %s base profile", (aspectRatio, size) => {
		const first = getExportResolutionOptions(aspectRatio)[0];

		expect([first?.width, first?.height]).toEqual(size);
	});

	it("keeps auto projects on the compatible landscape profile", () => {
		expect(getExportResolutionOptions(null)[0]).toMatchObject({
			width: 1280,
			height: 720,
		});
	});
});
