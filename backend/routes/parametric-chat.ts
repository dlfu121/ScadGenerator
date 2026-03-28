import { Router, Request, Response } from 'express';
import { generateOpenSCAD, fixOpenSCADCode, fixOpenSCADCodeWithRetry, askProductManager, RepairSummary } from '../services/ai-service';
import { openscadCompiler } from '../services/openscad-compiler';
import { checkGeometry, GeometryCheckResult } from '../services/geometry-checker';
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
  repairSummary?: RepairSummary;
  geometryReport?: GeometryCheckResult;
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
  /** 是否启用重试循环（修复-编译-再修复，最多3轮），默认 true */
  enableRetry?: boolean;
}

interface CheckRequestBody {
  stlBase64: string;
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

router.post('/export/stl', async (req: Request<{}, {}, ExportRequestBody>, res: Response) => {
  const { openscadCode, parameters = {} } = req.body;

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
  const { openscadCode, parameters = {} } = req.body;

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
    const { openscadCode, compileError, sessionId, enableRetry = true } = req.body;

    if (!openscadCode || !openscadCode.trim()) {
      return res.status(400).json({
        openscadCode: '',
        compilableCode: '',
        parameters: {},
        sessionId: sessionId || '',
        error: 'OpenSCAD 代码不能为空'
      } as ParametricChatResponse);
    }

    if (enableRetry) {
      // 带重试的修复流程：修复 → 编译 → 再修复，最多 3 轮
      // 通过闭包捕获最后一次成功编译的 STL，避免几何检查时重复编译。
      let capturedStlData: Parameters<typeof checkGeometry>[0] | undefined;
      const compileCallback = async (code: string) => {
        const result = await openscadCompiler.compileToSTL(code, {});
        if (result.success && result.stlData) {
          capturedStlData = result.stlData;
        }
        return { success: result.success, error: result.error };
      };

      const fixed = await fixOpenSCADCodeWithRetry(
        openscadCode,
        compileCallback,
        compileError,
        sessionId,
        3
      );

      // 若最终编译成功，对已捕获的 STL 执行几何检查，无需再次编译
      let geometryReport: GeometryCheckResult | undefined;
      if (fixed.repairSummary.succeeded && capturedStlData) {
        try {
          geometryReport = checkGeometry(capturedStlData);
        } catch {
          // 几何检查失败不影响主流程返回
        }
      }

      return res.json({ ...fixed, geometryReport } as ParametricChatResponse);
    }

    // 不启用重试时，单轮修复
    const fixed = await fixOpenSCADCode(openscadCode, compileError, sessionId);
    return res.json(fixed as ParametricChatResponse);
  } catch (error) {
    console.error('AI修复错误:', error);
    const fallback = (error as { fallbackResult?: ParametricChatResponse })?.fallbackResult;
    return res.status(500).json({
      openscadCode: fallback?.openscadCode || '',
      compilableCode: fallback?.compilableCode || fallback?.openscadCode || '',
      parameters: fallback?.parameters || {},
      sessionId: fallback?.sessionId || req.body.sessionId || '',
      error: error instanceof Error ? error.message : '修复失败'
    } as ParametricChatResponse);
  }
});

// 几何完整性与 3D 打印风险检查（接收 Base64 编码的 STL 二进制数据）
router.post('/check', async (req: Request<{}, {}, CheckRequestBody>, res: Response) => {
  try {
    const { stlBase64 } = req.body;

    if (!stlBase64 || !stlBase64.trim()) {
      return res.status(400).json({
        status: 'error',
        error: 'stlBase64 不能为空'
      });
    }

    let stlBuffer: Buffer;
    try {
      stlBuffer = Buffer.from(stlBase64, 'base64');
    } catch {
      return res.status(400).json({
        status: 'error',
        error: 'stlBase64 解码失败，请提供有效的 Base64 编码 STL 数据'
      });
    }

    const report = checkGeometry(stlBuffer);
    return res.json({
      status: 'success',
      ...report
    });
  } catch (error) {
    console.error('几何检查错误:', error);
    return res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : '几何检查服务异常'
    });
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
  sessionId?: string;
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
