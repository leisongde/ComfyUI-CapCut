export const SPEED_PRESETS = [
	{ label: "0.25x", value: 0.25 },
	{ label: "0.5x", value: 0.5 },
	{ label: "0.75x", value: 0.75 },
	{ label: "1x", value: 1 },
	{ label: "1.25x", value: 1.25 },
	{ label: "1.5x", value: 1.5 },
	{ label: "2x", value: 2 },
	{ label: "4x", value: 4 },
] as const;

export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 4;

export function formatSpeedLabel({ rate }: { rate: number }): string {
	if (Number.isInteger(rate)) return rate.toString();
	const rounded = Math.round(rate * 100) / 100;
	return rounded.toString();
}

export function computeDurationAfterSpeedChange({
	currentDuration,
	oldRate,
	newRate,
}: {
	currentDuration: number;
	oldRate: number;
	newRate: number;
}): number {
	return currentDuration * (oldRate / newRate);
}

export function computeSpeedStretch({
	initialDuration,
	initialRate,
	targetDuration,
	fps,
}: {
	initialDuration: number;
	initialRate: number;
	targetDuration: number;
	fps: number;
}): { duration: number; playbackRate: number } {
	const sourceDuration = initialDuration * initialRate;
	if (sourceDuration <= 0) {
		return { duration: initialDuration, playbackRate: initialRate };
	}

	const minDuration = sourceDuration / MAX_PLAYBACK_RATE;
	const maxDuration = sourceDuration / MIN_PLAYBACK_RATE;

	if (!Number.isFinite(fps) || fps <= 0) {
		const duration = Math.min(
			maxDuration,
			Math.max(minDuration, targetDuration),
		);
		return { duration, playbackRate: sourceDuration / duration };
	}

	const minFrames = Math.max(1, Math.ceil(minDuration * fps - 1e-9));
	const maxFrames = Math.max(minFrames, Math.floor(maxDuration * fps + 1e-9));
	const targetFrames = Math.round(targetDuration * fps);
	const frameCount = Math.min(maxFrames, Math.max(minFrames, targetFrames));
	const duration = frameCount / fps;

	return { duration, playbackRate: sourceDuration / duration };
}
