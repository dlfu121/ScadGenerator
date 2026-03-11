import React from 'react';
import { StateProvider, useAppState } from './modules/state-session/StateSession';
import { PromptInput } from './modules/prompt-input/PromptInput';
import { ParamPreviewCanvas, ParameterControls } from './modules/param-preview/ParamPreview';
import { useScadWorkflow } from './hooks/useScadWorkflow';

// 页面主容器：协调输入、生成、参数预览三大模块。
const AppContent: React.FC = () => {
  const { state, dispatch } = useAppState();
  const {
    handleGenerate,
    handleParameterChange,
    handleCodeChange,
    handleRetry,
    handleFix,
    handleCloseError,
  } = useScadWorkflow({ state, dispatch });

  return (
    <div className="app">
      <header className="app-header">
        <h1>参数化 OpenSCAD 生成工具</h1>
        <p>输入描述，生成参数化3D模型</p>
      </header>

      <main className="app-main">
        <section className="column left-column">
          <div className="panel top-panel code-panel">
            <h3>生成的OpenSCAD代码</h3>
            <textarea
              value={state.openscadCode}
              onChange={(event) => handleCodeChange(event.target.value)}
              className="code-editor"
              rows={16}
              spellCheck={false}
              placeholder="先输入自然语言并点击生成，或直接在此粘贴/编辑 OpenSCAD 代码"
            />
            <p className="code-editor-tip">编辑代码后将自动同步参数控制并重新编译预览。</p>
            {state.error && (
              <div className="error-message">
                错误: {state.error}
              </div>
            )}
          </div>

          <div className="panel bottom-panel prompt-panel">
            <PromptInput
              onGenerate={handleGenerate}
              isLoading={state.isLoading}
            />
          </div>
        </section>

        <section className="column right-column">
          <div className="panel top-panel preview-panel">
            <ParamPreviewCanvas
              stlData={state.stlData}
              compileStatus={state.compileStatus}
              compileProgress={state.compileProgress}
              compileMessage={state.compileMessage}
              compileError={state.compileErrorDetail || state.error}
              onRetry={handleRetry}
              onFix={handleFix}
              onCloseError={handleCloseError}
            />
          </div>

          <div className="panel bottom-panel controls-panel">
            <ParameterControls
              parameters={state.parameters}
              onParameterChange={handleParameterChange}
            />
          </div>
        </section>
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
          display: grid;
          grid-template-columns: minmax(420px, 1fr) minmax(420px, 1fr);
          gap: 20px;
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
          width: 100%;
        }

        .column {
          display: grid;
          grid-template-rows: 1fr auto;
          gap: 20px;
          min-height: 0;
        }

        .panel {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 14px;
          min-height: 0;
          overflow: hidden;
        }

        .prompt-panel {
          padding: 0;
          border: none;
          background: transparent;
          min-height: auto;
          max-height: 180px;
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

        .code-panel h3 {
          margin: 0 0 10px 0;
          color: #495057;
        }

        .code-editor {
          width: 100%;
          background: #f1f3f4;
          padding: 10px;
          border: 1px solid #d0d7de;
          border-radius: 4px;
          overflow-x: auto;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 14px;
          line-height: 1.4;
          resize: vertical;
          min-height: 320px;
          height: calc(100% - 56px);
        }

        .code-editor-tip {
          margin: 8px 0 0;
          color: #6b7280;
          font-size: 12px;
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
            grid-template-columns: 1fr;
          }

          .column {
            grid-template-rows: auto auto;
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
