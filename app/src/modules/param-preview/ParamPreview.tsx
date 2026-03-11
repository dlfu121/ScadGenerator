import React from 'react';
import { useThreePreview } from '../../hooks/useThreePreview';

interface ParamPreviewCanvasProps {
  stlData?: ArrayBuffer;
  compileStatus: 'queued' | 'running' | 'success' | 'error';
  compileProgress: number;
  compileMessage: string;
  compileError?: string;
  onRetry: () => void;
  onFix: () => void;
  onCloseError: () => void;
}

interface ParameterControlsProps {
  parameters: Record<string, any>;
  onParameterChange: (parameters: Record<string, any>) => void;
}

const getSliderConfig = (value: number) => {
  const abs = Math.max(Math.abs(value), 10);
  const min = Math.floor(Math.min(0, value - abs));
  const max = Math.ceil(value + abs);
  const isInteger = Number.isInteger(value);

  return {
    min,
    max,
    step: isInteger ? 1 : 0.1,
  };
};

export const ParamPreviewCanvas: React.FC<ParamPreviewCanvasProps> = ({
  stlData,
  compileStatus,
  compileProgress,
  compileMessage,
  compileError,
  onRetry,
  onFix,
  onCloseError,
}) => {
  const { mountRef, isLoadingMesh } = useThreePreview(stlData);

  return (
    <div className="preview-module">
      <h3>参数化预览</h3>

      <div className="preview-container">
        <div ref={mountRef} className="three-canvas" />
        {(isLoadingMesh || compileStatus === 'queued' || compileStatus === 'running') && (
          <div className="loading-overlay">
            <div className="loading-spinner">
              <div className="progress-title">{compileMessage || '编译中'}</div>
              <div className="progress-bar">
                <div className="progress-bar-inner" style={{ width: `${compileProgress}%` }} />
              </div>
              <div className="progress-text">{compileProgress}%</div>
            </div>
          </div>
        )}

        {compileStatus === 'error' && (
          <div className="error-overlay">
            <div className="error-card">
              <h4>编译失败</h4>
              <p>{compileError || '未知错误'}</p>
              <div className="error-actions">
                <button type="button" onClick={onRetry}>重试</button>
                <button type="button" className="fix-btn" onClick={onFix}>一键修复</button>
                <button type="button" className="close-btn" onClick={onCloseError}>关闭</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .preview-module {
          display: flex;
          flex-direction: column;
          gap: 12px;
          height: 100%;
        }

        .preview-module h3 {
          margin: 0;
        }

        .preview-container {
          position: relative;
          width: 100%;
          height: 100%;
          min-height: 320px;
          border: 1px solid #ddd;
          border-radius: 8px;
          overflow: hidden;
          background: #fff;
        }

        .three-canvas {
          width: 100%;
          height: 100%;
        }

        .loading-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255, 255, 255, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .loading-spinner {
          width: min(80%, 360px);
          color: #333;
        }

        .progress-title {
          font-size: 14px;
          margin-bottom: 8px;
          text-align: center;
        }

        .progress-bar {
          width: 100%;
          height: 8px;
          background: #dbe4f0;
          border-radius: 999px;
          overflow: hidden;
        }

        .progress-bar-inner {
          height: 100%;
          background: linear-gradient(90deg, #0f766e, #1d4ed8);
          transition: width 180ms ease;
        }

        .progress-text {
          text-align: right;
          margin-top: 6px;
          font-size: 12px;
          color: #475569;
        }

        .error-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.35);
          padding: 12px;
        }

        .error-card {
          width: min(90%, 420px);
          background: #fff;
          border-radius: 10px;
          padding: 14px;
          border: 1px solid #fecaca;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.15);
        }

        .error-card h4 {
          margin: 0 0 8px;
          color: #b91c1c;
        }

        .error-card p {
          margin: 0;
          color: #334155;
          font-size: 13px;
          line-height: 1.45;
          max-height: 130px;
          overflow: auto;
          white-space: pre-wrap;
        }

        .error-actions {
          margin-top: 12px;
          display: flex;
          gap: 8px;
        }

        .error-actions button {
          border: 0;
          background: #1d4ed8;
          color: #fff;
          border-radius: 6px;
          padding: 7px 10px;
          cursor: pointer;
        }

        .error-actions .fix-btn {
          background: #0f766e;
        }

        .error-actions .close-btn {
          background: #6b7280;
        }
      `}</style>
    </div>
  );
};

export const ParameterControls: React.FC<ParameterControlsProps> = ({ parameters, onParameterChange }) => {
  const handleParameterChange = (paramName: string, value: any) => {
    const newParameters = { ...parameters, [paramName]: value };
    onParameterChange(newParameters);
  };

  return (
    <div className="parameter-controls-module">
      <h3>参数控制</h3>

      <div className="parameters-panel">
        {Object.keys(parameters).length === 0 && <p className="empty-tip">暂无可调参数</p>}
        {Object.entries(parameters).map(([name, value]) => (
          <div key={name} className="parameter-control">
            <label>{name}:</label>
            {typeof value === 'number' ? (
              <div className="parameter-slider-group">
                <input
                  type="range"
                  value={value}
                  min={getSliderConfig(value).min}
                  max={getSliderConfig(value).max}
                  step={getSliderConfig(value).step}
                  onChange={(e) => {
                    const newValue = parseFloat(e.target.value);
                    handleParameterChange(name, Number.isFinite(newValue) ? newValue : 0);
                  }}
                  className="parameter-slider"
                />
                <input
                  type="number"
                  value={value}
                  onChange={(e) => {
                    const newValue = parseFloat(e.target.value);
                    handleParameterChange(name, Number.isFinite(newValue) ? newValue : 0);
                  }}
                  className="parameter-input parameter-number"
                />
              </div>
            ) : typeof value === 'boolean' ? (
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => handleParameterChange(name, e.target.checked)}
                className="parameter-checkbox"
              />
            ) : (
              <input
                type="text"
                value={value}
                onChange={(e) => handleParameterChange(name, e.target.value)}
                className="parameter-input"
              />
            )}
          </div>
        ))}
      </div>

      <style>{`
        .parameter-controls-module {
          display: flex;
          flex-direction: column;
          gap: 12px;
          height: 100%;
        }

        .parameter-controls-module h3 {
          margin: 0;
        }

        .parameters-panel {
          background: #f5f5f5;
          padding: 15px;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
          height: 100%;
          overflow: auto;
        }

        .empty-tip {
          margin: 0;
          color: #6b7280;
          font-size: 13px;
        }

        .parameter-control {
          display: flex;
          align-items: center;
          margin-bottom: 10px;
          gap: 10px;
        }

        .parameter-control label {
          min-width: 80px;
          font-weight: bold;
        }

        .parameter-input {
          flex: 1;
          padding: 5px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }

        .parameter-slider-group {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .parameter-slider {
          flex: 1;
          accent-color: #1d4ed8;
          cursor: pointer;
        }

        .parameter-number {
          width: 100px;
          flex: 0 0 100px;
        }

        .parameter-checkbox {
          width: 18px;
          height: 18px;
          accent-color: #1d4ed8;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};

interface ParamPreviewProps extends ParamPreviewCanvasProps {
  parameters: Record<string, any>;
  onParameterChange: (parameters: Record<string, any>) => void;
}

// 兼容旧用法：同时渲染预览和参数控制。
export const ParamPreview: React.FC<ParamPreviewProps> = ({
  stlData,
  parameters,
  compileStatus,
  compileProgress,
  compileMessage,
  compileError,
  onRetry,
  onFix,
  onCloseError,
  onParameterChange,
}) => {
  return (
    <div className="param-preview-module">
      <ParamPreviewCanvas
        stlData={stlData}
        compileStatus={compileStatus}
        compileProgress={compileProgress}
        compileMessage={compileMessage}
        compileError={compileError}
        onRetry={onRetry}
        onFix={onFix}
        onCloseError={onCloseError}
      />
      <ParameterControls parameters={parameters} onParameterChange={onParameterChange} />

      <style>{`
        .param-preview-module {
          display: flex;
          flex-direction: column;
          gap: 16px;
          height: 100%;
        }
      `}</style>
    </div>
  );
};
