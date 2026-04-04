# ScadGenerator AI 调用流程详解

## 📑 目录

1. [流程总览](#流程总览)
2. [三条主链路](#三条主链路)
   - [生成链路](#生成链路)
   - [确认链路](#确认链路)
   - [修复链路](#修复链路)
3. [关键函数详解](#关键函数详解)
4. [错误处理与重试机制](#错误处理与重试机制)
5. [性能指标与超时配置](#性能指标与超时配置)

---

## 流程总览

ScadGenerator 的 AI 调用采用**三链路分离设计**：

```
┌─────────────────────────────────────────────────────────────┐
│                   前端请求入口                               │
└─────────────────┬──────────────┬──────────────┬──────────────┘
                  │              │              │
          POST /api/             POST /confirm- POST /fix
       parametric-chat        requirement
                  │              │              │
                  ▼              ▼              ▼
           ┌─────────────┐  ┌──────────────┐ ┌──────────────┐
           │  生成链路   │  │  确认链路    │ │  修复链路    │
           │(1条主路径)  │  │(3向分流)     │ │(3级重试)     │
           └─────────────┘  └──────────────┘ └──────────────┘
```

---

## 三条主链路

### 生成链路

**路由**: `POST /api/parametric-chat`  
**入口函数**: `generateOpenSCAD(prompt, sessionId?, reportProgress?)`  
**场景**: 用户一键生成OpenSCAD代码

#### 执行流程

```
用户输入: "我想要一个参数化的长方体，尺寸200×100×50mm"
                    │
                    ▼
        【阶段1】产品经理需求预分析 (可选)
        ├─ 触发条件: PM_ENABLED = true
        ├─ 函数: generateProductBrief(prompt)
        ├─ 模型: PM_MODEL (kimi-k2.5)
        ├─ 作用: 将用户需求结构化，生成建模方案
        └─ 输出: productBrief (参数表+约束)
                    │
                    ▼
        【阶段2】老师傅代码生成 (核心)
        ├─ 函数: generateOpenSCAD{}
        ├─ 模型: OPENSCAD_MODEL (claude-4.5-sonnet)
        ├─ 输入构成:
        │   ├─ System Prompt: 强约束代码生成规则
        │   ├─ User Prompt: 用户需求 + productBrief
        │   └─ 温度: 0.7 (初次生成，允许创意)
        ├─ 超时: 120 秒
        └─ 输出: rawModelOutput (纯SCAD代码)
                    │
                    ▼
        【阶段3】代码清洗与参数提取
        ├─ 函数: processOpenSCADCode(rawCode)
        ├─ 操作:
        │   ├─ 去除不安全符号
        │   ├─ 提取顶层参数定义
        │   ├─ 验证基本编译性
        │   └─ 计算代码质量评分
        ├─ cleanedCode (质量评分 ≥ 0.6 时保留)
        └─ 回退策略: 质量不达标时使用 rawCode
                    │
                    ▼
        返回 GenerateResult {
          openscadCode,      // 原始模型输出
          compilableCode,    // 清洗后可编译代码
          parameters,        // 提取的参数字典
          sessionId,         // 会话ID
          productBrief?      // 结构化方案
        }
```

#### 代码示例

```typescript
// 入口调用
const result = await generateOpenSCAD(
  "我想要一个参数化的立方体",
  "session-123",
  (event) => console.log(event.stage, event.message)
);

// 返回结构
{
  openscadCode: "cube([10, 10, 10]);",
  compilableCode: "cube([10, 10, 10]);\n",
  parameters: { size: 10 },
  sessionId: "session-123",
  productBrief: "模型目标: 参数化立方体\n关键尺寸: 10×10×10mm\n..."
}
```

#### 进度事件 (reportProgress)

前端可以通过 `reportProgress` 回调实时获取生成进度：

| 阶段 | 事件类型 | 消息示例 | 元数据 |
|---|---|---|---|
| 初始化 | `queue` | 已收到需求，正在准备建模流程 | - |
| 产品经理阶段 | `pm_start` | 产品经理智能体正在拆解需求 | - |
| 产品经理完成 | `pm_done` | 需求拆解完成，正在进入代码生成 | `briefLength` |
| 代码生成开始 | `code_start` | 已收到需求，我来帮你把这个设计变成代码… | - |
| 代码生成完成 | `code_done` | 代码生成完成，现在验证编译 | - |
| 参数提取 | `parameters_extracted` | 参数提取完成 | `parameterCount` |

---

### 确认链路

**路由**: `POST /api/parametric-chat/confirm-requirement`  
**入口函数**: `askProductManager(userInput, conversationHistory[])`  
**场景**: 多轮对话进行需求确认，或代码问题处理

#### 决策树与路由分流

确认链路是整个系统的**智能分流中枢**。根据用户输入的意图，系统自动路由到产品经理、实习生或老师傅。

```
请求到达 askProductManager()
            │
            ▼
    ┌─────────────────────┐
    │ isCodeIssueIntent   │  ← 检测「代码/编译/报错/error」关键词
    │    (input)          │
    └────────┬────────────┘
             │
    ┌────────┴────────┐
    ▼                 ▼
  YES               NO
  代码问题         普通需求
    │                │
    ▼                ▼
shouldEscalate    产品经理继续
ToMaster?         需求确认
    │         
    ├─ YES ──→ askCodeResponder('master', ...)
    │         └─→ OPENSCAD_MODEL (Claude)
    │         └─→ 返回: {responderRole: 'master', response: SCAD代码}
    │
    └─ NO ──→ askCodeResponder('intern', ...)
             └─→ INTERN_MODEL (DeepSeek)
             └─→ 返回: {responderRole: 'intern', response: SCAD代码}

产品经理分支:
    ├─ 检测【需求确认完成】标记
    ├─ 检测【请老师傅生成代码】指令
    ├─ 提取【最终需求】内容
    └─ 返回: {
         response: 产品经理回复,
         isNeedMoreInfo: boolean,
         isClear: boolean,
         shouldGenerate: boolean,
         confirmedRequirement?: string,
         responderRole: 'product_manager'
       }
```

#### 代码问题识别规则

```typescript
function isCodeIssueIntent(input: string): boolean {
  // 匹配关键词（不区分大小写）
  return /(代码|编译|报错|错误|异常|崩溃|失败|修复|修理|bug|fix|error|stack|trace|warning)/i.test(input);
}
```

#### 升级条件详解

```typescript
function shouldEscalateToMaster(
  input: string,
  conversationHistory: ConversationMessage[]
): boolean {
  // 条件1: 用户明确要求老师傅
  const pmEscalation = /(请老师傅|转老师傅|老师傅处理|老师傅来)/.test(input);
  if (pmEscalation) {
    return true;  // ← 立即升级
  }

  // 条件2: 识别反复失败信号
  const retryHint = /(还是不行|依旧报错|连续失败|反复修改|多次修复|修了.*次|又报错)/.test(input);
  if (!retryHint) {
    return false;  // ← 首次问题交给实习生
  }

  // 条件3: 历史中有多次失败记录
  const failedCount = conversationHistory
    .filter((msg) => msg.role === 'assistant')
    .filter((msg) => /实习生|修复失败|未解决|建议你调整代码后再点一次修复/.test(msg.content))
    .length;

  return failedCount >= 2;  // ← 失败≥2次时升级到老师傅
}
```

#### 用户交互示例

**场景1: 普通需求确认**

```
用户: "我想要一个圆柱体"
                ↓
产品经理: "嗨~ 想做什么样的圆柱体呀？请问高度和半径各是多少毫米呢？📏"
                ↓
用户: "100mm高，20mm半径"
                ↓
产品经理: "好哒！我理解的是一个高100mm、半径20mm的圆柱体，是不是这样呀？
         【需求确认完成】
         【最终需求】
         - 圆柱体，高100mm，半径20mm
         - 参数化：height, radius
         【状态】等待用户下达"生成代码"指令
```

**场景2: 代码问题升级**

```
用户: "生成的代码编译报错"
                ↓
系统检测: isCodeIssueIntent = true
         shouldEscalateToMaster = false (首次失败)
                ↓
实习生: "我来帮你修复这个问题。请共享完整的编译错误信息。"
                ↓
用户: "还是不行，报同样的错误"
                ↓
系统检测: failedCount = 1, 不升级
         
用户: "又报错了，修了三次都没用"
                ↓
系统检测: failedCount >= 2, shouldEscalateToMaster = true
                ↓
老师傅: "[直接输出修复后的SCAD代码]"
```

---

### 修复链路

**路由**: `POST /api/parametric-chat/fix`  
**入口函数**: `fixOpenSCADCode(openscadCode, compileError?, sessionId?)`  
**场景**: 编译失败时自动修复

#### 三级重试机制

修复链路采用**渐进式重试策略**：优先使用速度快的模型，失败后逐级升级。

```
编译失败，用户提交修复请求
        │
        ▼
┌───────────────────────────────┐
│【第1级】实习生修复 (主模型)    │
│ 模型: INTERN_MODEL (DeepSeek) │
│ 超时: 240 秒                  │
│ max_tokens: 1536              │
└───────────────────────────────┘
        │
        ├─ ✅ 成功 ──→ 返回修复代码
        │
        └─ ❌ 失败 (超时/错误)
                │
                ▼
        ┌───────────────────────────────┐
        │【第2级】Kimi兜底修复 (第1次)  │
        │ 模型: KIMI_FIX_MODEL (Kimi)   │
        │ 超时: 240 秒                  │
        │ max_tokens: 1536              │
        └───────────────────────────────┘
                │
                ├─ ✅ 成功 ──→ 返回修复代码
                │
                └─ ❌ 失败 (超时/错误)
                        │
                        ▼
                ┌───────────────────────────────┐
                │【第3级】Kimi兜底修复 (第2次) │
                │ 模型: KIMI_FIX_MODEL (Kimi)   │
                │ 超时: 240 秒                  │
                │ max_tokens: 1536              │
                └───────────────────────────────┘
                        │
                        ├─ ✅ 成功 ──→ 返回修复代码
                        │
                        └─ ❌ 失败 (所有重试均失败)
                                │
                                ▼
                        返回 GenerateOpenSCADFailure {
                          message: "详细错误信息",
                          fallbackResult?: { 
                            尝试从错误堆栈中提取的代码
                          }
                        }
```

#### 修复提示词特性

修复流程对应的系统提示词具有特殊的约束：

```
你是一个 OpenSCAD 代码修复器（实习生）。
你会收到一段存在问题的 OpenSCAD 代码和编译错误信息。

强制规则（必须遵守）：
1) 仅返回修复后的完整 OpenSCAD 代码。
2) 禁止任何解释、注释说明、思考过程、markdown 围栏。
3) 保留原有建模意图与参数命名，优先做最小修改使其可编译。
4) 代码必须可执行且结构完整。

温度: 0.2 (低温，保证修复稳定性)
```

#### 错误信息传递

```typescript
// 修复请求
POST /api/parametric-chat/fix
{
  openscadCode: "cube([10, 10, 10))",  // 错误代码：缺少]
  compileError: "Parse error: Syntax error: expected ')' or ';' at end of input",
  sessionId: "session-123"
}

// 成功响应
{
  openscadCode: "cube([10, 10, 10]);",  // 修复后
  compilableCode: "cube([10, 10, 10]);\n",
  parameters: { size: 10 },
  sessionId: "session-123"
}

// 失败响应 (3级都失败)
{
  error: "GenerateOpenSCADFailure",
  message: "主模型修复失败(...); Kimi兜底修复失败(第1次: ...; 第2次: ...)",
  fallbackResult: {
    openscadCode: "cube([10, 10, 10]);",  // 从错误中提取的猜测
    compilableCode: "cube([10, 10, 10]);\n",
    parameters: {},
    sessionId: "session-123"
  }
}
```

---

## 关键函数详解

### 1. generateOpenSCAD

**签名**:
```typescript
async function generateOpenSCAD(
  prompt: string,
  sessionId?: string,
  reportProgress?: ProgressReporter
): Promise<GenerateResult>
```

**职责**: 将自然语言转换为OpenSCAD代码

**关键步骤**:

| 步骤 | 函数 | 作用 | 触发条件 |
|---|---|---|---|
| 1 | generateProductBrief | 结构化需求分解 | PM_ENABLED=true |
| 2 | API调用 (Claude) | OpenSCAD代码生成 | 无条件 |
| 3 | processOpenSCADCode | 代码清洗与参数提取 | 无条件 |
| 4 | buildGenerateResult | 结果封装 | 无条件 |

**错误处理**:
```typescript
try {
  // 生成逻辑
} catch (error) {
  throw new GenerateOpenSCADFailure(
    `生成失败: ${error.message}`,
    fallbackResult // 尝试从错误中提取代码
  );
}
```

---

### 2. askProductManager

**签名**:
```typescript
async function askProductManager(
  userInput: string,
  conversationHistory: ConversationMessage[] = []
): Promise<{
  response: string;
  isNeedMoreInfo: boolean;
  isClear: boolean;
  shouldGenerate: boolean;
  confirmedRequirement?: string;
  responderRole: ResponderRole;
}>
```

**职责**: 需求澄清对话 & 智能路由分发

**返回值详解**:

```typescript
// 场景1: 普通需求确认
{
  response: "【问题】\n- 你想要什么形状呀？\n...",
  isNeedMoreInfo: true,      // 还需要更多信息
  isClear: false,             // 需求不清晰
  shouldGenerate: false,      // 不应该生成代码
  confirmedRequirement: undefined,
  responderRole: 'product_manager'
}

// 场景2: 代码问题，路由到实习生
{
  response: "[OpenSCAD code...]",
  isNeedMoreInfo: true,
  isClear: false,
  shouldGenerate: false,
  responderRole: 'intern'     // ← 或 'master'
}
```

---

### 3. fixOpenSCADCode

**签名**:
```typescript
async function fixOpenSCADCode(
  openscadCode: string,
  compileError?: string,
  sessionId?: string
): Promise<GenerateResult>
```

**职责**: 编译错误修复（支持3级重试）

**关键实现**:
```typescript
// 1. 构建修复提示
const systemPrompt = `你是 OpenSCAD 代码修复器...`;
const userPrompt = `原始代码:\n${openscadCode}\n\n错误信息:\n${compileError}\n\n请修复:`;

// 2. 主模型尝试
try {
  const mainResult = await deepseekClient.chat.completions.create({...});
  return buildGenerateResult(mainResult.content);
} catch (primaryError) {
  // 3. Kimi兜底（第1次）
  // 4. Kimi兜底（第2次）
  // 5. 所有失败 → 抛异常
}
```

---

## 错误处理与重试机制

### 错误分类

| 错误类型 | 表现 | 处理策略 | 重试次数 |
|---|---|---|---|
| 超时 (Timeout) | 请求>指定时间 | 直接失败，不重试 | 0 |
| API错误 (4xx/5xx) | 模型服务返回错误 | 下级重试 (修复链) | 见链路 |
| 格式错误 | 输出不符合约束 | 尝试清洗，回退原始 | 0 |
| 编译错误 | OpenSCAD不可编译 | 进入修复链路 | 3 |

### 超时配置

| 功能 | 参数名 | 默认值 | 说明 |
|---|---|---|---|
| 生成 | 无独立配置 | 120s | 生成+产品经理合并超时 |
| 产品经理 | 后端代码 | 120s | confirm-requirement端点 |
| 修复 | OPENSCAD_FIX_TIMEOUT_MS | 240s | 修复更长，支持重试 |

```env
# 可配置变量
OPENSCAD_FIX_TIMEOUT_MS=240000  # 修复超时(毫秒)
```

---

## 性能指标与超时配置

### Token 消耗统计

| 功能 | 模型 | max_tokens | 用途 | 成本估算 |
|---|---|---|---|---|
| 生成(初次) | Claude | 4096 | 完整代码生成 | 高 |
| 生成(产品经理) | Kimi | 1024 | 需求结构化 | 中 |
| 确认对话 | Kimi/Claude | 2048 | 多轮对话 | 中 |
| 修复(主) | DeepSeek | 1536 | 代码修复 | 低 |
| 修复(兜底) | Kimi | 1536 | 二次修复 | 中 |

### 端到端性能

**完整流程耗时 (理想情况)**:

```
生成链路:
  产品经理分析 (30-60s)
    ↓
  老师傅生成 (15-40s)
    ↓
  代码清洗 (0.5-2s)
  ─────────────────
  总计: 45-100秒

确认链路:
  产品经理对话 (3-15s)
  [或] 实习生/老师傅代码 (15-40s)
  ─────────────────
  总计: 20-50秒

修复链路 (成功路径):
  主模型修复 (10-30s)
  ─────────────────
  总计: 10-30秒
```

### 优化建议

1. **并发优化**: 产品经理分析与老师傅生成不支持并发
2. **模型选择**: 
   - 实习生 (DeepSeek) 更快，用于首次修复
   - 老师傅 (Claude) 质量更高，用于关键生成
3. **缓存策略**: 相同需求的 productBrief 可缓存
4. **异步处理**: 长流程使用 WebSocket 推送进度

---

## 关键类型定义

```typescript
// 响应者角色
type ResponderRole = 'product_manager' | 'intern' | 'master';
type CodeResponderRole = 'intern' | 'master';

// 生成结果
interface GenerateResult {
  openscadCode: string;           // 原始模型输出
  compilableCode: string;         // 清洗后且可编译的代码
  parameters: Record<string, any>; // 提取的参数
  sessionId: string;              // 会话ID
  productBrief?: string;          // 产品经理方案
}

// 对话消息
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// 生成进度事件
interface GenerationProgressEvent {
  stage: 'queue' | 'pm_start' | 'pm_done' | 'code_start' | 'code_done' | 'parameters_extracted';
  message: string;
  meta?: Record<string, any>;
}
```

---

## 常见场景速查表

| 场景 | 入点 | 涉及模型 | 超时 | 重试 |
|---|---|---|---|---|
| 一键生成代码 | /parametric-chat | Kimi + Claude | 120s | 0 |
| 多轮需求确认 | /confirm-requirement | Kimi | 120s | 0 |
| 问题咨询升级 | /confirm-requirement | DeepSeek → Kimi | 120s | 0 |
| 编译错误修复 | /fix | DeepSeek → Kimi (×2) | 240s | 3 |
| 反复失败升级 | /confirm-requirement | Claude | 120s | 0 |

---

**文档版本**: v1.0  
**更新时间**: 2026-03-27  
**维护者**: ScadGenerator Team
