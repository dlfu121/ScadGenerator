import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import { generateOpenSCAD } from '../services/ai-service';

// 前端发起参数化建模请求的最小入参。
interface ParametricChatRequest {
  prompt: string;
  sessionId?: string;
}

// 统一返回结构，便于前端状态管理。
interface ParametricChatResponse {
  openscadCode: string;
  parameters: Record<string, any>;
  sessionId: string;
}

const router = Router();

// 主流程：校验 prompt -> 调用 AI 生成 -> 返回代码与参数。
router.post('/', async (req: Request<{}, {}, ParametricChatRequest>, res: Response<ParametricChatResponse>) => {
  try {
    const { prompt, sessionId } = req.body;
    
    // 空 prompt 直接返回 400，避免触发无意义模型调用。
    if (!prompt) {
      return res.status(400).json({
        openscadCode: '',
        parameters: {},
        sessionId: sessionId || ''
      } as ParametricChatResponse);
    }

    const result = await generateOpenSCAD(prompt, sessionId);
    
    res.json(result);
  } catch (error) {
    // 失败时返回可渲染的兜底结构，避免前端空对象判断复杂化。
    console.error('AI生成错误:', error);
    res.status(500).json({
      openscadCode: '// 生成失败',
      parameters: {},
      sessionId: req.body.sessionId || ''
    } as ParametricChatResponse);
  }
});

export default router;
