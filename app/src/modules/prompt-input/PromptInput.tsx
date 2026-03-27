import React, { useEffect, useRef, useState } from 'react';

interface PromptInputProps {
  onGenerate: (prompt: string) => Promise<{ success: boolean; fullResponse: string }>;
  onDirectCode?: (code: string, parameters?: Record<string, any>) => Promise<void>;
  isLoading: boolean;
  progressTrail: string[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'engineer';
  content: string;
  timestamp: string;
  type?: 'text' | 'progress' | 'waiting'; // 'waiting' 为等待回复占位符
  isConfirmationMarker?: boolean;
  agentRole?: 'product_manager' | 'intern' | 'master'; // 智能体角色，用于显示对应头像
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

// Prompt 输入模块：负责收集需求文本并触发生成。
export const PromptInput: React.FC<PromptInputProps> = ({ onGenerate, onDirectCode, isLoading, progressTrail }) => {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '你好，我是 OpenSCAD 助手。告诉我你想要的模型，我会帮你生成参数化代码并自动预览。',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [isRequirementConfirmed, setIsRequirementConfirmed] = useState(false);
  const [isConfirmingMode, setIsConfirmingMode] = useState(false);
  const [confirmedRequirement, setConfirmedRequirement] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pendingMessageIdRef = useRef<string | null>(null);
  const lastProgressCountRef = useRef<number>(0);
  const engineerProgressCursorRef = useRef<number>(0);

  const makeTimestamp = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

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
      '- 后端 AI 调用/多轮确认耗时较长（请求可能在内部排队）',
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
    const waitingMessage: ChatMessage = {
      id: pendingMessageId,
      role: 'assistant',
      content: '正在等待助理回复...（请稍候，最长约 2 分钟，若超时请稍后重试）',
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
        }),
      });

      const result = await response.json() as RequirementConfirmResult;

      if (!response.ok) {
        throw new Error(result?.error || '对话失败');
      }

      // 检查是否有确认标记
      const hasConfirmationMarker = result.pmResponse?.includes('【需求确认完成】');

      const responderRole = result.responderRole || 'product_manager';

      // 添加智能体回复
      const kimiMessage: ChatMessage = {
        id: `${pendingMessageId}_response`,
        role: responderRole === 'product_manager' ? 'assistant' : 'engineer',
        content: result.pmResponse || '已收到你的信息，继续详细描述。',
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
      // 当后端直接返回代码时，优先直达代码区并触发编译。
      const directCode = (result.openscadCode || '').trim()
        || (
          responderRole !== 'product_manager' && isLikelyScadCode(result.pmResponse || '')
            ? (result.pmResponse || '').trim()
            : ''
        );

      if (directCode) {
        setIsConfirmingMode(false);
        const codeToCompile = directCode;
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
        setTimeout(() => {
          void handleGenerateAfterConfirmation(generationPrompt);
        }, 300);
      }

      pendingMessageIdRef.current = null;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const rateLimitMessage = isRateLimitLike(errorText) ? buildRateLimitAnalysisMessage(errorText) : undefined;
      const timeoutMessage = isTimeoutLike(errorText) ? buildTimeoutAnalysisMessage(errorText) : undefined;
      const finalMessage = rateLimitMessage || timeoutMessage || '❌ 对话出错，请重试。';

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
    const generateResult = await onGenerate(generationPrompt);
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}_generate_complete`,
        role: 'assistant',
        content: generateResult.fullResponse || (generateResult.success ? '✅ 模型生成完成！' : '❌ 模型生成失败，请重试。'),
        timestamp: makeTimestamp(),
        type: 'text',
      },
    ]);
  };

  // 提交时做最小校验，避免空字符串请求。
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const promptText = prompt.trim();
    if (!promptText || isLoading) {
      return;
    }

    // 已进入对话确认阶段（含“需求已确认但等待生成指令”）时，继续走 Kimi 对话。
    if (isConfirmingMode || isRequirementConfirmed) {
      await handleConfirmationChat(promptText);
      return;
    }

    // 首次输入，进入确认模式
    setIsConfirmingMode(true);
    setPrompt('');
    
    // 进入确认模式，直接调用对话
    await handleConfirmationChat(promptText);
  };

  const handleClear = () => {
    setPrompt('');
  };

  const handleClearMessages = () => {
    setMessages([
      {
        id: 'welcome_reset',
        role: 'assistant',
        content: '会话已清空。你可以继续描述新的模型需求。',
        timestamp: makeTimestamp(),
      },
    ]);
    setConversationHistory([]);
    setIsRequirementConfirmed(false);
    setIsConfirmingMode(false);
    setConfirmedRequirement('');
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

  return (
    <div className="prompt-input-module">
      {/* 对话栏头部 */}
      <div className="chat-header">
        <div className="header-title">
          <h3>🤖 模型生成助手</h3>
          <p>
            {isLoading
              ? `⏳ ${progressTrail.length > 0 ? getProgressDisplayText(progressTrail[progressTrail.length - 1]) : 'AI正在处理中...'}`
              : isConfirmingMode || isRequirementConfirmed
                ? '💬 需求确认中（默认产品经理沟通，代码问题优先转实习生）'
                : '描述你的想法，我会帮你生成 OpenSCAD 代码'}
          </p>
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
              className={`message-item ${message.role} ${message.type || 'text'} ${message.isConfirmationMarker ? 'isConfirmationMarker' : ''}`}
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
                <div className="message-bubble">
                  {message.content}
                </div>
                {message.type !== 'progress' && (
                  <div className="message-meta">{message.timestamp}</div>
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
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit(event);
              }
            }}
            placeholder={isConfirmingMode || isRequirementConfirmed
              ? "继续描述需求，或输入“生成代码”...（Shift+Enter 换行，Enter 发送）"
              : "输入你的模型想法... （Shift+Enter 换行，Enter 发送）"}
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
          align-items: center;
          padding: 14px 16px 12px;
          border-bottom: 1px solid rgba(24, 100, 171, 0.14);
          background: linear-gradient(90deg, rgba(24, 100, 171, 0.92) 0%, rgba(39, 126, 201, 0.9) 42%, rgba(84, 168, 230, 0.92) 100%);
          color: #f8fbff;
          backdrop-filter: blur(6px);
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

        /* 产品经理小K - 可爱女生头像 */
        .message-avatar.product_manager {
          background: linear-gradient(135deg, #ffe4ec 0%, #ffcce0 100%);
          border-color: rgba(255, 105, 180, 0.3);
          box-shadow: 0 4px 12px rgba(255, 105, 180, 0.15);
        }

        /* 实习生 - 年轻新手头像 */
        .message-avatar.intern {
          background: linear-gradient(135deg, #e8f4ff 0%, #d1eaff 100%);
          border-color: rgba(66, 165, 245, 0.3);
          box-shadow: 0 4px 12px rgba(66, 165, 245, 0.15);
        }

        /* 老师傅 - 资深工程师头像 */
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
