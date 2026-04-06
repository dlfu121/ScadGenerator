import React, { useEffect, useMemo, useState } from 'react';
import { diffLines } from 'diff';
import type { Change } from 'diff';

export type MergeSegment =
  | { type: 'context'; value: string }
  | { type: 'replace'; id: number; removed: string; added: string }
  | { type: 'delete'; id: number; removed: string }
  | { type: 'insert'; id: number; added: string };

/** 将 diffLines 结果拆成可独立「采纳/保留原文」的片段 */
export function buildMergeSegments(before: string, after: string): MergeSegment[] {
  const a = before.replace(/\r\n/g, '\n');
  const b = after.replace(/\r\n/g, '\n');
  const changes: Change[] = diffLines(a, b);
  const segments: MergeSegment[] = [];
  let id = 0;
  let i = 0;

  while (i < changes.length) {
    const c = changes[i];
    if (!c.added && !c.removed) {
      segments.push({ type: 'context', value: c.value });
      i += 1;
    } else if (c.removed) {
      const removed = c.value;
      const next = changes[i + 1];
      if (next?.added) {
        segments.push({ type: 'replace', id: id++, removed, added: next.value });
        i += 2;
      } else {
        segments.push({ type: 'delete', id: id++, removed });
        i += 1;
      }
    } else if (c.added) {
      segments.push({ type: 'insert', id: id++, added: c.value });
      i += 1;
    } else {
      i += 1;
    }
  }

  return segments;
}

/** 根据每块是否采纳变更，拼出合并后的完整源码 */
export function mergeSegmentsToCode(segments: MergeSegment[], accepted: Record<number, boolean>): string {
  let out = '';
  for (const seg of segments) {
    if (seg.type === 'context') {
      out += seg.value;
      continue;
    }
    const adopt = accepted[seg.id] !== false;
    if (seg.type === 'replace') {
      out += adopt ? seg.added : seg.removed;
    } else if (seg.type === 'delete') {
      if (!adopt) {
        out += seg.removed;
      }
    } else if (seg.type === 'insert') {
      if (adopt) {
        out += seg.added;
      }
    }
  }
  return out;
}

function chunkToLines(raw: string): string[] {
  const v = raw.replace(/\r\n/g, '\n');
  let lines = v.split('\n');
  if (lines.length && lines[lines.length - 1] === '' && v.endsWith('\n')) {
    lines = lines.slice(0, -1);
  }
  return lines;
}

const SOURCE_LABELS: Record<string, string> = {
  generate: '生成 / 修订',
  fix: '自动修复',
  direct: '对话注入代码',
};

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

function stripScadComments(s: string): string {
  return s
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 根据片段中的 OpenSCAD 结构做简短中文「功能」说明（启发式，非语义理解）。
 */
export function inferScadBlockPurpose(segment: MergeSegment): string {
  let raw: string;
  switch (segment.type) {
    case 'context':
      return '未改动的上下文行';
    case 'replace':
      raw = `${segment.removed}\n${segment.added}`;
      break;
    case 'delete':
      raw = segment.removed;
      break;
    case 'insert':
      raw = segment.added;
      break;
  }
  const t = stripScadComments(raw).toLowerCase();
  const tags: string[] = [];
  const add = (label: string) => {
    if (!tags.includes(label)) {
      tags.push(label);
    }
  };

  if (/\bdifference\s*\(/.test(t)) add('布尔差（挖槽/开孔等）');
  if (/\bunion\s*\(/.test(t)) add('合并几何体');
  if (/\bintersection\s*\(/.test(t)) add('实体求交');
  if (/\bhull\s*\(/.test(t)) add('凸包');
  if (/\bminkowski\s*\(/.test(t)) add('闵夫斯基和');
  if (/\blinear_extrude\s*\(/.test(t)) add('线性拉伸成实体');
  if (/\brotate_extrude\s*\(/.test(t)) add('旋转拉伸成实体');
  if (/\bprojection\s*\(/.test(t)) add('投影');
  if (/\brender\s*\(/.test(t)) add('显式渲染');
  if (/\bimport\s*\(/.test(t)) add('导入外部网格');
  if (/\bsurface\s*\(/.test(t)) add('高度图曲面');
  if (/\bcube\s*\(/.test(t)) add('立方体');
  if (/\bsphere\s*\(/.test(t)) add('球体');
  if (/\bcylinder\s*\(/.test(t)) add('圆柱体');
  if (/\bpolygon\s*\(/.test(t)) add('多边形面');
  if (/\btext\s*\(/.test(t)) add('文字几何');
  if (/\btranslate\s*\(/.test(t)) add('平移');
  if (/\brotate\s*\(/.test(t)) add('旋转');
  if (/\bscale\s*\(/.test(t)) add('缩放');
  if (/\bresize\s*\(/.test(t)) add('调整尺寸');
  if (/\bmirror\s*\(/.test(t)) add('镜像');
  if (/\bmultmatrix\s*\(/.test(t)) add('变换矩阵');
  if (/\boffset\s*\(/.test(t)) add('偏移/圆角轮廓');
  if (/\bcolor\s*\(/.test(t)) add('颜色');
  if (/\bmodule\s+/.test(t)) add('模块定义');
  if (/\bfunction\s+/.test(t)) add('函数定义');
  if (/\bfor\s*\(/.test(t)) add('循环/阵列');
  if (/\blet\s*\(/.test(t)) add('局部绑定');
  if (/\beach\s*\(/.test(t)) add('遍历');
  if (/\binclude\s*</.test(t) || /\binclude\s*"/.test(t)) add('包含文件');
  if (/\buse\s*</.test(t) || /\buse\s*"/.test(t)) add('引用库');

  const paramLine = raw.match(/^\s*([A-Za-z_]\w*)\s*=\s*[^;\n]+;/m);
  if (paramLine && tags.length < 6) {
    add(`顶层参数「${paramLine[1]}」`);
  }

  if (tags.length > 0) {
    return `本块主要影响：${tags.slice(0, 6).join('、')}${tags.length > 6 ? '…' : ''}`;
  }

  const first = raw
    .split('\n')
    .map((line: string) => line.trim())
    .find((line: string) => line.length > 0);
  if (first) {
    const one = first.length > 88 ? `${first.slice(0, 88)}…` : first;
    return `代码变更片段：${one}`;
  }
  return 'OpenSCAD 文本变更（内容较短或仅空白）';
}

/** 会话里逐块展示的「修改块功能」行 */
export interface WorkspaceApplyBlockLine {
  kindLabel: '替换' | '删除' | '插入';
  adopted: boolean;
  /** 本地规则摘要；AI 失败时用于会话展示 */
  purpose: string;
}

/** 与后端 DiffExplainBlockInput 一致，供 /explain-diff-blocks */
export interface WorkspaceDiffExplainBlock {
  index: number;
  kind: 'replace' | 'delete' | 'insert';
  adopted: boolean;
  removed?: string;
  added?: string;
}

/** 应用合并时一并传给上层，用于在会话区说明采纳情况 */
export interface WorkspaceApplyMeta {
  source: 'generate' | 'fix' | 'direct';
  totalBlocks: number;
  adoptedBlocks: number;
  rejectedBlocks: number;
  /** 合并结果是否与「当前编辑器版本」全文一致（无有效变更） */
  mergedEqualsBefore: boolean;
  /** 每块说明是否均已成功来自审阅区 AI（用于会话标注） */
  aiBlockHelpFromApi: boolean;
  /** 按差异顺序，每块在模型上的作用说明（含本地兜底摘要） */
  blockLines: WorkspaceApplyBlockLine[];
  /** 供 AI 解释接口的块（含删/增全文） */
  explainBlocks: WorkspaceDiffExplainBlock[];
}

export function buildExplainPayloadFromSegments(
  segments: MergeSegment[],
  getAdopted: (segId: number) => boolean
): WorkspaceDiffExplainBlock[] {
  const out: WorkspaceDiffExplainBlock[] = [];
  let blockOrdinal = 0;
  for (const seg of segments) {
    if (seg.type === 'context') {
      continue;
    }
    blockOrdinal += 1;
    const adopted = getAdopted(seg.id);
    if (seg.type === 'replace') {
      out.push({ index: blockOrdinal, kind: 'replace', adopted, removed: seg.removed, added: seg.added });
    } else if (seg.type === 'delete') {
      out.push({ index: blockOrdinal, kind: 'delete', adopted, removed: seg.removed });
    } else {
      out.push({ index: blockOrdinal, kind: 'insert', adopted, added: seg.added });
    }
  }
  return out;
}

export async function fetchDiffBlockAiExplanations(blocks: WorkspaceDiffExplainBlock[]): Promise<string[] | null> {
  if (blocks.length === 0) {
    return [];
  }
  try {
    const res = await fetch('/api/parametric-chat/explain-diff-blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { explanations?: unknown };
    if (!Array.isArray(data.explanations)) {
      return null;
    }
    const strs = data.explanations.map((x) => (typeof x === 'string' ? x : String(x ?? '')));
    if (strs.length !== blocks.length) {
      return null;
    }
    return strs;
  } catch {
    return null;
  }
}

export interface CodeDiffReviewProps {
  before: string;
  after: string;
  source: 'generate' | 'fix' | 'direct';
  /** 由父组件在展示审阅前拉取的各块 AI/兜底说明（与左侧会话同步） */
  aiBySegId: Record<number, string>;
  aiExplainPhase: 'idle' | 'loading' | 'done' | 'error';
  /** 生成流程写入：块说明是否来自 AI（未定义时由 phase 推断） */
  explainsFromApi?: boolean;
  /** 传入合并后的完整代码与统计信息，供会话区展示 */
  onApply: (mergedCode: string, meta: WorkspaceApplyMeta) => void | Promise<void>;
  onDiscardAll: () => void;
  disabled?: boolean;
}

export const CodeDiffReview: React.FC<CodeDiffReviewProps> = ({
  before,
  after,
  source,
  aiBySegId,
  aiExplainPhase,
  explainsFromApi,
  onApply,
  onDiscardAll,
  disabled,
}) => {
  const segments = useMemo(() => buildMergeSegments(before, after), [before, after]);

  const changeIds = useMemo(() => {
    const ids: number[] = [];
    for (const s of segments) {
      if (s.type !== 'context') ids.push(s.id);
    }
    return ids;
  }, [segments]);

  const [accepted, setAccepted] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const next: Record<number, boolean> = {};
    for (const id of changeIds) {
      next[id] = true;
    }
    setAccepted(next);
  }, [before, after, changeIds.join(',')]);

  const mergedPreview = useMemo(() => mergeSegmentsToCode(segments, accepted), [segments, accepted]);

  const applyMeta = useMemo((): WorkspaceApplyMeta => {
    let adopted = 0;
    let rejected = 0;
    for (const id of changeIds) {
      if (accepted[id] !== false) {
        adopted += 1;
      } else {
        rejected += 1;
      }
    }

    const explainBlocks = buildExplainPayloadFromSegments(segments, (id) => accepted[id] !== false);
    const blockLines: WorkspaceApplyBlockLine[] = [];

    for (const seg of segments) {
      if (seg.type === 'context') {
        continue;
      }
      const kindLabel: WorkspaceApplyBlockLine['kindLabel'] =
        seg.type === 'replace' ? '替换' : seg.type === 'delete' ? '删除' : '插入';
      const adoptedFlag = accepted[seg.id] !== false;
      const aiLine = aiBySegId[seg.id]?.trim();
      blockLines.push({
        kindLabel,
        adopted: adoptedFlag,
        purpose: aiLine || inferScadBlockPurpose(seg),
      });
    }

    const aiBlockHelpFromApi =
      explainsFromApi === true &&
      changeIds.length > 0 &&
      changeIds.every((id) => Boolean(aiBySegId[id]?.trim()));

    return {
      source,
      totalBlocks: changeIds.length,
      adoptedBlocks: adopted,
      rejectedBlocks: rejected,
      mergedEqualsBefore: normalizeNewlines(mergedPreview) === normalizeNewlines(before),
      aiBlockHelpFromApi,
      blockLines,
      explainBlocks,
    };
  }, [accepted, aiBySegId, aiExplainPhase, before, changeIds, explainsFromApi, mergedPreview, segments, source]);

  const stats = useMemo(() => {
    let add = 0;
    let del = 0;
    const changes = diffLines(before.replace(/\r\n/g, '\n'), after.replace(/\r\n/g, '\n'));
    for (const c of changes) {
      const lines = chunkToLines(c.value);
      if (c.added) add += lines.length;
      if (c.removed) del += lines.length;
    }
    return { add, del };
  }, [before, after]);

  const setBlock = (id: number, adopt: boolean) => {
    setAccepted((prev) => ({ ...prev, [id]: adopt }));
  };

  const adoptAll = () => {
    const next: Record<number, boolean> = {};
    for (const id of changeIds) next[id] = true;
    setAccepted(next);
  };

  const rejectAllChanges = () => {
    const next: Record<number, boolean> = {};
    for (const id of changeIds) next[id] = false;
    setAccepted(next);
  };

  return (
    <div className="code-diff-review">
      <div className="code-diff-review-header">
        <div className="code-diff-review-title">
          <span className="code-diff-review-badge">{SOURCE_LABELS[source] || source}</span>
          <span>代码变更（按块审阅）</span>
        </div>
        <p className="code-diff-review-hint">
          请先阅读每块下方的 <strong>AI 功能说明</strong>，再勾选是否采纳；未采纳的块将保留编辑器中的原文。最后点击「应用合并结果并编译」。
        </p>
        {aiExplainPhase === 'loading' && changeIds.length > 0 && (
          <p className="code-diff-ai-banner code-diff-ai-banner-loading" role="status">
            正在请求 AI 解释各修改块的作用，便于你选择采纳或保留原文…
          </p>
        )}
        {aiExplainPhase === 'error' && changeIds.length > 0 && (
          <p className="code-diff-ai-banner code-diff-ai-banner-warn" role="note">
            AI 说明暂不可用，各块下方已改用本地规则摘要。
          </p>
        )}
        <div className="code-diff-review-stats">
          <span className="stat-add">+{stats.add} 行</span>
          <span className="stat-del">−{stats.del} 行</span>
          <span className="stat-blocks">{changeIds.length} 个可调整块</span>
        </div>
        <div className="code-diff-bulk">
          <button type="button" className="code-diff-linkish" onClick={adoptAll} disabled={disabled}>
            全部采纳 AI
          </button>
          <button type="button" className="code-diff-linkish" onClick={rejectAllChanges} disabled={disabled}>
            全部保留原文
          </button>
        </div>
      </div>

      <div className="code-diff-review-scroll" role="region" aria-label="OpenSCAD 分块差异">
        {segments.every((s) => s.type === 'context') ? (
          <div className="code-diff-row code-diff-same">
            <span className="code-diff-prefix"> </span>
            <span className="code-diff-line">（无文本差异）</span>
          </div>
        ) : (
          segments.map((seg, idx) => {
            if (seg.type === 'context') {
              return (
                <div key={`ctx-${idx}`} className="code-diff-context-block">
                  {chunkToLines(seg.value).map((line, li) => (
                    <div key={`c-${idx}-${li}`} className="code-diff-row code-diff-same">
                      <span className="code-diff-prefix"> </span>
                      <span className="code-diff-line">{line || ' '}</span>
                    </div>
                  ))}
                </div>
              );
            }

            const adopt = accepted[seg.id] !== false;
            const kindLabel =
              seg.type === 'replace' ? '替换' : seg.type === 'delete' ? '删除' : '插入';
            const aiPurposeLine =
              aiExplainPhase === 'loading' && !aiBySegId[seg.id]?.trim()
                ? '正在生成 AI 说明…'
                : aiBySegId[seg.id]?.trim() || inferScadBlockPurpose(seg);

            return (
              <div key={`blk-${seg.id}`} className={`code-diff-block ${adopt ? 'is-adopt' : 'is-reject'}`}>
                <div className="code-diff-block-toolbar">
                  <span className="code-diff-block-label">{kindLabel}</span>
                  <label className="code-diff-toggle">
                    <input
                      type="checkbox"
                      checked={adopt}
                      disabled={disabled}
                      onChange={(e) => setBlock(seg.id, e.target.checked)}
                    />
                    <span>
                      {adopt ? '采纳 AI 修改' : '保留原文（不采纳 AI）'}
                      <span className="code-diff-toggle-hint"> · {adopt ? '当前：采纳' : '当前：保留原文'}</span>
                    </span>
                  </label>
                </div>
                <div className="code-diff-block-ai-purpose">
                  <span className="code-diff-ai-purpose-label">AI 说明</span>
                  <p className="code-diff-ai-purpose-text">{aiPurposeLine}</p>
                </div>
                {seg.type === 'replace' && (
                  <div className="code-diff-block-body">
                    {chunkToLines(seg.removed).map((line, li) => (
                      <div key={`r-${li}`} className="code-diff-row code-diff-del">
                        <span className="code-diff-prefix">−</span>
                        <span className="code-diff-line">{line || ' '}</span>
                      </div>
                    ))}
                    {chunkToLines(seg.added).map((line, li) => (
                      <div key={`a-${li}`} className="code-diff-row code-diff-add">
                        <span className="code-diff-prefix">+</span>
                        <span className="code-diff-line">{line || ' '}</span>
                      </div>
                    ))}
                  </div>
                )}
                {seg.type === 'delete' &&
                  chunkToLines(seg.removed).map((line, li) => (
                    <div key={`d-${li}`} className="code-diff-row code-diff-del">
                      <span className="code-diff-prefix">−</span>
                      <span className="code-diff-line">{line || ' '}</span>
                    </div>
                  ))}
                {seg.type === 'insert' &&
                  chunkToLines(seg.added).map((line, li) => (
                    <div key={`i-${li}`} className="code-diff-row code-diff-add">
                      <span className="code-diff-prefix">+</span>
                      <span className="code-diff-line">{line || ' '}</span>
                    </div>
                  ))}
              </div>
            );
          })
        )}
      </div>

      <div className="code-diff-review-footer">
        <p className="code-diff-merge-note">合并预览长度：{mergedPreview.length} 字符</p>
        <div className="code-diff-review-actions">
          <button type="button" className="code-diff-btn code-diff-btn-reject" onClick={onDiscardAll} disabled={disabled}>
            放弃审阅（保持当前代码）
          </button>
          <button
            type="button"
            className="code-diff-btn code-diff-btn-accept"
            onClick={() => {
              void onApply(mergedPreview, applyMeta);
            }}
            disabled={disabled}
          >
            应用合并结果并编译
          </button>
        </div>
      </div>

      <style>{`
        .code-diff-review {
          display: flex;
          flex-direction: column;
          min-height: 0;
          flex: 1;
          border: 1px solid rgba(24, 100, 171, 0.22);
          border-radius: 12px;
          background: linear-gradient(180deg, #fbfdff 0%, #f4f8fc 100%);
          overflow: hidden;
        }
        .code-diff-review-header {
          padding: 10px 14px 8px;
          border-bottom: 1px solid rgba(24, 100, 171, 0.12);
          flex-shrink: 0;
        }
        .code-diff-review-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 700;
          font-size: 13px;
          color: #1864ab;
        }
        .code-diff-review-badge {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(24, 100, 171, 0.12);
          color: #1864ab;
        }
        .code-diff-review-hint {
          margin: 6px 0 0;
          font-size: 12px;
          line-height: 1.45;
          color: #5c6d82;
        }
        .code-diff-ai-banner {
          margin: 8px 0 0;
          padding: 8px 10px;
          border-radius: 8px;
          font-size: 12px;
          line-height: 1.45;
        }
        .code-diff-ai-banner-loading {
          background: rgba(24, 100, 171, 0.08);
          color: #1864ab;
        }
        .code-diff-ai-banner-warn {
          background: rgba(201, 42, 42, 0.08);
          color: #c92a2a;
        }
        .code-diff-review-stats {
          margin-top: 6px;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 11px;
          font-weight: 600;
        }
        .stat-add { color: #2b8a3e; }
        .stat-del { color: #c92a2a; }
        .stat-blocks { color: #5c6d82; font-weight: 500; }
        .code-diff-bulk {
          margin-top: 8px;
          display: flex;
          gap: 14px;
        }
        .code-diff-linkish {
          border: none;
          background: none;
          padding: 0;
          font-size: 12px;
          color: #1864ab;
          text-decoration: underline;
          cursor: pointer;
        }
        .code-diff-linkish:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .code-diff-review-scroll {
          flex: 1;
          min-height: 200px;
          max-height: min(48vh, 560px);
          overflow: auto;
          font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
          font-size: 12px;
          line-height: 1.45;
          padding: 8px 0;
        }
        .code-diff-context-block {
          margin: 0 8px 6px;
        }
        .code-diff-block {
          margin: 8px 8px 12px;
          border-radius: 10px;
          border: 1px solid rgba(24, 100, 171, 0.18);
          overflow: hidden;
          background: rgba(255, 255, 255, 0.65);
        }
        .code-diff-block.is-reject {
          border-color: rgba(90, 108, 126, 0.35);
          opacity: 0.92;
        }
        .code-diff-block-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 6px 10px;
          background: rgba(24, 100, 171, 0.06);
          border-bottom: 1px solid rgba(24, 100, 171, 0.1);
          flex-wrap: wrap;
        }
        .code-diff-block-label {
          font-size: 11px;
          font-weight: 700;
          color: #1864ab;
        }
        .code-diff-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: #495057;
          cursor: pointer;
          user-select: none;
        }
        .code-diff-toggle input {
          cursor: pointer;
        }
        .code-diff-toggle-hint {
          color: #868e96;
          font-weight: 500;
        }
        .code-diff-block-ai-purpose {
          padding: 8px 10px 10px;
          border-bottom: 1px solid rgba(24, 100, 171, 0.08);
          background: rgba(255, 255, 255, 0.5);
        }
        .code-diff-ai-purpose-label {
          display: inline-block;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #1864ab;
          margin-bottom: 4px;
        }
        .code-diff-ai-purpose-text {
          margin: 0;
          font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
          font-size: 12px;
          line-height: 1.5;
          color: #343a40;
          white-space: pre-wrap;
        }
        .code-diff-block-body {
          margin: 0;
        }
        .code-diff-row {
          display: flex;
          white-space: pre;
          padding: 0 10px;
          border-left: 3px solid transparent;
        }
        .code-diff-prefix {
          flex: 0 0 1.25rem;
          user-select: none;
          opacity: 0.65;
        }
        .code-diff-line {
          flex: 1;
          min-width: 0;
          overflow-x: auto;
        }
        .code-diff-add {
          background: rgba(43, 138, 62, 0.1);
          border-left-color: #2b8a3e;
        }
        .code-diff-del {
          background: rgba(201, 42, 42, 0.08);
          border-left-color: #c92a2a;
        }
        .code-diff-same {
          background: rgba(255, 255, 255, 0.4);
        }
        .code-diff-review-footer {
          border-top: 1px solid rgba(24, 100, 171, 0.12);
          background: rgba(255, 255, 255, 0.85);
          flex-shrink: 0;
          padding: 8px 12px 10px;
        }
        .code-diff-merge-note {
          margin: 0 0 8px;
          font-size: 11px;
          color: #868e96;
        }
        .code-diff-review-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        .code-diff-btn {
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
        }
        .code-diff-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .code-diff-btn-reject {
          background: #fff;
          border-color: rgba(90, 108, 126, 0.35);
          color: #495057;
        }
        .code-diff-btn-reject:hover:not(:disabled) {
          background: #f1f3f5;
        }
        .code-diff-btn-accept {
          background: linear-gradient(180deg, #228be6 0%, #1864ab 100%);
          color: #fff;
          border-color: rgba(15, 76, 129, 0.4);
        }
        .code-diff-btn-accept:hover:not(:disabled) {
          filter: brightness(1.05);
        }
      `}</style>
    </div>
  );
};
