import React from 'react';
import { StateProvider, useAppState } from './modules/state-session/StateSession';
import { PromptInput } from './modules/prompt-input/PromptInput';
import { ParamPreview } from './modules/param-preview/ParamPreview';

const AppContent: React.FC = () => {
  const { state, dispatch } = useAppState();

  const handleGenerate = async (prompt: string) => {
    dispatch({ type: 'SET_PROMPT', payload: prompt });
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: undefined });

    try {
      const response = await fetch('/api/parametric-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          sessionId: state.sessionId
        }),
      });

      if (!response.ok) {
        throw new Error('生成失败');
      }

      const result = await response.json();
      
      dispatch({ type: 'SET_OPENSCAD_CODE', payload: result.openscadCode });
      dispatch({ type: 'SET_PARAMETERS', payload: result.parameters });
      
      // 模拟编译STL
      setTimeout(() => {
        dispatch({ type: 'SET_STL_DATA', payload: 'mock-stl-data' });
        dispatch({ type: 'SET_LOADING', payload: false });
      }, 1000);

    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : '未知错误' });
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const handleParameterChange = (parameters: Record<string, any>) => {
    dispatch({ type: 'SET_PARAMETERS', payload: parameters });
    
    // 重新编译（模拟）
    setTimeout(() => {
      dispatch({ type: 'SET_STL_DATA', payload: 'mock-stl-data-updated' });
    }, 500);
  };

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
          />
        </div>
      </main>

      <footer className="app-footer">
        <p>会话ID: {state.sessionId || '未连接'}</p>
        <p>状态: {state.isLoading ? '处理中...' : '就绪'}</p>
      </footer>
      
      <style jsx>{`
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

const App: React.FC = () => {
  return (
    <StateProvider>
      <AppContent />
    </StateProvider>
  );
};

export default App;
