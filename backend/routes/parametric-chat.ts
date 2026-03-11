import { Router, Request, Response } from 'express';
import { generateOpenSCAD } from '../services/ai-service';
import { openscadCompiler } from '../services/openscad-compiler';

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

interface CompileRequestBody {
  openscadCode: string;
  parameters?: Record<string, any>;
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

router.post('/compile', async (req: Request<{}, {}, CompileRequestBody>, res: Response) => {
  const { openscadCode, parameters = {} } = req.body;

  if (!openscadCode || !openscadCode.trim()) {
    res.setHeader('X-Compile-Status', 'error');
    return res.status(400).json({
      status: 'error',
      error: 'OpenSCAD 代码不能为空'
    });
  }

  try {
    const result = await openscadCompiler.compileToSTL(openscadCode, parameters);

    if (!result.success || !result.stlData) {
      res.setHeader('X-Compile-Status', 'error');
      return res.status(422).json({
        status: result.status,
        error: result.error || '编译失败',
        detail: result.detail,
        compileTime: result.compileTime
      });
    }

    res.setHeader('Content-Type', 'model/stl');
    res.setHeader('X-Compile-Status', result.status);
    if (typeof result.compileTime === 'number') {
      res.setHeader('X-Compile-Time', result.compileTime.toString());
    }
    return res.status(200).send(result.stlData);
  } catch (error) {
    res.setHeader('X-Compile-Status', 'error');
    return res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : '编译服务异常',
      detail: {
        message: error instanceof Error ? error.message : '编译服务异常'
      }
    });
  }
});

export default router;
