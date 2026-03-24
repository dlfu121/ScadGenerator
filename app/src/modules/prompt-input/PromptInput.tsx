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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pendingMessageIdRef = useRef<string | null>(null);

  const makeTimestamp = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const pendingId = pendingMessageIdRef.current;
    if (!pendingId || !isLoading) {
      return;
    }

    const trailText = progressTrail
      .map((item, index) => `${index + 1}. ${item}`)
      .join('\n');
    const nextContent = trailText || '1. 请求已发送，正在等待模型响应';

    setMessages((prev) => prev.map((item) => (
      item.id === pendingId
        ? {
          ...item,
          content: nextContent,
          timestamp: makeTimestamp(),
        }
        : item
    )));
  }, [isLoading, progressTrail]);

  // 提交时做最小校验，避免空字符串请求。
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const promptText = prompt.trim();
    if (!promptText || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `${Date.now()}_user`,
      role: 'user',
      content: promptText,
      timestamp: makeTimestamp(),
    };

    const pendingMessageId = `${Date.now()}_assistant_pending`;
    pendingMessageIdRef.current = pendingMessageId;
    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: pendingMessageId,
        role: 'assistant',
        content: '1. 请求已接收，正在排队',
        timestamp: makeTimestamp(),
      },
    ]);
    setPrompt('');

    try {
      const generateResult = await onGenerate(promptText);
      setMessages((prev) => prev.map((item) => (
        item.id === pendingMessageId
          ? {
            ...item,
            content: generateResult.fullResponse || (generateResult.success ? '生成完成。' : '生成失败。'),
            timestamp: makeTimestamp(),
          }
          : item
      )));
      pendingMessageIdRef.current = null;
    } catch {
      setMessages((prev) => prev.map((item) => (
        item.id === pendingMessageId
          ? {
            ...item,
            content: '生成请求失败，请调整描述后重试。',
            timestamp: makeTimestamp(),
          }
          : item
      )));
      pendingMessageIdRef.current = null;
    }
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
  };

  return (
    <div className="prompt-input-module">
      <div className="prompt-header">
        <div className="prompt-title-wrap">
          <h3>建模对话区</h3>
          <p>与助手来回沟通，逐步完善你的模型</p>
        </div>
        <div className="prompt-tools">
          <button
            type="button"
            onClick={handleFillExample}
            disabled={isLoading}
            className="example-button"
            title="填充一个随机示例"
          >
            示例
          </button>
          <button
            type="button"
            onClick={handleClearMessages}
            disabled={isLoading}
            className="clear-history-button"
            title="清空当前会话消息"
          >
            清空会话
          </button>
        </div>
      </div>

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
            {item}
          </button>
        ))}
      </div>

      <div className="messages-panel" aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} className={`message-row ${message.role}`}>
            <div className="message-bubble-wrap">
              <div className="message-bubble">{message.content}</div>
              <div className="message-time">{message.timestamp}</div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit(event);
              }
            }}
            placeholder="输入你的模型想法，例如：做一个可调节尺寸的带孔支架"
            rows={3}
            disabled={isLoading}
            className="prompt-textarea"
          />
        </div>
        
        <div className="button-group">
          <button
            type="submit"
            disabled={!prompt.trim() || isLoading}
            className="generate-button"
          >
            {isLoading ? '生成中...' : '生成'}
          </button>
          
          <button
            type="button"
            onClick={handleClear}
            disabled={isLoading}
            className="clear-button"
          >
            清空
          </button>
        </div>
      </form>
      
      <style>{`
        .prompt-input-module {
          background: radial-gradient(circle at top left, #f5f3ff 0%, #eef2ff 40%, #f8fafc 100%);
          padding: 16px;
          border-radius: 10px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          border: 1px solid #dbe4ff;
        }

        .prompt-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 0;
        }

        .prompt-header h3 {
          margin: 0;
          line-height: 1.2;
          font-size: 18px;
          color: #1e1b4b;
        }

        .prompt-title-wrap p {
          margin: 4px 0 0;
          font-size: 12px;
          color: #475569;
        }

        .prompt-tools {
          display: flex;
          gap: 8px;
        }

        .quick-prompts {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .quick-prompt-chip {
          border: 1px solid #c7d2fe;
          border-radius: 999px;
          background: #eef2ff;
          color: #312e81;
          font-size: 12px;
          padding: 4px 10px;
          cursor: pointer;
        }

        .quick-prompt-chip:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .messages-panel {
          flex: 1;
          min-height: 0;
          background: #ffffff;
          border: 1px solid #c7d2fe;
          border-radius: 10px;
          padding: 12px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        form {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-shrink: 0;
        }

        .message-row {
          display: flex;
        }

        .message-row.user {
          justify-content: flex-end;
        }

        .message-row.assistant {
          justify-content: flex-start;
        }

        .message-bubble {
          max-width: 88%;
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 13px;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .message-bubble-wrap {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .message-time {
          font-size: 11px;
          color: #64748b;
          padding: 0 4px;
        }

        .message-row.user .message-time {
          text-align: right;
        }

        .message-row.user .message-bubble {
          background: #1d4ed8;
          color: #ffffff;
          border-bottom-right-radius: 4px;
        }

        .message-row.assistant .message-bubble {
          background: #e2e8f0;
          color: #0f172a;
          border-bottom-left-radius: 4px;
        }
        
        .prompt-textarea {
          width: 100%;
          padding: 10px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font-family: 'Consolas', 'Menlo', monospace;
          font-size: 13px;
          resize: none;
          flex: 1;
          min-height: 0;
          background: #f8fafc;
        }
        
        .button-group {
          display: flex;
          gap: 6px;
        }
        
        .generate-button {
          background: #2563eb;
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          flex: 1;
        }
        
        .generate-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        
        .clear-button {
          background: #475569;
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          flex: 1;
        }
        
        .clear-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .example-button {
          background: #0f766e;
          color: white;
          border: none;
          padding: 4px 10px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }

        .example-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .example-button:hover:not(:disabled) {
          background: #0b5f59;
        }

        .clear-history-button {
          background: #334155;
          color: #fff;
          border: none;
          padding: 4px 10px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }

        .clear-history-button:disabled {
          background: #94a3b8;
          cursor: not-allowed;
        }

        @media (max-width: 768px) {
          .prompt-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }

          .prompt-tools {
            width: 100%;
          }

          .prompt-tools button {
            flex: 1;
          }
        }
      `}</style>
    </div>
  );
};
