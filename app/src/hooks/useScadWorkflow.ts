import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import type { AppAction, AppState } from '../modules/state-session/StateSession';
import { buildGenerateReadyFullResponse, fetchBlockExplainsBySegId } from '../utils/pendingDiffExplain';

type AppDispatch = Dispatch<AppAction>;

interface UseScadWorkflowOptions {
  state: AppState;
  dispatch: AppDispatch;
}

interface CSGTreeResult {
  success: boolean;
  text?: string;
  error?: string;
}

export interface GenerateChatResult {
  success: boolean;
  fullResponse: string;
}

export interface GenerateRequestPayload {
  prompt: string;
  /** 与 /design-spec 一致的前置摘要；传入（含空串）可避免服务端重复跑简报 */
  productBrief?: string;
  /** 有值时表示在现有代码上按 prompt 修订 */
  baseOpenscadCode?: string;
}

function normalizeGenerateInput(input: string | GenerateRequestPayload): GenerateRequestPayload {
  if (typeof input === 'string') {
    return { prompt: input };
  }
  return input;
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

function isTimeoutLikeText(text: string) {
  return /超时|timed out|timeout|time out/i.test(text);
}

function isRateLimitLikeText(text: string) {
  return /429|rate limit|rate-limit|too many requests|RPM/i.test(text);
}

function buildTimeoutAnalysisMessage(errorText: string) {
  const sanitized = errorText.trim();
  return [
    '⏱️ 响应超时，请稍后重试。',
    sanitized ? `（详情：${sanitized}）` : '',
    '',
    '可能原因：',
    '- 网络波动或代理导致请求返回变慢',
    '- 后端 AI 调用/推理耗时较长（请求可能在内部排队）',
    '- 请求内容较长或较复杂，推理成本更高',
    '',
    '等待建议：',
    '- 先稍等 30-60 秒后再发一次',
    '- 必要时把需求拆成“主体/尺寸/孔位/参数化变量”分步骤确认',
  ].filter(Boolean).join('\n');
}

function buildRateLimitAnalysisMessage(errorText: string) {
  const sanitized = errorText.trim();
  return [
    '⛔ 请求被限流（429：RPM/频率限制），请稍后重试。',
    sanitized ? `（详情：${sanitized}）` : '',
    '',
    '可能原因：',
    '- 短时间内请求太频繁（超过每分钟请求数 RPM）',
    '- 后端触发了多次 AI 调用（连续生成/反复确认）',
    '',
    '等待建议：',
    '- 先等待 30-120 秒后再试，降低触发频率',
    '- 将操作合并为一次请求（例如一次输入完整需求）',
  ].filter(Boolean).join('\n');
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
    dispatch({ type: 'ADD_AI_PROGRESS', payload: '已进入编译队列' });
    dispatch({ type: 'SET_COMPILE_ERROR_DETAIL', payload: undefined });
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: undefined });

    try {
      dispatch({ type: 'SET_COMPILE_STATUS', payload: 'running' });
      dispatch({ type: 'SET_COMPILE_PROGRESS', payload: 35 });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '正在调用 OpenSCAD 编译' });
      dispatch({ type: 'ADD_AI_PROGRESS', payload: '正在调用 OpenSCAD 编译' });

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
      dispatch({ type: 'ADD_AI_PROGRESS', payload: '已返回 STL，正在加载渲染' });
      const stlBuffer = await response.arrayBuffer();

      if (requestId !== compileSeqRef.current || controller.signal.aborted) {
        return;
      }

      dispatch({ type: 'SET_STL_DATA', payload: stlBuffer });
      dispatch({ type: 'SET_COMPILE_STATUS', payload: 'success' });
      dispatch({ type: 'SET_COMPILE_PROGRESS', payload: 100 });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '编译完成' });
      dispatch({ type: 'ADD_AI_PROGRESS', payload: '编译完成，模型预览已更新' });
    } catch (error) {
      if (controller.signal.aborted || requestId !== compileSeqRef.current) {
        return;
      }
      dispatch({ type: 'SET_COMPILE_STATUS', payload: 'error' });
      dispatch({ type: 'SET_COMPILE_PROGRESS', payload: 0 });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '编译失败' });
      dispatch({ type: 'ADD_AI_PROGRESS', payload: '编译失败，请检查代码或点击自动修复' });
      dispatch({ type: 'SET_COMPILE_ERROR_DETAIL', payload: error instanceof Error ? error.message : '未知错误' });
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : '未知错误' });
    } finally {
      if (requestId === compileSeqRef.current) {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }
  }, [dispatch]);

  const acceptPendingCode = useCallback(async (mergedCode?: string): Promise<boolean> => {
    const pending = stateRef.current.pendingCodeReview;
    if (!pending) {
      dispatch({
        type: 'ADD_AI_PROGRESS',
        payload: '未能应用合并：审阅已结束或已失效，请重新生成代码后再试。',
      });
      dispatch({
        type: 'SET_COMPILE_MESSAGE',
        payload: '未能应用合并（审阅已失效）',
      });
      return false;
    }

    const finalCode = mergedCode !== undefined ? mergedCode : pending.proposedCode;
    const extracted = extractTopLevelParameters(finalCode);
    const params =
      Object.keys(extracted).length > 0 ? extracted : pending.proposedParameters;

    dispatch({ type: 'SET_OPENSCAD_CODE', payload: finalCode });
    dispatch({ type: 'SET_PARAMETERS', payload: params });
    dispatch({ type: 'CLEAR_PENDING_CODE_REVIEW' });
    await compileModel(finalCode, params);
    return true;
  }, [compileModel, dispatch]);

  const rejectPendingCode = useCallback(() => {
    dispatch({ type: 'CLEAR_PENDING_CODE_REVIEW' });
    dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '已放弃本次 AI 代码，保留编辑器中的当前版本' });
  }, [dispatch]);

  const handleGenerate = useCallback(async (input: string | GenerateRequestPayload): Promise<GenerateChatResult> => {
    const { prompt, productBrief, baseOpenscadCode } = normalizeGenerateInput(input);
    const isRevision = Boolean(baseOpenscadCode?.trim());

    dispatch({ type: 'CLEAR_PENDING_CODE_REVIEW' });
    dispatch({ type: 'CLEAR_AI_PROGRESS' });
    dispatch({
      type: 'ADD_AI_PROGRESS',
      payload: isRevision
        ? '正在根据修改意见更新模型代码（请稍候，最长约 2 分钟；若超时请稍后重试）'
        : '请求已发送，正在生成参数化代码（请稍候，最长约 2 分钟；若超时请稍后重试）',
    });
    dispatch({ type: 'SET_PROMPT', payload: prompt });
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: undefined });

    const snapshotBefore = stateRef.current.openscadCode;

    try {
      const response = await fetch('/api/parametric-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          sessionId: state.sessionId,
          ...(productBrief !== undefined ? { productBrief } : {}),
          ...(baseOpenscadCode?.trim() ? { baseOpenscadCode: baseOpenscadCode.trim() } : {}),
        }),
      });

      const result = await response.json().catch(() => null);

      if (result?.sessionId) {
        dispatch({ type: 'SET_SESSION_ID', payload: result.sessionId });
      }

      if (!response.ok) {
        throw new Error(result?.error || '生成失败');
      }

      const proposedRaw = typeof result?.openscadCode === 'string' ? result.openscadCode : '';
      if (!proposedRaw.trim()) {
        dispatch({ type: 'SET_LOADING', payload: false });
        return {
          success: false,
          fullResponse: '生成未返回有效代码。',
        };
      }

      if (!isRevision && typeof result?.productBrief === 'string' && result.productBrief.trim()) {
        dispatch({ type: 'ADD_AI_PROGRESS', payload: '推理摘要已完成，正在整理可编译代码' });
      }

      dispatch({ type: 'ADD_AI_PROGRESS', payload: '代码已生成，正在分析各修改块功能说明…' });

      const compilable =
        typeof result?.compilableCode === 'string' && result.compilableCode.trim()
          ? result.compilableCode
          : proposedRaw;
      const proposedParameters =
        result && Object.prototype.hasOwnProperty.call(result, 'parameters') && typeof result.parameters === 'object'
          ? result.parameters
          : {};

      const { bySegId, fromApi, segments } = await fetchBlockExplainsBySegId(snapshotBefore, proposedRaw);

      dispatch({
        type: 'SET_PENDING_CODE_REVIEW',
        payload: {
          previousCode: snapshotBefore,
          proposedCode: proposedRaw,
          compilableCode: compilable,
          proposedParameters,
          source: 'generate',
          blockExplainsBySegId: bySegId,
          blockExplainsFromApi: fromApi,
        },
      });

      dispatch({ type: 'SET_LOADING', payload: false });

      const fullResponse = buildGenerateReadyFullResponse(segments, bySegId, fromApi);

      return {
        success: true,
        fullResponse,
      };
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '未知错误';
      const rateLimitFriendly = isRateLimitLikeText(errorText) ? buildRateLimitAnalysisMessage(errorText) : undefined;
      const timeoutFriendly = isTimeoutLikeText(errorText) ? buildTimeoutAnalysisMessage(errorText) : errorText;
      const finalFriendly = rateLimitFriendly || timeoutFriendly;

      dispatch({ type: 'SET_ERROR', payload: finalFriendly });
      dispatch({ type: 'SET_COMPILE_STATUS', payload: 'error' });
      dispatch({ type: 'SET_COMPILE_PROGRESS', payload: 0 });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '生成失败' });
      dispatch({
        type: 'ADD_AI_PROGRESS',
        payload: rateLimitFriendly || (isTimeoutLikeText(errorText) ? timeoutFriendly : `生成失败：${errorText}`),
      });
      dispatch({ type: 'SET_LOADING', payload: false });

      return {
        success: false,
        fullResponse: finalFriendly,
      };
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

  const handleFix = useCallback(async () => {
    const pushEngineerEvent = (stage: string, message: string) => {
      dispatch({ type: 'ADD_AI_PROGRESS', payload: `ENGINEER|${stage}|${message}` });
    };

    const currentCode = stateRef.current.openscadCode;
    if (!currentCode.trim()) {
      dispatch({ type: 'SET_ERROR', payload: '当前没有可修复的 OpenSCAD 代码。' });
      return;
    }

    dispatch({ type: 'CLEAR_PENDING_CODE_REVIEW' });
    pushEngineerEvent('start', '实习生已接手修复，我先快速过一遍当前代码和报错。');
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: undefined });
    dispatch({ type: 'SET_COMPILE_MESSAGE', payload: 'AI 正在修复代码' });
    pushEngineerEvent('analysis', '正在定位问题根因，准备生成最小修改补丁。');

    const snapshotBefore = currentCode;

    try {
      const response = await fetch('/api/parametric-chat/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openscadCode: currentCode,
          compileError: stateRef.current.compileErrorDetail || stateRef.current.error,
          sessionId: stateRef.current.sessionId,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error || '自动修复失败');
      }

      const fixedCode = typeof result?.openscadCode === 'string' ? result.openscadCode : '';
      if (!fixedCode.trim()) {
        throw new Error('自动修复未返回有效代码');
      }

      pushEngineerEvent('patch', '修复结果已生成，请在右侧代码区查看差异并选择保留或放弃。');

      const compilable =
        typeof result?.compilableCode === 'string' && result.compilableCode.trim()
          ? result.compilableCode
          : fixedCode;
      const proposedParameters =
        result && Object.prototype.hasOwnProperty.call(result, 'parameters') && typeof result.parameters === 'object'
          ? result.parameters
          : stateRef.current.parameters;

      if (result?.sessionId) {
        dispatch({ type: 'SET_SESSION_ID', payload: result.sessionId });
      }

      dispatch({
        type: 'SET_PENDING_CODE_REVIEW',
        payload: {
          previousCode: snapshotBefore,
          proposedCode: fixedCode,
          compilableCode: compilable,
          proposedParameters,
          source: 'fix',
        },
      });

      dispatch({ type: 'SET_LOADING', payload: false });
      pushEngineerEvent('done', '请在右侧确认变更后再编译预览。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '自动修复失败';
      pushEngineerEvent('failed', `这次修复没能成功：${message}。建议你调整代码后再点一次修复。`);
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : '自动修复失败' });
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [compileModel, dispatch]);

  const handleCloseError = useCallback(() => {
    dispatch({ type: 'CLEAR_COMPILE_ERROR' });
  }, [dispatch]);

  const downloadBlob = useCallback((data: BlobPart, contentType: string, fileName: string) => {
    const blob = new Blob([data], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const handleExportSTL = useCallback(async () => {
    const currentCode = stateRef.current.openscadCode;
    if (!currentCode.trim()) {
      dispatch({ type: 'SET_ERROR', payload: '当前没有可导出的 OpenSCAD 代码。' });
      return;
    }

    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: undefined });
    dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '正在导出 STL 文件' });

    try {
      const response = await fetch('/api/parametric-chat/export/stl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openscadCode: currentCode,
          parameters: stateRef.current.parameters,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({ error: '导出 STL 失败' }));
        throw new Error(errorPayload.error || '导出 STL 失败');
      }

      const stlBuffer = await response.arrayBuffer();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadBlob(stlBuffer, 'model/stl', `model-${timestamp}.stl`);
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: 'STL 导出完成' });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : '导出 STL 失败' });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '导出 STL 失败' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [dispatch, downloadBlob]);

  const handleViewCSGTree = useCallback(async (): Promise<CSGTreeResult> => {
    const currentCode = stateRef.current.openscadCode;
    if (!currentCode.trim()) {
      const message = '当前没有可展示的 OpenSCAD 代码。';
      dispatch({ type: 'SET_ERROR', payload: message });
      return { success: false, error: message };
    }

    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: undefined });
    dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '正在生成 CSG 树' });

    try {
      const response = await fetch('/api/parametric-chat/export/csg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openscadCode: currentCode,
          parameters: stateRef.current.parameters,
        }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('CSG 树接口不存在（404）。请重启后端服务并确认已运行最新代码。');
        }
        const errorPayload = await response.json().catch(() => ({ error: '获取 CSG 树失败' }));
        const errorText = errorPayload.error || '获取 CSG 树失败';
        throw new Error(errorText);
      }

      const csgText = await response.text();
      if (!csgText.trim()) {
        throw new Error('OpenSCAD 返回了空的 CSG 内容，请检查模型或 OpenSCAD 版本是否支持 CSG 导出。');
      }

      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: 'CSG 树已更新' });
      return { success: true, text: csgText };
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '获取 CSG 树失败';
      dispatch({ type: 'SET_ERROR', payload: errorText });
      dispatch({ type: 'SET_COMPILE_MESSAGE', payload: '获取 CSG 树失败' });
      return { success: false, error: errorText };
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [dispatch]);

  const handleDirectCode = useCallback(async (code: string, parameters?: Record<string, any>) => {
    dispatch({ type: 'CLEAR_PENDING_CODE_REVIEW' });
    dispatch({ type: 'CLEAR_AI_PROGRESS' });
    dispatch({ type: 'ADD_AI_PROGRESS', payload: '已接收代码，正在准备审阅' });
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: undefined });

    const snapshotBefore = stateRef.current.openscadCode;

    try {
      const proposedParameters =
        parameters && Object.keys(parameters).length > 0
          ? parameters
          : extractTopLevelParameters(code);

      dispatch({
        type: 'SET_PENDING_CODE_REVIEW',
        payload: {
          previousCode: snapshotBefore,
          proposedCode: code,
          compilableCode: code,
          proposedParameters,
          source: 'direct',
        },
      });

      dispatch({ type: 'SET_LOADING', payload: false });
      dispatch({ type: 'ADD_AI_PROGRESS', payload: '请在右侧代码区查看差异并选择保留或放弃' });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '处理代码失败';
      dispatch({ type: 'SET_ERROR', payload: errorText });
      dispatch({ type: 'ADD_AI_PROGRESS', payload: `处理失败：${errorText}` });
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [dispatch]);

  return {
    handleGenerate,
    handleParameterChange,
    handleCodeChange,
    handleCompileNow,
    handleRetry,
    handleFix,
    handleCloseError,
    handleExportSTL,
    handleViewCSGTree,
    handleDirectCode,
    acceptPendingCode,
    rejectPendingCode,
  };
}
