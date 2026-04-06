import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { processOpenSCADCode } from './code-processor';
import {
  MASTER_CODEGEN_SYSTEM_PROMPT,
  buildMasterCodegenUserPrompt,
  FIX_SYSTEM_PROMPT,
  buildFixUserPrompt,
  PRODUCT_MANAGER_DIALOG_SYSTEM_PROMPT,
  buildProductManagerDialogUserPrompt,
  buildCodeResponderSystemPrompt,
  buildCodeResponderUserPrompt,
  PRODUCT_BRIEF_SYSTEM_PROMPT,
  buildProductBriefUserPrompt,
  buildRevisionCodegenUserPrompt,
} from '../config/agent-prompts';

// 用于 OpenSCAD 代码生成的模型配置（支持 claude-4.5-sonnet）
const CLAUDE_API_KEY = process.env.QN_API_KEY;
const CLAUDE_BASE_URL = process.env.QINIU_DEEPSEEK_BASE_URL || process.env.QN_BASE_URL || 'https://api.qnaigc.com/v1';
const OPENSCAD_MODEL = process.env.QINIU_DEEPSEEK_MODEL || process.env.OPENSCAD_MODEL || 'claude-4.5-sonnet';
const OPENSCAD_API_PROTOCOL = (process.env.OPENSCAD_API_PROTOCOL || 'anthropic-messages').trim().toLowerCase();
const OPENSCAD_API_PATH = process.env.OPENSCAD_API_PATH || '/messages';
const OPENSCAD_MAX_TOKENS = Number.parseInt(process.env.OPENSCAD_MAX_TOKENS || '1024', 10);
const OPENSCAD_CHAT_MAX_TOKENS = Number.parseInt(process.env.OPENSCAD_CHAT_MAX_TOKENS || '4096', 10);
const OPENSCAD_FIX_TIMEOUT_MS = Number.parseInt(process.env.OPENSCAD_FIX_TIMEOUT_MS || '240000', 10);

// 用于实习生（代码问题咨询 + 代码修复）的统一模型配置
const DEEPSEEK_API_KEY = process.env.QINIU_DEEPSEEK_API_KEY || process.env.QN_API_KEY;
const DEEPSEEK_BASE_URL = process.env.QINIU_DEEPSEEK_BASE_URL || process.env.QN_BASE_URL || 'https://api.qnaigc.com/v1';
const INTERN_MODEL = process.env.INTERN_MODEL || process.env.QINIU_DEEPSEEK_MODEL || 'deepseek/deepseek-v3.2-251201';
const INTERN_MAX_TOKENS = Number.parseInt(process.env.INTERN_MAX_TOKENS || '1536', 10);
const MASTER_MAX_TOKENS = Number.parseInt(process.env.MASTER_MAX_TOKENS || '1536', 10);

const PRODUCT_MANAGER_ENABLED = (process.env.PM_ENABLED || 'true').trim().toLowerCase() !== 'false';
const PRODUCT_MANAGER_API_KEY = process.env.QN_API_KEY;
const PRODUCT_MANAGER_BASE_URL = process.env.PM_BASE_URL || process.env.QN_BASE_URL || 'https://api.qnaigc.com/v1';
const PRODUCT_MANAGER_API_PATH = process.env.PM_API_PATH || '/messages';
const PRODUCT_MANAGER_MODEL = process.env.PM_MODEL || 'moonshotai/kimi-k2.5';
const PRODUCT_MANAGER_MAX_TOKENS = Number.parseInt(process.env.PM_MAX_TOKENS || '1024', 10);
const PRODUCT_MANAGER_API_PROTOCOL = (process.env.PM_API_PROTOCOL || 'openai-compatible').trim().toLowerCase();

// 修复兜底模型：仅用于 /fix 链路失败后的二次修复，不走产品经理逻辑。
const KIMI_FIX_API_KEY = process.env.KIMI_FIX_API_KEY || process.env.QN_API_KEY;
const KIMI_FIX_BASE_URL = process.env.KIMI_FIX_BASE_URL || process.env.QN_BASE_URL || 'https://api.qnaigc.com/v1';
const KIMI_FIX_MODEL = process.env.KIMI_FIX_MODEL || 'moonshotai/kimi-k2.5';

let claudeClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;
let productManagerClient: OpenAI | null = null;
let kimiFixClient: OpenAI | null = null;

function getClaudeClient(): OpenAI {
  if (!CLAUDE_API_KEY) {
    throw new Error('未配置 Claude API Key（QN_API_KEY）');
  }

  if (!claudeClient) {
    claudeClient = new OpenAI({
      apiKey: CLAUDE_API_KEY,
      baseURL: CLAUDE_BASE_URL,
      dangerouslyAllowBrowser: false,
    });
  }

  return claudeClient;
}

function getDeepseekClient(): OpenAI {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('未配置 DeepSeek API Key（QINIU_DEEPSEEK_API_KEY 或 QN_API_KEY）');
  }

  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      apiKey: DEEPSEEK_API_KEY,
      baseURL: DEEPSEEK_BASE_URL,
      dangerouslyAllowBrowser: false,
    });
  }

  return deepseekClient;
}

function getProductManagerClient(): OpenAI {
  if (!PRODUCT_MANAGER_API_KEY) {
    throw new Error('未配置产品经理智能体 API Key（QN_API_KEY）');
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

function getKimiFixClient(): OpenAI {
  if (!KIMI_FIX_API_KEY) {
    throw new Error('未配置 Kimi 修复 API Key（KIMI_FIX_API_KEY 或 QN_API_KEY）');
  }

  if (!kimiFixClient) {
    kimiFixClient = new OpenAI({
      apiKey: KIMI_FIX_API_KEY,
      baseURL: KIMI_FIX_BASE_URL,
      dangerouslyAllowBrowser: false,
    });
  }

  return kimiFixClient;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

type ResponderRole = 'product_manager' | 'intern' | 'master';
type CodeResponderRole = 'intern' | 'master';

interface RequirementConfirmation {
  isConfirmed: boolean;
  finalBrief: string;
  conversationHistory: ConversationMessage[];
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

interface AnthropicMessagesResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
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

export interface GenerateOpenSCADOptions {
  /** 已生成过的方案摘要：传入时跳过内部的 generateProductBrief（含空字符串，表示明确不跑简报） */
  precomputedProductBrief?: string;
  /** 非空时在现有代码上做修订，而非从零生成 */
  baseOpenscadCode?: string;
}

export async function generateOpenSCAD(
  prompt: string,
  sessionId?: string,
  reportProgress?: ProgressReporter,
  options?: GenerateOpenSCADOptions
): Promise<GenerateResult> {
  let rawModelOutput = '';
  let productBrief = '';
  const revisionBase = options?.baseOpenscadCode?.trim() || '';
  const isRevision = Boolean(revisionBase);

  try {
    const claude = getClaudeClient();
    reportProgress?.({ stage: 'queue', message: '已收到需求，正在准备建模流程' });

    if (isRevision) {
      productBrief =
        options?.precomputedProductBrief !== undefined
          ? (options.precomputedProductBrief || '').trim()
          : '';
      reportProgress?.({
        stage: 'revise_start',
        message: '正在根据修改意见更新参数化代码',
        meta: { baseLength: revisionBase.length },
      });
    } else if (options?.precomputedProductBrief !== undefined) {
      productBrief = (options.precomputedProductBrief || '').trim();
      reportProgress?.({
        stage: 'pm_done',
        message: '已使用前置方案摘要，正在进入代码生成',
        meta: { briefLength: productBrief.length },
      });
    } else if (PRODUCT_MANAGER_ENABLED) {
      reportProgress?.({ stage: 'pm_start', message: '产品经理智能体正在拆解需求' });
      productBrief = await generateProductBrief(prompt);
      reportProgress?.({
        stage: 'pm_done',
        message: '需求拆解完成，正在进入代码生成',
        meta: { briefLength: productBrief.length }
      });
    }

    // 通过 system prompt 强约束模型输出，降低解释性文本和围栏污染。
    const systemPrompt = MASTER_CODEGEN_SYSTEM_PROMPT;
    const deepseekPrompt = isRevision
      ? buildRevisionCodegenUserPrompt({
          userInstruction: prompt,
          baseCode: revisionBase,
          productBrief,
        })
      : buildMasterCodegenUserPrompt(prompt, productBrief);

    reportProgress?.({
      stage: 'code_start',
      message: isRevision ? '正在整合修改并生成完整代码…' : '已收到需求，我来帮你把这个设计变成代码，稍等片刻...',
    });
    
    if (OPENSCAD_API_PROTOCOL === 'anthropic-messages') {
      const claudeApiKey = CLAUDE_API_KEY;
      if (!claudeApiKey) {
        throw new Error('未配置 Claude API Key（QN_API_KEY）');
      }

      rawModelOutput = await callMessagesApi({
        apiKey: claudeApiKey,
        baseUrl: CLAUDE_BASE_URL,
        apiPath: OPENSCAD_API_PATH,
        model: OPENSCAD_MODEL,
        maxTokens: OPENSCAD_CHAT_MAX_TOKENS,
        systemPrompt,
        userPrompt: deepseekPrompt,
        temperature: 0.7,
      });
    } else {
      const response = await Promise.race([
        claude.chat.completions.create({
          model: OPENSCAD_MODEL,
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
    }

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
    console.error('Claude API 代码生成失败:', message);
    throw new GenerateOpenSCADFailure(message, fallbackResult);
  }
}

export async function fixOpenSCADCode(
  openscadCode: string,
  compileError?: string,
  sessionId?: string
): Promise<GenerateResult> {
  let rawModelOutput = '';

  const systemPrompt = FIX_SYSTEM_PROMPT;
  const userPrompt = buildFixUserPrompt(openscadCode, compileError);

  const requestRepair = async (client: OpenAI, model: string, timeoutLabel: string) => {
    const response = await Promise.race([
      client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: Number.isFinite(OPENSCAD_CHAT_MAX_TOKENS) ? OPENSCAD_CHAT_MAX_TOKENS : 4096,
        temperature: 0.2,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${timeoutLabel}（>${Math.round(OPENSCAD_FIX_TIMEOUT_MS / 1000)}s）`)), OPENSCAD_FIX_TIMEOUT_MS);
      })
    ]);

    return response.choices[0]?.message?.content || '';
  };

  // 主模型修复
  try {
    console.info(`[fix] 主模型修复开始: ${INTERN_MODEL}`);
    rawModelOutput = await requestRepair(getDeepseekClient(), INTERN_MODEL, '主模型修复超时');
    console.info(`[fix] 主模型修复成功: ${INTERN_MODEL}`);
    return buildGenerateResult(rawModelOutput, sessionId);
  } catch (primaryError) {
    const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.warn(`[fix] 主模型修复失败: ${INTERN_MODEL}; reason=${primaryMessage}`);

    // Kimi 兜底修复：失败后自动重试一次
    const kimiFix = getKimiFixClient();

    try {
      console.info(`[fix] Kimi 兜底修复开始(第1次): ${KIMI_FIX_MODEL}`);
      rawModelOutput = await requestRepair(kimiFix, KIMI_FIX_MODEL, 'Kimi 兜底修复超时');
      console.info(`[fix] Kimi 兜底修复成功(第1次): ${KIMI_FIX_MODEL}`);
      return buildGenerateResult(rawModelOutput, sessionId);
    } catch (fallbackErrorFirst) {
      const fallbackMessageFirst = fallbackErrorFirst instanceof Error ? fallbackErrorFirst.message : String(fallbackErrorFirst);
      console.warn(`[fix] Kimi 兜底修复失败(第1次): ${KIMI_FIX_MODEL}; reason=${fallbackMessageFirst}`);

      try {
        console.info(`[fix] Kimi 兜底修复重试开始(第2次): ${KIMI_FIX_MODEL}`);
        rawModelOutput = await requestRepair(kimiFix, KIMI_FIX_MODEL, 'Kimi 兜底重试超时');
        console.info(`[fix] Kimi 兜底修复重试成功(第2次): ${KIMI_FIX_MODEL}`);
        return buildGenerateResult(rawModelOutput, sessionId);
      } catch (fallbackErrorSecond) {
        const fallbackMessageSecond = fallbackErrorSecond instanceof Error ? fallbackErrorSecond.message : String(fallbackErrorSecond);
        const extractedRawOutput = rawModelOutput
          || extractRawOutputFromError(primaryError)
          || extractRawOutputFromError(fallbackErrorFirst)
          || extractRawOutputFromError(fallbackErrorSecond);
        const fallbackResult = extractedRawOutput
          ? buildGenerateResult(extractedRawOutput, sessionId)
          : undefined;

        console.error(`[fix] Kimi 兜底修复失败(第2次): ${KIMI_FIX_MODEL}; reason=${fallbackMessageSecond}`);
        throw new GenerateOpenSCADFailure(
          `主模型修复失败（${primaryMessage}）；Kimi 兜底修复失败（第1次: ${fallbackMessageFirst}; 第2次: ${fallbackMessageSecond}）`,
          fallbackResult
        );
      }
    }
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

// 与产品经理进行多轮对话来确认需求
export async function askProductManager(userInput: string, conversationHistory: ConversationMessage[] = []): Promise<{
  response: string;
  isNeedMoreInfo: boolean;
  isClear: boolean;
  shouldGenerate: boolean;
  confirmedRequirement?: string;
  responderRole: ResponderRole;
}> {
  if (!PRODUCT_MANAGER_API_KEY) {
    throw new Error('未配置产品经理智能体 API Key（QN_API_KEY）');
  }

  const normalizedInput = userInput.trim();
  if (isCodeIssueIntent(normalizedInput)) {
    const responderRole: CodeResponderRole = shouldEscalateToMaster(normalizedInput, conversationHistory)
      ? 'master'
      : 'intern';
    const engineerReply = await askCodeResponder(responderRole, normalizedInput, conversationHistory);
    return {
      response: engineerReply,
      isNeedMoreInfo: true,
      isClear: false,
      shouldGenerate: false,
      responderRole,
    };
  }

  const systemPrompt = PRODUCT_MANAGER_DIALOG_SYSTEM_PROMPT;

  // 构建消息历史
  const messages: ConversationMessage[] = [
    ...conversationHistory.map((msg) => ({
      role: msg.role,
      content: sanitizeConversationContent(msg.content),
    })),
    { role: 'user', content: userInput }
  ];

    const conversationText = messages
    .map((msg) => `${msg.role === 'user' ? '用户' : '产品经理'}: ${msg.content}`)
    .join('\n');

  if (PRODUCT_MANAGER_API_PROTOCOL === 'anthropic-messages') {
    const response = await callMessagesApi({
      apiKey: PRODUCT_MANAGER_API_KEY,
      baseUrl: PRODUCT_MANAGER_BASE_URL,
      apiPath: PRODUCT_MANAGER_API_PATH,
      model: PRODUCT_MANAGER_MODEL,
      maxTokens: PRODUCT_MANAGER_MAX_TOKENS * 2,
      systemPrompt,
      userPrompt: buildProductManagerDialogUserPrompt(conversationText),
      temperature: 0.5,
    });

    const responseText = sanitizeProductManagerResponse(response.trim());
    const isClear = responseText.includes('【需求确认完成】');
    const shouldGenerate = responseText.includes('【请老师傅生成代码】') || responseText.includes('【请Claude生成代码】');
    const isNeedMoreInfo = !isClear;
    const confirmedRequirement = extractConfirmedRequirement(responseText);

    return {
      response: responseText,
      isNeedMoreInfo,
      isClear,
      shouldGenerate,
      confirmedRequirement,
      responderRole: 'product_manager',
    };
  }

  const pmClient = getProductManagerClient();
  const response = await Promise.race([
    pmClient.chat.completions.create({
      model: PRODUCT_MANAGER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      ],
      max_tokens: Number.isFinite(PRODUCT_MANAGER_MAX_TOKENS * 2) ? PRODUCT_MANAGER_MAX_TOKENS * 2 : 2048,
      temperature: 0.5,
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('产品经理智能体逐步确认超时')), 120000);
    }),
  ]);

  const rawResponseText = response.choices[0]?.message?.content?.trim() || '';
  const responseText = sanitizeProductManagerResponse(rawResponseText);
  const isClear = responseText.includes('【需求确认完成】');
  const shouldGenerate = responseText.includes('【请老师傅生成代码】') || responseText.includes('【请Claude生成代码】');
  const isNeedMoreInfo = !isClear;
  const confirmedRequirement = extractConfirmedRequirement(responseText);

  return {
    response: responseText,
    isNeedMoreInfo,
    isClear,
    shouldGenerate,
    confirmedRequirement,
    responderRole: 'product_manager',
  };
}

async function askCodeResponder(
  role: CodeResponderRole,
  userInput: string,
  conversationHistory: ConversationMessage[]
): Promise<string> {
  const conversationText = buildConversationText(conversationHistory, userInput);
  const roleName = role === 'master' ? '老师傅' : '实习生';
  const systemPrompt = buildCodeResponderSystemPrompt(roleName);
  const codeResponderUserPrompt = buildCodeResponderUserPrompt(roleName, conversationText);

  if (role === 'intern') {
    const deepseek = getDeepseekClient();
    const response = await Promise.race([
      deepseek.chat.completions.create({
        model: INTERN_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: codeResponderUserPrompt },
        ],
        max_tokens: Number.isFinite(INTERN_MAX_TOKENS) ? INTERN_MAX_TOKENS : 1536,
        temperature: 0.2,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('实习生响应超时')), 120000);
      }),
    ]);

    return response.choices[0]?.message?.content?.trim() || 'cube([10,10,10]);';
  }

  if (OPENSCAD_API_PROTOCOL === 'anthropic-messages') {
    const masterApiKey = CLAUDE_API_KEY || PRODUCT_MANAGER_API_KEY;
    if (!masterApiKey) {
      throw new Error('未配置老师傅调用所需 API Key（QN_API_KEY）');
    }

    const reply = await callMessagesApi({
      apiKey: masterApiKey,
      baseUrl: CLAUDE_BASE_URL,
      apiPath: OPENSCAD_API_PATH,
      model: OPENSCAD_MODEL,
      maxTokens: MASTER_MAX_TOKENS,
      systemPrompt,
      userPrompt: codeResponderUserPrompt,
      temperature: 0.2,
    });
    return reply.trim() || 'cube([20,20,20]);';
  }

  const claude = getClaudeClient();
  const response = await Promise.race([
    claude.chat.completions.create({
      model: OPENSCAD_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: codeResponderUserPrompt },
      ],
      max_tokens: Number.isFinite(MASTER_MAX_TOKENS) ? MASTER_MAX_TOKENS : 1536,
      temperature: 0.2,
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('老师傅响应超时')), 120000);
    }),
  ]);

  return response.choices[0]?.message?.content?.trim() || 'cube([20,20,20]);';
}

function buildConversationText(conversationHistory: ConversationMessage[], userInput: string): string {
  const messages: ConversationMessage[] = [
    ...conversationHistory.map((msg) => ({
      role: msg.role,
      content: sanitizeConversationContent(msg.content),
    })),
    { role: 'user', content: userInput },
  ];

  return messages
    .map((msg) => `${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}`)
    .join('\n');
}

function isCodeIssueIntent(input: string): boolean {
  if (!input) {
    return false;
  }

  // 纯“生成代码”类指令应走产品经理确认完成后的生成链路，
  // 不能误判为“代码报错/修复”意图。
  if (/(生成代码|开始生成|出代码|生成一下代码|直接生成)/i.test(input.trim())) {
    return false;
  }

  return /(代码|编译|报错|错误|异常|崩溃|失败|修复|修理|bug|fix|error|stack|trace|warning)/i.test(input);
}

function shouldEscalateToMaster(input: string, conversationHistory: ConversationMessage[]): boolean {
  const pmEscalation = /(请老师傅|转老师傅|老师傅处理|老师傅来)/.test(input);
  if (pmEscalation) {
    return true;
  }

  const retryHint = /(还是不行|依旧报错|连续失败|反复修改|多次修复|修了.*次|又报错)/.test(input);
  if (!retryHint) {
    return false;
  }

  const failedHints = conversationHistory
    .filter((msg) => msg.role === 'assistant')
    .filter((msg) => /实习生|修复失败|未解决|建议你调整代码后再点一次修复/.test(msg.content))
    .length;

  return failedHints >= 2;
}

function sanitizeConversationContent(content: string): string {
  if (!content) {
    return '';
  }

  // 防止历史中出现代码污染后续对话风格。
  return content
    .replace(/```[\s\S]*?```/g, '[已省略代码内容]')
    .replace(/<script[\s\S]*?<\/script>/gi, '[已省略脚本内容]')
    .trim();
}

function sanitizeProductManagerResponse(responseText: string): string {
  if (!responseText) {
    return responseText;
  }

  if (!containsCodeLikeContent(responseText)) {
    return responseText;
  }

  // Kimi 若跑偏输出代码，后端直接拦截并改写成需求澄清文本。
  return [
    '【问题】',
    '- 我不会输出代码；我只负责细化建模方式。',
    '- 请继续补充：主体几何、关键尺寸(mm)、壁厚/孔位、参数化变量、机械细节。',
    '【反馈】',
    '- 已识别到您希望尽快生成，但当前由我先完成建模需求细化。',
    '【状态】等待用户补充细节',
  ].join('\n');
}

function containsCodeLikeContent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  return /```[\s\S]*?```/.test(normalized)
    || /<!DOCTYPE|<html|<script|<style/i.test(normalized)
    || /\b(function|const|let|var|class|import|export)\b/.test(normalized)
    || /\b(cube|sphere|cylinder|translate|rotate|difference|union)\s*\(/i.test(normalized)
    || /\{\s*"[^"]+"\s*:\s*/.test(normalized);
}

function extractConfirmedRequirement(responseText: string): string | undefined {
  const marker = '【最终需求】';
  const start = responseText.indexOf(marker);
  if (start === -1) {
    return undefined;
  }

  const afterMarker = responseText.slice(start + marker.length).trim();
  const stopMarkers = ['【状态】', '【请老师傅生成代码】', '【请Claude生成代码】'];
  let endIndex = afterMarker.length;

  for (const stopMarker of stopMarkers) {
    const idx = afterMarker.indexOf(stopMarker);
    if (idx !== -1) {
      endIndex = Math.min(endIndex, idx);
    }
  }

  const extracted = afterMarker.slice(0, endIndex).trim();
  return extracted || undefined;
}

/** 供 /explain-diff-blocks：按块解释 OpenSCAD 差异（与前端 WorkspaceDiffExplainBlock 对齐） */
export interface DiffExplainBlockInput {
  index: number;
  kind: 'replace' | 'delete' | 'insert';
  adopted: boolean;
  removed?: string;
  added?: string;
}

const DIFF_EXPLAIN_MODEL = process.env.DIFF_EXPLAIN_MODEL || process.env.KIMI_FIX_MODEL || 'moonshotai/kimi-k2.5';
const DIFF_EXPLAIN_MAX_TOKENS = Number.parseInt(process.env.DIFF_EXPLAIN_MAX_TOKENS || '3072', 10);

const DIFF_EXPLAIN_SYSTEM_PROMPT = `你是 OpenSCAD 建模助手。用户会提供若干「代码差异块」，每块包含类型（replace/delete/insert）、是否采纳 AI（可能为预览占位），以及删/增的代码片段。
这些说明会在用户勾选「是否采纳」之前展示，帮助用户理解每一块改动对模型的影响。
请用简体中文为每一块写**一句**功能说明（40～120 字为宜）：这段改动会让 3D 模型或参数发生**什么变化**（几何、尺寸、布尔运算、模块/参数等）。不要复述大段代码，不要写 markdown。
必须**只输出**一个 JSON 对象，格式严格为：{"explanations":["第1块说明","第2块说明",...]}。explanations 数组长度必须与输入块数量完全一致。`;

function truncateForExplain(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}\n…(已截断)`;
}

function normalizeExplanationList(parts: string[], expectedLen: number): string[] {
  const cleaned = parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < expectedLen; i += 1) {
    out.push(cleaned[i] || '（该块未能生成说明）');
  }
  return out;
}

function parseExplanationsJsonFromModel(text: string, expectedLen: number): string[] {
  const trimmed = text.trim();
  let jsonStr = trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    jsonStr = fence[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('模型输出不是合法 JSON');
  }

  let arr: unknown[];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { explanations?: unknown }).explanations)
  ) {
    arr = (parsed as { explanations: unknown[] }).explanations;
  } else {
    throw new Error('JSON 中缺少 explanations 数组');
  }

  const strings = arr.map((x) => (typeof x === 'string' ? x : String(x ?? '')));
  return normalizeExplanationList(strings, expectedLen);
}

/**
 * 调用 AI 为每个差异块生成一句中文功能说明（用于应用合并后的会话展示）。
 */
export async function explainOpenScadDiffBlocks(blocks: DiffExplainBlockInput[]): Promise<string[]> {
  if (blocks.length === 0) {
    return [];
  }

  const payload = {
    blocks: blocks.map((b) => ({
      index: b.index,
      kind: b.kind,
      adopted: b.adopted,
      removed: b.removed ? truncateForExplain(b.removed, 12000) : undefined,
      added: b.added ? truncateForExplain(b.added, 12000) : undefined,
    })),
  };

  const userContent = [
    `共 ${blocks.length} 个差异块，请按顺序生成 explanations。输入如下：`,
    JSON.stringify(payload, null, 2),
  ].join('\n');

  const client = getKimiFixClient();
  const response = await Promise.race([
    client.chat.completions.create({
      model: DIFF_EXPLAIN_MODEL,
      messages: [
        { role: 'system', content: DIFF_EXPLAIN_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      max_tokens: Number.isFinite(DIFF_EXPLAIN_MAX_TOKENS) ? DIFF_EXPLAIN_MAX_TOKENS : 3072,
      temperature: 0.25,
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('差异块说明调用超时')), 120000);
    }),
  ]);

  const text = response.choices[0]?.message?.content?.trim() || '';
  if (!text) {
    throw new Error('模型未返回说明文本');
  }

  return parseExplanationsJsonFromModel(text, blocks.length);
}

export async function generateProductBrief(prompt: string): Promise<string> {
  if (!PRODUCT_MANAGER_API_KEY) {
    throw new Error('未配置产品经理智能体 API Key（QN_API_KEY）');
  }

  const systemPrompt = PRODUCT_BRIEF_SYSTEM_PROMPT;
  const userPrompt = buildProductBriefUserPrompt(prompt);

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

/**
 * 检测输入中的 @提及 标记
 * 支持: @需求顾问 / 旧名 @产品经理 / @PM | @代码生成 / 旧名 @老师傅 | @代码助手 / 旧名 @实习生
 * @returns 返回角色名称，若没有 @提及 则返回 null
 */
export function detectMention(input: string): 'product_manager' | 'master' | 'intern' | null {
  const normalizedInput = input.toLowerCase();
  
  if (/@需求顾问|@产品经理|@pm|@product.?manager|@小k/.test(normalizedInput)) {
    return 'product_manager';
  }
  
  if (/@代码生成|@老师傅|@master|@craftsman/.test(normalizedInput)) {
    return 'master';
  }
  
  if (/@代码助手|@实习生|@intern|@apprentice/.test(normalizedInput)) {
    return 'intern';
  }
  
  return null;
}

/**
 * 根据 @提及 直接路由到对应角色
 * @param mention 角色类型
 * @param userInput 用户输入
 * @param conversationHistory 对话历史
 */
export async function handleMentionedRoute(
  mention: 'product_manager' | 'master' | 'intern',
  userInput: string,
  conversationHistory: ConversationMessage[] = []
): Promise<{
  response: string;
  mentionedRole: 'product_manager' | 'master' | 'intern';
  responderRole: ResponderRole;
  openscadCode?: string;
  parameters?: Record<string, any>;
}> {
  // 清理 @提及 标记
  const cleanedInput = userInput
    .replace(
      /@需求顾问|@产品经理|@PM|@pm|@product.?manager|@小k|@代码生成|@老师傅|@master|@craftsman|@代码助手|@实习生|@intern|@apprentice/gi,
      '',
    )
    .trim();
  
  switch (mention) {
    case 'product_manager': {
      // 直接调用产品经理
      const result = await askProductManager(cleanedInput, conversationHistory);
      return {
        response: result.response,
        mentionedRole: 'product_manager',
        responderRole: result.responderRole,
      };
    }
    
    case 'master':
    case 'intern': {
      // 直接调用老师傅或实习生处理代码问题
      const response = await askCodeResponder(mention, cleanedInput, conversationHistory);
      
      // 提取代码和参数
      const extractedCode = response.trim();
      const extractedParams = extractParameters(extractedCode);
      
      return {
        response,
        mentionedRole: mention,
        responderRole: mention,
        openscadCode: extractedCode,
        parameters: extractedParams,
      };
    }
    
    default:
      throw new Error(`未知的提及角色: ${mention}`);
  }
}
