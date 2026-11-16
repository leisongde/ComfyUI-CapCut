import type { TimelineTrack } from "@/types/timeline";

const TIME_TOLERANCE = 1e-9;

export interface RippleElementSnapshot {
	elementId: string;
	startTime: number;
}

export interface RippleElementUpdate {
	trackId: string;
	elementId: string;
	updates: { startTime: number };
}

export function captureFollowingElements({
	track,
	elementId,
}: {
	track: TimelineTrack;
	elementId: string;
}): RippleElementSnapshot[] {
	const selectedIndex = track.elements.findIndex((element) => element.id === elementId);
	const selected = track.elements[selectedIndex];
	if (!selected) return [];

	return track.elements
		.map((element, index) => ({ element, index }))
		.filter(
			({ element, index }) =>
				element.id !== elementId &&
				(element.startTime > selected.startTime + TIME_TOLERANCE ||
					(Math.abs(element.startTime - selected.startTime) <= TIME_TOLERANCE &&
						index > selectedIndex)),
		)
		.sort(
			(first, second) =>
				first.element.startTime - second.element.startTime || first.index - second.index,
		)
		.map(({ element }) => ({
			elementId: element.id,
			startTime: element.startTime,
		}));
}

export function createRippleUpdates({
	trackId,
	elements,
	timeDelta,
	minimumStartTime,
}: {
	trackId: string;
	elements: RippleElementSnapshot[];
	timeDelta: number;
	minimumStartTime?: number;
}): RippleElementUpdate[] {
	const proposedFirstStart = elements[0]?.startTime + timeDelta;
	const overlapCorrection =
		typeof minimumStartTime === "number" && Number.isFinite(proposedFirstStart)
			? Math.max(0, minimumStartTime - proposedFirstStart)
			: 0;
	const adjustedDelta = timeDelta + overlapCorrection;

	return elements.map((element) => ({
		trackId,
		elementId: element.elementId,
		updates: { startTime: Math.max(0, element.startTime + adjustedDelta) },
	}));
}
