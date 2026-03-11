import React, { useState } from 'react';

interface PromptInputProps {
  onGenerate: (prompt: string) => void;
  isLoading: boolean;
}

export const PromptInput: React.FC<PromptInputProps> = ({ onGenerate, isLoading }) => {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && !isLoading) {
      onGenerate(prompt.trim());
    }
  };

  const handleClear = () => {
    setPrompt('');
  };

  return (
    <div className="prompt-input-module">
      <h3>参数化设计输入</h3>
      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="请描述您想要生成的3D模型，例如：创建一个参数化的盒子，长度50mm，宽度30mm，高度20mm..."
            rows={4}
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
            {isLoading ? '生成中...' : '生成OpenSCAD'}
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
      
      <div className="examples">
        <h4>示例提示：</h4>
        <ul>
          <li>创建一个参数化的圆柱体，半径10mm，高度50mm</li>
          <li>设计一个带孔的立方体，边长40mm，孔径8mm</li>
          <li>生成一个参数化的球体，半径15mm</li>
        </ul>
      </div>
      
      <style jsx>{`
        .prompt-input-module {
          background: #f5f5f5;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        
        .prompt-textarea {
          width: 100%;
          min-height: 100px;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-family: monospace;
          resize: vertical;
        }
        
        .button-group {
          margin-top: 10px;
          display: flex;
          gap: 10px;
        }
        
        .generate-button {
          background: #007bff;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
        }
        
        .generate-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        
        .clear-button {
          background: #6c757d;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
        }
        
        .clear-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        
        .examples {
          margin-top: 20px;
          font-size: 14px;
        }
        
        .examples ul {
          margin: 10px 0;
          padding-left: 20px;
        }
        
        .examples li {
          margin: 5px 0;
          color: #666;
        }
      `}</style>
    </div>
  );
};
