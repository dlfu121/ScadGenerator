# 参数化 OpenSCAD 生成工具

一个基于TypeScript的全栈参数化3D模型生成工具，使用AI生成OpenSCAD代码并提供实时预览功能。

## 系统架构

### 6模块架构

1. **Prompt输入模块** - 用户界面输入模块
2. **AI生成模块** - 调用DeepSeek API生成OpenSCAD代码
3. **代码后处理模块** - 提取并清洗OpenSCAD代码
4. **OpenSCAD编译模块** - 将代码编译为STL（模拟实现）
5. **参数化预览渲染模块** - Three.js实时预览
6. **状态与会话模块** - WebSocket状态管理和会话持久化

## 环境变量配置

创建 `.env` 文件：

```env
QN_API_KEY=your_api_key_here
QN_BASE_URL=https://api.qnaigc.com/v1
OPENSCAD_MODEL=deepseek-r1
PORT=5000
```

## 启动步骤

### 1. 安装依赖

```bash
# 安装根目录依赖
npm install

# 安装前端依赖
cd app
npm install
cd ..
```

### 2. 启动开发服务器

```bash
# 同时启动前后端服务器
npm run dev

# 或分别启动
npm run dev:server  # 后端服务器 (端口5000)
npm run dev:client  # 前端开发服务器 (端口3000)
```

### 3. 访问应用

- 前端应用: http://localhost:3000
- 后端API: http://localhost:5000
- WebSocket: ws://localhost:5000

## 模块说明

### 模块1: Prompt输入模块 (`app/src/modules/prompt-input/`)
- 提供用户友好的输入界面
- 支持多行文本输入
- 包含示例提示和清空功能
- 实时验证输入内容

**验证方法**: 在界面中输入"创建一个参数化的立方体，边长30mm"，点击生成按钮。

### 模块2: AI生成模块 (`backend/services/ai-service.ts`)
- 调用DeepSeek API生成OpenSCAD代码
- 支持参数化代码生成
- 自动提取代码中的参数
- 错误处理和重试机制

**验证方法**: 发送POST请求到 `/api/parametric-chat` 端点：
```bash
curl -X POST http://localhost:5000/api/parametric-chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "创建一个参数化的立方体，边长30mm"}'
```

### 模块3: 代码后处理模块 (`backend/services/code-processor.ts`)
- 清理AI生成的代码
- 提取和验证参数
- 语法检查和错误报告
- 参数类型推断

**验证方法**: 测试代码处理功能：
```javascript
import { processOpenSCADCode } from './backend/services/code-processor';
const result = processOpenSCADCode('length = 30; cube([length, length, length]);');
```

### 模块4: OpenSCAD编译模块 (`backend/services/openscad-compiler.ts`)
- 模拟OpenSCAD编译过程
- 生成STL数据（Base64编码）
- 代码验证和错误检查
- 编译性能监控

**验证方法**: 测试编译功能：
```javascript
import { openscadCompiler } from './backend/services/openscad-compiler';
const result = await openscadCompiler.compileToSTL('cube([30,30,30]);');
```

### 模块5: 参数化预览渲染模块 (`app/src/modules/param-preview/`)
- Three.js 3D场景渲染
- 实时参数调整
- 鼠标交互控制
- STL模型加载和显示

**验证方法**: 在预览面板中调整参数值，观察3D模型实时更新。

### 模块6: 状态与会话模块 (`app/src/modules/state-session/`)
- WebSocket连接管理
- 会话状态持久化
- 历史记录管理
- 参数同步

**验证方法**: 检查浏览器控制台WebSocket连接状态，查看本地存储的会话数据。

## API端点

### POST /api/parametric-chat
生成OpenSCAD代码

**请求体**:
```json
{
  "prompt": "创建一个参数化的立方体，边长30mm",
  "sessionId": "optional-session-id"
}
```

**响应体**:
```json
{
  "openscadCode": "length = 30;\ncube([length, length, length]);",
  "parameters": {
    "length": 30
  },
  "sessionId": "generated-session-id"
}
```

## WebSocket事件

### 连接事件
- `connected` - 连接建立
- `parameters_updated` - 参数更新
- `ping/pong` - 心跳检测

## 已知限制

### MVP版本限制

1. **OpenSCAD编译**: 当前为模拟实现，未集成真实的openscad-wasm
2. **STL生成**: 生成简化的示例STL数据
3. **导出功能**: 未实现文件导出功能
4. **Creative模式**: 未实现创意生成模式
5. **错误处理**: 基础错误处理，需要增强
6. **性能**: 未进行性能优化
7. **安全性**: 缺少输入验证和安全防护
8. **测试**: 无自动化测试

### 技术限制

1. **依赖**: 需要有效的DeepSeek API密钥
2. **浏览器**: 需要支持WebGL的现代浏览器
3. **内存**: 大型模型可能消耗较多内存
4. **网络**: 依赖稳定的网络连接

## 开发说明

### 项目结构
```
ScadGenerator/
├── backend/                 # 后端服务
│   ├── server/             # Express服务器
│   ├── services/           # 业务逻辑服务
│   └── routes/             # API路由
├── app/                    # 前端应用
│   ├── src/
│   │   └── modules/        # 功能模块
│   └── public/             # 静态资源
├── package.json            # 根依赖配置
└── README.md              # 项目文档
```

### 技术栈
- **后端**: Node.js + Express + TypeScript
- **前端**: React + TypeScript + Vite
- **3D渲染**: Three.js
- **AI服务**: OpenAI SDK (DeepSeek)
- **实时通信**: WebSocket
- **状态管理**: React Context + useReducer

### 开发命令
```bash
npm run dev          # 开发模式
npm run build        # 构建生产版本
npm run start        # 启动生产服务器
```

## 贡献指南

1. Fork项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建Pull Request

## 许可证

MIT License
