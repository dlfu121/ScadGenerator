import { Router, Request, Response } from 'express';
import { generateOpenSCAD, fixOpenSCADCode, askProductManager, detectMention, handleMentionedRoute } from '../services/ai-service';
import { openscadCompiler } from '../services/openscad-compiler';
import { emitSessionEvent } from '../services/websocket';

// 前端发起参数化建模请求的最小入参。
interface ParametricChatRequest {
  prompt: string;
  sessionId?: string;
}

// 统一返回结构，便于前端状态管理。
interface ParametricChatResponse {
  openscadCode: string;
  compilableCode?: string;
  parameters: Record<string, any>;
  sessionId: string;
  productBrief?: string;
  error?: string;
}

interface CompileRequestBody {
  openscadCode: string;
  parameters?: Record<string, any>;
}

interface ExportRequestBody {
  openscadCode: string;
  parameters?: Record<string, any>;
}

interface FixRequestBody {
  openscadCode: string;
  compileError?: string;
  sessionId?: string;
}

const router = Router();

function readCodePayload(input: unknown): string {
  return typeof input === 'string' ? input : '';
}

// 主流程：校验 prompt -> 调用 AI 生成 -> 返回代码与参数。
router.post('/', async (req: Request<{}, {}, ParametricChatRequest>, res: Response<ParametricChatResponse>) => {
  try {
    const { prompt, sessionId } = req.body;
    
    // 空 prompt 直接返回 400，避免触发无意义模型调用。
    if (!prompt) {
      return res.status(400).json({
        openscadCode: '',
        compilableCode: '',
        parameters: {},
        sessionId: sessionId || ''
      } as ParametricChatResponse);
    }

    const result = await generateOpenSCAD(prompt, sessionId, (event) => {
      if (!sessionId) {
        return;
      }

      emitSessionEvent(sessionId, {
        type: 'ai_progress',
        ...event,
        timestamp: Date.now(),
      });
    });
    
    res.json(result);
  } catch (error) {
    // 失败时返回可渲染的兜底结构，避免前端空对象判断复杂化。
    console.error('AI生成错误:', error);
    const fallback = (error as { fallbackResult?: ParametricChatResponse })?.fallbackResult;
    res.status(500).json({
      openscadCode: fallback?.openscadCode || '',
      compilableCode: fallback?.compilableCode || fallback?.openscadCode || '',
      parameters: fallback?.parameters || {},
      sessionId: fallback?.sessionId || req.body.sessionId || '',
      error: error instanceof Error ? error.message : '生成失败'
    } as ParametricChatResponse);
  }
});

router.post('/compile', async (req: Request<{}, {}, CompileRequestBody>, res: Response) => {
  const openscadCode = readCodePayload(req.body?.openscadCode);
  const parameters = req.body?.parameters || {};

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

router.post('/export/stl', async (req: Request<{}, {}, ExportRequestBody>, res: Response) => {
  const openscadCode = readCodePayload(req.body?.openscadCode);
  const parameters = req.body?.parameters || {};

  if (!openscadCode || !openscadCode.trim()) {
    return res.status(400).json({
      status: 'error',
      error: 'OpenSCAD 代码不能为空'
    });
  }

  try {
    const result = await openscadCompiler.exportArtifact(openscadCode, parameters, 'stl');

    if (!result.success || !result.data) {
      return res.status(422).json({
        status: 'error',
        error: result.error || '导出 STL 失败',
        detail: result.detail,
        compileTime: result.compileTime
      });
    }

    if (typeof result.compileTime === 'number') {
      res.setHeader('X-Compile-Time', result.compileTime.toString());
    }
    res.setHeader('Content-Type', 'model/stl');
    res.setHeader('Content-Disposition', 'attachment; filename="model.stl"');
    return res.status(200).send(result.data);
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : '导出 STL 服务异常',
      detail: {
        message: error instanceof Error ? error.message : '导出 STL 服务异常'
      }
    });
  }
});

router.post('/export/csg', async (req: Request<{}, {}, ExportRequestBody>, res: Response) => {
  const openscadCode = readCodePayload(req.body?.openscadCode);
  const parameters = req.body?.parameters || {};

  if (!openscadCode || !openscadCode.trim()) {
    return res.status(400).json({
      status: 'error',
      error: 'OpenSCAD 代码不能为空'
    });
  }

  try {
    const result = await openscadCompiler.exportArtifact(openscadCode, parameters, 'csg');

    if (!result.success || !result.data) {
      return res.status(422).json({
        status: 'error',
        error: result.error || '导出 CSG 失败',
        detail: result.detail,
        compileTime: result.compileTime
      });
    }

    if (typeof result.compileTime === 'number') {
      res.setHeader('X-Compile-Time', result.compileTime.toString());
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="model.csg"');
    return res.status(200).send(result.data);
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : '导出 CSG 服务异常',
      detail: {
        message: error instanceof Error ? error.message : '导出 CSG 服务异常'
      }
    });
  }
});

router.post('/fix', async (req: Request<{}, {}, FixRequestBody>, res: Response<ParametricChatResponse>) => {
  try {
    const openscadCode = readCodePayload(req.body?.openscadCode);
    const compileError = req.body?.compileError;
    const sessionId = req.body?.sessionId;

    if (!openscadCode || !openscadCode.trim()) {
      return res.status(400).json({
        openscadCode: '',
        compilableCode: '',
        parameters: {},
        sessionId: sessionId || '',
        error: 'OpenSCAD 代码不能为空'
      } as ParametricChatResponse);
    }

    const fixed = await fixOpenSCADCode(openscadCode, compileError, sessionId);
    return res.json(fixed);
  } catch (error) {
    console.error('AI修复错误:', error);
    const fallback = (error as { fallbackResult?: ParametricChatResponse })?.fallbackResult;
    const originalCode = readCodePayload(req.body?.openscadCode);
    const safeCode = fallback?.openscadCode || originalCode;
    return res.status(500).json({
      openscadCode: safeCode,
      compilableCode: fallback?.compilableCode || safeCode,
      parameters: fallback?.parameters || {},
      sessionId: fallback?.sessionId || req.body.sessionId || '',
      error: error instanceof Error ? error.message : '修复失败'
    } as ParametricChatResponse);
  }
});

// 与产品经理进行多轮对话来确认需求
interface RequirementConfirmationRequest {
  userInput: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  sessionId?: string;
}

interface RequirementConfirmationResponse {
  pmResponse: string;
  isNeedMoreInfo: boolean;
  isClear: boolean;
  shouldGenerate: boolean;
  confirmedRequirement?: string;
  responderRole?: 'product_manager' | 'intern' | 'master';
  sessionId?: string;
  openscadCode?: string;
  parameters?: Record<string, any>;
}

router.post('/confirm-requirement', async (req: Request<{}, {}, RequirementConfirmationRequest>, res: Response<RequirementConfirmationResponse>) => {
  try {
    const { userInput, conversationHistory = [], sessionId } = req.body;

    if (!userInput || !userInput.trim()) {
      return res.status(400).json({
        pmResponse: '请输入您的建模需求',
        isNeedMoreInfo: true,
        isClear: false,
        shouldGenerate: false,
        sessionId
      });
    }

    // 【新增】检测 @提及 标记，优先处理 @实习生 和 @老师傅
    const mentionedRole = detectMention(userInput);
    if (mentionedRole) {
      const mentionedResult = await handleMentionedRoute(mentionedRole, userInput, conversationHistory);
      
      // 通过 WebSocket 发送进度事件
      if (sessionId) {
        emitSessionEvent(sessionId, {
          type: 'mention_routed',
          stage: 'mention_detected',
          mentionedRole: mentionedResult.mentionedRole,
          message: mentionedResult.response,
          timestamp: Date.now(),
        });
      }

      return res.json({
        pmResponse: mentionedResult.response,
        isNeedMoreInfo: false, // @提及直接处理，不需要更多信息
        isClear: false,
        shouldGenerate: false,
        responderRole: mentionedResult.responderRole,
        openscadCode: mentionedResult.openscadCode,
        parameters: mentionedResult.parameters,
        sessionId
      });
    }

    // 【原有逻辑】无 @提及 时，使用产品经理进行需求确认
    const result = await askProductManager(userInput, conversationHistory);

    // 通过 WebSocket 发送进度事件
    if (sessionId) {
      emitSessionEvent(sessionId, {
        type: 'requirement_confirmation',
        stage: result.isClear ? 'confirmed' : 'clarifying',
        message: result.response,
        isNeedMoreInfo: result.isNeedMoreInfo,
        isClear: result.isClear,
        timestamp: Date.now(),
      });
    }

    res.json({
      pmResponse: result.response,
      isNeedMoreInfo: result.isNeedMoreInfo,
      isClear: result.isClear,
      shouldGenerate: result.shouldGenerate,
      confirmedRequirement: result.confirmedRequirement,
      responderRole: result.responderRole,
      sessionId
    });
  } catch (error) {
    console.error('需求确认错误:', error);
    res.status(500).json({
      pmResponse: error instanceof Error ? error.message : '产品经理产生了错误',
      isNeedMoreInfo: true,
      isClear: false,
      shouldGenerate: false,
      sessionId: req.body.sessionId
    });
  }
});

export default router;
