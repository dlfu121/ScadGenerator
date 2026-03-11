import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import type { AppAction, AppState } from '../modules/state-session/StateSession';

type AppDispatch = Dispatch<AppAction>;

interface UseScadWorkflowOptions {
  state: AppState;
  dispatch: AppDispatch;
}

export function useScadWorkflow({ state, dispatch }: UseScadWorkflowOptions) {
  const compileAbortRef = useRef<AbortController | null>(null);
  const compileSeqRef = useRef(0);

  const compileModel = useCallback(async (openscadCode: string, parameters: Record<string, any>) => {
    compileAbortRef.current?.abort();
    const requestId = ++compileSeqRef.current;
    const controller = new AbortController();
    compileAbortRef.current = controller;

    dispatch({ type: 'SET_COMPILE_STATUS', payload: 'queued' });
    dispatch({ type: 'SET_COMPILE_PROGRESS', payload: 10 });
    dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '已进入编译队列' });
    dispatch({ type: 'SET_COMPILE_ERROR_DETAIL', payload: undefined });
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: undefined });

    try {
      dispatch({ type: 'SET_COMPILE_STATUS', payload: 'running' });
      dispatch({ type: 'SET_COMPILE_PROGRESS', payload: 35 });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '正在调用 OpenSCAD 编译' });

      const response = await fetch('/api/parametric-chat/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ openscadCode, parameters }),
      });

      if (requestId !== compileSeqRef.current || controller.signal.aborted) {
        return;
      }

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({ error: '编译失败', detail: undefined }));
        const detailText = typeof errorPayload?.detail?.message === 'string'
          ? errorPayload.detail.message
          : undefined;
        throw new Error(detailText || errorPayload.error || '编译失败');
      }

      dispatch({ type: 'SET_COMPILE_PROGRESS', payload: 75 });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '已返回 STL，正在加载渲染' });
      const stlBuffer = await response.arrayBuffer();

      if (requestId !== compileSeqRef.current || controller.signal.aborted) {
        return;
      }

      dispatch({ type: 'SET_STL_DATA', payload: stlBuffer });
      dispatch({ type: 'SET_COMPILE_STATUS', payload: 'success' });
      dispatch({ type: 'SET_COMPILE_PROGRESS', payload: 100 });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '编译完成' });
    } catch (error) {
      if (controller.signal.aborted || requestId !== compileSeqRef.current) {
        return;
      }
      dispatch({ type: 'SET_COMPILE_STATUS', payload: 'error' });
      dispatch({ type: 'SET_COMPILE_PROGRESS', payload: 0 });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '编译失败' });
      dispatch({ type: 'SET_COMPILE_ERROR_DETAIL', payload: error instanceof Error ? error.message : '未知错误' });
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : '未知错误' });
    } finally {
      if (requestId === compileSeqRef.current) {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }
  }, [dispatch]);

  const handleGenerate = useCallback(async (prompt: string) => {
    dispatch({ type: 'SET_PROMPT', payload: prompt });
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: undefined });

    try {
      const response = await fetch('/api/parametric-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          sessionId: state.sessionId,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({ error: '生成失败' }));
        throw new Error(errorPayload.error || '生成失败');
      }

      const result = await response.json();
      dispatch({ type: 'SET_OPENSCAD_CODE', payload: result.openscadCode });
      dispatch({ type: 'SET_PARAMETERS', payload: result.parameters });
      if (result.sessionId) {
        dispatch({ type: 'SET_SESSION_ID', payload: result.sessionId });
      }

      await compileModel(result.openscadCode, result.parameters);
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : '未知错误' });
      dispatch({ type: 'SET_COMPILE_STATUS', payload: 'error' });
      dispatch({ type: 'SET_COMPILE_PROGRESS', payload: 0 });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '生成失败' });
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [compileModel, dispatch, state.sessionId]);

  const handleParameterChange = useCallback(async (parameters: Record<string, any>) => {
    dispatch({ type: 'SET_PARAMETERS', payload: parameters });

    if (!state.openscadCode) {
      return;
    }

    await compileModel(state.openscadCode, parameters);
  }, [compileModel, dispatch, state.openscadCode]);

  const handleRetry = useCallback(async () => {
    if (!state.openscadCode) {
      return;
    }
    await compileModel(state.openscadCode, state.parameters);
  }, [compileModel, state.openscadCode, state.parameters]);

  const handleFix = useCallback(() => {
    dispatch({ type: 'SET_ERROR', payload: '一键修复已预留，下一阶段接入 AI 自动修复。' });
  }, [dispatch]);

  return {
    handleGenerate,
    handleParameterChange,
    handleRetry,
    handleFix,
  };
}
