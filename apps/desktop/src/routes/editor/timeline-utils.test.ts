import { describe, expect, it } from "vitest";

import { rippleDeleteAllTracks } from "./timeline-utils";

describe("unified edited timeline", () => {
	it("keeps click zoom, captions, and masks aligned after a ripple cut", () => {
		// The cursor session clock produces a click at 4s and therefore an auto
		// zoom around [3.7, 6.5]. This fixture removes [3, 5] from the rendered
		// timeline. Every output-timed presentation track must use the same cut
		// transform as the media, rather than retaining stale session positions.
		const timeline = {
			segments: [{ start: 0, end: 10, timescale: 1 }],
			zoomSegments: [{ start: 3.7, end: 6.5 }],
			maskSegments: [{ start: 2.5, end: 4 }],
			textSegments: [{ start: 5, end: 7 }],
			captionSegments: [{ start: 5, end: 7 }],
			keyboardSegments: [{ start: 1, end: 8 }],
			sceneSegments: [{ start: 5, end: 7 }],
		};

		rippleDeleteAllTracks(timeline, 3, 5);

		expect(timeline.segments).toEqual([
			{ start: 0, end: 3, timescale: 1 },
			{ start: 5, end: 10, timescale: 1 },
		]);
		expect(timeline.zoomSegments).toEqual([{ start: 3, end: 4.5 }]);
		expect(timeline.maskSegments).toEqual([{ start: 2.5, end: 3 }]);
		expect(timeline.textSegments).toEqual([{ start: 3, end: 5 }]);
		expect(timeline.captionSegments).toEqual([{ start: 3, end: 5 }]);
		expect(timeline.keyboardSegments).toEqual([{ start: 1, end: 6 }]);
		expect(timeline.sceneSegments).toEqual([{ start: 3, end: 5 }]);
	});

	it("drops a presentation effect that lives entirely inside the removed media", () => {
		const timeline = {
			segments: [{ start: 0, end: 10, timescale: 1 }],
			zoomSegments: [{ start: 3.2, end: 4.8 }],
			maskSegments: [],
			textSegments: [],
			captionSegments: [],
			keyboardSegments: [],
			sceneSegments: [],
		};

		rippleDeleteAllTracks(timeline, 3, 5);

		expect(timeline.zoomSegments).toEqual([]);
	});
});
