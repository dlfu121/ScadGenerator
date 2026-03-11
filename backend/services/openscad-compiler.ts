export interface CompileResult {
  success: boolean;
  stlData?: string; // Base64编码的STL数据
  error?: string;
  compileTime?: number;
}

// 编译服务：统一封装 OpenSCAD 代码校验与 STL 产物生成。
export class OpenSCADCompiler {
  private worker: any = null;

  // 对外编译入口，返回成功状态、产物和耗时信息。
  async compileToSTL(openscadCode: string, parameters: Record<string, any> = {}): Promise<CompileResult> {
    const startTime = Date.now();
    
    try {
      // 当前为 MVP：用模拟逻辑代替 openscad-wasm，先打通端到端流程。
      const stlData = await this.simulateCompilation(openscadCode, parameters);
      
      return {
        success: true,
        stlData,
        compileTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '编译失败',
        compileTime: Date.now() - startTime
      };
    }
  }

  private async simulateCompilation(code: string, parameters: Record<string, any>): Promise<string> {
    // 模拟 OpenSCAD 编译耗时，便于前端观察加载态。
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 仅做最小几何体存在性校验，避免返回完全无效结果。
    if (!code.includes('cube') && !code.includes('sphere') && !code.includes('cylinder')) {
      throw new Error('代码中未找到有效的3D几何体');
    }
    
    // 生成简化版 STL 文本并转 Base64，模拟真实编译产物格式。
    const stlHeader = 'solid model\n';
    const stlFooter = 'endsolid model\n';
    
    // 生成简单的三角形面片数据
    const triangles = this.generateSimpleTriangles();
    const stlBody = triangles.join('\n') + '\n';
    
    const stlContent = stlHeader + stlBody + stlFooter;
    
    // 转换为Base64
    return Buffer.from(stlContent).toString('base64');
  }

  private generateSimpleTriangles(): string[] {
    // 返回示例三角面片，前端可据此完成渲染流程验证。
    return [
      '  facet normal 0 0 1',
      '    outer loop',
      '      vertex 0 0 0',
      '      vertex 1 0 0',
      '      vertex 0 1 0',
      '    endloop',
      '  endfacet',
      '  facet normal 0 0 1',
      '    outer loop',
      '      vertex 1 0 0',
      '      vertex 1 1 0',
      '      vertex 0 1 0',
      '    endloop',
      '  endfacet',
      // 添加更多面...
    ];
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
