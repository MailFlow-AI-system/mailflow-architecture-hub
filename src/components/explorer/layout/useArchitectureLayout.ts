import { useEffect, useRef, useState } from 'react';

import {
  layoutArchitecture,
  type ArchitectureLayoutError,
  type ArchitectureLayoutGraph,
  type ArchitectureLayoutOptions,
  type ArchitectureLayoutResult,
} from './layoutArchitecture';

export type UseArchitectureLayoutResult<T = unknown> = {
  layout: ArchitectureLayoutResult<T> | null;
  loading: boolean;
  error: ArchitectureLayoutError | null;
};

export function useArchitectureLayout<T = unknown>(
  graph: ArchitectureLayoutGraph<T> | null | undefined,
  options: ArchitectureLayoutOptions = {},
): UseArchitectureLayoutResult<T> {
  const requestRef = useRef(0);
  const { engine, layerSpacing, nodeSpacing, padding } = options;
  const [state, setState] = useState<UseArchitectureLayoutResult<T>>({
    layout: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    if (!graph) {
      setState({ layout: null, loading: false, error: null });
      return;
    }

    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    void layoutArchitecture(graph, { engine, layerSpacing, nodeSpacing, padding }).then(
      (layout) => {
        if (!active || requestRef.current !== requestId) return;
        setState({ layout, loading: false, error: layout.error ?? null });
      },
    );

    return () => {
      active = false;
    };
  }, [engine, graph, layerSpacing, nodeSpacing, padding]);

  return state;
}
