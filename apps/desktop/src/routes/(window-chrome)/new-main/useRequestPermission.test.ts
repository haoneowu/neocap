import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requestAndVerifyPermission: vi.fn(),
	waitForPermissionUpdate: vi.fn(),
	fetchQuery: vi.fn(),
	invalidateQueries: vi.fn(),
	setAlwaysOnTop: vi.fn(),
	setQueryData: vi.fn(),
}));

vi.mock("@tanstack/solid-query", () => ({
	useQueryClient: () => ({
		setQueryData: mocks.setQueryData,
		fetchQuery: mocks.fetchQuery,
		invalidateQueries: mocks.invalidateQueries,
	}),
}));

vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({ setAlwaysOnTop: mocks.setAlwaysOnTop }),
}));

vi.mock("~/utils/devices", () => ({
	devicesSnapshot: { queryKey: ["devicesSnapshot"] },
}));

vi.mock("~/utils/os-permissions", () => ({
	requestAndVerifyPermission: mocks.requestAndVerifyPermission,
	waitForPermissionUpdate: mocks.waitForPermissionUpdate,
}));

vi.mock("~/utils/queries", () => ({
	getPermissions: { queryKey: ["permissionsOS"] },
}));

vi.mock("~/utils/tauri", () => ({ commands: {} }));

import useRequestPermission from "./useRequestPermission";

const grantedCheck = {
	screenRecording: "empty",
	microphone: "granted",
	camera: "empty",
	accessibility: "empty",
} as const;

const deniedMicrophoneCheck = {
	...grantedCheck,
	microphone: "denied",
} as const;

describe("useRequestPermission", () => {
	beforeEach(() => {
		mocks.requestAndVerifyPermission.mockReset();
		mocks.waitForPermissionUpdate.mockReset();
		mocks.fetchQuery.mockReset();
		mocks.invalidateQueries.mockReset();
		mocks.setAlwaysOnTop.mockReset();
		mocks.setQueryData.mockReset();
		mocks.requestAndVerifyPermission.mockResolvedValue({ check: grantedCheck });
		mocks.fetchQuery.mockResolvedValue({});
		mocks.invalidateQueries.mockResolvedValue(undefined);
		mocks.setAlwaysOnTop.mockResolvedValue(undefined);
	});

	it("updates both permission caches after an allowed request", async () => {
		await useRequestPermission()("microphone", "empty");

		expect(mocks.setAlwaysOnTop).toHaveBeenNthCalledWith(1, false);
		expect(mocks.setAlwaysOnTop).toHaveBeenNthCalledWith(2, true);
		expect(mocks.setQueryData).toHaveBeenNthCalledWith(
			1,
			["permissionsOS"],
			grantedCheck,
		);
		expect(mocks.fetchQuery).toHaveBeenCalledWith({
			queryKey: ["devicesSnapshot"],
		});
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["devicesSnapshot"],
			refetchType: "none",
		});

		const updater = mocks.setQueryData.mock.calls[1][1] as (
			snapshot: { cameras: string[]; microphones: string[] } | undefined,
		) => unknown;
		expect(updater({ cameras: [], microphones: [] })).toEqual({
			cameras: [],
			microphones: [],
			permissions: grantedCheck,
		});
		expect(updater(undefined)).toBeUndefined();
	});

	it("keeps the permission cache refresh when restoring window priority fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mocks.setAlwaysOnTop
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("window closed"));

		await useRequestPermission()("microphone", "empty");

		expect(mocks.requestAndVerifyPermission).toHaveBeenCalledOnce();
		expect(mocks.setQueryData).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});

	it("refreshes the device list after permission is granted in System Settings", async () => {
		mocks.requestAndVerifyPermission.mockResolvedValue({
			check: deniedMicrophoneCheck,
			status: "denied",
			openedSettings: true,
		});
		mocks.waitForPermissionUpdate.mockResolvedValue({
			check: grantedCheck,
			status: "granted",
		});

		await useRequestPermission()("microphone", "denied");

		await vi.waitFor(() => {
			expect(mocks.fetchQuery).toHaveBeenCalledTimes(1);
		});
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["devicesSnapshot"],
			refetchType: "none",
		});
	});
});
