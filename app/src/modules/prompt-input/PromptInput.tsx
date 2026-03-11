import React, { useState } from 'react';

interface PromptInputProps {
  onGenerate: (prompt: string) => void;
  isLoading: boolean;
}

const EXAMPLE_PROMPTS = [
  '创建一个参数化的圆柱体，半径10mm，高度50mm',
  '设计一个带孔的立方体，边长40mm，孔径8mm',
  '生成一个参数化的球体，半径15mm',
];

// Prompt 输入模块：负责收集需求文本并触发生成。
export const PromptInput: React.FC<PromptInputProps> = ({ onGenerate, isLoading }) => {
  const [prompt, setPrompt] = useState('');

  // 提交时做最小校验，避免空字符串请求。
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && !isLoading) {
      onGenerate(prompt.trim());
    }
  };

  const handleClear = () => {
    setPrompt('');
  };

  const handleFillExample = () => {
    const example = EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
    setPrompt(example);
  };

  return (
    <div className="prompt-input-module">
      <div className="prompt-header">
        <h3>参数化设计输入</h3>
        <button
          type="button"
          onClick={handleFillExample}
          disabled={isLoading}
          className="example-button"
          title="填充一个随机示例"
        >
          示例
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="请描述您想要生成的3D模型"
            rows={2}
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
          background: #f5f5f5;
          padding: 12px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          height: 100%;
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
        }
        
        .prompt-textarea {
          width: 100%;
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-family: monospace;
          font-size: 13px;
          resize: none;
          flex: 1;
          min-height: 0;
        }
        
        .button-group {
          display: flex;
          gap: 6px;
        }
        
        .generate-button {
          background: #007bff;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          flex: 1;
        }
        
        .generate-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        
        .clear-button {
          background: #6c757d;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          flex: 1;
        }
        
        .clear-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .example-button {
          background: #28a745;
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
          background: #218838;
        }
      `}</style>
    </div>
  );
};
