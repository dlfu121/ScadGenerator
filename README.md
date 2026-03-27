# ScadGenerator — 多智能体协作的 OpenSCAD 生成工具

基于自然语言描述，通过多 AI 智能体协作自动生成参数化 OpenSCAD 代码。项目采用现代化的前后端架构，提供实时 3D 预览和代码编辑功能，让你在浏览器中高效设计和调整 3D 模型。

## 🌟 核心特性

- **🤖 多智能体协作** - Claude-4.5-Sonnet、DeepSeek-R1、Kimi-K2.5 各司其职
- **💬 自然语言建模** - 输入中文或英文描述，AI 生成可运行的 OpenSCAD 参数化代码
- **🎮 实时 3D 预览** - Three.js 渲染 STL 模型，支持鼠标旋转/缩放
- **⚙️ 智能参数面板** - 自动解析代码变量，提供可调节滑块/输入框
- **🔄 会话持久化** - WebSocket 实时同步状态，刷新后恢复历史对话
- **⚡ 即时代码显示** - 生成后直接显示代码编辑器，支持语法高亮
- **🛠️ 代码修复** - AI 自动修复编译错误，保证代码可执行

## AI 智能体架构

项目采用多模型协作架构，不同 AI 智能体各司其职：

### 🎨 **Claude-4.5-Sonnet** - 代码生成专家
- **职责**: 根据需求生成高质量的 OpenSCAD 参数化代码
- **特点**: 严格遵守输出格式约束，确保代码可编译性
- **协议**: Anthropic Messages API

### 🔧 **DeepSeek-R1** - 代码修复专家  
- **职责**: 修复编译错误和语法问题，保证代码可执行
- **特点**: 最小修改原则，保留原有建模意图
- **协议**: OpenAI Compatible API

### 💼 **Kimi-K2.5** - 产品经理智能体
- **职责**: 
  - 通过多轮对话明确用户需求
  - 生成详细的建模方案和技术规格
- **特点**: 专业术语理解，结构化需求确认
- **协议**: OpenAI Compatible API

### 🔄 **工作流程**
```
用户需求 → Kimi需求确认 → Kimi方案生成 → Claude代码生成 → [编译错误?] → DeepSeek修复
```

## AI 智能体提示词

### 🎨 Claude-4.5-Sonnet - 代码生成提示词

```
你是一个 OpenSCAD 代码生成器。只输出一段可执行的 OpenSCAD 代码，禁止输出任何额外文本。

强制规则（必须遵守）：
1) 禁止解释、分析、思考过程、提示词复述。
2) 禁止 markdown 代码围栏（例如 ```openscad）。
3) 禁止返回重复代码块，只允许一段最终代码。
4) 生成有效且可编译的 OpenSCAD。
5) 尽量参数化（使用顶层参数定义）。

输出要求：
- 只返回纯 OpenSCAD 源码，不要前后缀。
```

### 🔧 DeepSeek-R1 - 代码修复提示词

```
你是一个 OpenSCAD 代码修复器。你会收到一段存在问题的 OpenSCAD 代码和编译错误信息。

强制规则（必须遵守）：
1) 仅返回修复后的完整 OpenSCAD 代码。
2) 禁止任何解释、注释说明、思考过程、markdown 围栏。
3) 保留原有建模意图与参数命名，优先做最小修改使其可编译。
4) 代码必须可执行且结构完整。
```

### 💼 Kimi-K2.5 - 产品经理提示词

#### 需求确认对话提示词
```
你是一个专业的 OpenSCAD 3D 参数化建模产品经理。你的职责是通过与用户交互来明确 OpenSCAD 3D 建模需求。

!! 重要 !!：这是关于用代码生成 3D CAD 模型的，不是网页设计或其他类型的项目。

你的任务：
1) 用户描述他们想要的 3D 模型后，主动询问关键细节
2) 通过多轮对话逐步明确需求
3) 当信息足够时输出【需求确认完成】

需要确认的关键信息：
✓ 主体几何形状（立方体、圆柱、球体、锥体或组合）
✓ 关键尺寸参数（长、宽、高或半径等，单位毫米 mm）
✓ 需要参数化的变量（哪些尺寸是可调的）
✓ 特殊特征（孔洞、倒角、圆角、凹陷等）
✓ 组合方式（并集、差集、交集）

回复格式范例：
【问题】
- 请问您想要的是什么基本形状？立方体还是其他形状？
- 您需要设定多少毫米的长宽高尺寸？

【反馈】
根据您的描述，我理解的是一个 200×100×50mm 的参数化立方体。

当信息完整时最后输出：【需求确认完成】

语气：专业、清晰、高效
```

#### 建模方案生成提示词
```
你是一个 3D 参数化建模产品经理。基于明确的建模需求，生成一份完整的建模方案。

输出格式要求：
1) 模型目标 - 用一句话描述
2) 关键结构与尺寸 - 主要组件和参数
3) 参数化变量建议 - 表格形式 (名称/含义/默认值/范围)
4) 建模步骤 - 5-8 步操作流程
5) 约束与注意事项 - 可编译性和工艺约束

输出要求：
- 只输出建模方案，不输出 OpenSCAD 代码
- 使用简洁的中文
- 方案信息足够让工程师直接开始编码
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite 5 |
| 3D 渲染 | Three.js |
| 后端 | Node.js + Express + TypeScript |
| 实时通信 | WebSocket (ws) |
| AI 服务 | OpenAI SDK（兼容 DeepSeek / 七牛 AI 网关） |
| Python 客户端 | openai-agents SDK（可选） |

## 🚢 部署流程（从拉代码到上线）

下面给出一个可直接执行的标准流程（单机部署）：

### Step 1) 准备环境

1. 安装 Node.js（建议 LTS，版本 >=18）
2. 确认 npm 可用：`npm -v`
3. （可选）安装 Python 3.10+，仅用于 Python 客户端
4. 机器上可执行 `openscad`（或在 `.env` 配置 `OPENSCAD_BIN`）

### Step 2) 拉取代码并配置环境变量

```bash
git clone <仓库地址>
cd ScadGenerator
cp .env.example .env
```

编辑 `.env`：

```env
QN_API_KEY=your_api_key_here
QN_BASE_URL=https://api.qnaigc.com/v1
# 可选：
# PORT=5001
# OPENSCAD_BIN=openscad
```

### Step 3) 安装依赖并构建

```bash
npm run install:all
npm run build
```

构建产物说明：
- 前端：`app/dist`
- 后端：`dist/server`

### Step 4) 启动生产服务

```bash
npm run start
```

默认监听：
- HTTP API：`http://localhost:5001`
- WebSocket：`ws://localhost:5001/ws`

### Step 5) 验证部署

1. 打开前端地址（开发环境通常是 `http://localhost:5173`；生产可用 Nginx 托管 `app/dist`）
2. 发起一次生成请求，确认：
   - 对话可正常返回
   - 右侧代码区出现 OpenSCAD 代码
   - 预览区能看到模型
3. 若出现报错，先检查后端日志与 `.env` 配置

## 🏗️ 项目架构

### 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 前端 | React 18 + TypeScript + Vite 5 | 用户界面和交互 |
| 3D 渲染 | Three.js | STL 模型渲染和预览 |
| 后端 | Node.js + Express + TypeScript | API 服务和业务逻辑 |
| 实时通信 | WebSocket (ws) | 前后端实时同步 |
| AI 服务 | OpenAI SDK | 统一接口调用多个 AI 模型 |
| 编译引擎 | OpenSCAD | 代码编译为 STL |

### 目录结构

```
ScadGenerator/
├── .env.example              # 环境变量模板
├── package.json              # 根脚本（dev / build / install:all）
├── backend/                  # 后端服务
│   ├── server/index.ts       # Express 入口
│   ├── routes/               # API 路由
│   └── services/
│       ├── ai-service.ts     # AI 智能体协调逻辑
│       ├── code-processor.ts # 代码解析和参数提取
│       ├── openscad-compiler.ts  # OpenSCAD 编译
│       └── websocket.ts      # WebSocket 服务
└── app/                      # 前端应用
    ├── src/App.tsx           # 主应用，智能体协作展示
    └── src/modules/
        ├── prompt-input/       # 用户输入界面
        ├── param-preview/     # 3D 预览和参数控制
        └── state-session/     # 会话状态管理
```

## 🛠️ 开发指南

### 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 同时启动前后端开发服务器 |
| `npm run dev:server` | 仅启动后端（端口 5001，tsx watch 热重载） |
| `npm run dev:client` | 仅启动前端（端口 5173，Vite HMR） |
| `npm run build` | 构建前后端生产版本 |
| `npm run start` | 启动生产服务器（需先 build） |
| `npm run install:all` | 一键安装所有依赖 |

### 🔧 核心功能

#### 1. 多智能体协作流程
```
用户输入需求 → Kimi-K2.5 需求确认 → Kimi-K2.5 方案生成 → Claude-4.5-Sonnet 代码生成 → [编译错误?] → DeepSeek-R1 修复
```

#### 2. 界面功能
- **左侧对话区**: 输入自然语言需求，查看 AI 处理进度
- **右侧工作区**: 
  - **SCAD代码** (默认): 语法高亮的代码编辑器
  - **预览**: Three.js 3D 模型渲染
  - **参数控制**: 智能参数调节面板
  - **CSG树**: 模型结构分析

#### 3. 实时特性
- WebSocket 实时同步生成进度
- 参数调节立即重新编译
- 代码编辑自动更新预览
- 语法检查和错误提示

### 📝 API 参考

#### `POST /api/parametric-chat`

生成参数化 OpenSCAD 代码。

**请求体**：
```json
{
  "prompt": "创建一个参数化的立方体，边长30mm",
  "sessionId": "可选，用于恢复历史会话"
}
```

**成功响应**：
```json
{
  "openscadCode": "length = 30;\ncube([length, length, length]);",
  "parameters": { "length": 30 },
  "sessionId": "uuid-string"
}
```

### 🔌 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `QN_API_KEY` | 统一 API Key (必需) | - |
| `QN_BASE_URL` | API 服务地址 | `https://api.qnaigc.com/v1` |
| `PORT` | 后端端口 | `5001` |
| `OPENSCAD_BIN` | OpenSCAD 可执行文件路径 | `openscad` |

## 🤖 Python AI 客户端（可选）

如需使用基于 `openai-agents` SDK 的独立 Python 客户端：

```bash
# 建议创建虚拟环境
python -m venv .venv
.venv\Scripts\activate      # Windows
# source .venv/bin/activate  # macOS/Linux

pip install -r requirements.txt
```

运行：
```bash
python app/src/modules/ai-generate-client/ai.py "创建一个参数化的立方体"
```

## ❓ 常见问题

**Q: 启动后前端提示无法连接后端？**  
A: 确认 `.env` 中 `PORT=5001` 与前端代理目标一致；检查后端是否正常启动。

**Q: AI 接口返回 401 / 403？**  
A: 检查 `.env` 中的 `QN_API_KEY` 是否正确填写且未过期。

**Q: 3D 预览空白？**  
A: 确认浏览器支持 WebGL；检查控制台是否有编译错误信息。

**Q: 端口被占用？**  
A: 修改 `.env` 的 `PORT` 值并同步更新前端代理配置。

**Q: AI 助理长时间没回复怎么办？**  
A: 前端已内置“等待回复提醒”，请求发出后会显示“正在等待助理回复（最长约 2 分钟）”。如果超过时限未返回，界面会给出“响应超时”的原因分析（网络波动、后端调用排队、需求复杂度较高）和重试建议（等待 30-60 秒后再试，必要时拆分需求）。

**Q: 出现 `429 rate limit reached for RPM` 是什么原因？**  
A: 这是模型服务的频率限制（每分钟请求数，RPM）触发。前端会自动识别 429/`rate limit`/`RPM` 报错，并展示限流原因分析与等待建议。通常等待 30-120 秒后重试即可；建议减少短时间连续点击“生成/修复”，尽量一次提交完整需求。

## 💬 AI 助理体验更新（前端）

以下增强已集成到聊天与生成流程：

- **等待回复提醒**：发送请求后，聊天区会立即插入“正在等待助理回复”的提示，避免误以为无响应。
- **超时原因分析**：当出现 `超时/timeout/timed out` 时，前端会展示可读性更高的分析与重试建议，而不只是一句通用错误。
- **429 限流原因分析**：当出现 `429/rate limit/RPM` 时，前端会展示限流原因、等待时长建议（30-120 秒）和降频建议。
- **统一错误体验**：需求确认对话失败与代码生成失败两条路径都已接入上述提示逻辑。

## 📋 许可证

MIT License

---

## 🎉 总结

ScadGenerator 是一个展示多智能体协作的先进项目：

- ✅ **多 AI 协作**: Claude、DeepSeek、Kimi 各司其职
- ✅ **现代化架构**: React + TypeScript + Node.js
- ✅ **实时交互**: WebSocket + Three.js
- ✅ **开箱即用**: 极简配置，快速启动
- ✅ **智能修复**: AI 自动修复编译错误
- ✅ **参数化设计**: 智能参数提取和调节

🚀 **立即体验**: `git clone && npm run install:all && npm run dev`
