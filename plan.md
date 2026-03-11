## Plan: ScadGenerator 实时渲染对齐 CADAM

目标是在仅改造 `ScadGenerator` 的前提下，把当前“模拟编译+伪渲染”升级为接近 CADAM 的前端体验：真实编译结果驱动真实 STL 渲染，并补齐 OrbitControls、进度反馈和错误恢复。推荐先沿用 Three.js 原生打通链路，再在第二阶段平滑引入 R3F 组件化渲染壳层，降低一次性迁移风险。

**Steps**
1. 阶段一：渲染链路去模拟化（基础能力，阻塞后续）。梳理并替换 `App.tsx`、`ParamPreview.tsx` 中的 `setTimeout` 模拟流程，改为“参数变化 -> 调用真实编译接口 -> 返回 STL -> 触发渲染”。
2. 阶段一：前后端协议收敛（*依赖步骤1*）。统一 STL 返回格式为 `Blob/ArrayBuffer`（替代伪数据字符串），并定义编译状态枚举：`queued/running/success/error`。
3. 阶段二：前端真实 STL 加载（*依赖步骤2*）。在 `ParamPreview.tsx` 集成 `STLLoader`，加入 geometry 的 `center()`、法线计算和旧 mesh 释放，确保参数频繁变化时无资源泄漏。
4. 阶段二：交互能力对齐 CADAM（*可与步骤3并行部分实现*）。引入 OrbitControls（阻尼、缩放边界、移动端触控），改造当前手写鼠标旋转逻辑。
5. 阶段三：用户反馈体系（*依赖步骤2*）。新增“编译中进度条+阶段文本”，并在渲染区显示失败原因与 `一键修复` 入口（先预留行为，后接 AI 修复）。
6. 阶段三：错误恢复与并发控制（*依赖步骤1*）。增加 `AbortController` 取消过期请求，确保最后一次参数更新获胜；编译错误结构化返回并可重试。
7. 阶段四：CADAM 风格增强（*可选增强*）。加入 HDR/环境光、相机按 bounding box 自适应、大模型顶点降采样策略，提升稳定帧率。
8. 阶段四：架构收尾（*依赖前述步骤*）。把渲染状态、编译状态、参数状态拆分为独立 hooks，避免 `App.tsx` 继续膨胀。

**Relevant files**
- `D:/MyProjects/ScadGenerator/app/src/App.tsx` — 移除模拟编译触发，改为真实接口驱动的状态编排。
- `D:/MyProjects/ScadGenerator/app/src/modules/param-preview/ParamPreview.tsx` — 集成 `STLLoader`、OrbitControls、资源清理与渲染生命周期。
- `D:/MyProjects/ScadGenerator/app/src/modules/state-session/StateSession.tsx` — 会话状态与编译状态拆分，减少耦合。
- `D:/MyProjects/ScadGenerator/backend/routes/parametric-chat.ts` — 明确生成与编译职责边界，避免单路由承担所有流程。
- `D:/MyProjects/ScadGenerator/backend/services/openscad-compiler.ts` — 从模拟编译改为真实编译实现，定义标准输出。
- `D:/MyProjects/CADAM/src/components/viewer/OpenSCADViewer.tsx` — 参考 STL 加载与错误反馈流程。
- `D:/MyProjects/CADAM/src/components/viewer/ThreeScene.tsx` — 参考 Canvas 场景组织与 OrbitControls 配置。
- `D:/MyProjects/CADAM/src/hooks/useOpenSCAD.ts` — 参考 Worker 通信、请求生命周期和错误处理模式。

**Verification**
1. 手动验证：输入 prompt 生成模型后，渲染内容应来自真实 STL，而非固定 BoxGeometry。
2. 手动验证：连续快速拖动参数 10 次，仅最后一次结果落地（无旧请求覆盖）。
3. 手动验证：编译失败时显示结构化错误与重试入口；恢复后可正常渲染。
4. 性能验证：中等模型下交互旋转保持流畅，参数连调时 UI 不冻结。
5. 回归验证：历史会话恢复、参数面板联动、下载或导出能力不回退。

**Decisions**
- 已确认范围：仅改造 `ScadGenerator`。
- 已确认目标深度：做到接近 CADAM（OrbitControls、进度反馈、错误恢复）。
- 路线建议：先“原生 Three.js 打通真实链路”，后“按模块迁移到 R3F”作为增强，而不是一次性全量迁移。
- 包含范围：真实编译接入、真实 STL 渲染、交互与反馈完善。
- 排除范围：多人协作、复杂材质编辑器、多文件 import 全功能在本轮不做。

**Further Considerations**
1. CADAM 路线说明：CADAM 的核心路线是 `react-three-fiber + drei + Three.js`，并通过 `useOpenSCAD + Worker` 做异步编译，属于“声明式场景 + Worker 编译隔离”。
2. 接口路线建议：CADAM 是“前端 Worker 本地编译优先”；ScadGenerator 现有后端链路更成熟，建议本轮走“后端真实编译 + 前端实时拉取/推送状态”，后续再评估 Worker 本地编译。
