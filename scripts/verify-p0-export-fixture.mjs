import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "target");
const runDir = process.env.CAP_EXPORT_FIXTURE_DIR
	? path.resolve(process.env.CAP_EXPORT_FIXTURE_DIR)
	: path.join(fixtureRoot, "neocap-export-fixture");
const capCli =
	process.env.CAP_CLI || path.join(root, "target", "release", "cap-cli");
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
const ffprobe = process.env.FFPROBE_BIN || "ffprobe";
const fixtureDurationSeconds = 2;
const fixtureWidth = 320;
const fixtureHeight = 180;
const fixtureFps = 15;

function fail(message) {
	throw new Error(message);
}

function isSafeRunDirectory() {
	return runDir.startsWith(`${fixtureRoot}${path.sep}`);
}

async function run(command, args) {
	try {
		return await execFile(command, args, {
			cwd: root,
			maxBuffer: 10 * 1024 * 1024,
		});
	} catch (error) {
		const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
		fail(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
	}
}

async function hashFile(filePath) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) {
		hash.update(chunk);
	}
	return hash.digest("hex");
}

async function probe(filePath) {
	const { stdout } = await run(ffprobe, [
		"-v",
		"error",
		"-show_entries",
		"format=duration:stream=codec_type,codec_name,width,height,sample_rate,channels",
		"-of",
		"json",
		filePath,
	]);
	return JSON.parse(stdout);
}

function stream(probeResult, codecType) {
	return probeResult.streams.find((entry) => entry.codec_type === codecType);
}

function assertMedia(probeResult, label) {
	const video = stream(probeResult, "video");
	const audio = stream(probeResult, "audio");
	const duration = Number(probeResult.format?.duration);

	if (!video || video.codec_name !== "h264") {
		fail(`${label} must contain an H.264 video stream`);
	}
	if (video.width !== fixtureWidth || video.height !== fixtureHeight) {
		fail(
			`${label} dimensions must be ${fixtureWidth}x${fixtureHeight}, got ${video.width}x${video.height}`,
		);
	}
	if (!audio || audio.codec_name !== "aac") {
		fail(`${label} must contain an AAC audio stream`);
	}
	if (
		!Number.isFinite(duration) ||
		Math.abs(duration - fixtureDurationSeconds) > 0.15
	) {
		fail(
			`${label} duration must be close to ${fixtureDurationSeconds}s, got ${duration}`,
		);
	}
}

function parseNdjson(text) {
	return text
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

async function main() {
	await access(capCli).catch(() => {
		fail(
			`Cap CLI was not found at ${capCli}. Build the release sidecars or set CAP_CLI.`,
		);
	});
	if (!isSafeRunDirectory()) {
		fail(`CAP_EXPORT_FIXTURE_DIR must be inside ${fixtureRoot}`);
	}
	await rm(runDir, { recursive: true, force: true });
	await mkdir(path.join(runDir, "fixture.cap", "content"), { recursive: true });

	const projectPath = path.join(runDir, "fixture.cap");
	const sourcePath = path.join(projectPath, "content", "display.mp4");
	const exportPath = path.join(runDir, "export.mp4");
	const reportPath = path.join(runDir, "report.json");

	await run(ffmpeg, [
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		"-f",
		"lavfi",
		"-i",
		`testsrc2=duration=${fixtureDurationSeconds}:size=${fixtureWidth}x${fixtureHeight}:rate=${fixtureFps}`,
		"-f",
		"lavfi",
		"-i",
		`sine=frequency=880:duration=${fixtureDurationSeconds}:sample_rate=48000`,
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-shortest",
		sourcePath,
	]);

	await writeFile(
		path.join(projectPath, "recording-meta.json"),
		`${JSON.stringify(
			{
				pretty_name: "NeoCap P0 export fixture",
				display: { path: "content/display.mp4", fps: fixtureFps },
				audio: { path: "content/display.mp4" },
			},
			null,
			2,
		)}\n`,
	);

	await run(capCli, [
		"project",
		"config",
		"set",
		projectPath,
		"--settings-json",
		"{}",
	]);

	const sourceHashBefore = await hashFile(sourcePath);
	const { stdout } = await run(capCli, [
		"--json",
		"export",
		projectPath,
		"--output",
		exportPath,
		"--fps",
		String(fixtureFps),
		"--resolution",
		`${fixtureWidth}x${fixtureHeight}`,
		"--quality",
		"potato",
		"--force-ffmpeg-decoder",
	]);
	const events = parseNdjson(stdout);
	const completed = events.at(-1);
	const finalProgress = events
		.filter((event) => event.type === "Progress")
		.at(-1);
	if (completed?.type !== "Completed" || completed.path !== exportPath) {
		fail(
			"export must finish with a Completed NDJSON event for the requested output path",
		);
	}
	if (
		finalProgress?.rendered_count !== fixtureDurationSeconds * fixtureFps ||
		finalProgress.total_frames !== fixtureDurationSeconds * fixtureFps
	) {
		fail("export progress did not report every expected frame");
	}

	const sourceHashAfter = await hashFile(sourcePath);
	if (sourceHashBefore !== sourceHashAfter) {
		fail("export modified the source recording");
	}

	const [sourceProbe, exportProbe, exportHash] = await Promise.all([
		probe(sourcePath),
		probe(exportPath),
		hashFile(exportPath),
	]);
	assertMedia(sourceProbe, "source");
	assertMedia(exportProbe, "export");

	const report = {
		sourcePath,
		exportPath,
		sourceSha256: sourceHashAfter,
		exportSha256: exportHash,
		events,
		sourceProbe,
		exportProbe,
	};
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`${JSON.stringify({ reportPath, ...report })}\n`);
}

await main();
