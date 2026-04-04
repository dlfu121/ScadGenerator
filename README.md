# ScadGenerator

一个面向 OpenSCAD 的多智能体参数化建模系统。

用户通过自然语言描述建模需求，系统会在前后端协同下完成以下流程：
- 需求澄清与结构化拆解
- OpenSCAD 代码生成
- 编译验证与预览
- 失败时自动修复与重试

项目重点不是“单模型一次性回答”，而是“角色分工 + 路由分流 + 可恢复会话”。

---

## 1. 项目定位

ScadGenerator 旨在解决以下问题：

1. 用户需求往往不完整，直接生成代码成功率不稳定。
2. 代码一旦编译失败，普通聊天助手很难持续修复直到可用。
3. 建模过程需要可视化反馈和参数化调节，而不是一次性文本输出。

因此本项目采用三角色智能体架构：
- 产品经理：负责需求确认与方案结构化。
- 老师傅：负责最终代码生成与疑难问题升级处理。
- 实习生：负责代码问题咨询与自动修复。

---

## 2. 核心能力

- 多角色智能体协作（产品经理 / 老师傅 / 实习生）
- 自然语言生成 OpenSCAD 参数化代码
- 自动抽取参数，驱动前端参数面板
- OpenSCAD 编译与 STL/CSG 导出
- 失败回退与自动修复
- WebSocket 实时进度反馈
- 对话式需求确认与角色分流

---

## 3. 智能体总览

当前系统按业务角色共 3 个智能体角色，按提示词模板共 4 套核心提示词。

### 3.1 角色与职责

| 角色 | 职责 | 主要入口 |
|---|---|---|
| 产品经理 | 多轮需求确认、结构化建模方案 | askProductManager, generateProductBrief |
| 老师傅 | 最终 OpenSCAD 代码生成、疑难升级处理 | generateOpenSCAD |
| 实习生 | 代码问题处理、编译错误自动修复 | fixOpenSCADCode |

### 3.2 模型映射（按当前代码真实逻辑）

| 角色/能力 | 模型变量 | 默认值 | 备注 |
|---|---|---|---|
| 产品经理（需求确认 + brief） | PM_MODEL | moonshotai/kimi-k2.5 | 走 OpenAI Compatible 或 Messages 协议 |
| 老师傅（代码生成 + 升级介入） | OPENSCAD_MODEL | claude-4.5-sonnet | 变量读取优先级见下文 |
| 实习生（咨询 + 修复） | INTERN_MODEL | deepseek/deepseek-v3.2-251201 | 与修复链路统一 |

### 3.3 关键模型变量优先级

当前后端代码中的模型读取逻辑如下：

1. 老师傅模型（OPENSCAD_MODEL）
   - 读取顺序：QINIU_DEEPSEEK_MODEL -> OPENSCAD_MODEL -> claude-4.5-sonnet
2. 实习生模型（INTERN_MODEL）
   - 读取顺序：INTERN_MODEL -> QINIU_DEEPSEEK_MODEL -> deepseek/deepseek-v3.2-251201
3. 产品经理模型（PRODUCT_MANAGER_MODEL）
   - 读取顺序：PM_MODEL -> moonshotai/kimi-k2.5

说明：
- QINIU_DEEPSEEK_MODEL 在当前实现里会影响老师傅与实习生的兜底模型。
- 如果你希望两者完全解耦，建议分别显式设置 OPENSCAD_MODEL 与 INTERN_MODEL。

---

## 4. 完整提示词（按后端源码摘录）

以下为 backend/services/ai-service.ts 中的系统提示词原文（仅做排版整理，语义保持一致）。

### 4.1 老师傅：代码生成提示词（generateOpenSCAD）

```text
你是"老师傅"，负责 OpenSCAD 代码生成。只输出一段可执行的 OpenSCAD 代码，禁止输出任何额外文本。

强制规则（必须遵守）：
1) 禁止解释、分析、思考过程、提示词复述。
2) 禁止 markdown 代码围栏（例如 ```openscad）。
3) 禁止返回重复代码块，只允许一段最终代码。
4) 生成有效且可编译的 OpenSCAD。
5) 尽量参数化（使用顶层参数定义）。

输出要求：
- 只返回纯 OpenSCAD 源码，不要前后缀。
```

### 4.2 实习生：代码修复提示词（fixOpenSCADCode）

```text
你是一个 OpenSCAD 代码修复器（实习生）。你会收到一段存在问题的 OpenSCAD 代码和编译错误信息。

强制规则（必须遵守）：
1) 仅返回修复后的完整 OpenSCAD 代码。
2) 禁止任何解释、注释说明、思考过程、markdown 围栏。
3) 保留原有建模意图与参数命名，优先做最小修改使其可编译。
4) 代码必须可执行且结构完整。
```

### 4.3 产品经理：需求确认提示词（askProductManager）

```text
你是小K，一位可爱又专业的 3D 参数化建模产品经理~ ✨

你的职责是帮用户把模糊的建模想法变成清晰的需求，然后交给老师傅去写代码！

!! 重要 !!：这是关于用代码生成 3D CAD 模型的，不是网页设计或其他类型的项目。
!! 强制规则 !!：你绝对不能输出 OpenSCAD 代码、JSON、代码块或任何可执行代码。你只负责需求确认哦~

你的任务：
1) 当用户描述想要的 3D 模型后，主动询问关键细节（像聊天一样自然）
2) 通过多轮对话逐步明确需求，语气要亲切可爱~
3) 当信息足够时输出【需求确认完成】并给出【最终需求】
4) 只有当用户明确说"生成代码/开始生成/出代码"时，才输出【请老师傅生成代码】

需要确认的关键信息：
✓ 主体几何形状（立方体、圆柱、球体、锥体或组合）
✓ 关键尺寸参数（长、宽、高或半径等，单位毫米 mm）
✓ 需要参数化的变量（哪些尺寸是可调的）
✓ 特殊特征（孔洞、倒角、圆角、凹陷等）
✓ 组合方式（并集、差集、交集）

回复格式范例：
【问题】
- 嗨~ 想做什么样的模型呀？立方体还是其他形状呢？
- 尺寸大概多少毫米呀？📏

【反馈】
好哒！我理解的是一个 200×100×50mm 的参数化立方体，是不是这样呀？

信息完整时请输出：
【需求确认完成】
【最终需求】
- 用 4~8 条要点总结可用于老师傅生成代码的完整需求

如果用户还没说"生成代码"，请额外输出：
【状态】等待用户下达"生成代码"指令

只有当用户明确要求生成代码时，再额外输出：
【请老师傅生成代码】

语气：可爱、亲切、活泼，像一位耐心的产品经理小姐姐~ 可以适度使用 emoji 但不要太多哦！
```

说明：原“askIntern（代码问题咨询）”和“askMasterCraftsman（疑难升级）已删除为独立智能体”，相关能力已分别并入“实习生”和“老师傅”的统一职责中。

### 4.4 产品经理：结构化方案提示词（generateProductBrief）

```text
你是一个 3D 参数化建模需求分析专家。基于用户的建模需求，提取关键参数信息，为代码生成提供结构化输入。

输出格式要求（仅包含以下信息，不要步骤）：
1) 模型目标 - 用一句话描述要创建的模型
2) 关键结构与尺寸 - 主要组件和具体尺寸(mm)
3) 参数化变量定义 - 表格形式 (变量名/含义/默认值/可选范围)
4) 约束与注意事项 - 可编译性约束、机械约束等

禁止输出：
- 禁止输出具体建模步骤或操作流程
- 禁止输出 OpenSCAD 代码
- 禁止输出几何构造细节

输出要求：
- 只输出参数化变量定义和约束信息
- 使用简洁的中文
- 信息足够老师傅直接编写代码
```

---

## 5. 分流规则（确认对话接口）

确认接口：POST /api/parametric-chat/confirm-requirement

服务端分流顺序：

1. 先进入 askProductManager。
2. 若命中代码问题关键词（代码/编译/报错/异常/fix/error 等），进入技术分流：
   - 如果满足升级条件，转老师傅（responderRole=master）
   - 否则转实习生（responderRole=intern）
3. 未命中代码问题，则由产品经理继续需求确认（responderRole=product_manager）。

升级条件（shouldEscalateToMaster）：
- 用户明确要求老师傅（如“请老师傅”“转老师傅”等）
- 或识别到“反复失败”并且历史中有多次失败信号

---

## 6. 完整调用链路

这里给出项目的三条主链路。

### 6.1 生成链路（老师傅出码主链）

1. 前端调用 POST /api/parametric-chat，提交 prompt。
2. 后端 route 调用 generateOpenSCAD。
3. 若 PM_ENABLED=true，先调用 generateProductBrief 获取结构化方案。
4. 老师傅提示词 + OPENSCAD_MODEL 生成 OpenSCAD 代码。
5. 代码经 processOpenSCADCode 清洗与参数提取，返回：
   - openscadCode
   - compilableCode
   - parameters
   - sessionId

### 6.2 确认链路（产品经理 / 实习生 / 老师傅分流）

1. 前端调用 POST /api/parametric-chat/confirm-requirement。
2. 后端调用 askProductManager。
3. askProductManager 内先做 isCodeIssueIntent 判断：
   - 否：产品经理继续需求确认
   - 是：进入技术侧
4. 技术侧再做 shouldEscalateToMaster：
   - true：由老师傅直接处理并输出最终代码
   - false：由实习生直接处理并输出最终代码
5. 返回结构包含 responderRole，前端据此渲染角色身份。

### 6.3 修复链路（实习生统一修复）

1. 前端调用 POST /api/parametric-chat/fix，提交 openscadCode 和 compileError。
2. 后端调用 fixOpenSCADCode。
3. 实习生提示词 + INTERN_MODEL 生成修复后代码。
4. 返回修复结果，前端触发重新编译并更新预览。

---

## 7. API 一览

### 7.1 POST /api/parametric-chat
- 用途：自然语言生成 OpenSCAD
- 入参：prompt, sessionId(可选)
- 出参：openscadCode, compilableCode, parameters, sessionId, productBrief(可选)

### 7.2 POST /api/parametric-chat/confirm-requirement
- 用途：需求确认对话与角色分流
- 入参：userInput, conversationHistory(可选), sessionId(可选)
- 出参：pmResponse, isNeedMoreInfo, isClear, shouldGenerate, confirmedRequirement(可选), responderRole

### 7.3 POST /api/parametric-chat/fix
- 用途：修复 OpenSCAD 代码
- 入参：openscadCode, compileError(可选), sessionId(可选)
- 出参：openscadCode, compilableCode, parameters, sessionId

### 7.4 POST /api/parametric-chat/compile
- 用途：编译 OpenSCAD 为 STL 二进制

### 7.5 POST /api/parametric-chat/export/stl
- 用途：导出 STL 文件

### 7.6 POST /api/parametric-chat/export/csg
- 用途：导出 CSG 文本

---

## 8. 技术架构

| 层级 | 技术 | 说明 |
|---|---|---|
| 前端 | React 18 + TypeScript + Vite | 交互界面、状态与可视化 |
| 3D 渲染 | Three.js | STL 预览 |
| 后端 | Node.js + Express + TypeScript | 路由与智能体编排 |
| 实时通信 | ws(WebSocket) | AI 进度事件推送 |
| AI 调用 | OpenAI SDK | 统一调用不同模型 |
| 编译引擎 | OpenSCAD | 代码编译与导出 |

---

## 9. 目录结构

```text
ScadGenerator/
├── .env.example
├── package.json
├── backend/
│   ├── server/index.ts
│   ├── routes/parametric-chat.ts
│   └── services/
│       ├── ai-service.ts
│       ├── openscad-compiler.ts
│       ├── code-processor.ts
│       └── websocket.ts
└── app/
    └── src/
```

---

## 10. 快速开始

### 10.1 环境准备

1. Node.js 18+
2. npm 可用
3. 机器可执行 openscad（或通过环境变量指定路径）

### 10.2 安装与启动

```bash
git clone <repo>
cd ScadGenerator
npm run install:all
cp .env.example .env
npm run dev
```

### 10.3 生产构建

```bash
npm run build
npm run start
```

---

## 11. 环境变量说明

当前 .env.example 关键变量如下：

```env
QN_API_KEY=your_api_key_here
//七牛apikey可以通过这个链接注册https://s.qiniu.com/v6zuUj，注册即送1000万token
QN_BASE_URL=https://api.qnaigc.com/v1
QINIU_DEEPSEEK_API_KEY=your_api_key_here

# 产品经理智能体（默认沟通需求）
PM_MODEL=moonshotai/kimi-k2.5
PM_API_PROTOCOL=openai-compatible

# 实习生智能体（代码问题优先路由）
INTERN_MODEL=deepseek/deepseek-v3.2-251201

# 兼容旧配置：若未设置 INTERN_MODEL，可继续使用该变量给实习生模型兜底
QINIU_DEEPSEEK_MODEL=deepseek-r1
OPENSCAD_FIX_TIMEOUT_MS=240000
KIMI_FIX_MODEL=moonshotai/kimi-k2.5
```

补充说明：
- OPENSCAD_MODEL、OPENSCAD_API_PROTOCOL、OPENSCAD_API_PATH、PM_* 等变量在代码中也支持，可按部署策略补充到 .env。
- 若你希望老师傅与实习生严格使用不同模型，建议显式同时设置 OPENSCAD_MODEL 和 INTERN_MODEL。

---

## 12. 常见问题

### 12.1 为什么请求会被分流到实习生或老师傅

因为确认接口会先识别是否为代码问题，再决定是否升级老师傅。请检查：
- 输入是否包含代码问题关键词
- conversationHistory 中是否出现多次失败信号
- 是否显式要求老师傅介入

### 12.2 为什么模型结果和预期不一致

先检查变量覆盖顺序：
- OPENSCAD_MODEL 可能被 QINIU_DEEPSEEK_MODEL 覆盖
- INTERN_MODEL 未设置时会回退到 QINIU_DEEPSEEK_MODEL

### 12.3 修复接口超时

可通过 OPENSCAD_FIX_TIMEOUT_MS 调整超时阈值，默认 240000 ms。

---

## 13. 推荐维护策略

1. 每次调整提示词后，至少做三类回归：
   - 普通需求确认
   - 代码问题转实习生
   - 明确升级到老师傅
2. 对模型变量做显式配置，避免兜底链路导致“误用模型”。
3. 将 responderRole 打点到日志，便于观察分流质量。

---

## 14. 许可证

MIT
