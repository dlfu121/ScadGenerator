import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { processOpenSCADCode } from './code-processor';

const DEEPSEEK_API_KEY = process.env.QINIU_DEEPSEEK_API_KEY || process.env.QN_API_KEY;
const DEEPSEEK_BASE_URL = process.env.QINIU_DEEPSEEK_BASE_URL || process.env.QN_BASE_URL || 'https://api.qnaigc.com/v1';
const DEEPSEEK_MODEL = process.env.QINIU_DEEPSEEK_MODEL || process.env.OPENSCAD_MODEL || 'deepseek-r1';
const OPENSCAD_API_PROTOCOL = (process.env.OPENSCAD_API_PROTOCOL || 'openai-compatible').trim().toLowerCase();
const OPENSCAD_API_PATH = process.env.OPENSCAD_API_PATH || '/messages';
const OPENSCAD_MAX_TOKENS = Number.parseInt(process.env.OPENSCAD_MAX_TOKENS || '1024', 10);
const OPENSCAD_CHAT_MAX_TOKENS = Number.parseInt(process.env.OPENSCAD_CHAT_MAX_TOKENS || '4096', 10);
const PRODUCT_MANAGER_ENABLED = (process.env.PM_ENABLED || 'true').trim().toLowerCase() !== 'false';
const PRODUCT_MANAGER_API_KEY = process.env.PM_API_KEY || process.env.CLAUDE_API_KEY;
const PRODUCT_MANAGER_BASE_URL = process.env.PM_BASE_URL || process.env.QN_BASE_URL || 'https://api.qnaigc.com/v1';
const PRODUCT_MANAGER_API_PATH = process.env.PM_API_PATH || '/messages';
const PRODUCT_MANAGER_MODEL = process.env.PM_MODEL || 'claude-4.5-sonnet';
const PRODUCT_MANAGER_MAX_TOKENS = Number.parseInt(process.env.PM_MAX_TOKENS || '1024', 10);
const PRODUCT_MANAGER_API_PROTOCOL = (process.env.PM_API_PROTOCOL || 'openai-compatible').trim().toLowerCase();

let openaiClient: OpenAI | null = null;
let productManagerClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('未配置七牛 DeepSeek API Key（QINIU_DEEPSEEK_API_KEY 或 QN_API_KEY）');
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: DEEPSEEK_API_KEY,
      baseURL: DEEPSEEK_BASE_URL,
      dangerouslyAllowBrowser: false,
    });
  }

  return openaiClient;
}

function getProductManagerClient(): OpenAI {
  if (!PRODUCT_MANAGER_API_KEY) {
    throw new Error('未配置产品经理智能体 API Key（PM_API_KEY 或 CLAUDE_API_KEY）');
  }

  if (!productManagerClient) {
    productManagerClient = new OpenAI({
      apiKey: PRODUCT_MANAGER_API_KEY,
      baseURL: PRODUCT_MANAGER_BASE_URL,
      dangerouslyAllowBrowser: false,
    });
  }

  return productManagerClient;
}

interface AnthropicMessagesResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

// AI 生成模块对外返回的数据结构。
interface GenerateResult {
  openscadCode: string;
  compilableCode: string;
  parameters: Record<string, any>;
  sessionId: string;
  productBrief?: string;
}

interface MessagesApiOptions {
  apiKey: string;
  baseUrl: string;
  apiPath: string;
  model: string;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
}

interface GenerationProgressEvent {
  stage: string;
  message: string;
  meta?: Record<string, unknown>;
}

type ProgressReporter = (event: GenerationProgressEvent) => void;

class GenerateOpenSCADFailure extends Error {
  fallbackResult?: GenerateResult;

  constructor(message: string, fallbackResult?: GenerateResult) {
    super(message);
    this.name = 'GenerateOpenSCADFailure';
    this.fallbackResult = fallbackResult;
  }
}

export async function generateOpenSCAD(
  prompt: string,
  sessionId?: string,
  reportProgress?: ProgressReporter
): Promise<GenerateResult> {
  let rawModelOutput = '';
  let productBrief = '';

  try {
    const openai = getOpenAIClient();
    reportProgress?.({ stage: 'queue', message: '已收到需求，正在准备建模流程' });

    if (PRODUCT_MANAGER_ENABLED) {
      reportProgress?.({ stage: 'pm_start', message: '产品经理智能体正在拆解需求' });
      productBrief = await generateProductBrief(prompt);
      reportProgress?.({
        stage: 'pm_done',
        message: '需求拆解完成，正在进入代码生成',
        meta: { briefLength: productBrief.length }
      });
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

    const deepseekPrompt = productBrief
      ? [
        '用户原始需求：',
        prompt,
        '',
        '产品经理建模方案（必须优先遵循）：',
        productBrief,
        '',
        '请基于上述方案生成参数化 OpenSCAD 代码。',
      ].join('\n')
      : prompt;

    reportProgress?.({ stage: 'code_start', message: '模型正在推理并生成 OpenSCAD 代码' });
    const response = await Promise.race([
      openai.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: deepseekPrompt }
        ],
          max_tokens: Number.isFinite(OPENSCAD_CHAT_MAX_TOKENS) ? OPENSCAD_CHAT_MAX_TOKENS : 4096,
        temperature: 0.7,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('AI 生成超时')), 120000);
      })
    ]);

    rawModelOutput = response.choices[0]?.message?.content || '';

    reportProgress?.({
      stage: 'code_done',
      message: '代码已生成，正在清洗与提取参数',
      meta: { outputLength: rawModelOutput.length }
    });

    const result = buildGenerateResult(rawModelOutput, sessionId, productBrief);
    reportProgress?.({
      stage: 'postprocess_done',
      message: '参数提取完成，准备开始编译预览',
      meta: { paramCount: Object.keys(result.parameters || {}).length }
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const extractedRawOutput = rawModelOutput || extractRawOutputFromError(error);
    const fallbackResult = extractedRawOutput
      ? buildGenerateResult(extractedRawOutput, sessionId, productBrief)
      : undefined;

    reportProgress?.({ stage: 'error', message: `生成阶段失败：${message}` });
    console.error('DeepSeek API 调用失败:', message);
    throw new GenerateOpenSCADFailure(message, fallbackResult);
  }
}

export async function fixOpenSCADCode(
  openscadCode: string,
  compileError?: string,
  sessionId?: string
): Promise<GenerateResult> {
  let rawModelOutput = '';

  try {
    const openai = getOpenAIClient();

    const systemPrompt = `你是一个 OpenSCAD 代码修复器。你会收到一段存在问题的 OpenSCAD 代码和编译错误信息。

强制规则（必须遵守）：
1) 仅返回修复后的完整 OpenSCAD 代码。
2) 禁止任何解释、注释说明、思考过程、markdown 围栏。
3) 保留原有建模意图与参数命名，优先做最小修改使其可编译。
4) 代码必须可执行且结构完整。`;

    const userPrompt = [
      '请修复以下 OpenSCAD 代码。',
      compileError ? `编译错误信息：\n${compileError}` : '编译错误信息：无',
      '原始代码：',
      openscadCode,
    ].join('\n\n');

    const response = await Promise.race([
      openai.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: Number.isFinite(OPENSCAD_CHAT_MAX_TOKENS) ? OPENSCAD_CHAT_MAX_TOKENS : 4096,
        temperature: 0.2,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('AI 修复超时')), 120000);
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

    console.error('DeepSeek 代码修复失败:', message);
    throw new GenerateOpenSCADFailure(message, fallbackResult);
  }
}

function buildGenerateResult(rawModelOutput: string, sessionId?: string, productBrief?: string): GenerateResult {
  const rawCode = rawModelOutput.trim();
  const processed = processOpenSCADCode(rawCode);

  // cleanedCode 为空（score 不够）时回退到 rawCode，保证编译有内容
  const compilableCode = processed.cleanedCode || rawCode;
  const parameters = processed.parameters.reduce((acc, param) => {
    acc[param.name] = param.defaultValue ?? param.value;
    return acc;
  }, {} as Record<string, any>);

  return {
    openscadCode: rawCode,
    compilableCode,
    parameters,
    sessionId: sessionId || uuidv4(),
    productBrief: productBrief?.trim() || undefined,
  };
}

async function generateProductBrief(prompt: string): Promise<string> {
  if (!PRODUCT_MANAGER_API_KEY) {
    throw new Error('未配置产品经理智能体 API Key（PM_API_KEY 或 CLAUDE_API_KEY）');
  }

  const systemPrompt = `你是一个 3D 参数化建模产品经理。你的任务是：
1) 理解用户需求并补全可执行的建模要点；
2) 输出给 OpenSCAD 工程师的实现方案；
3) 只输出简洁中文方案，不输出 OpenSCAD 代码。`;

  const userPrompt = [
    '请将以下用户需求整理为“建模方案”，用于后续代码生成。',
    '输出建议包含：',
    '- 模型目标',
    '- 关键结构与尺寸',
    '- 参数化变量建议（名称/含义/默认值）',
    '- 建模步骤（简洁）',
    '- 约束与注意事项',
    '',
    `用户需求：${prompt}`,
  ].join('\n');

  if (PRODUCT_MANAGER_API_PROTOCOL === 'anthropic-messages') {
    return callMessagesApi({
      apiKey: PRODUCT_MANAGER_API_KEY,
      baseUrl: PRODUCT_MANAGER_BASE_URL,
      apiPath: PRODUCT_MANAGER_API_PATH,
      model: PRODUCT_MANAGER_MODEL,
      maxTokens: PRODUCT_MANAGER_MAX_TOKENS,
      systemPrompt,
      userPrompt,
      temperature: 0.3,
    });
  }

  const pmClient = getProductManagerClient();
  const response = await Promise.race([
    pmClient.chat.completions.create({
      model: PRODUCT_MANAGER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: Number.isFinite(PRODUCT_MANAGER_MAX_TOKENS) ? PRODUCT_MANAGER_MAX_TOKENS : 1024,
      temperature: 0.3,
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('产品经理智能体调用超时')), 120000);
    }),
  ]);

  return response.choices[0]?.message?.content?.trim() || '';
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

async function callMessagesApi(options: MessagesApiOptions): Promise<string> {
  if (!options.apiKey) {
    throw new Error('Messages API 缺少 API Key');
  }

  const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
  const normalizedPath = options.apiPath.replace(/^\/+/, '');
  const url = new URL(normalizedPath, baseUrl);

  const response = await Promise.race([
    fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        system: options.systemPrompt,
        messages: [{
          role: 'user',
          content: [{
            type: 'text',
            text: options.userPrompt,
          }],
        }],
        max_tokens: Number.isFinite(options.maxTokens) ? options.maxTokens : 1024,
        temperature: options.temperature,
      }),
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('AI 调用超时')), 120000);
    })
  ]);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Messages API 调用失败: ${response.status} ${errText}`);
  }

  const data = await response.json() as AnthropicMessagesResponse;
  const output = data.content
    ?.filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text?.trim() || '')
    .filter(Boolean)
    .join('\n') || '';

  return output;
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
