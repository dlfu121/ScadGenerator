# ScadGenerator — 参数化 OpenSCAD AI 生成工具

通过自然语言描述，AI 自动生成参数化 OpenSCAD 代码，配合 Three.js 实时 3D 预览，让你在浏览器中直接设计和调整 3D 模型。

## 功能特性

- **自然语言建模** — 输入中文或英文描述，AI 生成可运行的 OpenSCAD 参数化代码
- **实时 3D 预览** — Three.js 渲染生成的 STL 模型，支持鼠标旋转/缩放
- **参数面板** — 自动解析代码中的变量，提供可调节的滑块/输入框
- **会话持久化** — WebSocket 实时同步状态，刷新后恢复历史对话
- **后端编译** — Express 服务器接入 OpenSCAD 编译链路并返回 STL 数据

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite 5 |
| 3D 渲染 | Three.js |
| 后端 | Node.js + Express + TypeScript |
| 实时通信 | WebSocket (ws) |
| AI 服务 | OpenAI SDK（兼容 DeepSeek / 七牛 AI 网关） |
| Python 客户端 | openai-agents SDK（可选） |

## 环境要求

- **Node.js** >= 18
- **npm** >= 9
- **Python** >= 3.10（仅使用 Python AI 客户端时需要）
- 兼容 OpenAI 接口的 **API Key**（支持七牛 DeepSeek 网关或其他服务）
- 支持 WebGL 的现代浏览器（Chrome / Edge / Firefox 最新版）

## 快速开始

### 1. 克隆项目

```bash
git clone <仓库地址>
cd ScadGenerator
```

### 2. 配置环境变量

复制示例文件并填写你的 API Key：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 七牛 DeepSeek 网关（或其他兼容 OpenAI 的服务）
QINIU_DEEPSEEK_API_KEY=your_api_key_here
QINIU_DEEPSEEK_BASE_URL=https://api.qnaigc.com/v1
QINIU_DEEPSEEK_MODEL=deepseek-r1

# 后端监听端口（默认 5000）
PORT=5000
```

> **注意**：`.env` 文件已被 `.gitignore` 排除，不会提交到版本库。

### 3. 安装依赖

```bash
# 一键安装根目录 + 前端依赖
npm run install:all
```

等价手动执行：

```bash
npm install
cd app && npm install && cd ..
```

### 4. 启动开发服务器

```bash
npm run dev
```

该命令同时启动：

| 服务 | 地址 |
|------|------|
| 前端 (Vite) | http://localhost:5173 |
| 后端 (Express) | http://localhost:5000 |
| WebSocket | ws://localhost:5000 |

> 前端已配置反向代理，`/api` 请求自动转发到后端，无需手动处理跨域。

### 5. 开始使用

打开 http://localhost:5173，在输入框中描述你想要的 3D 模型，例如：

```
创建一个参数化的齿轮，模数2，齿数20，厚度10mm
```

点击生成，AI 将返回 OpenSCAD 代码并在右侧实时渲染 3D 预览。

## 项目结构

```
ScadGenerator/
├── .env.example              # 环境变量模板
├── package.json              # 根脚本（dev / build / install:all）
├── requirements.txt          # Python 依赖（可选）
├── backend/                  # 后端服务
│   ├── server/index.ts       # Express 入口，挂载路由和 WebSocket
│   ├── routes/               # API 路由定义
│   └── services/
│       ├── ai-service.ts     # 调用 AI API，生成 OpenSCAD 代码
│       ├── code-processor.ts # 提取、清洗 AI 返回的代码
│       ├── openscad-compiler.ts  # 编译 OpenSCAD → STL
│       └── websocket.ts      # WebSocket 服务，含指数退避重连
└── app/                      # 前端应用
    ├── vite.config.ts        # Vite 配置（端口 5173，代理 /api）
    └── src/
        ├── App.tsx           # 全局状态编排
        └── modules/
            ├── prompt-input/     # 用户输入面板
            ├── ai-generate-client/
            │   └── ai.py         # Python AI 客户端（可选）
            ├── openscad-compile/ # 前端编译状态管理
            ├── param-preview/    # Three.js 3D 渲染与参数面板
            └── state-session/    # WebSocket 会话状态
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 同时启动前后端开发服务器 |
| `npm run dev:server` | 仅启动后端（端口 5000，tsx watch 热重载） |
| `npm run dev:client` | 仅启动前端（端口 5173，Vite HMR） |
| `npm run build` | 构建前后端生产版本 |
| `npm run start` | 启动生产服务器（需先 build） |
| `npm run install:all` | 一键安装所有依赖 |

## API 参考

### `POST /api/parametric-chat`

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

### WebSocket 事件

连接地址：`ws://localhost:5000`

| 事件 | 方向 | 说明 |
|------|------|------|
| `connected` | 服务器 → 客户端 | 连接建立确认 |
| `parameters_updated` | 双向 | 参数变更同步 |
| `ping` / `pong` | 双向 | 心跳保活 |

## Python AI 客户端（可选）

如需使用基于 `openai-agents` SDK 的独立 Python 客户端：

```bash
# 建议创建虚拟环境
python -m venv .venv
.venv\Scripts\activate      # Windows
# source .venv/bin/activate  # macOS/Linux

pip install -r requirements.txt
```

所需环境变量（同 `.env`）：

```env
QN_API_KEY=your_api_key_here
QN_BASE_URL=https://api.qnaigc.com/v1
OPENSCAD_MODEL=deepseek-r1
```

运行：

```bash
python app/src/modules/ai-generate-client/ai.py
```

## 常见问题

**Q: 启动后前端提示无法连接后端？**  
A: 确认 `.env` 中 `PORT=5000` 与 `vite.config.ts` 的代理目标一致；检查后端是否正常启动（终端无报错）。

**Q: AI 接口返回 401 / 403？**  
A: 检查 `.env` 中的 `QINIU_DEEPSEEK_API_KEY` 是否正确填写且未过期。

**Q: 3D 预览空白？**  
A: 确认浏览器支持 WebGL（访问 https://get.webgl.org 验证）；检查控制台是否有编译错误信息。

**Q: 端口被占用？**  
A: 修改 `.env` 的 `PORT` 值并同步更新 `app/vite.config.ts` 中的 proxy target。

## 项目进展与不足

### 已完成

| 模块 | 状态 | 说明 |
|------|------|------|
| AI 代码生成 | ✅ 完成 | 接入七牛 DeepSeek 网关，System Prompt 强约束输出格式，60s 超时保护 |
| 代码后处理 | ✅ 完成 | 自动剥离 Markdown 围栏、提取纯 OpenSCAD 代码 |
| 后端编译链路 | ✅ 完成 | 调用本地 `openscad` 可执行文件编译 → STL，支持临时文件隔离 |
| 前端 3D 渲染 | ✅ 完成 | Three.js 加载 STL，`STLLoader` + 法线计算 + 旧 Mesh 自动释放 |
| 参数面板 | ✅ 完成 | 正则解析顶层变量，支持数值滑块实时回写代码并触发重编译 |
| 编译进度反馈 | ✅ 完成 | 前端显示 queued / running / success / error 四态进度条 |
| AbortController | ✅ 完成 | 连续调参时取消过期请求，只保留最新一次编译结果 |
| WebSocket 会话 | ✅ 完成 | 指数退避重连，刷新页面不丢失历史对话 |
| 错误恢复 | ✅ 完成 | 编译失败显示结构化错误，提供重试与"一键 AI 修复"入口 |
| Python 客户端 | ✅ 完成 | 基于 openai-agents SDK 的独立脚本，可单独测试 AI 链路 |

### 待改进

**编译依赖本地安装**  
后端编译调用系统路径下的 `openscad` 可执行文件（通过 `OPENSCAD_BIN` 环境变量指定）。部署环境若未安装 OpenSCAD，编译步骤会直接报错。未来可考虑集成 [openscad-wasm](https://github.com/openscad/openscad-wasm) 实现零依赖浏览器端编译。

**3D 渲染交互能力有限**  
当前使用手写鼠标旋转逻辑，缺少 OrbitControls（阻尼、边界限制、触控支持）、HDR 环境光和相机自适应定位。复杂模型旋转时体验欠佳。

**无用户认证**  
所有请求共享同一后端实例，API Key 暴露在服务器环境变量中，不适合直接多人共享部署。

**AI 修复功能未深度接入**  
前端"一键修复"按钮已预留，但后端 AI 修复逻辑尚未完整实现（仅传递报错信息重新生成，缺少针对性的错误定位提示）。

**无 STL 导出**  
编译产物 STL 数据已在内存中，但未提供下载按钮，用户无法保存模型文件。

**无自动化测试**  
后端 `tests/` 目录仅有结构，核心流程（AI 生成 → 编译 → 渲染）尚无集成测试覆盖。

## 许可证

MIT License
