import { useQueryClient } from "@tanstack/solid-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { devicesSnapshot } from "~/utils/devices";
import {
	type PermissionRequestResult,
	requestAndVerifyPermission,
	waitForPermissionUpdate,
} from "~/utils/os-permissions";
import { getPermissions } from "~/utils/queries";
import {
	commands,
	type OSPermissionStatus,
	type OSPermissionsCheck,
} from "~/utils/tauri";

export default function useRequestPermission() {
	const queryClient = useQueryClient();

	const applyPermissionCheck = async (
		type: "camera" | "microphone",
		check: OSPermissionsCheck,
	) => {
		queryClient.setQueryData(getPermissions.queryKey, check);
		queryClient.setQueryData(devicesSnapshot.queryKey, (snapshot) =>
			snapshot ? { ...snapshot, permissions: check } : snapshot,
		);

		if (check[type] === "granted") {
			try {
				await queryClient.invalidateQueries({
					queryKey: devicesSnapshot.queryKey,
					refetchType: "none",
				});
				await queryClient.fetchQuery(devicesSnapshot);
			} catch (error) {
				console.warn(
					`Failed to refresh ${type} devices after permission:`,
					error,
				);
			}
		}
	};

	async function requestPermission(
		type: "camera" | "microphone",
		currentStatus?: OSPermissionStatus,
	) {
		try {
			const window = getCurrentWindow();
			await window.setAlwaysOnTop(false);
			let result: PermissionRequestResult;
			try {
				result = await requestAndVerifyPermission(
					commands,
					type,
					currentStatus,
				);
			} finally {
				try {
					await window.setAlwaysOnTop(true);
				} catch (error) {
					console.warn("Failed to restore window priority:", error);
				}
			}
			await applyPermissionCheck(type, result.check);

			if (result.openedSettings && result.status !== "granted") {
				void waitForPermissionUpdate(commands, type)
					.then(({ check }) => applyPermissionCheck(type, check))
					.catch((error) => {
						console.warn(
							`Failed to refresh ${type} permission after Settings:`,
							error,
						);
					});
			}
		} catch (error) {
			console.error(`Failed to get ${type} permission:`, error);
		}
	}

	return requestPermission;
}
