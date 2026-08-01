/** The product wordmark used by the local NeoCap desktop application. */
export function NeoCapBrand(props: { class?: string }) {
	return (
		<div class={props.class} aria-label="NeoCap">
			<span
				aria-hidden="true"
				class="size-10 shrink-0 rounded-xl border border-blue-5 bg-[radial-gradient(circle_at_center,_white_0_25%,_#bfdbfe_26%_44%,_#2563eb_45%_61%,_#eff6ff_62%)] shadow-sm"
			/>
			<span class="text-[2rem] font-semibold tracking-[-0.05em] text-gray-12">
				NeoCap
			</span>
		</div>
	);
}
