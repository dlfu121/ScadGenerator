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
  let cleanedCode = rawCode.trim();
  
  // 先做轻量清洗：移除注释与空行，便于后续参数提取与语法检查。
  cleanedCode = cleanedCode
    .split('\n')
    .filter(line => !line.trim().startsWith('//') && line.trim() !== '')
    .join('\n');

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
