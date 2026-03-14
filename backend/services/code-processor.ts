export interface ProcessedCode {
  cleanedCode: string;
  parameters: Parameter[];
  errors: string[];
}

// 参数抽象：供前端动态渲染参数面板。
export interface Parameter {
  name: string;
  type: 'number' | 'string' | 'boolean';
  value: any;
  description?: string;
}

// 代码后处理总入口：清洗、提参、基础校验。
export function processOpenSCADCode(rawCode: string): ProcessedCode {
  const errors: string[] = [];
  const normalized = normalizeModelOutput(rawCode);
  const cleanedCode = extractOpenSCADCandidate(normalized);

  // 从 `name = value;` 风格语句中提取参数。
  const parameters = extractParameters(cleanedCode);
  
  // 做基础语法健壮性检查（括号/方括号/花括号配对）。
  const syntaxErrors = validateSyntax(cleanedCode);
  errors.push(...syntaxErrors);

  return {
    cleanedCode,
    parameters,
    errors
  };
}

function normalizeModelOutput(rawCode: string): string {
  return rawCode
    .replace(/\r\n?/g, '\n')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/think>/gi, '')
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
    .trim();
}

function extractOpenSCADCandidate(normalized: string): string {
  if (!normalized) {
    return '';
  }

  const fencedBlocks = [...normalized.matchAll(/```(?:openscad|scad)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  const candidateSource = fencedBlocks.length > 0
    ? fencedBlocks[fencedBlocks.length - 1]
    : normalized;

  const lines = candidateSource
    .split('\n')
    .map((line) => stripInlineNoise(line))
    .filter((line) => line.trim() !== '');

  if (fencedBlocks.length > 0) {
    return lines.join('\n').trim();
  }

  const firstCodeLine = lines.findIndex((line) => isLikelyOpenSCADLine(line));
  if (firstCodeLine === -1) {
    return lines.join('\n').trim();
  }

  let lastCodeLine = firstCodeLine;
  for (let index = firstCodeLine; index < lines.length; index += 1) {
    if (isLikelyOpenSCADLine(lines[index]) || isStructuralContinuationLine(lines[index])) {
      lastCodeLine = index;
    }
  }

  return lines
    .slice(firstCodeLine, lastCodeLine + 1)
    .filter((line) => isLikelyOpenSCADLine(line) || isStructuralContinuationLine(line))
    .join('\n')
    .trim();
}

function stripInlineNoise(line: string): string {
  return line
    .replace(/^```(?:openscad|scad)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^\s*\/\*+\s*$/, '')
    .replace(/^\s*\*\/\s*$/, '')
    .replace(/\s*\/\/.*$/, '')
    .trimRight();
}

function isLikelyOpenSCADLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return /^(module|function|for|if|else|let|each)\b/.test(trimmed)
    || /^[A-Za-z_]\w*\s*=/.test(trimmed)
    || /^(cube|sphere|cylinder|polyhedron|polygon|circle|square|text|translate|rotate|scale|mirror|resize|color|offset|minkowski|hull|union|difference|intersection|linear_extrude|rotate_extrude|projection|multmatrix|surface|import|render|echo)\b/.test(trimmed)
    || /^[{}]$/.test(trimmed)
    || /[;{}]$/.test(trimmed);
}

function isStructuralContinuationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return /^[\[\]{}(),.+\-*/\d\s]+,?$/.test(trimmed);
}

function extractParameters(code: string): Parameter[] {
  const parameters: Parameter[] = [];
  const lines = code.split('\n');
  
  lines.forEach(line => {
    // 匹配参数定义：name = value;
    const match = line.match(/^(\w+)\s*=\s*(.+);?\s*$/);
    if (match) {
      const [, name, valueStr] = match;
      
      try {
        const value = parseValue(valueStr);
        const type = getValueType(value);
        
        parameters.push({
          name,
          type,
          value,
          description: `参数 ${name}`
        });
      } catch (error) {
        // 无法解析的赋值表达式直接跳过，不阻塞整体处理。
      }
    }
  });
  
  return parameters;
}

function parseValue(valueStr: string): any {
  valueStr = valueStr.trim();
  
  // 移除末尾的分号
  if (valueStr.endsWith(';')) {
    valueStr = valueStr.slice(0, -1);
  }
  
  // 数字
  if (/^-?\d*\.?\d+$/.test(valueStr)) {
    return parseFloat(valueStr);
  }
  
  // 布尔值
  if (valueStr === 'true') return true;
  if (valueStr === 'false') return false;
  
  // 字符串
  if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
    return valueStr.slice(1, -1);
  }
  
  // 数组
  if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
    try {
      return JSON.parse(valueStr.replace(/(\w+)\s*:/g, '"$1":'));
    } catch {
      return valueStr;
    }
  }
  
  // 复杂表达式先按字符串保留，交给 OpenSCAD 在运行时解释。
  return valueStr;
}

function getValueType(value: any): 'number' | 'string' | 'boolean' {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

// 轻量语法校验：逐行检查常见括号配对问题。
function validateSyntax(code: string): string[] {
  const errors: string[] = [];
  const lines = code.split('\n');
  
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    
    // 检查未闭合的括号
    const openBrackets = (trimmed.match(/\(/g) || []).length;
    const closeBrackets = (trimmed.match(/\)/g) || []).length;
    if (openBrackets !== closeBrackets) {
      errors.push(`第 ${index + 1} 行: 括号不匹配`);
    }
    
    // 检查未闭合的方括号
    const openSquare = (trimmed.match(/\[/g) || []).length;
    const closeSquare = (trimmed.match(/\]/g) || []).length;
    if (openSquare !== closeSquare) {
      errors.push(`第 ${index + 1} 行: 方括号不匹配`);
    }
    
    // 检查未闭合的花括号
    const openBrace = (trimmed.match(/\{/g) || []).length;
    const closeBrace = (trimmed.match(/\}/g) || []).length;
    if (openBrace !== closeBrace) {
      errors.push(`第 ${index + 1} 行: 花括号不匹配`);
    }
  });
  
  return errors;
}
