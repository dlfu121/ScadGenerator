import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StateProvider, useAppState } from './modules/state-session/StateSession';
import { PromptInput } from './modules/prompt-input/PromptInput';
import { ParamPreviewCanvas, ParameterControls } from './modules/param-preview/ParamPreview';
import { useScadWorkflow } from './hooks/useScadWorkflow';

interface SyntaxIssue {
  line: number;
  message: string;
}

interface HighlightToken {
  text: string;
  kind: 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'builtin' | 'variable' | 'bool' | 'boolOp' | 'operator' | 'csg' | 'bracket';
}

const SCAD_KEYWORDS = new Set([
  'module',
  'function',
  'if',
  'else',
  'for',
  'let',
  'assign',
  'include',
  'use',
  'echo',
  'assert',
  'each',
]);

const SCAD_CSG_WORDS = new Set([
  'union',
  'difference',
  'intersection',
  'hull',
  'minkowski',
  'render',
  'projection',
]);

const SCAD_BUILTINS = new Set([
  'translate',
  'rotate',
  'scale',
  'resize',
  'mirror',
  'multmatrix',
  'color',
  'offset',
  'linear_extrude',
  'rotate_extrude',
  'polygon',
  'text',
  'cube',
  'sphere',
  'cylinder',
  'polyhedron',
  'surface',
  'import',
]);

const BOOLEAN_WORDS = new Set(['true', 'false', 'and', 'or', 'not']);
const TWO_CHAR_OPERATORS = new Set(['&&', '||', '==', '!=', '<=', '>=']);
const SINGLE_CHAR_OPERATORS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '?', ':', '!', ',']);
const BRACKET_CHARS = new Set(['(', ')', '[', ']', '{', '}']);

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function tokenizeScad(code: string): HighlightToken[][] {
  const lines = code.split('\n');
  const highlightedLines: HighlightToken[][] = [];
  let inBlockComment = false;

  for (const line of lines) {
    const tokens: HighlightToken[] = [];
    let index = 0;

    while (index < line.length) {
      const current = line[index];
      const next = line[index + 1] || '';

      if (inBlockComment) {
        const endIndex = line.indexOf('*/', index);
        if (endIndex === -1) {
          tokens.push({ text: line.slice(index), kind: 'comment' });
          index = line.length;
          continue;
        }

        tokens.push({ text: line.slice(index, endIndex + 2), kind: 'comment' });
        index = endIndex + 2;
        inBlockComment = false;
        continue;
      }

      if (current === '/' && next === '/') {
        tokens.push({ text: line.slice(index), kind: 'comment' });
        break;
      }

      if (current === '/' && next === '*') {
        const endIndex = line.indexOf('*/', index + 2);
        if (endIndex === -1) {
          tokens.push({ text: line.slice(index), kind: 'comment' });
          inBlockComment = true;
          break;
        }

        tokens.push({ text: line.slice(index, endIndex + 2), kind: 'comment' });
        index = endIndex + 2;
        continue;
      }

      if (current === '"' || current === '\'') {
        const quote = current;
        let endIndex = index + 1;
        while (endIndex < line.length) {
          const candidate = line[endIndex];
          if (candidate === quote && line[endIndex - 1] !== '\\') {
            endIndex += 1;
            break;
          }
          endIndex += 1;
        }
        tokens.push({ text: line.slice(index, endIndex), kind: 'string' });
        index = endIndex;
        continue;
      }

      if (/\s/.test(current)) {
        let endIndex = index + 1;
        while (endIndex < line.length && /\s/.test(line[endIndex])) {
          endIndex += 1;
        }
        tokens.push({ text: line.slice(index, endIndex), kind: 'plain' });
        index = endIndex;
        continue;
      }

      if (/\d/.test(current) || (current === '.' && /\d/.test(next))) {
        let endIndex = index + 1;
        while (endIndex < line.length && /[0-9.]/.test(line[endIndex])) {
          endIndex += 1;
        }
        tokens.push({ text: line.slice(index, endIndex), kind: 'number' });
        index = endIndex;
        continue;
      }

      if (isIdentifierStart(current)) {
        let endIndex = index + 1;
        while (endIndex < line.length && isIdentifierPart(line[endIndex])) {
          endIndex += 1;
        }
        const word = line.slice(index, endIndex);

        if (SCAD_CSG_WORDS.has(word)) {
          tokens.push({ text: word, kind: 'csg' });
        } else if (SCAD_KEYWORDS.has(word)) {
          tokens.push({ text: word, kind: 'keyword' });
        } else if (BOOLEAN_WORDS.has(word)) {
          tokens.push({ text: word, kind: 'bool' });
        } else if (SCAD_BUILTINS.has(word)) {
          tokens.push({ text: word, kind: 'builtin' });
        } else {
          tokens.push({ text: word, kind: 'variable' });
        }

        index = endIndex;
        continue;
      }

      const twoChar = `${current}${next}`;
      if (TWO_CHAR_OPERATORS.has(twoChar)) {
        tokens.push({ text: twoChar, kind: twoChar === '&&' || twoChar === '||' ? 'boolOp' : 'operator' });
        index += 2;
        continue;
      }

      if (BRACKET_CHARS.has(current)) {
        tokens.push({ text: current, kind: 'bracket' });
        index += 1;
        continue;
      }

      if (SINGLE_CHAR_OPERATORS.has(current)) {
        tokens.push({ text: current, kind: current === '!' ? 'boolOp' : 'operator' });
        index += 1;
        continue;
      }

      tokens.push({ text: current, kind: 'plain' });
      index += 1;
    }

    highlightedLines.push(tokens);
  }

  return highlightedLines;
}

function analyzeScadSyntax(code: string): SyntaxIssue[] {
  if (!code.trim()) {
    return [];
  }

  const issues: SyntaxIssue[] = [];
  const stack: Array<{ expected: string; line: number }> = [];
  const openingToClosing: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
  };
  const closingChars = new Set(Object.values(openingToClosing));

  let line = 1;
  let inSingleLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < code.length; i += 1) {
    const current = code[i];
    const next = code[i + 1] || '';

    if (current === '\n') {
      line += 1;
      inSingleLineComment = false;
      continue;
    }

    if (inSingleLineComment) {
      continue;
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && current === '/' && next === '/') {
      inSingleLineComment = true;
      i += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && current === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (!inDoubleQuote && current === '\'' && code[i - 1] !== '\\') {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && current === '"' && code[i - 1] !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (current in openingToClosing) {
      stack.push({ expected: openingToClosing[current], line });
      continue;
    }

    if (closingChars.has(current)) {
      const expected = stack.pop();
      if (!expected || expected.expected !== current) {
        issues.push({ line, message: `括号不匹配，遇到 ${current}` });
      }
    }
  }

  for (const unclosed of stack) {
    issues.push({ line: unclosed.line, message: `未闭合括号，缺少 ${unclosed.expected}` });
  }

  return issues;
}

// 页面主容器：协调输入、生成、参数预览三大模块。
const AppContent: React.FC = () => {
  const { state, dispatch } = useAppState();
  const [rightView, setRightView] = useState<'code' | 'preview' | 'csg' | 'parameters'>('code');
  const [csgTreeText, setCsgTreeText] = useState('');
  const [csgTreeError, setCsgTreeError] = useState<string | undefined>(undefined);
  const [lastCsgSourceKey, setLastCsgSourceKey] = useState('');
  const codeEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const syntaxOverlayRef = useRef<HTMLDivElement | null>(null);
  const syntaxIssues = useMemo(() => analyzeScadSyntax(state.openscadCode), [state.openscadCode]);
  const syntaxErrorLineSet = useMemo(() => new Set(syntaxIssues.map((item) => item.line)), [syntaxIssues]);
  const totalLines = useMemo(() => Math.max(1, state.openscadCode.split('\n').length), [state.openscadCode]);
  const highlightedLines = useMemo(() => tokenizeScad(state.openscadCode), [state.openscadCode]);
  const csgSourceKey = useMemo(
    () => `${state.openscadCode}::${JSON.stringify(state.parameters || {})}`,
    [state.openscadCode, state.parameters]
  );
  const {
    handleGenerate,
    handleParameterChange,
    handleCodeChange,
    handleCompileNow,
    handleRetry,
    handleFix,
    handleCloseError,
    handleExportSTL,
    handleViewCSGTree,
  } = useScadWorkflow({ state, dispatch });

  const openCSGView = useCallback(() => {
    setRightView('csg');

    if (!state.openscadCode.trim()) {
      setCsgTreeText('');
      setCsgTreeError('当前没有可展示的 OpenSCAD 代码。');
      return;
    }

    if (csgTreeText && lastCsgSourceKey === csgSourceKey) {
      return;
    }

    setCsgTreeError(undefined);
    void (async () => {
      const result = await handleViewCSGTree();
      if (!result.success || !result.text) {
        setCsgTreeText('');
        setCsgTreeError(result.error || '获取 CSG 树失败。');
        return;
      }

      setCsgTreeText(result.text);
      setLastCsgSourceKey(csgSourceKey);
    })();
  }, [csgSourceKey, csgTreeText, handleViewCSGTree, lastCsgSourceKey, state.openscadCode]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>参数化 OpenSCAD 生成工具</h1>
        <p>输入描述，生成参数化3D模型</p>
      </header>

      <main className="app-main">
        <section className="column left-column">
          <div className="panel chat-panel">
            <PromptInput
              onGenerate={handleGenerate}
              isLoading={state.isLoading}
              progressTrail={state.aiProgressTrail}
            />
          </div>
        </section>

        <section className="column right-column">
          <div className="panel top-panel content-panel">
            <div className="content-panel-header">
              <h3>模型工作区</h3>
              <div className="view-switch">
                <button
                  type="button"
                  className={`view-switch-button ${rightView === 'preview' ? 'active' : ''}`}
                  onClick={() => setRightView('preview')}
                >
                  预览
                </button>
                <button
                  type="button"
                  className={`view-switch-button ${rightView === 'code' ? 'active' : ''}`}
                  onClick={() => setRightView('code')}
                >
                  SCAD代码
                </button>
                <button
                  type="button"
                  className={`view-switch-button ${rightView === 'parameters' ? 'active' : ''}`}
                  onClick={() => setRightView('parameters')}
                >
                  参数控制
                </button>
                <button
                  type="button"
                  className={`view-switch-button ${rightView === 'csg' ? 'active' : ''}`}
                  onClick={openCSGView}
                >
                  CSG树
                </button>
              </div>
            </div>

            {rightView === 'code' ? (
              <div className="code-panel">
                <div className="code-panel-header">
                  <h4>生成的 OpenSCAD 代码</h4>
                  <div className="code-actions">
                    <button
                      type="button"
                      className="fix-now-button"
                      onClick={() => {
                        void handleFix();
                      }}
                      disabled={!state.openscadCode.trim() || state.isLoading}
                    >
                      自动修复
                    </button>
                    <button
                      type="button"
                      className="compile-now-button"
                      onClick={handleCompileNow}
                      disabled={!state.openscadCode.trim() || state.isLoading}
                    >
                      立即编译
                    </button>
                    <button
                      type="button"
                      className="export-stl-button"
                      onClick={() => {
                        void handleExportSTL();
                      }}
                      disabled={!state.openscadCode.trim() || state.isLoading}
                    >
                      导出 STL
                    </button>
                  </div>
                </div>
                <div className="code-editor-shell">
                  <div className="line-gutter" ref={gutterRef} aria-hidden="true">
                    {Array.from({ length: totalLines }).map((_, index) => {
                      const line = index + 1;
                      return (
                        <div
                          key={`line-${line}`}
                          className={`line-number ${syntaxErrorLineSet.has(line) ? 'error' : ''}`}
                        >
                          {line}
                        </div>
                      );
                    })}
                  </div>

                  <div className="code-editor-stack">
                    <div className="line-highlight-overlay" ref={overlayRef} aria-hidden="true">
                      {Array.from({ length: totalLines }).map((_, index) => {
                        const line = index + 1;
                        return (
                          <div
                            key={`highlight-${line}`}
                            className={`line-highlight ${syntaxErrorLineSet.has(line) ? 'error' : ''}`}
                          />
                        );
                      })}
                    </div>

                    <div className="syntax-token-overlay" ref={syntaxOverlayRef} aria-hidden="true">
                      {highlightedLines.map((lineTokens, lineIndex) => (
                        <div key={`syntax-line-${lineIndex + 1}`} className="syntax-line">
                          {lineTokens.length === 0 ? (
                            ' '
                          ) : (
                            lineTokens.map((token, tokenIndex) => (
                              <span key={`tok-${lineIndex + 1}-${tokenIndex}`} className={`tok tok-${token.kind}`}>
                                {token.text}
                              </span>
                            ))
                          )}
                        </div>
                      ))}
                    </div>

                    <textarea
                      ref={codeEditorRef}
                      value={state.openscadCode}
                      onChange={(event) => handleCodeChange(event.target.value)}
                      onScroll={(event) => {
                        const target = event.currentTarget;
                        if (gutterRef.current) {
                          gutterRef.current.scrollTop = target.scrollTop;
                        }
                        if (overlayRef.current) {
                          overlayRef.current.scrollTop = target.scrollTop;
                          overlayRef.current.scrollLeft = target.scrollLeft;
                        }
                        if (syntaxOverlayRef.current) {
                          syntaxOverlayRef.current.scrollTop = target.scrollTop;
                          syntaxOverlayRef.current.scrollLeft = target.scrollLeft;
                        }
                      }}
                      onKeyDown={(event) => {
                        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                          event.preventDefault();
                          void handleCompileNow();
                        }
                      }}
                      className={`code-editor ${syntaxIssues.length > 0 ? 'has-syntax-error' : ''}`}
                      rows={16}
                      spellCheck={false}
                      wrap="off"
                      placeholder="先输入自然语言并点击生成，或直接在此粘贴/编辑 OpenSCAD 代码"
                    />
                  </div>
                </div>
                <p className="code-editor-tip">编辑代码后将自动同步参数控制并重新编译预览。按 Ctrl+Enter 可立即编译。</p>
                {syntaxIssues.length > 0 && (
                  <div className="syntax-error-list" role="alert">
                    <h5>语法检查</h5>
                    <ul>
                      {syntaxIssues.slice(0, 8).map((issue, index) => (
                        <li key={`syntax-${issue.line}-${index}`}>
                          第 {issue.line} 行: {issue.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {state.error && (
                  <div className="error-message">
                    错误: {state.error}
                  </div>
                )}
              </div>
            ) : rightView === 'preview' ? (
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
            ) : rightView === 'parameters' ? (
              <div className="parameters-panel">
                <ParameterControls
                  parameters={state.parameters}
                  onParameterChange={handleParameterChange}
                />
              </div>
            ) : (
              <div className="csg-tree-panel">
                <div className="csg-tree-header">
                  <h4>CSG 树</h4>
                  <button
                    type="button"
                    className="refresh-csg-button"
                    onClick={() => {
                      setCsgTreeText('');
                      setLastCsgSourceKey('');
                      openCSGView();
                    }}
                    disabled={!state.openscadCode.trim() || state.isLoading}
                  >
                    刷新
                  </button>
                </div>
                {csgTreeError ? (
                  <div className="error-message">错误: {csgTreeError}</div>
                ) : (
                  <pre className="csg-tree-content">{csgTreeText || '正在加载 CSG 树...'}</pre>
                )}
              </div>
            )}
          </div>
        </section>
      </main>


      <style>{`
        html,
        body,
        #root {
          height: 100%;
          margin: 0;
        }

        body {
          overflow: hidden;
        }

        .app {
          height: 100%;
          display: flex;
          flex-direction: column;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          overflow-x: hidden;
          overflow-y: hidden;
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
          grid-template-columns: minmax(340px, 0.85fr) minmax(460px, 1.15fr);
          gap: 20px;
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
          width: 100%;
          min-width: 0;
          min-height: 0;
          overflow: hidden;
        }

        .column {
          min-height: 0;
          min-width: 0;
        }

        .left-column {
          display: flex;
          height: 100%;
          min-height: 0;
        }

        .right-column {
          display: grid;
          grid-template-rows: 1fr;
          gap: 20px;
          height: 100%;
          min-height: 0;
          min-width: 0;
        }

        .top-panel {
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }

        .panel {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 14px;
          min-height: 0;
          min-width: 0;
          overflow: hidden;
        }

        .chat-panel {
          padding: 0;
          display: flex;
          flex: 1;
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }

        .content-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          height: 100%;
          min-width: 0;
          min-height: 0;
          overflow: hidden;
        }

        .content-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .content-panel-header h3 {
          margin: 0;
          color: #0f172a;
          font-size: 18px;
        }

        .view-switch {
          display: inline-flex;
          gap: 6px;
          background: #e2e8f0;
          border-radius: 8px;
          padding: 4px;
        }

        .view-switch-button {
          border: none;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 12px;
          color: #334155;
          background: transparent;
          cursor: pointer;
        }

        .view-switch-button.active {
          background: #ffffff;
          color: #0f172a;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
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

        .code-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .code-panel {
          display: flex;
          flex-direction: column;
          min-height: 0;
          min-width: 0;
          height: 100%;
          overflow: hidden;
        }

        .code-panel h4 {
          margin: 0;
          color: #495057;
          font-size: 15px;
        }

        .compile-now-button {
          border: 0;
          border-radius: 6px;
          background: #0f766e;
          color: #fff;
          padding: 8px 12px;
          font-size: 13px;
          cursor: pointer;
          white-space: nowrap;
        }

        .export-stl-button {
          border: 0;
          border-radius: 6px;
          background: #2563eb;
          color: #fff;
          padding: 8px 12px;
          font-size: 13px;
          cursor: pointer;
          white-space: nowrap;
        }

        .code-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .fix-now-button {
          border: 0;
          border-radius: 6px;
          background: #1d4ed8;
          color: #fff;
          padding: 8px 12px;
          font-size: 13px;
          cursor: pointer;
          white-space: nowrap;
        }

        .fix-now-button:disabled {
          background: #94a3b8;
          cursor: not-allowed;
        }

        .compile-now-button:disabled {
          background: #94a3b8;
          cursor: not-allowed;
        }

        .export-stl-button:disabled {
          background: #94a3b8;
          cursor: not-allowed;
        }

        .csg-tree-panel {
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .csg-tree-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .csg-tree-header h4 {
          margin: 0;
          color: #495057;
          font-size: 15px;
        }

        .refresh-csg-button {
          border: 0;
          border-radius: 6px;
          background: #334155;
          color: #fff;
          padding: 8px 12px;
          font-size: 13px;
          cursor: pointer;
          white-space: nowrap;
        }

        .refresh-csg-button:disabled {
          background: #94a3b8;
          cursor: not-allowed;
        }

        .csg-tree-content {
          margin: 0;
          flex: 1;
          min-height: 280px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #0f172a;
          color: #e2e8f0;
          padding: 12px;
          overflow: auto;
          font-family: 'Consolas', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 12px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .code-editor-shell {
          --vscode-editor-bg: #1e1e1e;
          --vscode-editor-fg: #d4d4d4;
          --vscode-gutter-bg: #252526;
          --vscode-gutter-border: #2d2d30;
          --vscode-gutter-fg: #858585;
          --vscode-line-error: rgba(244, 71, 71, 0.2);
          --vscode-token-comment: #6a9955;
          --vscode-token-string: #ce9178;
          --vscode-token-number: #b5cea8;
          --vscode-token-keyword: #c586c0;
          --vscode-token-builtin: #dcdcaa;
          --vscode-token-variable: #9cdcfe;
          --vscode-token-bool: #569cd6;
          --vscode-token-bool-op: #d7ba7d;
          --vscode-token-operator: #d4d4d4;
          --vscode-token-csg: #4ec9b0;
          --vscode-token-bracket: #ffd700;
          display: grid;
          grid-template-columns: 52px 1fr;
          min-height: 0;
          height: 100%;
          flex: 1;
          min-width: 0;
          border: 1px solid #2d2d30;
          border-radius: 6px;
          overflow: hidden;
          background: var(--vscode-editor-bg);
        }

        .line-gutter {
          background: var(--vscode-gutter-bg);
          border-right: 1px solid var(--vscode-gutter-border);
          overflow: hidden;
          padding: 10px 0;
        }

        .line-number {
          height: 20px;
          line-height: 20px;
          text-align: right;
          padding: 0 10px;
          font-size: 12px;
          color: var(--vscode-gutter-fg);
          font-family: 'Consolas', 'Menlo', monospace;
        }

        .line-number.error {
          color: #f48771;
          background: var(--vscode-line-error);
          font-weight: 600;
        }

        .code-editor-stack {
          position: relative;
          background: var(--vscode-editor-bg);
          height: 100%;
          min-height: 0;
          min-width: 0;
          overflow: hidden;
        }

        .line-highlight-overlay {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          padding: 10px;
          z-index: 1;
          box-sizing: border-box;
          tab-size: 2;
        }

        .line-highlight {
          height: 20px;
          line-height: 20px;
        }

        .line-highlight.error {
          background: var(--vscode-line-error);
          border-left: 2px solid #f48771;
        }

        .syntax-token-overlay {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          padding: 10px;
          z-index: 2;
          font-family: 'Consolas', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 14px;
          line-height: 20px;
          white-space: pre;
          color: var(--vscode-editor-fg);
          box-sizing: border-box;
          tab-size: 2;
        }

        .syntax-line {
          height: 20px;
          line-height: 20px;
          white-space: pre;
        }

        .tok {
          color: var(--vscode-editor-fg);
        }

        .tok-comment {
          color: var(--vscode-token-comment);
        }

        .tok-string {
          color: var(--vscode-token-string);
        }

        .tok-number {
          color: var(--vscode-token-number);
        }

        .tok-keyword {
          color: var(--vscode-token-keyword);
        }

        .tok-builtin {
          color: var(--vscode-token-builtin);
        }

        .tok-variable {
          color: var(--vscode-token-variable);
        }

        .tok-bool {
          color: var(--vscode-token-bool);
        }

        .tok-boolOp {
          color: var(--vscode-token-bool-op);
        }

        .tok-operator {
          color: var(--vscode-token-operator);
        }

        .tok-csg {
          color: var(--vscode-token-csg);
        }

        .tok-bracket {
          color: var(--vscode-token-bracket);
        }

        .code-editor {
          position: relative;
          z-index: 3;
          display: block;
          width: 100%;
          height: 100%;
          min-height: 0;
          background: transparent;
          padding: 10px;
          border: none;
          outline: none;
          overflow-x: auto;
          overflow-y: scroll;
          overscroll-behavior: contain;
          font-family: 'Consolas', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 14px;
          line-height: 20px;
          resize: none;
          color: transparent;
          -webkit-text-fill-color: transparent;
          caret-color: var(--vscode-editor-fg);
          white-space: pre;
          box-sizing: border-box;
          tab-size: 2;
        }

        .code-editor.has-syntax-error {
          box-shadow: inset 0 0 0 1px rgba(244, 71, 71, 0.45);
        }

        .code-editor::placeholder {
          color: #8b949e;
          -webkit-text-fill-color: #8b949e;
        }

        .syntax-error-list {
          margin-top: 8px;
          border: 1px solid #fecaca;
          background: #fef2f2;
          border-radius: 6px;
          padding: 8px 10px;
        }

        .syntax-error-list h5 {
          margin: 0 0 6px;
          color: #991b1b;
          font-size: 12px;
        }

        .syntax-error-list ul {
          margin: 0;
          padding-left: 16px;
          max-height: 110px;
          overflow: auto;
          color: #991b1b;
          font-size: 12px;
        }

        .code-editor-tip {
          margin: 8px 0 0;
          color: #6b7280;
          font-size: 12px;
        }

        .parameters-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          width: 100%;
          overflow: hidden;
        }

        @media (max-width: 768px) {
          .app-main {
            grid-template-columns: 1fr;
          }

          .right-column {
            grid-template-rows: 1fr;
          }

          .content-panel-header {
            flex-wrap: wrap;
          }

          .view-switch {
            width: 100%;
          }

          .view-switch-button {
            flex: 1;
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
