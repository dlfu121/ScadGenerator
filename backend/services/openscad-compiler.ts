import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

export type CompileStatus = 'queued' | 'running' | 'success' | 'error';

export interface CompileErrorDetail {
  message: string;
  stderr?: string;
  stdout?: string;
  exitCode?: number;
  code?: string;
}

export interface CompileResult {
  status: CompileStatus;
  success: boolean;
  stlData?: Buffer;
  error?: string;
  detail?: CompileErrorDetail;
  compileTime?: number;
}

// 编译服务：统一封装 OpenSCAD 代码校验与 STL 产物生成。
export class OpenSCADCompiler {
  private worker: any = null;
  private readonly executable: string;

  constructor() {
    this.executable = process.env.OPENSCAD_BIN || 'openscad';
  }

  // 对外编译入口，返回成功状态、产物和耗时信息。
  async compileToSTL(openscadCode: string, parameters: Record<string, any> = {}): Promise<CompileResult> {
    const startTime = Date.now();
    const normalizedCode = this.normalizeOpenSCADCode(openscadCode);
    
    try {
      const validation = await this.validateCode(normalizedCode);
      if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
      }

      const stlData = await this.compileWithOpenSCAD(normalizedCode, parameters);
      
      return {
        status: 'success',
        success: true,
        stlData,
        compileTime: Date.now() - startTime
      };
    } catch (error) {
      const detail: CompileErrorDetail = {
        message: error instanceof Error ? error.message : '编译失败'
      };

      return {
        status: 'error',
        success: false,
        error: detail.message,
        detail,
        compileTime: Date.now() - startTime
      };
    }
  }

  private async compileWithOpenSCAD(code: string, parameters: Record<string, any>): Promise<Buffer> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scad-generator-'));
    const inputPath = path.join(tempRoot, 'input.scad');
    const outputPath = path.join(tempRoot, 'output.stl');

    try {
      const parameterSource = this.serializeParameters(parameters);
      await fs.writeFile(inputPath, `${parameterSource}\n${code}`, 'utf-8');

      await this.runOpenSCAD(inputPath, outputPath);

      const stlData = await fs.readFile(outputPath);
      if (!stlData.length) {
        throw new Error('OpenSCAD 未输出有效 STL 数据');
      }
      return stlData;
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }

  private runOpenSCAD(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.executable,
        ['-o', outputPath, inputPath],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        }
      );

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
      }, 60000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`OpenSCAD 启动失败: ${error.message}`));
      });

      child.on('close', (exitCode) => {
        clearTimeout(timeout);

        if (exitCode === 0) {
          resolve();
          return;
        }

        const reason = stderr.trim() || stdout.trim() || '未知编译错误';
        reject(new Error(`OpenSCAD 编译失败(exit=${exitCode ?? -1}): ${reason}`));
      });
    });
  }

  private serializeParameters(parameters: Record<string, any>): string {
    return Object.entries(parameters)
      .map(([key, value]) => `${key} = ${this.toOpenSCADValue(value)};`)
      .join('\n');
  }

  private normalizeOpenSCADCode(input: string): string {
    let normalized = input.trim();

    if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
      normalized = normalized.slice(1, -1).trim();
    }

    const fencedMatch = normalized.match(/^```(?:openscad|scad)?\s*([\s\S]*?)\s*```$/i);
    if (fencedMatch?.[1]) {
      normalized = fencedMatch[1].trim();
    }

    return normalized
      .replace(/^```(?:openscad|scad)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  private toOpenSCADValue(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.toOpenSCADValue(item)).join(', ')}]`;
    }

    const safeString = String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${safeString}"`;
  }

  async validateCode(code: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    // 基本输入检查。
    if (!code.trim()) {
      errors.push('代码为空');
    }
    
    // 用栈结构做括号配对检查，快速拦截常见语法错误。
    const brackets: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    const stack: string[] = [];
    
    for (const char of code) {
      if (Object.keys(brackets).includes(char)) {
        stack.push(brackets[char]);
      } else if (Object.values(brackets).includes(char)) {
        const expected = stack.pop();
        if (expected !== char) {
          errors.push('括号不匹配');
          break;
        }
      }
    }
    
    if (stack.length > 0) {
      errors.push('未闭合的括号');
    }
    
    // 检查是否至少包含一个常见 OpenSCAD 几何/布尔函数。
    const scadFunctions = ['cube', 'sphere', 'cylinder', 'union', 'difference', 'intersection'];
    const hasValidFunction = scadFunctions.some(func => code.includes(func));
    
    if (!hasValidFunction) {
      errors.push('未找到有效的OpenSCAD几何函数');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  // 释放潜在 Worker 资源，供服务关闭时调用。
  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export const openscadCompiler = new OpenSCADCompiler();
