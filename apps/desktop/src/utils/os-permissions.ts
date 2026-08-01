import type {
	OSPermission,
	OSPermissionStatus,
	OSPermissionsCheck,
} from "~/utils/tauri";

export function isPermissionGranted(status?: OSPermissionStatus): boolean {
	return status === "granted" || status === "notNeeded";
}

export function permissionStatusFor(
	check: OSPermissionsCheck,
	permission: OSPermission,
): OSPermissionStatus {
	switch (permission) {
		case "screenRecording":
			return check.screenRecording;
		case "microphone":
			return check.microphone;
		case "camera":
			return check.camera;
		case "accessibility":
			return check.accessibility;
	}
}

type PermissionClient = {
	requestPermission: (permission: OSPermission) => Promise<void>;
	openPermissionSettings: (permission: OSPermission) => Promise<void>;
	doPermissionsCheck: (initialCheck: boolean) => Promise<OSPermissionsCheck>;
};

export type PermissionRequestResult = {
	check: OSPermissionsCheck;
	status: OSPermissionStatus;
	openedSettings: boolean;
};

type PermissionPollOptions = {
	maxAttempts?: number;
	sleep?: () => Promise<void>;
};

const permissionPollSleep = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 500);
	});

export async function waitForPermissionUpdate(
	client: Pick<PermissionClient, "doPermissionsCheck">,
	permission: OSPermission,
	options: PermissionPollOptions = {},
): Promise<Pick<PermissionRequestResult, "check" | "status">> {
	const { maxAttempts = 60, sleep = permissionPollSleep } = options;
	let check = await client.doPermissionsCheck(false);
	let status = permissionStatusFor(check, permission);

	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		if (isPermissionGranted(status)) break;
		await sleep();
		check = await client.doPermissionsCheck(false);
		status = permissionStatusFor(check, permission);
	}

	return { check, status };
}

export async function requestAndVerifyPermission(
	client: PermissionClient,
	permission: OSPermission,
	currentStatus?: OSPermissionStatus,
): Promise<PermissionRequestResult> {
	if (currentStatus === "denied") {
		await client.openPermissionSettings(permission);
		const check = await client.doPermissionsCheck(false);
		return {
			check,
			status: permissionStatusFor(check, permission),
			openedSettings: true,
		};
	}

	await client.requestPermission(permission);

	const check = await client.doPermissionsCheck(false);
	const status = permissionStatusFor(check, permission);

	if (isPermissionGranted(status)) {
		return {
			check,
			status,
			openedSettings: false,
		};
	}

	await client.openPermissionSettings(permission);

	return {
		check,
		status,
		openedSettings: true,
	};
}
