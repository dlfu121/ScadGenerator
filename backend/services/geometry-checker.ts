// 几何完整性检查与 3D 打印风险分析服务
// Geometry integrity and 3D printing risk analysis service

type Vec3 = [number, number, number];

interface Triangle {
  normal: Vec3;
  v1: Vec3;
  v2: Vec3;
  v3: Vec3;
}

export interface GeometryIssue {
  type: 'non_manifold' | 'open_boundary' | 'degenerate_face' | 'inconsistent_normals';
  description: string;
  count: number;
}

export interface PrintingRisk {
  type: 'overhang' | 'thin_wall' | 'small_feature';
  description: string;
  severity: 'low' | 'medium' | 'high';
  count?: number;
}

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
  size: Vec3;
}

export interface GeometryCheckResult {
  isValid: boolean;
  triangleCount: number;
  boundingBox: BoundingBox;
  geometryIssues: GeometryIssue[];
  printingRisks: PrintingRisk[];
  summary: string;
}

// 顶点坐标精度（保留小数位数），用于顶点去重
const VERTEX_PRECISION = 4;
// 最小壁厚阈值 (mm)，低于此值认为存在薄壁风险
const MIN_WALL_THICKNESS_MM = 0.8;
// 悬空角度阈值：法向量 Z 分量低于此负值（< -cos45° ≈ -0.707）表示面朝下超过 45°，视为严重悬空
const OVERHANG_THRESHOLD = -0.707;
// 退化面阈值：面积小于此值（mm²）视为退化面
const DEGENERATE_AREA_THRESHOLD = 1e-8;
// 法向量一致性角度阈值（cos 90° = 0）
const NORMAL_CONSISTENCY_THRESHOLD = 0;

/**
 * 解析 STL 二进制数据，提取三角面片列表。
 * 接受 Uint8Array（兼容 Node.js Buffer，因为 Buffer 继承自 Uint8Array）。
 * 支持二进制格式；若为 ASCII 格式则降级解析。
 */
export function parseSTL(buffer: Uint8Array): Triangle[] {
  if (isASCIISTL(buffer)) {
    const text = decodeAscii(buffer);
    return parseASCIISTL(text);
  }
  return parseBinarySTL(buffer);
}

/** 将 Uint8Array 中的字节解码为 Latin-1/ASCII 字符串（不依赖 TextDecoder） */
function decodeAscii(buffer: Uint8Array): string {
  let result = '';
  for (let i = 0; i < buffer.length; i++) {
    result += String.fromCharCode(buffer[i]);
  }
  return result;
}

function isASCIISTL(buffer: Uint8Array): boolean {
  // ASCII STL 以 "solid" 开头，取前 256 字节判断
  const previewLen = Math.min(256, buffer.length);
  let preview = '';
  for (let i = 0; i < previewLen; i++) {
    preview += String.fromCharCode(buffer[i]);
  }
  return /^\s*solid\s/i.test(preview);
}

function parseBinarySTL(buffer: Uint8Array): Triangle[] {
  // STL 二进制格式：80字节头 + 4字节三角面数量 + 每面50字节
  if (buffer.length < 84) {
    return [];
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const triangleCount = view.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;

  const maxTriangles =
    buffer.length < expectedLength
      ? Math.floor((buffer.length - 84) / 50)
      : triangleCount;

  return parseTriangles(view, Math.min(triangleCount, maxTriangles));
}

function parseTriangles(view: DataView, count: number): Triangle[] {
  const triangles: Triangle[] = [];
  for (let i = 0; i < count; i++) {
    const offset = 84 + i * 50;
    triangles.push({
      normal: [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
      ],
      v1: [
        view.getFloat32(offset + 12, true),
        view.getFloat32(offset + 16, true),
        view.getFloat32(offset + 20, true),
      ],
      v2: [
        view.getFloat32(offset + 24, true),
        view.getFloat32(offset + 28, true),
        view.getFloat32(offset + 32, true),
      ],
      v3: [
        view.getFloat32(offset + 36, true),
        view.getFloat32(offset + 40, true),
        view.getFloat32(offset + 44, true),
      ],
    });
  }
  return triangles;
}

function parseASCIISTL(text: string): Triangle[] {
  const triangles: Triangle[] = [];
  const facetPattern =
    /facet\s+normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+outer\s+loop\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = facetPattern.exec(text)) !== null) {
    triangles.push({
      normal: [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])],
      v1: [parseFloat(match[4]), parseFloat(match[5]), parseFloat(match[6])],
      v2: [parseFloat(match[7]), parseFloat(match[8]), parseFloat(match[9])],
      v3: [parseFloat(match[10]), parseFloat(match[11]), parseFloat(match[12])],
    });
  }
  return triangles;
}

function vertexKey(v: Vec3): string {
  return v.map((c) => c.toFixed(VERTEX_PRECISION)).join(',');
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function magnitude(v: Vec3): number {
  return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function edgeLength(a: Vec3, b: Vec3): number {
  return magnitude(subtract(a, b));
}

/**
 * 计算三角面积（使用叉积法）
 */
function triangleArea(v1: Vec3, v2: Vec3, v3: Vec3): number {
  const e1 = subtract(v2, v1);
  const e2 = subtract(v3, v1);
  return magnitude(cross(e1, e2)) / 2;
}

/**
 * 计算顶点索引映射（顶点坐标 → 全局唯一索引）
 */
function buildVertexMap(triangles: Triangle[]): { map: Map<string, number>; indices: number[][] } {
  const map = new Map<string, number>();
  const indices: number[][] = [];
  let nextId = 0;

  for (const tri of triangles) {
    const faceIndices: number[] = [];
    for (const v of [tri.v1, tri.v2, tri.v3]) {
      const key = vertexKey(v);
      let idx = map.get(key);
      if (idx === undefined) {
        idx = nextId++;
        map.set(key, idx);
      }
      faceIndices.push(idx);
    }
    indices.push(faceIndices);
  }

  return { map, indices };
}

/**
 * 检测非流形边与开放边界
 * - 流形网格：每条无向边恰好被两个面共享
 * - 开放边界：只被一个面共享的边
 * - 非流形边：被三个及以上面共享的边
 */
function checkEdges(
  triangleIndices: number[][]
): { nonManifoldCount: number; openBoundaryCount: number } {
  const edgeFaceCount = new Map<string, number>();

  for (const face of triangleIndices) {
    const [a, b, c] = face;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = edgeKey(u, v);
      edgeFaceCount.set(key, (edgeFaceCount.get(key) ?? 0) + 1);
    }
  }

  let nonManifoldCount = 0;
  let openBoundaryCount = 0;

  for (const count of edgeFaceCount.values()) {
    if (count === 1) {
      openBoundaryCount++;
    } else if (count > 2) {
      nonManifoldCount++;
    }
  }

  return { nonManifoldCount, openBoundaryCount };
}

/**
 * 检测退化面（面积近乎为零）
 */
function checkDegenerateFaces(triangles: Triangle[]): number {
  let count = 0;
  for (const tri of triangles) {
    if (triangleArea(tri.v1, tri.v2, tri.v3) < DEGENERATE_AREA_THRESHOLD) {
      count++;
    }
  }
  return count;
}

/**
 * 检测面片法向量与计算法向量不一致的问题（翻转面）
 */
function checkInconsistentNormals(triangles: Triangle[]): number {
  let count = 0;
  for (const tri of triangles) {
    const e1 = subtract(tri.v2, tri.v1);
    const e2 = subtract(tri.v3, tri.v1);
    const computedNormal = cross(e1, e2);
    if (magnitude(computedNormal) < 1e-12) {
      continue; // 退化面跳过
    }
    // 若存储法向量与计算法向量点积为负，则面片翻转
    if (dot(tri.normal, computedNormal) < NORMAL_CONSISTENCY_THRESHOLD) {
      count++;
    }
  }
  return count;
}

/**
 * 检测悬空风险（法向量 Z 分量低于阈值的下表面）
 */
function checkOverhangs(triangles: Triangle[]): { severeCount: number; moderateCount: number } {
  let severeCount = 0;
  let moderateCount = 0;

  for (const tri of triangles) {
    const e1 = subtract(tri.v2, tri.v1);
    const e2 = subtract(tri.v3, tri.v1);
    const n = cross(e1, e2);
    const len = magnitude(n);
    if (len < 1e-12) {
      continue;
    }
    const nz = n[2] / len;
    if (nz < OVERHANG_THRESHOLD) {
      severeCount++; // > 45° 悬空
    } else if (nz < 0) {
      moderateCount++; // 0°~45° 轻度悬空
    }
  }

  return { severeCount, moderateCount };
}

/**
 * 检测薄壁/细小特征风险（通过最短边长近似估计）
 */
function checkThinFeatures(triangles: Triangle[]): {
  minEdgeLength: number;
  thinEdgeCount: number;
} {
  let minEdgeLength = Infinity;
  let thinEdgeCount = 0;

  for (const tri of triangles) {
    const edges: [Vec3, Vec3][] = [
      [tri.v1, tri.v2],
      [tri.v2, tri.v3],
      [tri.v3, tri.v1],
    ];

    for (const [a, b] of edges) {
      const len = edgeLength(a, b);
      if (len < minEdgeLength) {
        minEdgeLength = len;
      }
      if (len < MIN_WALL_THICKNESS_MM && len > DEGENERATE_AREA_THRESHOLD) {
        thinEdgeCount++;
      }
    }
  }

  return {
    minEdgeLength: minEdgeLength === Infinity ? 0 : minEdgeLength,
    thinEdgeCount,
  };
}

/**
 * 计算模型包围盒
 */
function computeBoundingBox(triangles: Triangle[]): BoundingBox {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const tri of triangles) {
    for (const v of [tri.v1, tri.v2, tri.v3]) {
      if (v[0] < minX) minX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }

  const min: Vec3 = [minX, minY, minZ];
  const max: Vec3 = [maxX, maxY, maxZ];
  const size: Vec3 = [maxX - minX, maxY - minY, maxZ - minZ];

  return { min, max, size };
}

/**
 * 对 STL 数据执行完整的几何完整性检查与 3D 打印风险分析。
 * 接受 Uint8Array（兼容 Node.js Buffer）。
 */
export function checkGeometry(stlBuffer: Uint8Array): GeometryCheckResult {
  const triangles = parseSTL(stlBuffer);

  if (triangles.length === 0) {
    return {
      isValid: false,
      triangleCount: 0,
      boundingBox: {
        min: [0, 0, 0],
        max: [0, 0, 0],
        size: [0, 0, 0],
      },
      geometryIssues: [
        {
          type: 'degenerate_face',
          description: '模型不包含任何有效面片，无法进行几何检查',
          count: 0,
        },
      ],
      printingRisks: [],
      summary: '模型数据为空或无法解析，请重新生成或修复代码',
    };
  }

  const { indices } = buildVertexMap(triangles);
  const { nonManifoldCount, openBoundaryCount } = checkEdges(indices);
  const degenerateFaceCount = checkDegenerateFaces(triangles);
  const inconsistentNormalCount = checkInconsistentNormals(triangles);
  const { severeCount: severeOverhangCount, moderateCount: moderateOverhangCount } =
    checkOverhangs(triangles);
  const { minEdgeLength, thinEdgeCount } = checkThinFeatures(triangles);
  const boundingBox = computeBoundingBox(triangles);

  const geometryIssues: GeometryIssue[] = [];
  const printingRisks: PrintingRisk[] = [];

  // 几何完整性问题
  if (nonManifoldCount > 0) {
    geometryIssues.push({
      type: 'non_manifold',
      description: `发现 ${nonManifoldCount} 条非流形边（被3个或以上面片共享），模型可能存在几何错误`,
      count: nonManifoldCount,
    });
  }

  if (openBoundaryCount > 0) {
    geometryIssues.push({
      type: 'open_boundary',
      description: `发现 ${openBoundaryCount} 条开放边界（只被1个面片引用），模型存在空壳或孔洞`,
      count: openBoundaryCount,
    });
  }

  if (degenerateFaceCount > 0) {
    geometryIssues.push({
      type: 'degenerate_face',
      description: `发现 ${degenerateFaceCount} 个退化面片（面积接近零），可能导致渲染或切片异常`,
      count: degenerateFaceCount,
    });
  }

  if (inconsistentNormalCount > 0) {
    geometryIssues.push({
      type: 'inconsistent_normals',
      description: `发现 ${inconsistentNormalCount} 个面片法向量翻转（内外表面反向），可能影响打印外观`,
      count: inconsistentNormalCount,
    });
  }

  // 3D 打印风险
  if (severeOverhangCount > 0) {
    printingRisks.push({
      type: 'overhang',
      description: `发现 ${severeOverhangCount} 个严重悬空面（>45°），打印时需要支撑结构`,
      severity: 'high',
      count: severeOverhangCount,
    });
  }

  if (moderateOverhangCount > 0) {
    printingRisks.push({
      type: 'overhang',
      description: `发现 ${moderateOverhangCount} 个轻度悬空面（0°~45°），建议评估是否添加支撑`,
      severity: 'low',
      count: moderateOverhangCount,
    });
  }

  if (thinEdgeCount > 0) {
    const severity = minEdgeLength < MIN_WALL_THICKNESS_MM / 2 ? 'high' : 'medium';
    printingRisks.push({
      type: 'thin_wall',
      description: `发现 ${thinEdgeCount} 条薄壁/细小边（最短 ${minEdgeLength.toFixed(3)} mm，建议最小壁厚 ${MIN_WALL_THICKNESS_MM} mm）`,
      severity,
      count: thinEdgeCount,
    });
  } else if (minEdgeLength < MIN_WALL_THICKNESS_MM && minEdgeLength > 0) {
    printingRisks.push({
      type: 'small_feature',
      description: `模型最小特征尺寸约 ${minEdgeLength.toFixed(3)} mm，可能超出打印机精度极限`,
      severity: 'medium',
    });
  }

  const isValid =
    geometryIssues.filter((i) => i.type === 'non_manifold' || i.type === 'open_boundary').length ===
    0;

  const summary = buildSummary(triangles.length, geometryIssues, printingRisks, boundingBox);

  return {
    isValid,
    triangleCount: triangles.length,
    boundingBox,
    geometryIssues,
    printingRisks,
    summary,
  };
}

function buildSummary(
  triangleCount: number,
  geometryIssues: GeometryIssue[],
  printingRisks: PrintingRisk[],
  boundingBox: BoundingBox
): string {
  const parts: string[] = [];

  parts.push(
    `模型包含 ${triangleCount} 个面片，尺寸约 ${boundingBox.size.map((s) => s.toFixed(1)).join(' × ')} mm。`
  );

  if (geometryIssues.length === 0) {
    parts.push('几何完整性检查通过，未发现非流形或空壳问题。');
  } else {
    const issueDescriptions = geometryIssues.map((i) => i.description).join('；');
    parts.push(`几何问题：${issueDescriptions}。`);
  }

  if (printingRisks.length === 0) {
    parts.push('未检测到明显的 3D 打印风险。');
  } else {
    const highRisks = printingRisks.filter((r) => r.severity === 'high');
    const otherRisks = printingRisks.filter((r) => r.severity !== 'high');

    if (highRisks.length > 0) {
      parts.push(`高风险打印问题：${highRisks.map((r) => r.description).join('；')}。`);
    }
    if (otherRisks.length > 0) {
      parts.push(`其他打印建议：${otherRisks.map((r) => r.description).join('；')}。`);
    }
  }

  return parts.join(' ');
}
