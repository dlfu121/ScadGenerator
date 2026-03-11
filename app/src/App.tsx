import React from 'react';
import { StateProvider, useAppState } from './modules/state-session/StateSession';
import { PromptInput } from './modules/prompt-input/PromptInput';
import { ParamPreview } from './modules/param-preview/ParamPreview';
import { useScadWorkflow } from './hooks/useScadWorkflow';

// 页面主容器：协调输入、生成、参数预览三大模块。
const AppContent: React.FC = () => {
  const { state, dispatch } = useAppState();
  const {
    handleGenerate,
    handleParameterChange,
    handleRetry,
    handleFix,
  } = useScadWorkflow({ state, dispatch });

  return (
    <div className="app">
      <header className="app-header">
        <h1>参数化 OpenSCAD 生成工具</h1>
        <p>输入描述，生成参数化3D模型</p>
      </header>

      <main className="app-main">
        <div className="left-panel">
          <PromptInput 
            onGenerate={handleGenerate}
            isLoading={state.isLoading}
          />
          
          {state.error && (
            <div className="error-message">
              错误: {state.error}
            </div>
          )}

          {state.openscadCode && (
            <div className="code-display">
              <h3>生成的OpenSCAD代码</h3>
              <pre>{state.openscadCode}</pre>
            </div>
          )}
        </div>

        <div className="right-panel">
          <ParamPreview
            stlData={state.stlData}
            parameters={state.parameters}
            onParameterChange={handleParameterChange}
            compileStatus={state.compileStatus}
            compileProgress={state.compileProgress}
            compileMessage={state.compileMessage}
            compileError={state.compileErrorDetail || state.error}
            onRetry={handleRetry}
            onFix={handleFix}
          />
        </div>
      </main>

      <footer className="app-footer">
        <p>会话ID: {state.sessionId || '未连接'}</p>
        <p>状态: {state.compileStatus} / {state.compileMessage}{state.isLoading ? ' (处理中...)' : ''}</p>
      </footer>
      
      <style>{`
        .app {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        }

        .app-header {
          background: #2c3e50;
          color: white;
          padding: 20px;
          text-align: center;
        }

        .app-header h1 {
          margin: 0 0 10px 0;
          font-size: 24px;
        }

        .app-header p {
          margin: 0;
          opacity: 0.8;
        }

        .app-main {
          flex: 1;
          display: flex;
          gap: 20px;
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
          width: 100%;
        }

        .left-panel {
          flex: 1;
          min-width: 400px;
        }

        .right-panel {
          flex: 1;
          min-width: 400px;
        }

        .error-message {
          background: #f8d7da;
          color: #721c24;
          padding: 10px;
          border-radius: 4px;
          margin: 10px 0;
        }

        .code-display {
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 8px;
          padding: 15px;
          margin-top: 20px;
        }

        .code-display h3 {
          margin: 0 0 10px 0;
          color: #495057;
        }

        .code-display pre {
          background: #f1f3f4;
          padding: 10px;
          border-radius: 4px;
          overflow-x: auto;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 14px;
          line-height: 1.4;
        }

        .app-footer {
          background: #f8f9fa;
          padding: 15px 20px;
          border-top: 1px solid #e9ecef;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 14px;
          color: #6c757d;
        }

        @media (max-width: 768px) {
          .app-main {
            flex-direction: column;
          }
          
          .left-panel,
          .right-panel {
            min-width: auto;
          }
        }
      `}</style>
    </div>
  );
};

// 应用入口：把全局状态 Provider 包裹到页面内容外层。
const App: React.FC = () => {
  return (
    <StateProvider>
      <AppContent />
    </StateProvider>
  );
};

export default App;
