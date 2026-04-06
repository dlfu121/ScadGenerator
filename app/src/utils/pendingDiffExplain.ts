import {
  buildExplainPayloadFromSegments,
  buildMergeSegments,
  fetchDiffBlockAiExplanations,
  inferScadBlockPurpose,
  type MergeSegment,
} from '../modules/code-workspace/CodeDiffReview';

/**
 * 拉取各差异块说明（优先 AI，失败则本地启发式），按 segId 映射。
 */
export async function fetchBlockExplainsBySegId(
  previousCode: string,
  proposedCode: string
): Promise<{ bySegId: Record<number, string>; fromApi: boolean; segments: MergeSegment[] }> {
  const segments = buildMergeSegments(previousCode, proposedCode);
  const payload = buildExplainPayloadFromSegments(segments, () => true);
  if (payload.length === 0) {
    return { bySegId: {}, fromApi: true, segments };
  }

  const result = await fetchDiffBlockAiExplanations(payload);
  if (result === null) {
    const heuristicMap: Record<number, string> = {};
    for (const s of segments) {
      if (s.type === 'context') {
        continue;
      }
      heuristicMap[s.id] = inferScadBlockPurpose(s);
    }
    return { bySegId: heuristicMap, fromApi: false, segments };
  }

  const bySegId: Record<number, string> = {};
  let i = 0;
  for (const s of segments) {
    if (s.type === 'context') {
      continue;
    }
    bySegId[s.id] = result[i++] ?? '';
  }
  return { bySegId, fromApi: true, segments };
}

/**
 * 生成成功后同一条助手消息：含引导 + 各块作用。
 */
export function buildGenerateReadyFullResponse(
  segments: MergeSegment[],
  bySegId: Record<number, string>,
  fromApi: boolean
): string {
  const blocks: string[] = [];
  let n = 0;
  for (const seg of segments) {
    if (seg.type === 'context') {
      continue;
    }
    n += 1;
    const kind = seg.type === 'replace' ? '替换' : seg.type === 'delete' ? '删除' : '插入';
    const text = bySegId[seg.id]?.trim() || inferScadBlockPurpose(seg);
    blocks.push(`${n}. **${kind}**：${text}`);
  }

  if (n === 0) {
    return [
      '✅ 新代码已就绪。请在右侧「代码」页查看差异，最后点 **应用合并结果并编译**；不需要可点放弃审阅。',
    ].join('\n');
  }

  const header = [
    '✅ 新代码已就绪。请在右侧「代码」页查看红/绿差异，**结合下面各块说明**决定勾选是否采纳 AI，最后点 **应用合并结果并编译**；不需要可点放弃审阅。',
    '',
    fromApi ? '**各修改块的作用**' : '**各修改块的作用**（AI 暂不可用，以下为本地规则摘要）',
    '',
  ].join('\n');

  return [header, ...blocks].join('\n');
}
