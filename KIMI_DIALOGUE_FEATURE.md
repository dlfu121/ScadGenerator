# Kimi 对话式需求确认功能

## 功能概述

实现了 Kimi 产品经理与用户进行多轮对话来确认 OpenSCAD 3D 建模需求的功能。用户不再需要一次性提供完整的需求，而是可以逐步与 AI 进行交互，直到需求明确。

## 架构改动

### 1. 新增接口 (`ai-service.ts`)

```typescript
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface RequirementConfirmation {
  isConfirmed: boolean;
  finalBrief: string;
  conversationHistory: ConversationMessage[];
}
```

### 2. 新增函数

#### `askProductManager()`
用户与产品经理进行对话，逐步明确需求。

```typescript
export async function askProductManager(
  userInput: string,
  conversationHistory: ConversationMessage[] = []
): Promise<{
  response: string;
  isNeedMoreInfo: boolean;
  isClear: boolean;
}>
```

**返回值：**
- `response`: Kimi 的回复
- `isNeedMoreInfo`: 是否还需要更多信息（是否包含【需求确认完成】）
- `isClear`: 需求是否已清晰确认

#### `generateProductBrief()`
改进了的函数，现在基于完整的、已确认的需求生成建模方案。

## API 端点

### POST `/api/parametric-chat/confirm-requirement`

进行需求确认对话。

**请求体：**
```json
{
  "userInput": "我想要一个200×100×50的盒子",
  "conversationHistory": [
    {
      "role": "user",
      "content": "我想要一个盒子"
    },
    {
      "role": "assistant",
      "content": "Kimi 的回复内容..."
    }
  ],
  "sessionId": "session-123"
}
```

**响应体：**
```json
{
  "pmResponse": "Kimi 的回复",
  "isNeedMoreInfo": true,
  "isClear": false,
  "sessionId": "session-123"
}
```

## 使用流程

### 前端流程

```
1. 用户输入初始需求
   ↓
2. 调用 /confirm-requirement
   ↓
3. Kimi 提出问题或确认信息
   ↓
4. 判断 isClear 标志
   - false: 继续步骤 1-3
   - true: 进入代码生成阶段
   ↓
5. 根据确认的需求调用 generateOpenSCAD/fixOpenSCADCode
```

### 对话示例

```
用户第1轮: "我想要一个盒子"
Kimi:     "【问题】请问您要的盒子尺寸是多少？
          【反馈】我理解您需要一个基本的立方体模型。"
          isNeedMoreInfo: true, isClear: false

用户第2轮: "200mm×100mm×50mm，需要参数化"
Kimi:     "【问题】还有其他特殊要求吗？比如孔洞、倒角等？
          【反馈】已确认尺寸为 200×100×50mm，需要参数化实现。
          【需求确认完成】"
          isNeedMoreInfo: false, isClear: true

生成阶段：
  ↓
调用 generateOpenSCAD(确认的需求)
  ↓
生成建模方案和 OpenSCAD 代码
```

## Kimi 提示词

```
你是一个专业的 OpenSCAD 3D 参数化建模产品经理。你的职责是通过与用户交互来明确 OpenSCAD 3D 建模需求。

关键任务：
✓ 确认基本几何形状
✓ 获取精准的尺寸参数
✓ 理解参数化需求
✓ 识别特殊特征

输出标记：
- 【问题】: 需要澄清的问题
- 【反馈】: 对需求的理解总结
- 【需求确认完成】: 当信息足够完整时输出
```

## WebSocket 事件

对话过程中通过 WebSocket 发送事件：

```json
{
  "type": "requirement_confirmation",
  "stage": "clarifying|confirmed",
  "message": "回复内容",
  "isNeedMoreInfo": true|false,
  "isClear": false|true,
  "timestamp": 1711350000000
}
```

## 改动点总结

### `ai-service.ts`
- ✅ 添加 `ConversationMessage` 接口
- ✅ 添加 `askProductManager()` 函数
- ✅ 改进 `generateProductBrief()` 提示词
- ✅ 优化 Kimi 系统提示词，明确 OpenSCAD 3D 建模场景

### `parametric-chat.ts`
- ✅ 导入 `askProductManager`
- ✅ 新增 `/confirm-requirement` 端点
- ✅ 实现对话请求处理逻辑
- ✅ 集成 WebSocket 事件发送

## 使用建议

### 前端实现建议

```typescript
// 第一阶段：需求确认
async confirmRequirement(userMessage: string) {
  const response = await fetch('/api/parametric-chat/confirm-requirement', {
    method: 'POST',
    body: JSON.stringify({
      userInput: userMessage,
      conversationHistory: this.conversationHistory,
      sessionId: this.sessionId
    })
  });
  
  const data = await response.json();
  this.conversationHistory.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: data.pmResponse }
  );
  
  // 显示 Kimi 的回复
  showMessage(data.pmResponse);
  
  // 判断是否需要继续对话
  if (data.isClear) {
    // 需求确认完成，进入代码生成阶段
    generateCode();
  } else {
    // 等待用户提供更多信息
    enableUserInput();
  }
}

// 第二阶段：基于确认的需求生成代码
async generateCode() {
  // 将整个对话历史作为需求输入
  const requirementSummary = this.conversationHistory
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');
  
  const result = await generateOpenSCAD(requirementSummary, this.sessionId);
  // 显示生成的代码
  displayCode(result.compilableCode);
}
```

## 后续优化空间

1. **对话持久化**: 将对话历史存储到数据库
2. **对话分析**: 分析用户常见的需求模式
3. **智能提示**: 基于用户历史给出更好的问题建议
4. **多模态**: 支持用户上传图片辅助需求描述
5. **版本控制**: 保存需求的不同版本便于对比

## 测试方式

### 使用 API 测试

```bash
# 第 1 轮
curl -X POST http://localhost:5001/api/parametric-chat/confirm-requirement \
  -H "Content-Type: application/json" \
  -d '{"userInput":"我想要一个盒子","sessionId":"test-001"}'

# 第 2 轮（基于第 1 轮的对话历史）
curl -X POST http://localhost:5001/api/parametric-chat/confirm-requirement \
  -H "Content-Type: application/json" \
  -d '{
    "userInput":"200×100×50mm，需要参数化",
    "conversationHistory":[
      {"role":"user","content":"我想要一个盒子"},
      {"role":"assistant","content":"[第1轮的Kimi回复]"}
    ],
    "sessionId":"test-001"
  }'
```

### 完整的需求确认流程

1. 用户初始输入 → Kimi 提问关键细节
2. 用户补充 → Kimi 确认信息
3. 重复直到 `isClear: true`
4. 调用 `generateOpenSCAD` 生成代码
5. 前端展示结果
