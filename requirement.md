# ScadGenerator 本地运行配置说明

本文档用于帮助同学在新电脑上完成 ScadGenerator 的本地运行配置。

## 1. 必备软件

1. Node.js 18+（建议安装 LTS）
2. npm 9+
3. OpenSCAD（必须安装，用于把 OpenSCAD 代码编译成 STL）
4. Git（用于克隆项目）

可选：

1. Python 3.10+（仅在你要运行 Python AI 客户端时需要）

## 2. 获取项目代码

在终端执行：

```bash
git clone <仓库地址>
cd ScadGenerator
```

## 3. 配置环境变量

1. 复制环境变量模板：

```bash
cp .env.example .env
```

Windows PowerShell 也可以用：

```powershell
Copy-Item .env.example .env
```

2. 编辑 `.env`，至少填写下面这些：

```env
# 推荐使用这组变量
QINIU_DEEPSEEK_API_KEY=你的APIKey
QINIU_DEEPSEEK_BASE_URL=https://api.qnaigc.com/v1
QINIU_DEEPSEEK_MODEL=deepseek-r1

# 兼容旧变量名（可选）
QN_API_KEY=你的APIKey
QN_BASE_URL=https://api.qnaigc.com/v1
OPENSCAD_MODEL=deepseek-r1

# 后端端口（可选，默认5000）
PORT=5000

# 如果系统找不到 openscad 命令，手动指定 OpenSCAD 可执行文件路径
# Windows 示例：
# OPENSCAD_BIN=C:\Program Files\OpenSCAD\openscad.exe
```

说明：

1. API Key 至少要配置 `QINIU_DEEPSEEK_API_KEY` 或 `QN_API_KEY` 其中一个。
2. 如果命令行里直接输入 `openscad` 能运行，一般不需要配置 `OPENSCAD_BIN`。

## 4. 安装依赖

项目根目录执行：

```bash
npm run install:all
```

该命令会安装：

1. 根目录后端依赖
2. `app/` 前端依赖

## 5. 启动项目

在项目根目录执行：

```bash
npm run dev
```

启动后访问：

1. 前端页面：http://localhost:5173
2. 后端服务：http://localhost:5000
3. WebSocket：ws://localhost:5000

## 6. 快速自检

1. 打开前端页面后输入一句模型描述并点击生成。
2. 若返回 OpenSCAD 代码且右侧出现 3D 预览，说明配置成功。

## 7. 常见问题

1. 报错“未配置七牛 DeepSeek API Key”
   - 检查 `.env` 是否已创建且填写了 `QINIU_DEEPSEEK_API_KEY` 或 `QN_API_KEY`。

2. 报错“OpenSCAD 启动失败”或“'openscad' 不是内部或外部命令”
   - 先确认本机已安装 OpenSCAD。
   - 在 `.env` 里配置 `OPENSCAD_BIN` 为 OpenSCAD 的绝对路径。

3
   - 检查 5000. 前端能开但生成失败
   - 看启动终端是否有后端报错。 端口是否被占用；如占用，改 `.env` 中 `PORT`，并同步调整 `app/vite.config.ts` 代理目标。

## 8. 可选：Python AI 客户端

仅在需要单独运行 Python 客户端时执行：

```bash
python -m venv .venv
```

Windows 激活：

```powershell
.\.venv\Scripts\Activate.ps1
```

安装依赖：

```bash
pip install -r requirements.txt
```

运行：

```bash
python app/src/modules/ai-generate-client/ai.py
```