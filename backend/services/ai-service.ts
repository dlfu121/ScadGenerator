import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { processOpenSCADCode } from './code-processor';

const openai = new OpenAI({
  apiKey: process.env.QN_API_KEY,
  baseURL: process.env.QN_BASE_URL || 'https://api.qnaigc.com/v1',
  dangerouslyAllowBrowser: false,
});

// AI 生成模块对外返回的数据结构。
interface GenerateResult {
  openscadCode: string;
  parameters: Record<string, any>;
  sessionId: string;
}

export async function generateOpenSCAD(prompt: string, sessionId?: string): Promise<GenerateResult> {
  try {
    if (!process.env.QN_API_KEY) {
      throw new Error('未配置 QN_API_KEY，无法调用 AI 生成服务');
    }

    // 通过 system prompt 约束模型输出为可执行的参数化 OpenSCAD 代码。
    const systemPrompt = `你是一个专业的OpenSCAD代码生成助手。请根据用户的需求生成参数化的OpenSCAD代码。

要求：
1. 生成有效的OpenSCAD代码
2. 使用参数化设计，包含可调参数
3. 代码应该简洁且易于理解
4. 只返回OpenSCAD代码，不要解释

示例格式：
// 参数定义
length = 50;
width = 30;
height = 20;

// 模型生成
cube([length, width, height]);`;

    const response = await Promise.race([
      openai.chat.completions.create({
        model: process.env.OPENSCAD_MODEL || 'deepseek-r1',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('AI 生成超时，请稍后重试')), 15000);
      })
    ]);

    // 容错：当模型无内容时，返回默认失败注释，避免后续流程崩溃。
    const openscadCode = response.choices[0]?.message?.content || '// 生成失败';
    
    // 使用代码处理模块清理代码并提取参数定义。
    const processed = processOpenSCADCode(openscadCode);
    const parameters = processed.parameters.reduce((acc, param) => {
      acc[param.name] = param.value;
      return acc;
    }, {} as Record<string, any>);
    
    return {
      openscadCode: processed.cleanedCode,
      parameters,
      // 透传已有会话；若为空则生成新会话，便于前后端追踪上下文。
      sessionId: sessionId || uuidv4()
    };
  } catch (error) {
    console.error('OpenAI API错误:', error);
    throw error;
  }
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
