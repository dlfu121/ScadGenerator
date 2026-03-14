import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { processOpenSCADCode } from './code-processor';

const DEEPSEEK_API_KEY = process.env.QINIU_DEEPSEEK_API_KEY || process.env.QN_API_KEY;
const DEEPSEEK_BASE_URL = process.env.QINIU_DEEPSEEK_BASE_URL || process.env.QN_BASE_URL || 'https://api.qnaigc.com/v1';
const DEEPSEEK_MODEL = process.env.QINIU_DEEPSEEK_MODEL || process.env.OPENSCAD_MODEL || 'deepseek-r1';

const openai = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: DEEPSEEK_BASE_URL,
  dangerouslyAllowBrowser: false,
});

// AI 生成模块对外返回的数据结构。
interface GenerateResult {
  openscadCode: string;
  compilableCode: string;
  parameters: Record<string, any>;
  sessionId: string;
}

class GenerateOpenSCADFailure extends Error {
  fallbackResult?: GenerateResult;

  constructor(message: string, fallbackResult?: GenerateResult) {
    super(message);
    this.name = 'GenerateOpenSCADFailure';
    this.fallbackResult = fallbackResult;
  }
}

export async function generateOpenSCAD(prompt: string, sessionId?: string): Promise<GenerateResult> {
  let rawModelOutput = '';

  try {
    if (!DEEPSEEK_API_KEY) {
      throw new Error('未配置七牛 DeepSeek API Key（QINIU_DEEPSEEK_API_KEY 或 QN_API_KEY）');
    }

    // 通过 system prompt 强约束模型输出，降低解释性文本和围栏污染。
    const systemPrompt = `你是一个 OpenSCAD 代码生成器。只输出一段可执行的 OpenSCAD 代码，禁止输出任何额外文本。

  强制规则（必须遵守）：
  1) 禁止解释、分析、思考过程、提示词复述。
  2) 禁止 markdown 代码围栏（例如 \`\`\`openscad）。
  3) 禁止返回重复代码块，只允许一段最终代码。
  4) 生成有效且可编译的 OpenSCAD。
  5) 尽量参数化（使用顶层参数定义）。

  输出要求：
  - 只返回纯 OpenSCAD 源码，不要前后缀。`;

    const response = await Promise.race([
      openai.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('AI 生成超时')), 60000);
      })
    ]);

    rawModelOutput = response.choices[0]?.message?.content || '';

    return buildGenerateResult(rawModelOutput, sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const extractedRawOutput = rawModelOutput || extractRawOutputFromError(error);
    const fallbackResult = extractedRawOutput
      ? buildGenerateResult(extractedRawOutput, sessionId)
      : undefined;

    console.error('DeepSeek API 调用失败:', message);
    throw new GenerateOpenSCADFailure(message, fallbackResult);
  }
}

function buildGenerateResult(rawModelOutput: string, sessionId?: string): GenerateResult {
  const processed = processOpenSCADCode(rawModelOutput);
  const parameters = processed.parameters.reduce((acc, param) => {
    acc[param.name] = param.value;
    return acc;
  }, {} as Record<string, any>);

  const rawCode = rawModelOutput.trim();
  const compilableCode = processed.cleanedCode || rawCode;

  return {
    openscadCode: rawCode,
    compilableCode,
    parameters,
    sessionId: sessionId || uuidv4()
  };
}

function extractRawOutputFromError(error: unknown): string {
  const visited = new Set<unknown>();
  const candidates: string[] = [];

  const collect = (value: unknown, depth: number) => {
    if (depth > 3 || value == null || visited.has(value)) {
      return;
    }

    if (typeof value === 'string') {
      if (looksLikeModelOutput(value)) {
        candidates.push(value);
      }
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, depth + 1));
      return;
    }

    for (const key of ['message', 'content', 'text', 'body', 'data', 'error', 'response', 'cause']) {
      if (key in value) {
        collect((value as Record<string, unknown>)[key], depth + 1);
      }
    }

    Object.values(value as Record<string, unknown>).forEach((item) => collect(item, depth + 1));
  };

  collect(error, 0);

  return candidates.find((candidate) => candidate.trim()) || '';
}

function looksLikeModelOutput(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return /```(?:openscad|scad)?/i.test(normalized)
    || /<think>|<\/think>/i.test(normalized)
    || /(cube|sphere|cylinder|polyhedron|polygon|translate|rotate|union|difference|intersection)\s*\(/i.test(normalized)
    || /^[A-Za-z_]\w*\s*=.*;/m.test(normalized);
}

// 保留的兜底参数提取函数：当前主流程未使用，作为备用解析能力保留。
function extractParameters(code: string): Record<string, any> {
  const parameters: Record<string, any> = {};
  const lines = code.split('\n');
  
  lines.forEach(line => {
    const match = line.match(/^(\w+)\s*=\s*(.+);?$/);
    if (match) {
      const [, name, value] = match;
      try {
        parameters[name] = eval(value);
      } catch {
        parameters[name] = value;
      }
    }
  });
  
  return parameters;
}
