import { useState, useCallback, useRef, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { DagNodeData } from './workflow-to-flow';
import { computeTopologyLevels, levelHasCheckpoint } from './topology';

export type PreviewNodeState = 'waiting' | 'active' | 'completed';

interface PreviewState {
  readonly previewing: boolean;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly levels: readonly (readonly string[])[];
  readonly phase: 'running' | 'finishing' | 'idle';
}

const INITIAL_STATE: PreviewState = {
  previewing: false,
  currentStep: -1,
  totalSteps: 0,
  levels: [],
  phase: 'idle',
};

type AnimationSpeed = 'fast' | 'normal' | 'slow';

const SPEED_MULTIPLIER: Record<AnimationSpeed, number> = {
  fast: 0.5,
  normal: 1,
  slow: 2,
};

const BASE_NORMAL_DELAY_MS = 800;
const BASE_CHECKPOINT_DELAY_MS = 1500;
const BASE_FINISH_GLOW_MS = 1000;

interface UsePreviewResult {
  readonly previewing: boolean;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly startPreview: () => void;
  readonly stopPreview: () => void;
  readonly getNodePreviewState: (nodeId: string) => PreviewNodeState | null;
  readonly isEdgeActive: (sourceId: string, targetId: string) => boolean;
  readonly phase: 'running' | 'finishing' | 'idle';
}

export function usePreview(
  nodes: readonly Node<DagNodeData>[],
  edges: readonly Edge[],
  animationSpeed: AnimationSpeed = 'normal',
): UsePreviewResult {
  const [state, setState] = useState<PreviewState>(INITIAL_STATE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopPreview = useCallback(() => {
    clearTimer();
    setState(INITIAL_STATE);
  }, [clearTimer]);

  // Advance to next step
  const speedRef = useRef(animationSpeed);
  useEffect(() => { speedRef.current = animationSpeed; }, [animationSpeed]);

  const scheduleNext = useCallback(
    (levels: readonly (readonly string[])[], step: number, allNodes: readonly Node<DagNodeData>[]) => {
      const nextStep = step + 1;
      const multiplier = SPEED_MULTIPLIER[speedRef.current];

      if (nextStep >= levels.length) {
        // All levels done - show finishing glow
        setState((prev) => ({ ...prev, currentStep: nextStep, phase: 'finishing' }));
        timerRef.current = setTimeout(() => {
          setState(INITIAL_STATE);
        }, BASE_FINISH_GLOW_MS * multiplier);
        return;
      }

      const levelNodeIds = levels[nextStep];
      const isCheckpoint = levelHasCheckpoint(levelNodeIds, allNodes);
      const delay = (isCheckpoint ? BASE_CHECKPOINT_DELAY_MS : BASE_NORMAL_DELAY_MS) * multiplier;

      setState((prev) => ({ ...prev, currentStep: nextStep }));

      timerRef.current = setTimeout(() => {
        scheduleNext(levels, nextStep, allNodes);
      }, delay);
    },
    []
  );

  const startPreview = useCallback(() => {
    clearTimer();

    if (nodes.length === 0) return;

    const levels = computeTopologyLevels(nodes, edges);
    if (levels.length === 0) return;

    setState({
      previewing: true,
      currentStep: 0,
      totalSteps: levels.length,
      levels,
      phase: 'running',
    });

    const firstLevelNodes = levels[0];
    const isCheckpoint = levelHasCheckpoint(firstLevelNodes, nodes);
    const multiplier = SPEED_MULTIPLIER[animationSpeed];
    const delay = (isCheckpoint ? BASE_CHECKPOINT_DELAY_MS : BASE_NORMAL_DELAY_MS) * multiplier;

    timerRef.current = setTimeout(() => {
      scheduleNext(levels, 0, nodes);
    }, delay);
  }, [nodes, edges, clearTimer, scheduleNext]);

  // Cleanup on unmount
  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  const getNodePreviewState = useCallback(
    (nodeId: string): PreviewNodeState | null => {
      if (!state.previewing) return null;

      if (state.phase === 'finishing') return 'completed';

      for (let i = 0; i < state.levels.length; i++) {
        if (state.levels[i].includes(nodeId)) {
          if (i < state.currentStep) return 'completed';
          if (i === state.currentStep) return 'active';
          return 'waiting';
        }
      }
      return 'waiting';
    },
    [state]
  );

  const isEdgeActive = useCallback(
    (sourceId: string, targetId: string): boolean => {
      if (!state.previewing || state.phase !== 'running') return false;

      const sourceState = getNodePreviewState(sourceId);
      const targetState = getNodePreviewState(targetId);

      return sourceState === 'completed' && targetState === 'active';
    },
    [state, getNodePreviewState]
  );

  return {
    previewing: state.previewing,
    currentStep: state.currentStep,
    totalSteps: state.totalSteps,
    startPreview,
    stopPreview,
    getNodePreviewState,
    isEdgeActive,
    phase: state.phase,
  };
}
