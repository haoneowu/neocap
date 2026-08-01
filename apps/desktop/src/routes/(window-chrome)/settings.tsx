import { A, type RouteSectionProps } from "@solidjs/router";
import { getVersion } from "@tauri-apps/api/app";
import * as shell from "@tauri-apps/plugin-shell";
import {
	createSignal,
	For,
	onMount,
	Show,
	Suspense,
} from "solid-js";
import { CapErrorBoundary } from "~/components/CapErrorBoundary";
import { commands } from "~/utils/tauri";
import IconLucideTerminal from "~icons/lucide/terminal";
import IconLucideZap from "~icons/lucide/zap";

function SettingsContentSkeleton() {
	return (
		<div class="cap-settings-page flex flex-col h-full custom-scroll">
			<div class="px-6 py-6 space-y-7 max-w-[42rem]" aria-hidden="true">
				<div class="space-y-2.5">
					<div class="px-1 space-y-1.5">
						<div class="h-4 w-28 rounded-full bg-gray-4 animate-pulse" />
						<div class="h-3 w-72 max-w-full rounded-full bg-gray-4 animate-pulse" />
					</div>
					<div class="cap-settings-card overflow-hidden rounded-xl border border-gray-3 bg-gray-2 divide-y divide-gray-3">
						<div class="px-4 py-3.5 space-y-2">
							<div class="h-[15px] w-40 rounded-full bg-gray-4 animate-pulse" />
							<div class="h-3 w-64 max-w-full rounded-full bg-gray-4 animate-pulse" />
						</div>
						<div class="px-4 py-3.5 space-y-2">
							<div class="h-[15px] w-36 rounded-full bg-gray-4 animate-pulse" />
							<div class="h-3 w-56 max-w-full rounded-full bg-gray-4 animate-pulse" />
						</div>
						<div class="px-4 py-3.5 space-y-2">
							<div class="h-[15px] w-44 rounded-full bg-gray-4 animate-pulse" />
							<div class="h-3 w-60 max-w-full rounded-full bg-gray-4 animate-pulse" />
						</div>
					</div>
				</div>
				<div class="space-y-2.5">
					<div class="px-1 space-y-1.5">
						<div class="h-4 w-36 rounded-full bg-gray-4 animate-pulse" />
						<div class="h-3 w-64 max-w-full rounded-full bg-gray-4 animate-pulse" />
					</div>
					<div class="cap-settings-card overflow-hidden rounded-xl border border-gray-3 bg-gray-2 divide-y divide-gray-3">
						<div class="px-4 py-3.5 space-y-2">
							<div class="h-[15px] w-48 rounded-full bg-gray-4 animate-pulse" />
							<div class="h-3 w-52 max-w-full rounded-full bg-gray-4 animate-pulse" />
						</div>
						<div class="px-4 py-3.5 space-y-2">
							<div class="h-[15px] w-32 rounded-full bg-gray-4 animate-pulse" />
							<div class="h-3 w-72 max-w-full rounded-full bg-gray-4 animate-pulse" />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function Settings(props: RouteSectionProps) {
	const [version, setVersion] = createSignal<string | null>(null);
	const settingsItems = [
		{
			href: "general",
			name: "General",
			icon: IconCapSettings,
		},
		{
			href: "hotkeys",
			name: "Shortcuts",
			icon: IconCapHotkeys,
		},
		{
			href: "cli",
			name: "CLI",
			icon: IconLucideTerminal,
		},
		{
			href: "recordings",
			name: "Recordings",
			icon: IconLucideSquarePlay,
		},
		{
			href: "screenshots",
			name: "Screenshots",
			icon: IconLucideImage,
		},
		{
			href: "automations",
			name: "Automations",
			icon: IconLucideZap,
		},
		{
			href: "transcription",
			name: "Transcription",
			icon: IconCapCaptions,
		},
		{
			href: "integrations",
			name: "Integrations",
			icon: IconLucideUnplug,
		},
		{
			href: "license",
			name: "License",
			icon: IconLucideGift,
		},
		{
			href: "experimental",
			name: "Experimental",
			icon: IconCapSettings,
		},
		{
			href: "feedback",
			name: "Feedback",
			icon: IconLucideMessageSquarePlus,
		},
		{
			href: "changelog",
			name: "Changelog",
			icon: IconLucideBell,
		},
	];

	onMount(() => {
		void getVersion()
			.then(setVersion)
			.catch((error) => console.error("Failed to load app version:", error));
	});

	return (
		<div class="cap-settings-shell flex-1 flex flex-row divide-x divide-gray-3 text-[0.875rem] leading-5 overflow-y-hidden">
			<div
				class="cap-settings-sidebar flex flex-col h-full bg-gray-2"
				data-tauri-drag-region
			>
				<div class="cap-settings-window-spacer" data-tauri-drag-region />
				<div class="mx-2 mt-2 mb-3 px-2 py-1.5" data-tauri-drag-region="false">
					<p class="text-[13px] leading-[15px] text-gray-12">NeoCap</p>
					<p class="mt-0.5 text-[11px] leading-[13px] text-gray-10">
						Local-first · no account required
					</p>
				</div>
				<ul class="cap-settings-nav min-w-48 h-full p-2.5 space-y-1 text-gray-12">
					<For each={settingsItems}>
						{(item) => (
							<li>
								<A
									href={item.href}
									activeClass="bg-gray-5 pointer-events-none"
									class="cap-settings-nav-item rounded-lg h-8 hover:bg-gray-3 text-[13px] px-2 flex flex-row items-center gap-1.5 transition-colors"
								>
									<item.icon class="opacity-60 size-4" aria-hidden="true" />
									<span>{item.name}</span>
								</A>
							</li>
						)}
					</For>
				</ul>
				<div class="cap-settings-account p-2.5 text-left flex flex-col">
					<Show when={version()}>
						{(v) => (
							<div class="mb-2 text-xs text-gray-11 flex flex-col items-start gap-1.5">
								<span>v{v()}</span>
								<div class="flex flex-col items-start gap-1.5">
									<button
										type="button"
										class="text-gray-11 hover:text-gray-12 underline transition-colors"
										onClick={() =>
										shell.open("https://github.com/haoneowu/neocap/releases")
										}
									>
										View previous versions
									</button>
									<span class="text-gray-10">
										Updates are published manually on GitHub.
									</span>
								</div>
							</div>
						)}
					</Show>
				</div>
			</div>
			<div class="cap-settings-content overflow-y-hidden flex-1 min-w-0">
				<CapErrorBoundary>
					<Suspense fallback={<SettingsContentSkeleton />}>
						{props.children}
					</Suspense>
				</CapErrorBoundary>
			</div>
		</div>
	);
}
