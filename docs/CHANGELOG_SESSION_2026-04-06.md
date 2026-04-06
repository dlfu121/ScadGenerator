# 变更日志 · 2026-04-06

本文档整理本会话内对 **ScadGenerator** 做过的全部前端/后端相关修改，便于回顾与交接。

---

## 1. 岗位对外名称与 `@` 别名

| 原称呼（内部 role 不变） | 对外名称 | 主要 `@` 标签 |
|--------------------------|----------|----------------|
| 产品经理 | **需求顾问** | `@需求顾问`（仍兼容 `@产品经理`、`@PM`、`@小k` 等） |
| 实习生 | **代码助手** | `@代码助手`（仍兼容 `@实习生`、`@intern` 等） |
| 老师傅 | **代码生成** | `@代码生成`（仍兼容 `@老师傅`、`@master` 等） |

**后端**（`backend/services/ai-service.ts`）

- `detectMention()`：增加对上述新中文标签的识别，旧标签逻辑保留。
- `handleMentionedRoute` 中 `cleanedInput`：同步增加对新区段名的剥离，避免把标签带进模型输入。

---

## 2. 会话顶部「召唤」按钮与忙碌动画

**文件**：`app/src/modules/prompt-input/PromptInput.tsx`

- 在对话栏标题区域下方增加 **三个按钮**，分别插入 `@需求顾问 `、`@代码助手 `、`@代码生成 `，并聚焦输入框。
- 使用状态 **`busyAgentRole`**（`'product_manager' | 'intern' | 'master' | null`）标记当前正在响应的岗位。
- 在以下路径中设置/清除 `busyAgentRole`，使对应按钮出现 **高亮/脉冲动画**（如 `is-working`、小圆点）：
  - 需求确认对话 `handleConfirmationChat`（按 `@` 解析角色，无 `@` 时默认需求顾问）
  - 确认后走生成 `handleGenerateAfterConfirmation`（代码生成）
  - 首次方案+生成 `handlePlanThenGenerate`、代码修订 `handleRevisionGenerate`（代码生成）
- 全局 `isLoading` 或与忙碌重叠时，禁用召唤按钮，避免重复提交。
- 欢迎语、清空会话提示、副标题等文案已改为新岗位名与用法说明。

**说明**：内部角色名仍为 `product_manager` / `intern` / `master`，仅展示与 `@` 解析扩展。

---

## 3. 左侧会话：避免与右侧审阅重复「再贴一整段代码」

**需求**：右侧已有代码增删与各块说明时，左侧不应再重复大段代码或冗长块说明，应偏 **提醒**。

### 3.1 对话返回代码且将进入右侧审阅（`onDirectCode`）

**文件**：`app/src/modules/prompt-input/PromptInput.tsx`

- 当存在 `directCode` 且存在 **`onDirectCode`** 时，左侧气泡内容改为固定短文案常量 **`DIRECT_CODE_PENDING_REVIEW_REMINDER`**（提示去右侧看差异与说明、再应用合并）。
- **多轮 `conversationHistory`** 仍写入后端返回的完整 `pmResponse`，保证后续请求上下文不变。

### 3.2 应用合并后注入左侧会话

**文件**：`app/src/App.tsx` · `formatWorkspaceApplyChatMessage`

- 改为 **简短几条**：标题「已应用合并」、来源与块数统计、一句「详细以右侧审阅为准」。
- **已移除**：在左侧按块重复列出「各代码修改块的作用」等长列表（与右侧重复的部分）。

---

## 4. 头像显示（与中途误解的澄清）

- 曾根据反馈短暂隐藏 **`engineer` 消息左侧头像**，后按用户说明 **恢复**：问题不在头像本身，而在 **文案重复**。
- 当前：**工程师类消息**（`role: 'engineer'`）仍显示与 `agentRole` 对应的头像（如代码助手/代码生成）。

---

## 5. 涉及文件一览

| 文件 | 变更摘要 |
|------|----------|
| `backend/services/ai-service.ts` | `detectMention`、`cleanedInput` 支持新 `@` 别名 |
| `app/src/modules/prompt-input/PromptInput.tsx` | 岗位名与文案、`@` 解析、召唤按钮与动画、`busyAgentRole`、直达审阅时的短提醒、头像恢复 |
| `app/src/App.tsx` | `formatWorkspaceApplyChatMessage` 精简为合并完成提醒 |

---

## 6. 未纳入本文档范围的说明

- 历史会话中关于 **diff 合并说明 / `pendingDiffExplain` / `CodeDiffReview`** 等更早的较大功能，若未在本轮会话中修改，不写入本日志。
- 仓库内其他文档（如 `KIMI_DIALOGUE_FEATURE.md`、`MENTION_CODE_INJECTION_GUIDE.md`）**未**因本次需求一并更新；若需与产品文案一致，可后续单独补文档。

---

*本日志由 2026-04-06 会话整理。*
