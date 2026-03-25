import React, { useEffect, useRef, useState } from 'react';

interface PromptInputProps {
  onGenerate: (prompt: string) => Promise<{ success: boolean; fullResponse: string }>;
  isLoading: boolean;
  progressTrail: string[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  type?: 'text' | 'progress'; // 'text' 为普通消息，'progress' 为进度消息
  isConfirmationMarker?: boolean; // 标记【需求确认完成】
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
  error?: string;
}

const EXAMPLE_PROMPTS = [
  '创建一个参数化的圆柱体，半径10mm，高度50mm',
  '设计一个带孔的立方体，边长40mm，孔径8mm',
  '生成一个参数化的球体，半径15mm',
];

// Prompt 输入模块：负责收集需求文本并触发生成。
export const PromptInput: React.FC<PromptInputProps> = ({ onGenerate, isLoading, progressTrail }) => {
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

  const makeTimestamp = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      
      // 添加 Kimi 的回应
      const kimiMessage: ChatMessage = {
        id: `${pendingMessageId}_response`,
        role: 'assistant',
        content: result.pmResponse || '已收到你的信息，继续详细描述。',
        timestamp: makeTimestamp(),
        type: 'text',
        isConfirmationMarker: hasConfirmationMarker,
      };

      setMessages((prev) => [...prev, kimiMessage]);

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
      const errorMessage: ChatMessage = {
        id: `${pendingMessageId}_error`,
        role: 'assistant',
        content: '❌ 对话出错，请重试。',
        timestamp: makeTimestamp(),
        type: 'text',
      };

      setMessages((prev) => [...prev, errorMessage]);
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

  const handleFillExample = () => {
    const example = EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
    setPrompt(example);
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
            {isConfirmingMode || isRequirementConfirmed
              ? '💬 需求确认中（说“生成代码”后由 Claude 出码）'
              : '描述你的想法，我会帮你生成 OpenSCAD 代码'}
          </p>
        </div>
        <div className="header-actions">
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

      {/* 快速示例面板 */}
      {messages.length <= 1 && (
        <div className="quick-examples-section">
          <p className="section-label">快速示例：</p>
          <div className="quick-prompts" role="list" aria-label="快捷提示词">
            {EXAMPLE_PROMPTS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setPrompt(item)}
                disabled={isLoading}
                className="quick-prompt-chip"
                role="listitem"
              >
                <span className="chip-icon">💡</span>
                <span>{item}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 消息展示面板 */}
      <div className="messages-container" aria-live="polite" aria-label="对话消息">
        <div className="messages-panel">
          {messages.map((message) => (
            <div 
              key={message.id} 
              className={`message-item ${message.role} ${message.type || 'text'} ${message.isConfirmationMarker ? 'isConfirmationMarker' : ''}`}
              role={message.role === 'user' ? 'log' : 'status'}
            >
              {message.type !== 'progress' && (
                <div className="message-avatar">
                  {message.role === 'user' ? '👤' : '🤖'}
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
      <form onSubmit={handleSubmit} className="input-form">
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
          <button
            type="button"
            onClick={handleFillExample}
            disabled={isLoading || isConfirmingMode || isRequirementConfirmed}
            className="text-button example-btn"
            title="填充随机示例"
          >
            📝 示例
          </button>
        </div>
      </form>
      
      <style>{`
        .prompt-input-module {
          background: #ffffff;
          padding: 0;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 0;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          border: 1px solid #e5e7eb;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }

        /* 头部样式 */
        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          flex-shrink: 0;
        }

        .header-title h3 {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          line-height: 1.3;
        }

        .header-title p {
          margin: 2px 0 0;
          font-size: 12px;
          opacity: 0.9;
          line-height: 1.2;
        }

        .header-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .icon-button {
          background: rgba(255, 255, 255, 0.2);
          border: none;
          color: white;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          font-size: 0;
        }

        .icon-button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.3);
        }

        .icon-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* 快速示例区域 */
        .quick-examples-section {
          flex-shrink: 0;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
          background: #f9fafb;
        }

        .section-label {
          margin: 0 0 8px 0;
          font-size: 12px;
          font-weight: 500;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .quick-prompts {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .quick-prompt-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          border: 1px solid #d1d5db;
          border-radius: 20px;
          background: white;
          color: #374151;
          font-size: 12px;
          padding: 6px 12px;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .quick-prompt-chip:hover:not(:disabled) {
          background: #f3f4f6;
          border-color: #667eea;
          color: #667eea;
          transform: translateY(-1px);
        }

        .quick-prompt-chip:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .chip-icon {
          font-size: 13px;
        }

        /* 消息容器 */
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
          background: #fafbfc;
        }

        /* 消息滚动优化 */
        .messages-panel::-webkit-scrollbar {
          width: 6px;
        }

        .messages-panel::-webkit-scrollbar-track {
          background: transparent;
        }

        .messages-panel::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 3px;
        }

        .messages-panel::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }

        .messages-end {
          height: 0;
        }

        /* 消息项 */
        .message-item {
          display: flex;
          gap: 8px;
          animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .message-item.user {
          flex-direction: row-reverse;
        }

        .message-avatar {
          font-size: 20px;
          line-height: 1;
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .message-content-wrap {
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-width: 75%;
        }

        .message-item.user .message-content-wrap {
          align-items: flex-end;
        }

        .message-item.assistant .message-content-wrap {
          align-items: flex-start;
        }

        .message-bubble {
          background: #e5e7eb;
          color: #111827;
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 13px;
          line-height: 1.5;
          word-wrap: break-word;
          white-space: pre-wrap;
        }

        .message-item.assistant .message-bubble {
          background: #f3f4f6;
          border-left: 3px solid #667eea;
        }

        .message-item.assistant.isConfirmationMarker .message-bubble {
          background: #d1fae5;
          border-left: 3px solid #10b981;
          color: #047857;
          font-weight: 500;
        }

        .message-item.user .message-bubble {
          background: #667eea;
          color: white;
          border-bottom-right-radius: 4px;
        }

        .message-item.assistant .message-bubble {
          background: #f3f4f6;
          color: #111827;
          border-bottom-left-radius: 4px;
        }

        /* 进度消息样式 */
        .message-item.progress {
          gap: 0;
          margin: 2px 0;
          animation: fadeIn 0.2s ease-out;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        .message-item.progress .message-bubble {
          background: transparent;
          color: #9ca3af;
          padding: 2px 0;
          border-radius: 0;
          font-size: 11px;
          line-height: 1.4;
          white-space: pre-wrap;
        }

        .message-item.progress .message-content-wrap {
          gap: 0;
          max-width: 100%;
        }

        .message-meta {
          font-size: 11px;
          color: #9ca3af;
          padding: 0 4px;
        }

        /* 输入表单 */
        .input-form {
          flex-shrink: 0;
          padding: 12px 16px;
          border-top: 1px solid #e5e7eb;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: white;
        }

        .input-wrapper {
          display: flex;
          gap: 8px;
          align-items: flex-end;
          background: #f9fafb;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          padding: 6px 8px;
          transition: all 0.2s;
        }

        .input-wrapper:focus-within {
          border-color: #667eea;
          background: white;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .message-input {
          flex: 1;
          border: none;
          background: transparent;
          padding: 6px;
          font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          color: #111827;
          resize: none;
          max-height: 120px;
          outline: none;
          min-height: 32px;
          max-rows: 5;
        }

        .message-input::placeholder {
          color: #9ca3af;
        }

        .message-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .send-button {
          background: #667eea;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 6px 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          font-size: 0;
          flex-shrink: 0;
        }

        .send-button:hover:not(:disabled) {
          background: #5568d3;
          transform: scale(1.05);
        }

        .send-button:disabled {
          background: #d1d5db;
          cursor: not-allowed;
        }

        .send-button svg {
          display: flex;
        }

        .spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* 输入底部 */
        .input-footer {
          display: flex;
          gap: 8px;
          font-size: 12px;
        }

        .text-button {
          background: none;
          border: none;
          color: #667eea;
          cursor: pointer;
          padding: 0;
          font-size: 12px;
          transition: all 0.2s;
        }

        .text-button:hover:not(:disabled) {
          color: #5568d3;
          text-decoration: underline;
        }

        .text-button:disabled {
          color: #d1d5db;
          cursor: not-allowed;
        }

        /* 响应式设计 */
        @media (max-width: 768px) {
          .chat-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }

          .header-actions {
            width: 100%;
            justify-content: flex-end;
          }

          .quick-prompts {
            gap: 6px;
          }

          .quick-prompt-chip {
            flex-shrink: 0;
            font-size: 11px;
            padding: 5px 10px;
          }

          .message-content-wrap {
            max-width: 85%;
          }

          .message-input {
            font-size: 14px;
          }
        }

        @media (max-width: 480px) {
          .prompt-input-module {
            border-radius: 8px;
          }

          .chat-header {
            padding: 10px 12px;
          }

          .header-title h3 {
            font-size: 14px;
          }

          .header-title p {
            font-size: 11px;
          }

          .quick-examples-section {
            padding: 10px 12px;
          }

          .messages-panel {
            padding: 12px;
            gap: 10px;
          }

          .input-form {
            padding: 10px 12px;
            gap: 6px;
          }

          .input-wrapper {
            padding: 5px 6px;
          }

          .message-content-wrap {
            max-width: 90%;
          }
        }
      `}</style>
    </div>
  );
};
