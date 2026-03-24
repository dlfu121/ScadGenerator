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

export type ArtifactFormat = 'stl' | 'csg';

export interface ArtifactResult {
  success: boolean;
  data?: Buffer;
  error?: string;
  detail?: CompileErrorDetail;
  compileTime?: number;
}

// 编译服务：统一封装 OpenSCAD 代码校验与 STL 产物生成。
export class OpenSCADCompiler {
  private worker: any = null;
  private readonly executable: string;
  private readonly compileTimeoutMs: number;

  constructor() {
    this.executable = process.env.OPENSCAD_BIN || 'openscad';
    const timeoutFromEnv = Number.parseInt(process.env.OPENSCAD_COMPILE_TIMEOUT_MS || '', 10);
    this.compileTimeoutMs = Number.isFinite(timeoutFromEnv) && timeoutFromEnv > 0 ? timeoutFromEnv : 180000;
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

  async exportArtifact(
    openscadCode: string,
    parameters: Record<string, any> = {},
    format: ArtifactFormat = 'stl'
  ): Promise<ArtifactResult> {
    const startTime = Date.now();
    const normalizedCode = this.normalizeOpenSCADCode(openscadCode);

    try {
      const validation = await this.validateCode(normalizedCode);
      if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
      }

      const data = await this.compileWithOpenSCAD(normalizedCode, parameters, format);

      return {
        success: true,
        data,
        compileTime: Date.now() - startTime
      };
    } catch (error) {
      const detail: CompileErrorDetail = {
        message: error instanceof Error ? error.message : '导出失败'
      };

      return {
        success: false,
        error: detail.message,
        detail,
        compileTime: Date.now() - startTime
      };
    }
  }

  private async compileWithOpenSCAD(
    code: string,
    parameters: Record<string, any>,
    format: ArtifactFormat = 'stl'
  ): Promise<Buffer> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scad-generator-'));
    const inputPath = path.join(tempRoot, 'input.scad');
    const outputPath = path.join(tempRoot, `output.${format}`);

    try {
      const parameterSource = this.serializeParameters(parameters);
      await fs.writeFile(inputPath, `${parameterSource}\n${code}`, 'utf-8');

      await this.runOpenSCAD(inputPath, outputPath);

      const outputData = await fs.readFile(outputPath);
      if (!outputData.length) {
        throw new Error(`OpenSCAD 未输出有效 ${format.toUpperCase()} 数据`);
      }
      return outputData;
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
      }, this.compileTimeoutMs);

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
    // 放宽前置校验：仅拦截空代码，其余语法交给 OpenSCAD 编译器处理，避免长代码误杀。
    if (!code.trim()) {
      return {
        valid: false,
        errors: ['代码为空']
      };
    }

    return {
      valid: true,
      errors: []
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
