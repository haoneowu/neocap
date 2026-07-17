import { describe, expect, it } from "vitest";
import { ASPECT_RATIOS } from "./projectConfig";

describe("NeoCap primary canvas profiles", () => {
	it.each([
		["wide", [16, 9]],
		["vertical", [9, 16]],
		["square", [1, 1]],
	] as const)("keeps %s at %j", (profile, ratio) => {
		expect(ASPECT_RATIOS[profile].ratio).toEqual(ratio);
	});
});
