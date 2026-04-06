import React, { useEffect, useRef, useState } from 'react';
import type { GenerateChatResult, GenerateRequestPayload } from '../../hooks/useScadWorkflow';
import { ChatMarkdownBody, SpecMarkdownBody } from './MarkdownRichText';

interface PromptInputProps {
  onGenerate: (input: string | GenerateRequestPayload) => Promise<GenerateChatResult>;
  onDirectCode?: (code: string, parameters?: Record<string, any>) => Promise<void>;
  isLoading: boolean;
  progressTrail: string[];
  /** 与后端 WebSocket / 会话一致 */
  sessionId?: string;
  /** 工作区当前代码：非空时后续输入走「快速修订」 */
  currentOpenscadCode?: string;
  /** 右侧「应用合并」成功后注入会话区（key 每次变化追加一条） */
  workspaceChatInjection?: { key: number; text: string } | null;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'engineer';
  content: string;
  timestamp: string;
  type?: 'text' | 'progress' | 'waiting' | 'spec'; // spec = 建模方案（参数与特点）
  isConfirmationMarker?: boolean;
  agentRole?: 'product_manager' | 'intern' | 'master'; // 智能体角色，用于显示对应头像
  action?: 'confirm-first-generate';
}

interface PendingFirstGenerate {
  promptText: string;
  brief: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface RequirementConfirmResult {
  pmResponse?: string;
  isNeedMoreInfo?: boolean;
  isClear?: boolean;
  shouldGenerate?: boolean;
  confirmedRequirement?: string;
  responderRole?: 'product_manager' | 'intern' | 'master';
  error?: string;
  openscadCode?: string;
  parameters?: Record<string, any>;
}

interface RuntimeModels {
  productManagerModel: string;
  firstCodegenModel: string;
  revisionCodegenModel: string;
  codegenModel: string;
  internModel: string;
  kimiFixModel: string;
}

const DEFAULT_RUNTIME_MODELS: RuntimeModels = {
  productManagerModel: 'moonshotai/kimi-k2.5',
  firstCodegenModel: 'claude-4.5-sonnet',
  revisionCodegenModel: 'claude-4.5-sonnet',
  codegenModel: 'claude-4.5-sonnet',
  internModel: 'deepseek/deepseek-v3.2-251201',
  kimiFixModel: 'moonshotai/kimi-k2.5',
};

type SummonAgentRole = 'product_manager' | 'intern' | 'master';

/** 顶部按钮对应的 @ 标签与对外岗位名（与后端 detectMention 一致） */
const SUMMON_AGENTS: { role: SummonAgentRole; tag: string; label: string }[] = [
  { role: 'product_manager', tag: '@产品经理 ', label: '产品经理' },
  { role: 'intern', tag: '@实习生 ', label: '实习生' },
  { role: 'master', tag: '@老师傅 ', label: '老师傅' },
];

/** 代码将进右侧审阅区时，左侧只显示提醒，避免与右侧差异/说明重复贴整段代码 */
const DIRECT_CODE_PENDING_REVIEW_REMINDER =
  '✅ 代码已提交到右侧审阅区。**请在右侧查看增删差异与各块说明**，确认后再点「应用合并」。';

/** 与后端 detectMention 一致：含此类标记时仍走对话/路由，而非直连生成 */
function mentionsAssistant(input: string): boolean {
  return /@产品经理|@需求顾问|@pm|@product.?manager|@小k|@老师傅|@代码生成|@master|@craftsman|@实习生|@代码助手|@intern|@apprentice/i.test(
    input
  );
}

/** 解析当前输入里优先出现的 @ 岗位（用于按钮高亮与忙碌动画） */
function detectLocalMentionRole(text: string): SummonAgentRole | null {
  const normalized = text.toLowerCase();
  if (/@产品经理|@需求顾问|@pm|@product.?manager|@小k/.test(normalized)) {
    return 'product_manager';
  }
  if (/@实习生|@代码助手|@intern|@apprentice/.test(normalized)) {
    return 'intern';
  }
  if (/@老师傅|@代码生成|@master|@craftsman/.test(normalized)) {
    return 'master';
  }
  return null;
}

// Prompt 输入模块：负责收集需求文本并触发生成。
export const PromptInput: React.FC<PromptInputProps> = ({
  onGenerate,
  onDirectCode,
  isLoading,
  progressTrail,
  sessionId,
  currentOpenscadCode = '',
  workspaceChatInjection = null,
}) => {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '你好，我是 OpenSCAD 助手。描述模型后：先自动整理「参数与特点」方案供你确认理解，再生成可编译的参数化示例代码；右侧可继续调参。若已有模型，直接发修改意见（如「高度改成 30」）可快速改代码。需要聊天澄清请用 @产品经理、@实习生、@老师傅（也可点上方按钮插入）。',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [isRequirementConfirmed, setIsRequirementConfirmed] = useState(false);
  const [isConfirmingMode, setIsConfirmingMode] = useState(false);
  const [confirmedRequirement, setConfirmedRequirement] = useState('');
  /** 与最近一次 design-spec 一致，修订时带给后端 */
  const [lastProductBrief, setLastProductBrief] = useState('');
  /** 首次流程：方案已确认，等待用户点击按钮后再生成代码 */
  const [pendingFirstGenerate, setPendingFirstGenerate] = useState<PendingFirstGenerate | null>(null);
  /** 当前正在响应的岗位（对话接口或生成链路），用于顶部按钮动画 */
  const [busyAgentRole, setBusyAgentRole] = useState<SummonAgentRole | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingMessageIdRef = useRef<string | null>(null);
  const lastProgressCountRef = useRef<number>(0);
  const engineerProgressCursorRef = useRef<number>(0);
  const lastWorkspaceChatInjectKeyRef = useRef<number | null>(null);
  const runtimeModelsRef = useRef<RuntimeModels>(DEFAULT_RUNTIME_MODELS);

  const makeTimestamp = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const fetchRuntimeModels = React.useCallback(async (): Promise<RuntimeModels> => {
    try {
      const response = await fetch('/api/parametric-chat/runtime-models', { method: 'GET' });
      if (!response.ok) {
        return runtimeModelsRef.current;
      }

      const json = (await response.json()) as Partial<RuntimeModels>;
      const next: RuntimeModels = {
        productManagerModel: typeof json.productManagerModel === 'string' && json.productManagerModel.trim()
          ? json.productManagerModel.trim()
          : runtimeModelsRef.current.productManagerModel,
        firstCodegenModel: typeof json.firstCodegenModel === 'string' && json.firstCodegenModel.trim()
          ? json.firstCodegenModel.trim()
          : runtimeModelsRef.current.firstCodegenModel,
        revisionCodegenModel: typeof json.revisionCodegenModel === 'string' && json.revisionCodegenModel.trim()
          ? json.revisionCodegenModel.trim()
          : runtimeModelsRef.current.revisionCodegenModel,
        codegenModel: typeof json.codegenModel === 'string' && json.codegenModel.trim()
          ? json.codegenModel.trim()
          : runtimeModelsRef.current.codegenModel,
        internModel: typeof json.internModel === 'string' && json.internModel.trim()
          ? json.internModel.trim()
          : runtimeModelsRef.current.internModel,
        kimiFixModel: typeof json.kimiFixModel === 'string' && json.kimiFixModel.trim()
          ? json.kimiFixModel.trim()
          : runtimeModelsRef.current.kimiFixModel,
      };

      runtimeModelsRef.current = next;
      return next;
    } catch {
      return runtimeModelsRef.current;
    }
  }, []);

  const getModelWaitingText = (modelName: string) =>
    `等待${modelName}模型...（请稍候，最长约 2 分钟，若超时请稍后重试）`;

  const insertSummonTag = (tag: string) => {
    setPrompt((prev) => (prev ? `${prev} ` : '') + tag);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) {
        return;
      }
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  };

  const parseEngineerEvent = (raw: string): { stage: string; message: string } | null => {
    if (!raw.startsWith('ENGINEER|')) {
      return null;
    }

    const firstSep = raw.indexOf('|');
    const secondSep = raw.indexOf('|', firstSep + 1);
    if (firstSep === -1 || secondSep === -1) {
      return null;
    }

    const stage = raw.slice(firstSep + 1, secondSep).trim();
    const message = raw.slice(secondSep + 1).trim();
    if (!message) {
      return null;
    }

    return { stage, message };
  };

  const getProgressDisplayText = (raw: string) => {
    const engineerEvent = parseEngineerEvent(raw);
    return engineerEvent ? engineerEvent.message : raw;
  };

  const isTimeoutLike = (text: string) => /超时|timed out|timeout|time out/i.test(text);
  const isRateLimitLike = (text: string) =>
    /429|rate limit|rate-limit|too many requests|RPM/i.test(text);
  const isLikelyScadCode = (text: string) => {
    const normalized = text.trim();
    if (!normalized) {
      return false;
    }

    // 兜底识别：确认链路中偶发“只在 pmResponse 里返回代码”时也能直达代码区。
    return /\b(cube|sphere|cylinder|translate|rotate|difference|union|intersection|linear_extrude|polygon)\s*\(/i.test(normalized)
      || /^[A-Za-z_]\w*\s*=\s*[^;\n]+;$/m.test(normalized);
  };

  const buildTimeoutAnalysisMessage = (errorText: string) => {
    const sanitized = errorText.trim();
    return [
      '⏱️ 响应超时，请稍后重试。',
      sanitized ? `（详情：${sanitized}）` : '',
      '',
      '可能原因：',
      '- 网络波动或代理导致请求返回变慢',
      '- 后端 AI 调用耗时较长（请求可能在内部排队）',
      '- 你的描述较复杂或较长，推理成本更高',
      '',
      '等待建议：',
      '- 先稍等 30-60 秒后再发一次',
      '- 必要时把需求拆成“主体/尺寸/孔位/参数化变量”分步骤确认',
    ].filter(Boolean).join('\n');
  };

  const buildRateLimitAnalysisMessage = (errorText: string) => {
    const sanitized = errorText.trim();
    return [
      '⛔ 请求被限流（429：RPM/频率限制），请稍后重试。',
      sanitized ? `（详情：${sanitized}）` : '',
      '',
      '可能原因：',
      '- 短时间内请求太频繁（超过每分钟请求数 RPM）',
      '- 后端触发了多次 AI 调用（例如连续生成/反复确认）',
      '',
      '等待建议：',
      '- 先等待 30-120 秒，降低触发频率后再试',
      '- 避免短时间连续多次点击“生成/修复”，可一次提交完整需求',
      '- 若你有多用户/多会话同时使用，建议错峰使用',
    ].filter(Boolean).join('\n');
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    void fetchRuntimeModels();
  }, [fetchRuntimeModels]);

  useEffect(() => {
    if (!workspaceChatInjection?.text?.trim()) {
      return;
    }
    const { key, text } = workspaceChatInjection;
    if (lastWorkspaceChatInjectKeyRef.current === key) {
      return;
    }
    lastWorkspaceChatInjectKeyRef.current = key;
    setMessages((prev) => [
      ...prev,
      {
        id: `workspace_inject_${key}`,
        role: 'assistant',
        content: text,
        timestamp: makeTimestamp(),
        type: 'text',
      },
    ]);
  }, [workspaceChatInjection]);

  useEffect(() => {
    if (progressTrail.length < engineerProgressCursorRef.current) {
      engineerProgressCursorRef.current = 0;
    }

    const startIndex = engineerProgressCursorRef.current;
    if (progressTrail.length <= startIndex) {
      return;
    }

    for (let i = startIndex; i < progressTrail.length; i++) {
      const engineerEvent = parseEngineerEvent(progressTrail[i]);
      if (!engineerEvent) {
        continue;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}_engineer_${engineerEvent.stage}_${i}`,
          role: 'engineer',
          content: engineerEvent.message,
          timestamp: makeTimestamp(),
          type: 'waiting',
        },
      ]);
    }

    engineerProgressCursorRef.current = progressTrail.length;
  }, [progressTrail]);

  useEffect(() => {
    const pendingId = pendingMessageIdRef.current;
    if (!pendingId || !isLoading) {
      lastProgressCountRef.current = 0;
      return;
    }

    // 检查是否有新的进度项需要添加
    const currentProgressCount = progressTrail.length;
    const lastProgressCount = lastProgressCountRef.current;

    if (currentProgressCount > lastProgressCount) {
      // 添加新的进度项
      for (let i = lastProgressCount; i < currentProgressCount; i++) {
        const progressItem = progressTrail[i];
        if (parseEngineerEvent(progressItem)) {
          continue;
        }
        const progressMessageId = `${pendingId}_progress_${i}`;
        
        setMessages((prev) => [
          ...prev,
          {
            id: progressMessageId,
            role: 'assistant',
            content: `${i + 1}. ${progressItem}`,
            timestamp: makeTimestamp(),
            type: 'progress',
          },
        ]);
      }
      lastProgressCountRef.current = currentProgressCount;
    }
  }, [isLoading, progressTrail]);

  // 处理需求确认对话
  const handleConfirmationChat = async (userInput: string) => {
    const localMentionRole = detectLocalMentionRole(userInput);
    setBusyAgentRole(localMentionRole ?? 'product_manager');
    const userMessage: ChatMessage = {
      id: `${Date.now()}_user`,
      role: 'user',
      content: userInput,
      timestamp: makeTimestamp(),
      type: 'text',
    };

    const pendingMessageId = `${Date.now()}_assistant_pending`;
    pendingMessageIdRef.current = pendingMessageId;

    // 添加用户消息到对话历史
    const newConversationHistory: ConversationMessage[] = [
      ...conversationHistory,
      { role: 'user', content: userInput },
    ];
    setConversationHistory(newConversationHistory);

    // 更新 UI 显示用户消息
    setMessages((prev) => [...prev, userMessage]);
    setPrompt('');

    // 立即插入“等待回复”提醒，避免用户误以为没有响应
    const runtimeModels = await fetchRuntimeModels();
    const hasExistingCode = Boolean((currentOpenscadCode || '').trim());
    const waitingContent = localMentionRole === 'master'
      ? getModelWaitingText(hasExistingCode ? runtimeModels.revisionCodegenModel : runtimeModels.firstCodegenModel)
      : localMentionRole === 'intern'
        ? getModelWaitingText(runtimeModels.internModel)
        : getModelWaitingText(runtimeModels.productManagerModel);

    const waitingMessage: ChatMessage = {
      id: pendingMessageId,
      role: 'assistant',
      content: waitingContent,
      timestamp: makeTimestamp(),
      type: 'waiting',
    };
    setMessages((prev) => [...prev, waitingMessage]);

    try {
      // 调用确认需求端点
      const response = await fetch('/api/parametric-chat/confirm-requirement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput,
          conversationHistory: newConversationHistory,
          currentOpenscadCode,
        }),
      });

      const result = await response.json() as RequirementConfirmResult;

      if (!response.ok) {
        throw new Error(result?.error || result?.pmResponse || '对话失败');
      }

      // 检查是否有确认标记
      const hasConfirmationMarker = result.pmResponse?.includes('【需求确认完成】');

      const responderRole = result.responderRole || 'product_manager';

      // 当后端直接返回代码时，优先直达代码区并触发编译。
      const directCode = (result.openscadCode || '').trim()
        || (
          responderRole !== 'product_manager' && isLikelyScadCode(result.pmResponse || '')
            ? (result.pmResponse || '').trim()
            : ''
        );

      const chatBubbleContent =
        directCode && onDirectCode
          ? DIRECT_CODE_PENDING_REVIEW_REMINDER
          : (result.pmResponse || '已收到你的信息，继续详细描述。');

      // 添加智能体回复（展示文案）；对话历史仍保存完整 pmResponse 供后续轮次使用
      const kimiMessage: ChatMessage = {
        id: `${pendingMessageId}_response`,
        role: responderRole === 'product_manager' ? 'assistant' : 'engineer',
        content: chatBubbleContent,
        timestamp: makeTimestamp(),
        type: 'text',
        isConfirmationMarker: hasConfirmationMarker,
        agentRole: responderRole,
      };

      // 移除“等待中”占位气泡，再追加最终回复
      setMessages((prev) => [...prev.filter((m) => m.id !== pendingMessageId), kimiMessage]);

      // 更新对话历史
      setConversationHistory((prev) => [
        ...prev,
        { role: 'assistant', content: result.pmResponse || '' },
      ]);

      if (result.confirmedRequirement && result.confirmedRequirement.trim()) {
        setConfirmedRequirement(result.confirmedRequirement.trim());
      }

      // 需求确认完成后进入“待生成”状态，但不自动生成。
      if (hasConfirmationMarker || result.isClear) {
        setIsRequirementConfirmed(true);
      }

      if (directCode) {
        setIsConfirmingMode(false);
        const codeToCompile = directCode;
        setBusyAgentRole(null);
        setTimeout(() => {
          if (onDirectCode) {
            void onDirectCode(codeToCompile, result.parameters);
          } else {
            void handleGenerateAfterConfirmation(codeToCompile);
          }
        }, 300);
        pendingMessageIdRef.current = null;
        return;
      }
      // 只有当 Kimi 明确发出“请Claude生成代码”信号时，才调用 Claude 生成。
      if (result.shouldGenerate) {
        setIsConfirmingMode(false);
        const generationPrompt = (result.confirmedRequirement && result.confirmedRequirement.trim())
          ? result.confirmedRequirement.trim()
          : buildRequirementSummary(newConversationHistory, result.pmResponse || '');
        setBusyAgentRole(null);
        setTimeout(() => {
          void handleGenerateAfterConfirmation(generationPrompt);
        }, 300);
      }

      setBusyAgentRole(null);
      pendingMessageIdRef.current = null;
    } catch (error) {
      setBusyAgentRole(null);
      const errorText = error instanceof Error ? error.message : String(error);
      const rateLimitMessage = isRateLimitLike(errorText) ? buildRateLimitAnalysisMessage(errorText) : undefined;
      const timeoutMessage = isTimeoutLike(errorText) ? buildTimeoutAnalysisMessage(errorText) : undefined;
      const finalMessage = rateLimitMessage || timeoutMessage || `❌ 对话出错：${errorText}`;

      const errorMessage: ChatMessage = {
        id: `${pendingMessageId}_error`,
        role: 'assistant',
        content: finalMessage,
        timestamp: makeTimestamp(),
        type: 'text',
      };

      // 移除“等待中”占位气泡，再追加错误提示
      setMessages((prev) => [...prev.filter((m) => m.id !== pendingMessageId), errorMessage]);
      pendingMessageIdRef.current = null;
    }
  };

  // 需求确认完成后进行代码生成
  const handleGenerateAfterConfirmation = async (generationPrompt: string) => {
    const pendingMessageId = `${Date.now()}_generate_pending`;
    pendingMessageIdRef.current = pendingMessageId;

    const runtimeModels = await fetchRuntimeModels();
    const waitingMessage: ChatMessage = {
      id: pendingMessageId,
      role: 'assistant',
      content: getModelWaitingText(runtimeModels.firstCodegenModel),
      timestamp: makeTimestamp(),
      type: 'waiting',
    };
    setMessages((prev) => [...prev, waitingMessage]);

    setBusyAgentRole('master');
    try {
      const generateResult = await onGenerate({ prompt: generationPrompt });
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== pendingMessageId),
        {
          id: `${pendingMessageId}_complete`,
          role: 'assistant',
          content: generateResult.fullResponse || (generateResult.success ? '✅ 模型生成完成！' : '❌ 模型生成失败，请重试。'),
          timestamp: makeTimestamp(),
          type: 'text',
        },
      ]);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const fallbackMessage: ChatMessage = {
        id: `${pendingMessageId}_error`,
        role: 'assistant',
        content: `❌ 生成失败：${errorText}`,
        timestamp: makeTimestamp(),
        type: 'text',
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== pendingMessageId), fallbackMessage]);
    } finally {
      setBusyAgentRole(null);
      pendingMessageIdRef.current = null;
    }
  };

  // 已有代码时：带方案摘要做快速修订（不再重复 design-spec）
  const handleRevisionGenerate = async (promptText: string) => {
    const baseCode = (currentOpenscadCode || '').trim();
    if (!baseCode) {
      await handlePlanThenGenerate(promptText);
      return;
    }

    const userMessage: ChatMessage = {
      id: `${Date.now()}_user`,
      role: 'user',
      content: promptText,
      timestamp: makeTimestamp(),
      type: 'text',
    };

    const pendingMessageId = `${Date.now()}_rev_pending`;
    pendingMessageIdRef.current = pendingMessageId;

    setMessages((prev) => [...prev, userMessage]);
    setPrompt('');

    const runtimeModels = await fetchRuntimeModels();

    const waitingMessage: ChatMessage = {
      id: pendingMessageId,
      role: 'assistant',
      content: getModelWaitingText(runtimeModels.revisionCodegenModel),
      timestamp: makeTimestamp(),
      type: 'waiting',
    };
    setMessages((prev) => [...prev, waitingMessage]);

    setBusyAgentRole('master');
    try {
      const generateResult = await onGenerate({
        prompt: promptText,
        productBrief: lastProductBrief,
        baseOpenscadCode: baseCode,
      });
      const assistantMessage: ChatMessage = {
        id: `${pendingMessageId}_response`,
        role: 'assistant',
        content:
          generateResult.fullResponse
          || (generateResult.success ? '✅ 已根据意见更新代码并尝试重新编译。' : '❌ 修订失败，请重试。'),
        timestamp: makeTimestamp(),
        type: 'text',
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== pendingMessageId), assistantMessage]);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const rateLimitMessage = isRateLimitLike(errorText) ? buildRateLimitAnalysisMessage(errorText) : undefined;
      const timeoutMessage = isTimeoutLike(errorText) ? buildTimeoutAnalysisMessage(errorText) : undefined;
      const finalMessage = rateLimitMessage || timeoutMessage || '❌ 修订失败，请重试。';
      const errorMessage: ChatMessage = {
        id: `${pendingMessageId}_error`,
        role: 'assistant',
        content: finalMessage,
        timestamp: makeTimestamp(),
        type: 'text',
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== pendingMessageId), errorMessage]);
    } finally {
      setBusyAgentRole(null);
      pendingMessageIdRef.current = null;
    }
  };

  // 首次流程：用户点击确认按钮后，才启动第一次代码生成
  const handleConfirmFirstGenerate = async (confirmMessageId: string) => {
    if (!pendingFirstGenerate) {
      return;
    }

    const { promptText, brief } = pendingFirstGenerate;
    setPendingFirstGenerate(null);

    const pendingCode = `${Date.now()}_code_pending`;
    pendingMessageIdRef.current = pendingCode;

    const runtimeModels = await fetchRuntimeModels();

    setMessages((prev) => [
      ...prev.filter((m) => m.id !== confirmMessageId),
      {
        id: pendingCode,
        role: 'assistant',
        content: getModelWaitingText(runtimeModels.firstCodegenModel),
        timestamp: makeTimestamp(),
        type: 'waiting',
      },
    ]);

    setBusyAgentRole('master');
    try {
      const generateResult = await onGenerate({ prompt: promptText, productBrief: brief });

      const assistantMessage: ChatMessage = {
        id: `${pendingCode}_response`,
        role: 'assistant',
        content:
          generateResult.fullResponse
          || (generateResult.success ? '✅ 代码已生成并尝试编译预览，可在右侧查看参数与预览。' : '❌ 生成失败，请重试。'),
        timestamp: makeTimestamp(),
        type: 'text',
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== pendingCode), assistantMessage]);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const rateLimitMessage = isRateLimitLike(errorText) ? buildRateLimitAnalysisMessage(errorText) : undefined;
      const timeoutMessage = isTimeoutLike(errorText) ? buildTimeoutAnalysisMessage(errorText) : undefined;
      const finalMessage = rateLimitMessage || timeoutMessage || '❌ 处理失败，请重试。';
      const errorMessage: ChatMessage = {
        id: `${pendingCode}_error`,
        role: 'assistant',
        content: finalMessage,
        timestamp: makeTimestamp(),
        type: 'text',
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== pendingCode), errorMessage]);
    } finally {
      setBusyAgentRole(null);
      pendingMessageIdRef.current = null;
    }
  };

  // 首次建模：先拉取方案摘要（参数与特点）→ 展示 → 再生成代码（避免重复跑简报）
  const handlePlanThenGenerate = async (promptText: string) => {
    const userMessage: ChatMessage = {
      id: `${Date.now()}_user`,
      role: 'user',
      content: promptText,
      timestamp: makeTimestamp(),
      type: 'text',
    };

    const pendingAnalyze = `${Date.now()}_plan_pending`;
    const specMessageId = `${pendingAnalyze}_spec`;
    pendingMessageIdRef.current = pendingAnalyze;

    setMessages((prev) => [...prev, userMessage]);
    setPrompt('');

    const runtimeModels = await fetchRuntimeModels();

    const waitingAnalyze: ChatMessage = {
      id: pendingAnalyze,
      role: 'assistant',
      content: getModelWaitingText(runtimeModels.productManagerModel),
      timestamp: makeTimestamp(),
      type: 'waiting',
    };
    setMessages((prev) => [...prev, waitingAnalyze]);

    setBusyAgentRole('master');
    try {
      const specRes = await fetch('/api/parametric-chat/design-spec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          ...(sessionId ? { sessionId } : {}),
        }),
      });
      const specJson = (await specRes.json()) as {
        productBrief?: string;
        error?: string;
        skipped?: boolean;
      };

      if (!specRes.ok) {
        throw new Error(specJson?.error || '方案解析失败');
      }

      const brief = (specJson.productBrief || '').trim();
      setLastProductBrief(brief);

      const specBody =
        brief
        || '（当前未开启需求拆解 PM_ENABLED=false，将直接按描述建模。可在 .env 中设置 PM_ENABLED=true 以启用「参数与特点」说明。）';

      const specMessage: ChatMessage = {
        id: specMessageId,
        role: 'assistant',
        content: specBody,
        timestamp: makeTimestamp(),
        type: 'spec',
      };

      setMessages((prev) => [...prev.filter((m) => m.id !== pendingAnalyze), specMessage]);

      const confirmMessage: ChatMessage = {
        id: `${pendingAnalyze}_confirm_first_codegen`,
        role: 'assistant',
        content: '方案已准备完成。点击下方按钮确认后，再开始第一次代码生成。',
        timestamp: makeTimestamp(),
        type: 'text',
        action: 'confirm-first-generate',
      };

      setPendingFirstGenerate({ promptText, brief });
      setMessages((prev) => [...prev, confirmMessage]);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const rateLimitMessage = isRateLimitLike(errorText) ? buildRateLimitAnalysisMessage(errorText) : undefined;
      const timeoutMessage = isTimeoutLike(errorText) ? buildTimeoutAnalysisMessage(errorText) : undefined;
      const finalMessage = rateLimitMessage || timeoutMessage || '❌ 处理失败，请重试。';
      const errorMessage: ChatMessage = {
        id: `${pendingAnalyze}_error`,
        role: 'assistant',
        content: finalMessage,
        timestamp: makeTimestamp(),
        type: 'text',
      };
      setMessages((prev) => [
        ...prev.filter(
          (m) =>
            m.id !== pendingAnalyze &&
            m.id !== specMessageId &&
            m.id !== `${pendingAnalyze}_confirm_first_codegen`,
        ),
        errorMessage,
      ]);
    } finally {
      setBusyAgentRole(null);
      pendingMessageIdRef.current = null;
    }
  };

  // 提交时做最小校验，避免空字符串请求。
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const promptText = prompt.trim();
    if (!promptText || isLoading) {
      return;
    }

    // @提及：仍走确认端点（产品经理对话或实习生/老师傅直出代码）
    if (mentionsAssistant(promptText)) {
      if (!isConfirmingMode && !isRequirementConfirmed) {
        setIsConfirmingMode(true);
      }
      await handleConfirmationChat(promptText);
      return;
    }

    // 已在多轮对话流程中（例如曾使用过 @产品经理）：后续输入继续走对话
    if (isConfirmingMode || isRequirementConfirmed) {
      await handleConfirmationChat(promptText);
      return;
    }

    const hasCode = Boolean((currentOpenscadCode || '').trim());
    if (hasCode) {
      await handleRevisionGenerate(promptText);
    } else {
      await handlePlanThenGenerate(promptText);
    }
  };

  const handleClear = () => {
    setPrompt('');
  };

  const handleClearMessages = () => {
    setMessages([
      {
        id: 'welcome_reset',
        role: 'assistant',
        content:
          '会话已清空。描述需求后将先展示参数与特点方案，再生成代码；已有模型时可发修改意见快速修订。需要聊天可用 @产品经理、@实习生、@老师傅（或点上方按钮）。',
        timestamp: makeTimestamp(),
      },
    ]);
    setConversationHistory([]);
    setIsRequirementConfirmed(false);
    setIsConfirmingMode(false);
    setConfirmedRequirement('');
    setLastProductBrief('');
    setPendingFirstGenerate(null);
    engineerProgressCursorRef.current = progressTrail.length;
  };

  const buildRequirementSummary = (history: ConversationMessage[], latestAssistantMessage: string): string => {
    const historyText = history
      .map((msg) => `${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}`)
      .join('\n');

    return [
      '以下是已确认的需求对话，请仅基于这些内容生成 OpenSCAD 代码：',
      historyText,
      latestAssistantMessage ? `\n助手最新回复：\n${latestAssistantMessage}` : '',
      confirmedRequirement ? `\n已提取最终需求：\n${confirmedRequirement}` : '',
    ].join('\n');
  };

  const isSummonBusy = busyAgentRole !== null || isLoading;
  const isSummonWorking = (role: SummonAgentRole) => busyAgentRole === role;

  return (
    <div className="prompt-input-module">
      {/* 对话栏头部 */}
      <div className="chat-header">
        <div className="header-left">
          <div className="header-title">
            <h3>🤖 模型生成助手</h3>
            <p>
              {isLoading
                ? `⏳ ${progressTrail.length > 0 ? getProgressDisplayText(progressTrail[progressTrail.length - 1]) : 'AI正在处理中...'}`
                : isConfirmingMode || isRequirementConfirmed
                  ? '💬 对话模式（@产品经理 / @实习生 / @老师傅 或下方按钮）；发送消息继续'
                  : '先展示方案（参数/特点），再生成代码；有模型后可直接发修改意见'}
            </p>
          </div>
          <div className="summon-row" role="toolbar" aria-label="召唤岗位">
            {SUMMON_AGENTS.map((a) => (
              <button
                key={a.role}
                type="button"
                className={`summon-btn summon-${a.role}${isSummonWorking(a.role) ? ' is-working' : ''}`}
                onClick={() => insertSummonTag(a.tag)}
                disabled={isSummonBusy}
                title={`插入 ${a.tag.trim()}，再输入你的说明并发送`}
              >
                <span className="summon-emoji" aria-hidden>
                  {a.role === 'product_manager' ? '💬' : a.role === 'intern' ? '🛠️' : '⚙️'}
                </span>
                <span className="summon-label">{a.label}</span>
                {isSummonWorking(a.role) && (
                  <span className="summon-dot" aria-hidden />
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="header-actions">
          {isLoading && (
            <div className="header-spinner">
              <svg viewBox="0 0 24 24" className="spinner" width="18" height="18">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          )}
          <button
            type="button"
            onClick={handleClearMessages}
            disabled={isLoading}
            className="icon-button clear-chat-btn"
            title="清空所有对话"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 消息展示面板 */}
      <div className="messages-container" aria-live="polite" aria-label="对话消息">
        <div className="messages-panel">
          {messages.map((message) => (
            <div 
              key={message.id} 
              className={`message-item ${message.role} ${message.type || 'text'}${message.type === 'spec' ? ' spec-message' : ''} ${message.isConfirmationMarker ? 'isConfirmationMarker' : ''}`}
              role={message.role === 'user' ? 'log' : 'status'}
            >
              {message.type !== 'progress' && message.type !== 'waiting' && (
                <div className={`message-avatar ${message.agentRole || ''}`}>
                  {message.role === 'user'
                    ? '👤'
                    : message.agentRole === 'product_manager'
                      ? '👩‍🎨'
                      : message.agentRole === 'intern'
                        ? '👨‍💻'
                        : message.agentRole === 'master'
                          ? '👨‍🔧'
                          : '🤖'}
                </div>
              )}
              <div className="message-content-wrap">
                <div className={`message-bubble${message.type === 'spec' ? ' spec-bubble' : ''}`}>
                  {message.type === 'spec' ? (
                    <>
                      <div className="spec-bubble-title">建模方案：参数与特点</div>
                      <SpecMarkdownBody source={message.content} />
                    </>
                  ) : (message.role === 'assistant' || message.role === 'engineer') &&
                    message.type !== 'progress' &&
                    message.type !== 'waiting' ? (
                    <ChatMarkdownBody source={message.content} />
                  ) : (
                    message.content
                  )}
                </div>
                {message.type !== 'progress' && (
                  <div className="message-meta">{message.timestamp}</div>
                )}
                {message.action === 'confirm-first-generate' && (
                  <div className="confirm-generate-row">
                    <button
                      type="button"
                      className="confirm-generate-btn"
                      disabled={isLoading || !pendingFirstGenerate}
                      onClick={() => {
                        void handleConfirmFirstGenerate(message.id);
                      }}
                    >
                      确认并生成代码
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} className="messages-end" />
        </div>
      </div>

      {/* 输入区域 */}
      <form onSubmit={handleSubmit} className={`input-form ${isLoading ? 'is-loading' : ''}`}>
        <div className="input-wrapper">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit(event);
              }
            }}
            placeholder={isConfirmingMode || isRequirementConfirmed
              ? '继续对话，或说明修改需求…（Shift+Enter 换行，Enter 发送）'
              : '描述需求：先出方案再生成代码；右侧已有模型时可发修改意见（Shift+Enter 换行）'}
            disabled={isLoading}
            className="message-input"
            rows={1}
          />
          <button
            type="submit"
            disabled={!prompt.trim() || isLoading}
            className="send-button"
            title={isLoading ? '生成中，请稍候' : '发送'}
          >
            {isLoading ? (
              <svg viewBox="0 0 24 24" className="spinner" width="16" height="16">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M16.6915026,12.4744748 L3.50612381,13.2599618 C3.19218622,13.2599618 3.03521743,13.4170592 3.03521743,13.5741566 L1.15159189,20.0151496 C0.8376543,20.8006365 0.99,21.89 1.77946707,22.52 C2.40,22.99 3.50612381,23.1 4.13399899,22.8429026 L21.714504,14.0454487 C22.6563168,13.5741566 23.1272231,12.6315722 22.9702544,11.6889879 L4.13399899,1.16398164 C3.34915502,0.9 2.40734225,1.00636533 1.77946707,1.4776575 C0.994623095,2.10604706 0.837654326,3.0486314 1.15159189,3.99701575 L3.03521743,10.4380088 C3.03521743,10.5950943 3.34915502,10.7521917 3.50612381,10.7521917 L16.6915026,11.5376786 C16.6915026,11.5376786 17.1624089,11.5376786 17.1624089,12.0089707 C17.1624089,12.4744748 16.6915026,12.4744748 16.6915026,12.4744748 Z"/>
              </svg>
            )}
          </button>
        </div>
        <div className="input-footer">
        </div>
      </form>
      
      <style>{`
        .prompt-input-module {
          --panel-bg: linear-gradient(165deg, #fbfcff 0%, #f2f6ff 46%, #eef4ff 100%);
          --brand: #1864ab;
          --brand-strong: #0f4c81;
          --brand-soft: #d8ebff;
          --ink: #172033;
          --muted: #61708b;
          --line: #d2dfef;

          background: var(--panel-bg);
          border-radius: 16px;
          border: 1px solid var(--line);
          box-shadow: 0 16px 34px rgba(15, 45, 78, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.75);
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          position: relative;
          font-family: "Space Grotesk", "Avenir Next", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
        }

        .prompt-input-module::before {
          content: "";
          position: absolute;
          top: -140px;
          right: -110px;
          width: 320px;
          height: 320px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(122, 193, 255, 0.36) 0%, rgba(122, 193, 255, 0.04) 62%, transparent 100%);
          pointer-events: none;
          z-index: 0;
        }

        .chat-header,
        .messages-container,
        .input-form {
          position: relative;
          z-index: 1;
        }

        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          padding: 14px 16px 12px;
          border-bottom: 1px solid rgba(24, 100, 171, 0.14);
          background: linear-gradient(90deg, rgba(24, 100, 171, 0.92) 0%, rgba(39, 126, 201, 0.9) 42%, rgba(84, 168, 230, 0.92) 100%);
          color: #f8fbff;
          backdrop-filter: blur(6px);
        }

        .header-left {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .summon-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }

        .summon-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 11px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.42);
          background: rgba(255, 255, 255, 0.12);
          color: #f8fbff;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
          position: relative;
        }

        .summon-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.22);
          transform: translateY(-1px);
        }

        .summon-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .summon-btn .summon-emoji {
          font-size: 14px;
          line-height: 1;
        }

        .summon-btn .summon-label {
          letter-spacing: 0.2px;
          white-space: nowrap;
        }

        .summon-btn .summon-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #7bed9f;
          box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35);
          animation: summonDotPulse 0.9s ease-in-out infinite;
        }

        .summon-btn.is-working {
          animation: summonBtnPulse 1.25s ease-in-out infinite;
          box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35), 0 4px 14px rgba(0, 0, 0, 0.12);
        }

        @keyframes summonBtnPulse {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.12); }
        }

        @keyframes summonDotPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.65; transform: scale(0.92); }
        }

        .header-title h3 {
          margin: 0;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.2px;
        }

        .header-title p {
          margin: 2px 0 0;
          font-size: 12px;
          opacity: 0.9;
          line-height: 1.2;
          min-height: 14px;
        }

        .header-spinner {
          display: flex;
          align-items: center;
          justify-content: center;
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }

        .header-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .icon-button {
          border: 1px solid rgba(255, 255, 255, 0.46);
          border-radius: 10px;
          padding: 6px 9px;
          color: #f8fbff;
          background: rgba(255, 255, 255, 0.1);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease;
          font-size: 0;
        }

        .icon-button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.2);
          border-color: rgba(255, 255, 255, 0.75);
          transform: translateY(-1px);
        }

        .icon-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .messages-container {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .messages-panel {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.62) 0%, rgba(255, 255, 255, 0.78) 100%),
            radial-gradient(circle at 18% 12%, rgba(202, 232, 255, 0.55) 0%, transparent 46%);
        }

        .messages-panel::-webkit-scrollbar {
          width: 8px;
        }

        .messages-panel::-webkit-scrollbar-track {
          background: transparent;
        }

        .messages-panel::-webkit-scrollbar-thumb {
          border-radius: 10px;
          background: rgba(96, 140, 183, 0.45);
        }

        .messages-panel::-webkit-scrollbar-thumb:hover {
          background: rgba(70, 122, 172, 0.65);
        }

        .messages-end {
          height: 0;
        }

        .message-item {
          display: flex;
          gap: 10px;
          animation: slideIn 0.26s ease-out;
        }

        .message-item.user {
          flex-direction: row-reverse;
        }

        .message-avatar {
          width: 30px;
          height: 30px;
          flex-shrink: 0;
          border-radius: 10px;
          font-size: 17px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.72);
          border: 1px solid rgba(24, 100, 171, 0.16);
          box-shadow: 0 4px 12px rgba(23, 35, 62, 0.08);
        }

        /* 产品经理头像 */
        .message-avatar.product_manager {
          background: linear-gradient(135deg, #ffe4ec 0%, #ffcce0 100%);
          border-color: rgba(255, 105, 180, 0.3);
          box-shadow: 0 4px 12px rgba(255, 105, 180, 0.15);
        }

        /* 实习生头像 */
        .message-avatar.intern {
          background: linear-gradient(135deg, #e8f4ff 0%, #d1eaff 100%);
          border-color: rgba(66, 165, 245, 0.3);
          box-shadow: 0 4px 12px rgba(66, 165, 245, 0.15);
        }

        /* 老师傅头像 */
        .message-avatar.master {
          background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);
          border-color: rgba(255, 167, 38, 0.3);
          box-shadow: 0 4px 12px rgba(255, 167, 38, 0.15);
        }

        .message-content-wrap {
          display: flex;
          flex-direction: column;
          gap: 5px;
          max-width: 78%;
        }

        .message-item.user .message-content-wrap {
          align-items: flex-end;
        }

        .message-item.assistant .message-content-wrap {
          align-items: flex-start;
        }

        .message-item.engineer .message-content-wrap {
          align-items: flex-start;
        }

        .message-bubble {
          border-radius: 14px;
          padding: 10px 14px;
          font-size: 13px;
          line-height: 1.56;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          color: var(--ink);
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid rgba(133, 166, 201, 0.26);
          box-shadow: 0 5px 16px rgba(22, 61, 95, 0.08);
        }

        .message-item.assistant .message-bubble {
          border-left: 3px solid #4fa8df;
        }

        .message-item.engineer .message-bubble {
          color: #1f3e2b;
          background: linear-gradient(145deg, #eefaf2 0%, #e4f6ea 100%);
          border-color: rgba(62, 152, 89, 0.3);
          border-left: 3px solid #3a9a5a;
        }

        .message-item.assistant.isConfirmationMarker .message-bubble {
          background: #e8faf0;
          border-color: rgba(49, 151, 97, 0.25);
          border-left: 3px solid #299764;
          color: #125f3f;
          font-weight: 600;
        }

        .message-bubble.spec-bubble {
          background: linear-gradient(165deg, #f8fbff 0%, #eef6ff 100%);
          border-color: rgba(24, 100, 171, 0.28);
          border-left: 3px solid #1864ab;
          padding: 12px 14px;
          white-space: normal;
        }

        .spec-bubble-title {
          font-weight: 700;
          font-size: 12px;
          color: #1864ab;
          letter-spacing: 0.02em;
          margin-bottom: 8px;
        }

        .md-root {
          overflow-x: auto;
        }

        .md-root--spec {
          font-size: 12px;
          line-height: 1.55;
          color: #2f4a63;
        }

        .md-root--chat {
          font-size: 13px;
          line-height: 1.55;
          color: var(--ink);
        }

        .message-item.assistant .message-bubble:has(.md-root--chat),
        .message-item.engineer .message-bubble:has(.md-root--chat) {
          white-space: normal;
        }

        .md-root .md-p {
          margin: 0 0 0.55em;
        }

        .md-root .md-p:last-child {
          margin-bottom: 0;
        }

        .md-root--chat .md-p {
          margin: 0 0 0.65em;
        }

        .md-root .md-strong {
          color: #1a3a52;
          font-weight: 600;
        }

        .md-root--chat .md-strong {
          color: inherit;
        }

        .md-root .md-ul,
        .md-root .md-ol {
          margin: 0.35em 0 0.55em;
          padding-left: 1.35em;
        }

        .md-root .md-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11.5px;
          margin: 0.5em 0;
          border: 1px solid rgba(24, 100, 171, 0.2);
          border-radius: 8px;
          overflow: hidden;
        }

        .md-root .md-table th,
        .md-root .md-table td {
          border: 1px solid rgba(24, 100, 171, 0.15);
          padding: 6px 10px;
          text-align: left;
          vertical-align: top;
        }

        .md-root .md-table th {
          background: rgba(24, 100, 171, 0.08);
          font-weight: 600;
          color: #1864ab;
        }

        .md-root .md-thead th {
          white-space: nowrap;
        }

        .md-root--spec .md-code-inline {
          font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
          font-size: 11px;
          background: rgba(24, 100, 171, 0.07);
          padding: 1px 5px;
          border-radius: 4px;
        }

        .md-root--spec .md-pre-spec {
          margin: 0.5em 0;
          padding: 8px 10px;
          background: rgba(24, 100, 171, 0.06);
          border-radius: 8px;
          overflow-x: auto;
          font-size: 11px;
        }

        .md-root--chat .md-pre-chat {
          margin: 0.75em 0 0;
          padding: 12px 14px;
          background: #1a2332;
          color: #e6edf3;
          border-radius: 10px;
          overflow-x: auto;
          border: 1px solid rgba(255, 255, 255, 0.06);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        .md-root--chat .md-pre-chat .md-code-block {
          display: block;
          font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
          font-size: 12px;
          line-height: 1.45;
          white-space: pre;
          word-break: normal;
          overflow-wrap: normal;
          background: transparent !important;
          padding: 0 !important;
          border-radius: 0;
          color: inherit;
        }

        .md-root--chat .md-code-inline {
          font-family: ui-monospace, Consolas, monospace;
          font-size: 12px;
          background: rgba(24, 100, 171, 0.1);
          padding: 2px 6px;
          border-radius: 4px;
        }

        .md-root .md-h,
        .md-root .md-h3 {
          margin: 0.65em 0 0.35em;
          font-size: 13px;
          color: #1864ab;
          font-weight: 700;
        }

        .md-root--chat .md-h,
        .md-root--chat .md-h3 {
          color: #1864ab;
        }

        .md-root .md-h:first-child,
        .md-root .md-h3:first-child {
          margin-top: 0;
        }

        .md-root .md-hr {
          border: none;
          border-top: 1px solid rgba(24, 100, 171, 0.18);
          margin: 0.75em 0;
        }

        .md-root--chat .md-hr {
          border-top-color: rgba(22, 61, 95, 0.15);
        }

        .message-item.spec-message .message-content-wrap {
          max-width: 95%;
        }

        .message-item.user .message-bubble {
          color: #f7fcff;
          background: linear-gradient(145deg, #0f5f99 0%, #177abf 50%, #2f95d7 100%);
          border-color: rgba(9, 64, 106, 0.28);
          border-bottom-right-radius: 5px;
        }

        /* 等待提示/进度消息 - 灰色小字，无头像 */
        .message-item.waiting .message-bubble {
          background: transparent;
          border: none;
          box-shadow: none;
          color: #999;
          font-size: 12px;
          padding: 4px 0;
          line-height: 1.4;
        }

        .message-item.assistant.waiting .message-content-wrap {
          max-width: 100%;
        }

        .message-item.progress {
          margin-top: -3px;
          margin-bottom: -1px;
          animation: fadeIn 0.16s ease-out;
        }

        .message-item.progress .message-content-wrap {
          max-width: 100%;
          gap: 0;
        }

        .message-item.progress .message-bubble {
          background: transparent;
          border: none;
          box-shadow: none;
          color: #5f708d;
          padding: 2px 0 1px;
          font-size: 11px;
          line-height: 1.35;
        }

        .message-item.waiting {
          justify-content: center;
          margin: 8px 0;
          animation: fadeIn 0.3s ease-out;
        }

        .message-item.waiting .message-content-wrap {
          align-items: center;
          max-width: 100%;
        }

        .message-item.waiting .message-bubble {
          background: transparent;
          border: none;
          box-shadow: none;
          color: #8a9aaf;
          font-size: 12px;
          padding: 4px 12px;
          line-height: 1.4;
        }

        .message-item.waiting .message-meta {
          display: none;
        }

        .confirm-generate-row {
          margin-top: 8px;
        }

        .confirm-generate-btn {
          border: 1px solid #58a9df;
          background: linear-gradient(135deg, #1c7fca 0%, #3a9ee4 100%);
          color: #f7fbff;
          border-radius: 10px;
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.2s ease, opacity 0.2s ease;
          box-shadow: 0 5px 14px rgba(28, 127, 202, 0.22);
        }

        .confirm-generate-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 7px 16px rgba(28, 127, 202, 0.3);
        }

        .confirm-generate-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
          transform: none;
          box-shadow: none;
        }

        .input-form {
          flex-shrink: 0;
          padding: 13px 14px 14px;
          border-top: 1px solid rgba(24, 100, 171, 0.14);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.7) 0%, rgba(242, 248, 255, 0.9) 100%);
        }

        .input-form.is-loading .input-wrapper {
          border-color: #667eea;
          background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
        }

        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        .input-wrapper {
          display: flex;
          gap: 8px;
          align-items: flex-end;
          border-radius: 13px;
          border: 1px solid #bfd3e7;
          background: rgba(255, 255, 255, 0.95);
          padding: 7px 8px 7px 10px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85);
          transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
        }

        .input-wrapper:focus-within {
          border-color: #58a9df;
          box-shadow: 0 0 0 4px rgba(88, 169, 223, 0.2), 0 6px 16px rgba(55, 106, 146, 0.13);
          transform: translateY(-1px);
        }

        .message-input {
          flex: 1;
          border: none;
          background: transparent;
          padding: 5px 6px;
          min-height: 34px;
          max-height: 132px;
          resize: none;
          outline: none;
          color: #1b2740;
          font-family: "Space Grotesk", "Avenir Next", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
          font-size: 13px;
          line-height: 1.45;
        }

        .message-input::placeholder {
          color: #7a8ba5;
        }

        .message-input:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .send-button {
          width: 36px;
          height: 36px;
          border-radius: 11px;
          border: none;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 0;
          color: #f8fcff;
          background: linear-gradient(145deg, #0f4d80 0%, #0f71ba 55%, #45a9df 100%);
          box-shadow: 0 8px 16px rgba(22, 86, 138, 0.3);
          transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
        }

        .send-button:hover:not(:disabled) {
          transform: translateY(-1px) scale(1.03);
          box-shadow: 0 12px 20px rgba(22, 86, 138, 0.34);
          filter: saturate(1.07);
        }

        .send-button:disabled {
          background: linear-gradient(145deg, #9fb2c8 0%, #c2d0df 100%);
          box-shadow: none;
          cursor: not-allowed;
        }

        .spinner {
          animation: spin 1s linear infinite;
        }

        .input-footer {
          display: none;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 768px) {
          .chat-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
            padding: 12px 13px 11px;
          }

          .header-actions {
            width: 100%;
            justify-content: flex-end;
          }

          .messages-panel {
            padding: 13px;
          }

          .message-content-wrap {
            max-width: 86%;
          }
        }

        @media (max-width: 480px) {
          .prompt-input-module {
            border-radius: 12px;
          }

          .header-title h3 {
            font-size: 14px;
          }

          .header-title p {
            font-size: 11px;
          }

          .messages-panel {
            padding: 11px;
            gap: 10px;
          }

          .message-content-wrap {
            max-width: 90%;
          }

          .message-bubble {
            font-size: 12px;
            padding: 9px 12px;
          }

          .input-form {
            padding: 10px 10px 11px;
          }

          .send-button {
            width: 34px;
            height: 34px;
          }
        }
      `}</style>
    </div>
  );
};
