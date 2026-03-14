# ScadGenerator 数据清洗改造计划（照抄 CADAM）

> 目标：把 `backend/services/code-processor.ts` 的每一个函数都对齐 CADAM 的实际实现，同时升级 `Parameter` 类型，让参数面板能支持 range / options / group。

---

## 一、CADAM 的清洗方式（原文逻辑）

### 1. 代码提取（`parametric-chat/index.ts`）

**正常路径（tool call 成功）**：模型直接返回纯代码，只用一行 fence 正则处理：

```typescript
const codeBlockRegex = /^```(?:openscad)?\n?([\s\S]*?)\n?```$/;
const match = code.match(codeBlockRegex);
if (match) code = match[1].trim();
```

**兜底路径（模型把代码放进文本）**：`extractOpenSCADCodeFromText` 扫描所有 fence 块，用 `scoreOpenSCADCode` 打分选最优；若没有 fence 且整段文本得分 >= 5 也接受：

```typescript
function scoreOpenSCADCode(code: string): number {
  // primitives / bool-ops / transforms / extrusions / module / $fn / var=val
  // 每类关键词命中都加分，cap 变量声明贡献
}
```

### 2. 参数解析（`_shared/parseParameter.ts`）

- 只解析文件**顶部**（截至第一个 `module` 或 `function` 关键词前）
- 正则：`/^([a-z0-9A-Z_$]+)\s*=\s*([^;]+);[\t\f\cK ]*(\/\/[^\n]*)?/gm`
- 支持类型：`number | boolean | string | number[] | string[] | boolean[]`
- 右值含变量引用（如 `width * 2`）或多行时 `continue`，**不报错**
- 分组：识别 `/* [GroupName] */` 块，参数归属到所在分组
- 行尾注释元数据：
  - 纯数字 `// 5` → `step`（number）或 `max`（string）
  - `// [10:200]` 或 `// [0:5:100]` → `range { min, step, max }`
  - `// [opt1, opt2]` → `options` 下拉列表
- 上方行注释 `// description` → `description` 字段
- `displayName`：下划线→空格→首字母大写；`$fn` → `Resolution`

### 3. System Prompt 策略（`STRICT_CODE_PROMPT`）

```
Return ONLY raw OpenSCAD code.
DO NOT wrap it in markdown code blocks (no ```openscad).
Initialize and declare variables at the START of the code.
Do not write any other text or comments in the response.
```

**结论**：CADAM 把清洗压缩到最小——Prompt 层禁止 fence，代码层只做一行 fence 剥离 + score 兜底；参数解析功能完整但**不修改代码本体**。

---

## 二、ScadGenerator 现状对比（差距清单）

| # | 现有函数/行为 | 问题 | CADAM 做法 |
|---|---|---|---|
| 1 | `normalizeModelOutput` 删除 `/* */` | Customizer 分组标记 `/* [Group] */` 被清除 | 不删块注释 |
| 2 | `stripInlineNoise` 删除 `// …` 行尾注释 | 参数 range/options/description 元数据全丢 | 完全保留行注释 |
| 3 | 无 fence 时用 `isLikelyOpenSCADLine` 逐行过滤 | `difference() {` 下一行 `}` 被过滤，代码结构被截断 | `scoreOpenSCADCode` 整体评分，超阈值则保留全文 |
| 4 | 有 fence 时取**最后一个**块，不评分 | 若模型重复输出，选错块 | 遍历所有块，取最高分 |
| 5 | `validateSyntax` 逐行统计括号 | `translate([10,0,0])` 单行合法但触发假报错 | 全局计数（或不校验） |
| 6 | `Parameter` 无 range/options/group/displayName | 参数面板功能缺失 | 完整元数据 |
| 7 | `extractParameters` 扫全文所有行 | 误提取 module 内部局部变量 | 只解析顶部（截至第一个 module/function） |
| 8 | `extractParameters` 接受变量引用右值 | 把 `radius = base_r` 当参数，运行时出错 | 右值含字母引用则 skip |

---

## 三、改造方案（函数级，照抄 CADAM）

### 文件：`backend/services/code-processor.ts` —— 全量重写

#### 3.1 `Parameter` 接口扩展

```typescript
export interface ParameterRange {
  min?: number;
  max?: number;
  step?: number;
}

export interface ParameterOption {
  value: string | number;
  label?: string;
}

export type ParameterType =
  | 'number' | 'string' | 'boolean'
  | 'number[]' | 'string[]' | 'boolean[]';

export interface Parameter {
  name: string;
  displayName: string;
  type: ParameterType;
  value: number | string | boolean | number[] | string[] | boolean[];
  defaultValue: number | string | boolean | number[] | string[] | boolean[];
  description?: string;
  group: string;
  range: ParameterRange;
  options: ParameterOption[];
}
```

#### 3.2 `normalizeModelOutput` —— 只去 `<think>` 标签，保留 `/* */`

```typescript
// 改造前：还额外删除 /* */ 块注释
// 改造后：
function normalizeModelOutput(rawCode: string): string {
  return rawCode
    .replace(/\r\n?/g, '\n')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();
}
```

#### 3.3 新增 `scoreOpenSCADCode`（照抄 CADAM）

```typescript
function scoreOpenSCADCode(code: string): number {
  if (!code || code.length < 20) return 0;
  let score = 0;
  const patterns = [
    /\b(cube|sphere|cylinder|polyhedron)\s*\(/gi,
    /\b(union|difference|intersection)\s*\(\s*\)/gi,
    /\b(translate|rotate|scale|mirror)\s*\(/gi,
    /\b(linear_extrude|rotate_extrude)\s*\(/gi,
    /\b(module|function)\s+\w+\s*\(/gi,
    /\$fn\s*=/gi,
    /\bfor\s*\(\s*\w+\s*=\s*\[/gi,
    /;\s*$/gm,
    /\/\/.*$/gm,
  ];
  for (const pattern of patterns) {
    score += (code.match(pattern) || []).length;
  }
  const varDecls = code.match(/^\s*\w+\s*=\s*[^;]+;/gm);
  if (varDecls) score += Math.min(varDecls.length, 5);
  return score;
}
```

#### 3.4 `extractOpenSCADCandidate` —— 改为 score 机制，删除逐行过滤

```typescript
// 改造前：有 fence → 取最后一块 → 逐行 stripInlineNoise
//         无 fence → isLikelyOpenSCADLine 逐行过滤（截断结构体）
// 改造后：
function extractOpenSCADCandidate(normalized: string): string {
  if (!normalized) return '';

  const fenceRegex = /```(?:openscad|scad)?\s*\n?([\s\S]*?)\n?```/gi;
  let match: RegExpExecArray | null;
  let bestCode = '';
  let bestScore = 0;

  while ((match = fenceRegex.exec(normalized)) !== null) {
    const code = match[1].trim();
    const score = scoreOpenSCADCode(code);
    if (score > bestScore) {
      bestScore = score;
      bestCode = code;
    }
  }

  // 有 fence 且得分 >= 3：返回最优块，不做逐行过滤
  if (bestCode && bestScore >= 3) return bestCode;

  // 无 fence：整段文本得分 >= 5 才接受
  const rawScore = scoreOpenSCADCode(normalized);
  if (rawScore >= 5) return normalized.trim();

  // 分数不够：返回空串，调用方回退到 rawCode
  return '';
}
```

#### 3.5 删除以下函数（逐行过滤体系，不再需要）

- `stripInlineNoise`
- `isLikelyOpenSCADLine`
- `isStructuralContinuationLine`

#### 3.6 `validateSyntax` —— 改为全局括号平衡

```typescript
// 改造前：逐行统计，translate([10,0,0]) 触发假报错
// 改造后：
function validateSyntax(code: string): string[] {
  const errors: string[] = [];
  // 去除字符串字面量，防止字符串内的括号干扰计数
  const stripped = code.replace(/"[^"]*"/g, '""');
  const counts = { round: [0, 0], square: [0, 0], curly: [0, 0] };
  for (const ch of stripped) {
    if (ch === '(') counts.round[0]++;
    else if (ch === ')') counts.round[1]++;
    else if (ch === '[') counts.square[0]++;
    else if (ch === ']') counts.square[1]++;
    else if (ch === '{') counts.curly[0]++;
    else if (ch === '}') counts.curly[1]++;
  }
  if (counts.round[0]  !== counts.round[1])  errors.push('括号 () 全局不匹配');
  if (counts.square[0] !== counts.square[1]) errors.push('方括号 [] 全局不匹配');
  if (counts.curly[0]  !== counts.curly[1])  errors.push('花括号 {} 全局不匹配');
  return errors;
}
```

#### 3.7 `extractParameters` —— 照抄 CADAM `parseParameters` 完整逻辑

关键改动点：

1. **截断位置**：先 `script.split(/^(module |function )/m)[0]` 取顶部
2. **分组扫描**：用 `/* [GroupName] */` 正则分割 groupSections，参数归组
3. **正则升级**：`/^([a-z0-9A-Z_$]+)\s*=\s*([^;]+);[\t\f\cK ]*(\/\/[^\n]*)?/gm`
4. **跳过变量引用**：右值以字母开头（且非 `true`/`false`）则 `continue`
5. **`convertType`**：支持 `number[] | string[] | boolean[]`，抛异常则 `continue`
6. **行尾注释元数据**（照抄 CADAM 逐条判断）：
   - 纯数字 → step / max
   - `[min:max]` 或 `[min:step:max]` → range
   - `[opt1, opt2]` 含逗号 → options
7. **上方注释 description**：split 取参数行上一行，以 `//` 开头则截取
8. **`displayName`**：`_` → 空格 → 首字母大写；`$fn` → `Resolution`

### 文件：`backend/services/ai-service.ts` —— `buildGenerateResult` 小调整

```typescript
function buildGenerateResult(rawModelOutput: string, sessionId?: string): GenerateResult {
  const rawCode = rawModelOutput.trim();
  const processed = processOpenSCADCode(rawCode);

  // cleanedCode 空时（score 不够）回退到 rawCode，保证编译有内容
  const compilableCode = processed.cleanedCode || rawCode;

  const parameters = processed.parameters.reduce((acc, param) => {
    acc[param.name] = param.defaultValue ?? param.value;
    return acc;
  }, {} as Record<string, any>);

  return {
    openscadCode: rawCode,    // 前端展示：始终显示原始输出
    compilableCode,           // 后端编译：fence 剥离后的干净代码
    parameters,
    sessionId: sessionId || uuidv4()
  };
}
```

---

## 四、实施顺序

| 步骤 | 内容 | 优先级 |
|---|---|---|
| 1 | 扩展 `Parameter` 接口（ParameterRange / ParameterOption / ParameterType） | P0 |
| 2 | 重写 `normalizeModelOutput`（去 `<think>`，保留 `/* */`） | P0 |
| 3 | 新增 `scoreOpenSCADCode` | P0 |
| 4 | 重写 `extractOpenSCADCandidate`（score 机制） | P0 |
| 5 | 删除 `stripInlineNoise` / `isLikelyOpenSCADLine` / `isStructuralContinuationLine` | P0 |
| 6 | 重写 `validateSyntax`（全局括号平衡） | P0 |
| 7 | 重写 `extractParameters`（照抄 CADAM parseParameters） | P1 |
| 8 | 调整 `buildGenerateResult`（`defaultValue` 字段）| P1 |
| 9 | `npm run build:server` + 重启后端 + 回归测试 | P0 |

---

## 五、验证用例

| prompt | 期望结果 |
|---|---|
| `边长15mm的正四面体` | cleanedCode 无 fence、结构完整、编译成功 |
| `半径10mm球体，$fn=64` | `$fn` 参数 displayName = "Resolution"，编译成功 |
| 模型输出带 ` ```openscad ``` ` | fence 剥离，cleanedCode 为纯代码，score >= 3 |
| 模型输出纯文本含 `cylinder()` | score >= 5 时接受，< 5 时 compilableCode 回退到 rawCode |
| `translate([10,0,0]) sphere(5);` | validateSyntax 无报错 |

---

## 六、参考文件

- [CADAM parseParameter.ts](../CADAM/supabase/functions/_shared/parseParameter.ts)
- [CADAM parametric-chat/index.ts](../CADAM/supabase/functions/parametric-chat/index.ts)
- [ScadGenerator code-processor.ts](backend/services/code-processor.ts) ← 待改造
- [ScadGenerator ai-service.ts](backend/services/ai-service.ts) ← buildGenerateResult 小调整

