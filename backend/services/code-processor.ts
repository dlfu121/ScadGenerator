export interface ProcessedCode {
  cleanedCode: string;
  parameters: Parameter[];
  errors: string[];
}

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

// 代码后处理总入口：清洗、提参、基础校验。
export function processOpenSCADCode(rawCode: string): ProcessedCode {
  const errors: string[] = [];
  const normalized = normalizeModelOutput(rawCode);
  const cleanedCode = extractOpenSCADCandidate(normalized);

  const parameters = extractParameters(cleanedCode || normalized);

  const syntaxErrors = validateSyntax(cleanedCode || normalized);
  errors.push(...syntaxErrors);

  return {
    cleanedCode,
    parameters,
    errors
  };
}

// 只去 <think> 标签；保留 /* */ 块注释（Customizer 分组标记）。
function normalizeModelOutput(rawCode: string): string {
  return rawCode
    .replace(/\r\n?/g, '\n')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();
}

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

// 从模型输出中提取最优 OpenSCAD 代码候选。
// 有 fence：遍历所有块，取 score 最高的；无 fence：整段得分 >= 5 才接受。
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

  if (bestCode && bestScore >= 3) return bestCode;

  const rawScore = scoreOpenSCADCode(normalized);
  if (rawScore >= 5) return normalized.trim();

  return '';
}

// 全局括号平衡校验，避免单行 translate([10,0,0]) 触发假报错。
function validateSyntax(code: string): string[] {
  const errors: string[] = [];
  const stripped = code.replace(/"[^"]*"/g, '""');
  let round = 0, square = 0, curly = 0;
  for (const ch of stripped) {
    if (ch === '(') round++;
    else if (ch === ')') round--;
    else if (ch === '[') square++;
    else if (ch === ']') square--;
    else if (ch === '{') curly++;
    else if (ch === '}') curly--;
  }
  if (round !== 0)  errors.push('括号 () 全局不匹配');
  if (square !== 0) errors.push('方括号 [] 全局不匹配');
  if (curly !== 0)  errors.push('花括号 {} 全局不匹配');
  return errors;
}

// 照抄 CADAM parseParameters 完整逻辑。
function extractParameters(code: string): Parameter[] {
  // 只解析顶部（截至第一个 module/function 关键词前）
  const script = code.split(/^(module |function )/m)[0];

  const parameters: Record<string, Parameter> = {};
  const parameterRegex =
    /^([a-z0-9A-Z_$]+)\s*=\s*([^;]+);[\t\f\cK ]*(\/\/[^\n]*)?/gm;
  const groupRegex = /^\/\*\s*\[([^\]]+)\]\s*\*\//gm;

  // 分组扫描
  const groupSections: { id: string; group: string; code: string }[] = [
    { id: '', group: '', code: script },
  ];
  let tmpGroup;
  while ((tmpGroup = groupRegex.exec(script))) {
    groupSections.push({
      id: tmpGroup[0],
      group: tmpGroup[1].trim(),
      code: '',
    });
  }

  groupSections.forEach((group, index) => {
    const nextGroup = groupSections[index + 1];
    const startIndex = group.id ? script.indexOf(group.id) : 0;
    const endIndex = nextGroup ? script.indexOf(nextGroup.id) : script.length;
    group.code = script.substring(startIndex, endIndex);
  });

  if (groupSections.length > 1) {
    groupSections[0].code = script.substring(0, script.indexOf(groupSections[1].id));
  }

  groupSections.forEach((groupSection) => {
    let match;
    while ((match = parameterRegex.exec(groupSection.code)) !== null) {
      const name = match[1];
      const value = match[2].trim();

      // 跳过变量引用（右值以字母开头且非 true/false）或多行
      if (
        value !== 'true' &&
        value !== 'false' &&
        (value.match(/^[a-zA-Z_]/) || value.split('\n').length > 1)
      ) {
        continue;
      }

      let typeAndValue: { value: Parameter['value']; type: ParameterType } | undefined;
      try {
        typeAndValue = convertType(value);
      } catch {
        continue;
      }
      if (!typeAndValue) continue;

      let description: Parameter['description'] = undefined;
      let options: ParameterOption[] = [];
      let range: ParameterRange = {};

      // 行尾注释元数据
      if (match[3]) {
        const rawComment = match[3].replace(/^\/\/\s*/, '').trim();
        const cleaned = rawComment.replace(/^\[+|\]+$/g, '');

        if (!isNaN(Number(rawComment))) {
          if (typeAndValue.type === 'string') {
            range = { max: parseFloat(cleaned) };
          } else {
            range = { step: parseFloat(cleaned) };
          }
        } else if (rawComment.startsWith('[') && cleaned.includes(',')) {
          options = cleaned.trim().split(',').map((option) => {
            const parts = option.trim().split(':');
            let optVal: ParameterOption['value'] = parts[0];
            const label: ParameterOption['label'] = parts[1];
            if (typeAndValue!.type === 'number') optVal = parseFloat(String(optVal));
            return { value: optVal, label };
          });
        } else if (cleaned.match(/([0-9]+:?)+/)) {
          const [min, maxOrStep, max] = cleaned.trim().split(':');
          if (min && (maxOrStep || max)) range = { min: parseFloat(min) };
          if (max || maxOrStep || min) range = { ...range, max: parseFloat(max || maxOrStep || min) };
          if (max && maxOrStep) range = { ...range, step: parseFloat(maxOrStep) };
        }
      }

      // 上方行注释 → description
      let above = script.split(new RegExp(`^${escapeRegExp(match[0])}`, 'gm'))[0];
      if (above.endsWith('\n')) above = above.slice(0, -1);
      const lastLine = above.split('\n').reverse()[0];
      if (lastLine && lastLine.trim().startsWith('//')) {
        const desc = lastLine.replace(/^\/\/\/*\s*/, '');
        if (desc.length > 0) description = desc;
      }

      let displayName = name
        .replace(/_/g, ' ')
        .split(' ')
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ');
      if (name === '$fn') displayName = 'Resolution';

      parameters[name] = {
        description,
        group: groupSection.group,
        name,
        displayName,
        defaultValue: typeAndValue.value,
        range,
        options,
        ...typeAndValue,
      };
    }
  });

  return Object.values(parameters);
}

function convertType(rawValue: string): { value: Parameter['value']; type: ParameterType } {
  if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    return { value: parseFloat(rawValue), type: 'number' };
  } else if (rawValue === 'true' || rawValue === 'false') {
    return { value: rawValue === 'true', type: 'boolean' };
  } else if (/^".*"$/.test(rawValue)) {
    return { value: rawValue.replace(/^"(.*)"$/, '$1'), type: 'string' };
  } else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
    const items = rawValue.slice(1, -1).split(',').map((s) => s.trim());
    if (items.length > 0 && items.every((i) => /^-?\d+(\.\d+)?$/.test(i))) {
      return { value: items.map(parseFloat), type: 'number[]' };
    } else if (items.length > 0 && items.every((i) => /^".*"$/.test(i))) {
      return { value: items.map((i) => i.slice(1, -1)), type: 'string[]' };
    } else if (items.length > 0 && items.every((i) => i === 'true' || i === 'false')) {
      return { value: items.map((i) => i === 'true'), type: 'boolean[]' };
    }
    throw new Error(`Invalid array value: ${rawValue}`);
  } else {
    throw new Error(`Invalid value: ${rawValue}`);
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
