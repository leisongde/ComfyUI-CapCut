import { useCallback, useEffect, useRef, useState } from "react";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { EditorCore } from "@/core";
import {
	type SnapPoint,
	useTimelineSnapping,
} from "@/hooks/timeline/use-timeline-snapping";
import { computeSpeedStretch } from "@/lib/timeline/speed-utils";
import {
	captureFollowingElements,
	createRippleUpdates,
	type RippleElementSnapshot,
} from "@/lib/timeline/ripple-utils";
import { useTimelineStore } from "@/stores/timeline-store";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";

interface SpeedStretchState {
	startX: number;
	initialDuration: number;
	initialPlaybackRate: number;
	initialStartTime: number;
	rippleElements: RippleElementSnapshot[];
}

interface UseElementSpeedStretchProps {
	element: TimelineElement;
	track: TimelineTrack;
	zoomLevel: number;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
	onInteractionStateChange?: (params: { isResizing: boolean }) => void;
}

function getPlaybackRate({ element }: { element: TimelineElement }): number {
	if (element.type !== "video" && element.type !== "audio") return 1;
	return element.playbackRate ?? 1;
}

export function useElementSpeedStretch({
	element,
	track,
	zoomLevel,
	onSnapPointChange,
	onInteractionStateChange,
}: UseElementSpeedStretchProps) {
	const editor = EditorCore.getInstance();
	const activeProject = editor.project.getActive();
	const snappingEnabled = useTimelineStore((state) => state.snappingEnabled);
	const { findSnapPoints, snapToNearestPoint } = useTimelineSnapping();
	const [stretching, setStretching] = useState<SpeedStretchState | null>(null);
	const [currentDuration, setCurrentDuration] = useState(element.duration);
	const [currentPlaybackRate, setCurrentPlaybackRate] = useState(
		getPlaybackRate({ element }),
	);
	const currentDurationRef = useRef(element.duration);
	const currentPlaybackRateRef = useRef(getPlaybackRate({ element }));

	const handleSpeedStretchStart = ({ e }: { e: React.MouseEvent }) => {
		if (element.type !== "video" && element.type !== "audio") return;

		e.stopPropagation();
		e.preventDefault();

		const playbackRate = element.playbackRate ?? 1;
		const rippleElements = captureFollowingElements({
			track,
			elementId: element.id,
		});
		setStretching({
			startX: e.clientX,
			initialDuration: element.duration,
			initialPlaybackRate: playbackRate,
			initialStartTime: element.startTime,
			rippleElements,
		});
		setCurrentDuration(element.duration);
		setCurrentPlaybackRate(playbackRate);
		currentDurationRef.current = element.duration;
		currentPlaybackRateRef.current = playbackRate;
		onInteractionStateChange?.({ isResizing: true });
	};

	const updateSpeedFromMouseMove = useCallback(
		({ clientX }: { clientX: number }) => {
			if (!stretching) return;

			const pixelsPerSecond = TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
			const deltaTime = (clientX - stretching.startX) / pixelsPerSecond;
			let targetEndTime =
				stretching.initialStartTime + stretching.initialDuration + deltaTime;
			let speedSnapPoint: SnapPoint | null = null;

			if (snappingEnabled) {
				const snapPoints = findSnapPoints({
					tracks: editor.timeline.getTracks(),
					playheadTime: editor.playback.getCurrentTime(),
					excludeElementId: element.id,
				});
				const snapResult = snapToNearestPoint({
					targetTime: targetEndTime,
					snapPoints,
					zoomLevel,
				});
				speedSnapPoint = snapResult.snapPoint;
				targetEndTime = snapResult.snappedTime;
			}

			const fps = activeProject.settings.fps;
			const result = computeSpeedStretch({
				initialDuration: stretching.initialDuration,
				initialRate: stretching.initialPlaybackRate,
				targetDuration: targetEndTime - stretching.initialStartTime,
				fps,
			});
			const actualEndTime = stretching.initialStartTime + result.duration;
			const frameTolerance = fps > 0 ? 0.5 / fps + 1e-9 : 1e-9;
			if (
				speedSnapPoint &&
				Math.abs(actualEndTime - speedSnapPoint.time) > frameTolerance
			) {
				speedSnapPoint = null;
			}
			onSnapPointChange?.(speedSnapPoint);

			if (
				result.duration === currentDurationRef.current &&
				result.playbackRate === currentPlaybackRateRef.current
			) {
				return;
			}

			setCurrentDuration(result.duration);
			setCurrentPlaybackRate(result.playbackRate);
			currentDurationRef.current = result.duration;
			currentPlaybackRateRef.current = result.playbackRate;
			const durationDelta = result.duration - stretching.initialDuration;
			editor.timeline.updateElements({
				updates: [
					{
						trackId: track.id,
						elementId: element.id,
						updates: {
							duration: result.duration,
							playbackRate: result.playbackRate,
						},
					},
					...createRippleUpdates({
						trackId: track.id,
						elements: stretching.rippleElements,
						timeDelta: durationDelta,
						minimumStartTime: actualEndTime,
					}),
				],
				pushHistory: false,
			});
		},
		[
			stretching,
			zoomLevel,
			snappingEnabled,
			findSnapPoints,
			snapToNearestPoint,
			editor,
			element.id,
			track.id,
			activeProject.settings.fps,
			onSnapPointChange,
		],
	);

	const handleSpeedStretchEnd = useCallback(() => {
		if (!stretching) return;

		// The moving handle can finish under the pointer's old target. Prevent the
		// resulting click from being treated as a click on empty timeline space.
		const suppressClick = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
		};
		document.addEventListener("click", suppressClick, {
			capture: true,
			once: true,
		});
		window.setTimeout(() => {
			document.removeEventListener("click", suppressClick, true);
		}, 0);

		const finalDuration = currentDurationRef.current;
		const finalPlaybackRate = currentPlaybackRateRef.current;
		const changed =
			finalDuration !== stretching.initialDuration ||
			finalPlaybackRate !== stretching.initialPlaybackRate;

		if (changed) {
			editor.timeline.updateElements({
				updates: [
					{
						trackId: track.id,
						elementId: element.id,
						updates: {
							duration: stretching.initialDuration,
							playbackRate: stretching.initialPlaybackRate,
						},
					},
					...createRippleUpdates({
						trackId: track.id,
						elements: stretching.rippleElements,
						timeDelta: 0,
					}),
				],
				pushHistory: false,
			});
			editor.timeline.updateElements({
				updates: [
					{
						trackId: track.id,
						elementId: element.id,
						updates: {
							duration: finalDuration,
							playbackRate: finalPlaybackRate,
						},
					},
					...createRippleUpdates({
						trackId: track.id,
						elements: stretching.rippleElements,
						timeDelta: finalDuration - stretching.initialDuration,
						minimumStartTime: stretching.initialStartTime + finalDuration,
					}),
				],
			});
		}

		setStretching(null);
		onInteractionStateChange?.({ isResizing: false });
		onSnapPointChange?.(null);
	}, [
		stretching,
		editor.timeline,
		track.id,
		element.id,
		onInteractionStateChange,
		onSnapPointChange,
	]);

	useEffect(() => {
		if (!stretching) return;

		const handleDocumentMouseMove = ({ clientX }: MouseEvent) => {
			updateSpeedFromMouseMove({ clientX });
		};
		const handleDocumentMouseUp = () => {
			handleSpeedStretchEnd();
		};

		document.addEventListener("mousemove", handleDocumentMouseMove);
		document.addEventListener("mouseup", handleDocumentMouseUp);

		return () => {
			document.removeEventListener("mousemove", handleDocumentMouseMove);
			document.removeEventListener("mouseup", handleDocumentMouseUp);
		};
	}, [stretching, updateSpeedFromMouseMove, handleSpeedStretchEnd]);

	return {
		handleSpeedStretchStart,
		isSpeedStretching: stretching !== null,
		currentDuration,
		currentPlaybackRate,
	};
}
