import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import type { AppAction, AppState } from '../modules/state-session/StateSession';

type AppDispatch = Dispatch<AppAction>;

interface UseScadWorkflowOptions {
  state: AppState;
  dispatch: AppDispatch;
}

function parseScalarValue(rawValue: string): string | number | boolean {
  const normalized = rawValue.trim();

  if (/^-?\d*\.?\d+$/.test(normalized)) {
    return Number.parseFloat(normalized);
  }

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  const quoted = normalized.match(/^(["'])(.*)\1$/);
  if (quoted) {
    return quoted[2];
  }

  return normalized;
}

function extractTopLevelParameters(code: string): Record<string, any> {
  const nextParameters: Record<string, any> = {};
  const declarationRegex = /^\s*([A-Za-z_]\w*)\s*=\s*([^;]+);\s*$/;

  for (const line of code.split('\n')) {
    const match = line.match(declarationRegex);
    if (!match) {
      continue;
    }

    const [, name, rawValue] = match;
    nextParameters[name] = parseScalarValue(rawValue);
  }

  return nextParameters;
}

function toOpenSCADLiteral(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  const escaped = String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function syncCodeWithParameters(code: string, parameters: Record<string, any>): string {
  if (!code.trim()) {
    return code;
  }

  const declarationRegex = /^(\s*)([A-Za-z_]\w*)(\s*=\s*)([^;]+)(;\s*)$/;
  const nextLines = code.split('\n').map((line) => {
    const match = line.match(declarationRegex);
    if (!match) {
      return line;
    }

    const [, indent, name, assign, existing, suffix] = match;
    if (!(name in parameters)) {
      return line;
    }

    const nextValue = toOpenSCADLiteral(parameters[name]);
    if (existing.trim() === nextValue) {
      return line;
    }

    return `${indent}${name}${assign}${nextValue}${suffix}`;
  });

  return nextLines.join('\n');
}

export function useScadWorkflow({ state, dispatch }: UseScadWorkflowOptions) {
  const compileAbortRef = useRef<AbortController | null>(null);
  const compileSeqRef = useRef(0);
  const codeEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 始终指向最新 state，消除 setTimeout 回调中的旧闭包问题
  const stateRef = useRef(state);
  stateRef.current = state;

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

      const result = await response.json().catch(() => null);

      if (result && Object.prototype.hasOwnProperty.call(result, 'openscadCode')) {
        dispatch({ type: 'SET_OPENSCAD_CODE', payload: result.openscadCode });
      }

      if (result && Object.prototype.hasOwnProperty.call(result, 'parameters') && typeof result.parameters === 'object') {
        dispatch({ type: 'SET_PARAMETERS', payload: result.parameters });
      }

      if (result?.sessionId) {
        dispatch({ type: 'SET_SESSION_ID', payload: result.sessionId });
      }

      if (!response.ok) {
        throw new Error(result?.error || '生成失败');
      }

      await compileModel(result.compilableCode || result.openscadCode, result.parameters);
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
    const nextCode = syncCodeWithParameters(state.openscadCode, parameters);
    if (nextCode !== state.openscadCode) {
      dispatch({ type: 'SET_OPENSCAD_CODE', payload: nextCode });
    }

    if (!state.openscadCode) {
      return;
    }

    await compileModel(nextCode, parameters);
  }, [compileModel, dispatch, state.openscadCode]);

  const handleCodeChange = useCallback((openscadCode: string) => {
    dispatch({ type: 'SET_OPENSCAD_CODE', payload: openscadCode });

    // 立即提取参数并同步参数面板，不等待防抖——保证每次按键参数控制都实时更新
    const extractedParameters = extractTopLevelParameters(openscadCode);
    if (Object.keys(extractedParameters).length > 0) {
      dispatch({ type: 'SET_PARAMETERS', payload: extractedParameters });
    }

    // 防抖：只对编译请求做节流，避免每个按键都触发一次服务端编译
    if (codeEditTimerRef.current) {
      clearTimeout(codeEditTimerRef.current);
    }

    // 在错误态下加快重编译反馈，减少“改完代码没反应”的体感。
    const debounceMs = stateRef.current.compileStatus === 'error' ? 180 : 500;

    codeEditTimerRef.current = setTimeout(async () => {
      const latestExtracted = extractTopLevelParameters(openscadCode);
      const paramsForCompile = Object.keys(latestExtracted).length > 0
        ? latestExtracted
        : stateRef.current.parameters;
      await compileModel(openscadCode, paramsForCompile);
    }, debounceMs);
  }, [compileModel, dispatch]);

  const handleCompileNow = useCallback(async () => {
    if (codeEditTimerRef.current) {
      clearTimeout(codeEditTimerRef.current);
      codeEditTimerRef.current = null;
    }

    const currentCode = stateRef.current.openscadCode;
    if (!currentCode.trim()) {
      return;
    }

    const latestExtracted = extractTopLevelParameters(currentCode);
    const paramsForCompile = Object.keys(latestExtracted).length > 0
      ? latestExtracted
      : stateRef.current.parameters;

    if (Object.keys(latestExtracted).length > 0) {
      dispatch({ type: 'SET_PARAMETERS', payload: latestExtracted });
    }

    await compileModel(currentCode, paramsForCompile);
  }, [compileModel, dispatch]);

  const handleRetry = useCallback(async () => {
    if (!state.openscadCode) {
      return;
    }
    await compileModel(state.openscadCode, state.parameters);
  }, [compileModel, state.openscadCode, state.parameters]);

  const handleFix = useCallback(() => {
    dispatch({ type: 'SET_ERROR', payload: '一键修复已预留，下一阶段接入 AI 自动修复。' });
  }, [dispatch]);

  const handleCloseError = useCallback(() => {
    dispatch({ type: 'CLEAR_COMPILE_ERROR' });
  }, [dispatch]);

  return {
    handleGenerate,
    handleParameterChange,
    handleCodeChange,
    handleCompileNow,
    handleRetry,
    handleFix,
    handleCloseError,
  };
}
