import {
  parseSTL,
  checkGeometry,
  GeometryCheckResult,
} from '../geometry-checker';

// -----------------------------------------------------------------------
// 辅助函数：生成 STL 二进制数据（单个三角面片）
// -----------------------------------------------------------------------

function writeFloat32LE(buf: Buffer, offset: number, value: number): void {
  buf.writeFloatLE(value, offset);
}

function buildBinarySTL(triangles: Array<{
  normal: [number, number, number];
  v1: [number, number, number];
  v2: [number, number, number];
  v3: [number, number, number];
}>): Buffer {
  // 80字节头 + 4字节三角面数 + 每面50字节
  const buf = Buffer.alloc(84 + triangles.length * 50, 0);
  buf.writeUInt32LE(triangles.length, 80);

  for (let i = 0; i < triangles.length; i++) {
    const { normal, v1, v2, v3 } = triangles[i];
    const base = 84 + i * 50;
    [normal, v1, v2, v3].forEach((vec, vi) => {
      const offset = base + vi * 12;
      writeFloat32LE(buf, offset, vec[0]);
      writeFloat32LE(buf, offset + 4, vec[1]);
      writeFloat32LE(buf, offset + 8, vec[2]);
    });
    // attribute byte count (2 bytes, already 0)
  }
  return buf;
}

/** 构建一个封闭的立方体 STL（12个三角面片） */
function buildCubeSTL(size = 10): Buffer {
  const s = size;
  // 6个面，每面2个三角形 = 12个三角面片
  const triangles: Array<{
    normal: [number, number, number];
    v1: [number, number, number];
    v2: [number, number, number];
    v3: [number, number, number];
  }> = [
    // Bottom (-Z)
    { normal: [0, 0, -1], v1: [0, 0, 0], v2: [s, 0, 0], v3: [s, s, 0] },
    { normal: [0, 0, -1], v1: [0, 0, 0], v2: [s, s, 0], v3: [0, s, 0] },
    // Top (+Z)
    { normal: [0, 0, 1], v1: [0, 0, s], v2: [s, s, s], v3: [s, 0, s] },
    { normal: [0, 0, 1], v1: [0, 0, s], v2: [0, s, s], v3: [s, s, s] },
    // Front (-Y)
    { normal: [0, -1, 0], v1: [0, 0, 0], v2: [s, 0, s], v3: [s, 0, 0] },
    { normal: [0, -1, 0], v1: [0, 0, 0], v2: [0, 0, s], v3: [s, 0, s] },
    // Back (+Y)
    { normal: [0, 1, 0], v1: [0, s, 0], v2: [s, s, 0], v3: [s, s, s] },
    { normal: [0, 1, 0], v1: [0, s, 0], v2: [s, s, s], v3: [0, s, s] },
    // Left (-X)
    { normal: [-1, 0, 0], v1: [0, 0, 0], v2: [0, s, 0], v3: [0, s, s] },
    { normal: [-1, 0, 0], v1: [0, 0, 0], v2: [0, s, s], v3: [0, 0, s] },
    // Right (+X)
    { normal: [1, 0, 0], v1: [s, 0, 0], v2: [s, s, s], v3: [s, s, 0] },
    { normal: [1, 0, 0], v1: [s, 0, 0], v2: [s, 0, s], v3: [s, s, s] },
  ];
  return buildBinarySTL(triangles);
}

/** 构建一个有孔洞（开放边界）的 STL——单个三角面片 */
function buildOpenMeshSTL(): Buffer {
  return buildBinarySTL([
    { normal: [0, 0, 1], v1: [0, 0, 0], v2: [1, 0, 0], v3: [0.5, 1, 0] },
  ]);
}

/** 构建包含退化面（共线顶点）的 STL */
function buildDegenerateFaceSTL(): Buffer {
  // v1, v2, v3 共线 → 面积为 0
  return buildBinarySTL([
    { normal: [0, 0, 1], v1: [0, 0, 0], v2: [1, 0, 0], v3: [2, 0, 0] },
  ]);
}

/** 构建翻转法向量的 STL */
function buildFlippedNormalSTL(): Buffer {
  // 法向量 [0,0,-1]，但顶点顺序实际计算出 [0,0,+1]
  return buildBinarySTL([
    { normal: [0, 0, -1], v1: [0, 0, 0], v2: [1, 0, 0], v3: [0.5, 1, 0] },
    // 补充另一个正确面保持非空模型
    { normal: [0, 0, 1], v1: [0, 0, 0], v2: [0.5, 1, 0], v3: [1, 0, 0] },
  ]);
}

/** 构建有悬空面的 STL（面朝下 normal.z < -0.707） */
function buildOverhangSTL(): Buffer {
  // 法向量指向 -Z (悬空超过45°)
  return buildBinarySTL([
    { normal: [0, 0, -1], v1: [0, 0, 5], v2: [1, 0, 5], v3: [0.5, 1, 5] },
    { normal: [0, 0, 1], v1: [0, 0, 0], v2: [0.5, 1, 0], v3: [1, 0, 0] },
  ]);
}

/** 构建有薄壁边的 STL（最短边 < 0.8mm） */
function buildThinWallSTL(): Buffer {
  const tinyOffset = 0.3; // mm，小于 MIN_WALL_THICKNESS_MM = 0.8
  return buildBinarySTL([
    { normal: [0, 0, 1], v1: [0, 0, 0], v2: [tinyOffset, 0, 0], v3: [0, tinyOffset, 0] },
    { normal: [0, 0, -1], v1: [0, 0, 0], v2: [0, tinyOffset, 0], v3: [tinyOffset, 0, 0] },
  ]);
}

// -----------------------------------------------------------------------
// 测试套件
// -----------------------------------------------------------------------

describe('parseSTL', () => {
  test('解析空缓冲区返回空数组', () => {
    const result = parseSTL(Buffer.alloc(0));
    expect(result).toEqual([]);
  });

  test('解析长度不足80字节的缓冲区返回空数组', () => {
    const result = parseSTL(Buffer.alloc(50));
    expect(result).toEqual([]);
  });

  test('解析含1个三角面的二进制 STL', () => {
    const stl = buildBinarySTL([
      { normal: [0, 0, 1], v1: [0, 0, 0], v2: [1, 0, 0], v3: [0.5, 1, 0] },
    ]);
    const triangles = parseSTL(stl);
    expect(triangles).toHaveLength(1);
    expect(triangles[0].normal[2]).toBeCloseTo(1, 3);
    expect(triangles[0].v1[0]).toBeCloseTo(0, 3);
    expect(triangles[0].v2[0]).toBeCloseTo(1, 3);
  });

  test('解析包含12个三角面的立方体 STL', () => {
    const stl = buildCubeSTL(10);
    const triangles = parseSTL(stl);
    expect(triangles).toHaveLength(12);
  });

  test('解析 ASCII STL', () => {
    const ascii = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0.5 1 0
    endloop
  endfacet
endsolid test`;
    const buf = Buffer.from(ascii, 'utf-8');
    const triangles = parseSTL(buf);
    expect(triangles).toHaveLength(1);
    expect(triangles[0].normal[2]).toBeCloseTo(1, 3);
  });
});

describe('checkGeometry - 立方体（有效闭合网格）', () => {
  let result: GeometryCheckResult;

  beforeAll(() => {
    result = checkGeometry(buildCubeSTL(10));
  });

  test('三角面数量应为12', () => {
    expect(result.triangleCount).toBe(12);
  });

  test('包围盒尺寸约为 10×10×10 mm', () => {
    expect(result.boundingBox.size[0]).toBeCloseTo(10, 1);
    expect(result.boundingBox.size[1]).toBeCloseTo(10, 1);
    expect(result.boundingBox.size[2]).toBeCloseTo(10, 1);
  });

  test('几何完整性检查：无非流形或开放边界问题', () => {
    const badIssues = result.geometryIssues.filter(
      (i) => i.type === 'non_manifold' || i.type === 'open_boundary'
    );
    expect(badIssues).toHaveLength(0);
  });

  test('isValid 应为 true', () => {
    expect(result.isValid).toBe(true);
  });

  test('summary 应包含三角面数量信息', () => {
    expect(result.summary).toContain('12');
  });
});

describe('checkGeometry - 开放网格（单三角面，有边界）', () => {
  let result: GeometryCheckResult;

  beforeAll(() => {
    result = checkGeometry(buildOpenMeshSTL());
  });

  test('isValid 应为 false（开放边界）', () => {
    expect(result.isValid).toBe(false);
  });

  test('几何问题应包含 open_boundary', () => {
    const boundaryIssue = result.geometryIssues.find((i) => i.type === 'open_boundary');
    expect(boundaryIssue).toBeDefined();
    expect(boundaryIssue!.count).toBeGreaterThan(0);
  });
});

describe('checkGeometry - 退化面', () => {
  let result: GeometryCheckResult;

  beforeAll(() => {
    result = checkGeometry(buildDegenerateFaceSTL());
  });

  test('应检测到退化面', () => {
    const issue = result.geometryIssues.find((i) => i.type === 'degenerate_face');
    expect(issue).toBeDefined();
    expect(issue!.count).toBeGreaterThan(0);
  });
});

describe('checkGeometry - 翻转法向量', () => {
  let result: GeometryCheckResult;

  beforeAll(() => {
    result = checkGeometry(buildFlippedNormalSTL());
  });

  test('应检测到不一致法向量', () => {
    const issue = result.geometryIssues.find((i) => i.type === 'inconsistent_normals');
    expect(issue).toBeDefined();
    expect(issue!.count).toBeGreaterThan(0);
  });
});

describe('checkGeometry - 悬空检测', () => {
  let result: GeometryCheckResult;

  beforeAll(() => {
    result = checkGeometry(buildOverhangSTL());
  });

  test('应检测到悬空风险', () => {
    const risk = result.printingRisks.find((r) => r.type === 'overhang');
    expect(risk).toBeDefined();
  });

  test('严重悬空应标记为 high 风险', () => {
    const highRisk = result.printingRisks.find(
      (r) => r.type === 'overhang' && r.severity === 'high'
    );
    expect(highRisk).toBeDefined();
  });
});

describe('checkGeometry - 薄壁检测', () => {
  let result: GeometryCheckResult;

  beforeAll(() => {
    result = checkGeometry(buildThinWallSTL());
  });

  test('应检测到薄壁风险', () => {
    const risk = result.printingRisks.find(
      (r) => r.type === 'thin_wall' || r.type === 'small_feature'
    );
    expect(risk).toBeDefined();
  });
});

describe('checkGeometry - 空缓冲区', () => {
  test('应返回 isValid=false 并包含描述错误', () => {
    const result = checkGeometry(Buffer.alloc(0));
    expect(result.isValid).toBe(false);
    expect(result.triangleCount).toBe(0);
  });
});
