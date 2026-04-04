/**
 * 测试：@提及绿色框中的代码是否进入代码区
 * 最简单的测试用例
 */

const testCases = [
  {
    name: '测试1：@实习生 + 最小化代码',
    input: '@实习生 生成一个立方体',
    expectedGreenBox: true,
    expectedCodeInjection: false, // 当前应该是false，因为代码没进入代码区
    description: '验证@实习生返回的代码是否进入代码编辑区'
  },
  {
    name: '测试2：@老师傅 + 代码修复',
    input: '@老师傅 修复这个错误：cube();',
    expectedGreenBox: true,
    expectedCodeInjection: false, // 当前应该是false
    description: '验证@老师傅返回的修复代码是否进入代码编辑区'
  },
  {
    name: '测试3：@产品经理 + 需求确认',
    input: '@产品经理 我想要一个参数化立方体',
    expectedGreenBox: true,
    expectedCodeInjection: false, // 产品经理通常不返回代码
    description: '产品经理应该只确认需求，不应该直接返回代码'
  }
];

async function runTest(testCase) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`▶ 运行: ${testCase.name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📝 输入: ${testCase.input}`);
  console.log(`📖 描述: ${testCase.description}`);

  try {
    // 发送请求到后端
    const response = await fetch('/api/parametric-chat/confirm-requirement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userInput: testCase.input,
        conversationHistory: [],
      }),
    });

    const result = await response.json();

    console.log(`\n✅ 响应状态: ${response.status}`);
    console.log(`✅ responderRole: ${result.responderRole}`);
    console.log(`\n📦 返回体结构检查:`);
    console.log(`  - pmResponse: ${result.pmResponse ? '✓ 有' : '✗ 无'}`);
    console.log(`  - openscadCode: ${result.openscadCode ? '✓ 有' : '✗ 无'}`);
    console.log(`  - parameters: ${result.parameters ? '✓ 有' : '✗ 无'}`);

    console.log(`\n🟢 绿色框内容(前50字):`);
    console.log(`  ${result.pmResponse?.substring(0, 50)}...`);

    if (result.openscadCode) {
      console.log(`\n💚 代码区内容(前50字):`);
      console.log(`  ${result.openscadCode.substring(0, 50)}...`);
    } else {
      console.log(`\n❌ 代码区: 为空 (这是问题!)`);
    }

    return {
      hasGreenBox: !!result.pmResponse,
      hasCodeInjection: !!result.openscadCode,
      responderRole: result.responderRole,
    };
  } catch (error) {
    console.error(`❌ 测试失败: ${error.message}`);
    return null;
  }
}

// 执行所有测试
async function runAllTests() {
  console.log(`\n\n🧪 测试套件: 绿色框代码注入`);
  console.log(`运行时间: ${new Date().toLocaleString('zh-CN')}`);

  const results = [];
  for (const testCase of testCases) {
    const result = await runTest(testCase);
    if (result) {
      results.push({
        testName: testCase.name,
        ...result,
      });
    }
  }

  // 总结
  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`📊 测试总结`);
  console.log(`${'='.repeat(60)}`);
  results.forEach((r, i) => {
    console.log(`\n测试 ${i + 1}: ${r.testName}`);
    console.log(`  绿色框: ${r.hasGreenBox ? '✓' : '✗'}`);
    console.log(`  代码区: ${r.hasCodeInjection ? '✓' : '✗'} ${!r.hasCodeInjection ? '← 问题!' : ''}`);
    console.log(`  角色: ${r.responderRole}`);
  });

  console.log(`\n⚠️  问题诊断:`);
  const codeInjectionFailures = results.filter(r => !r.hasCodeInjection);
  if (codeInjectionFailures.length > 0) {
    console.log(`  ❌ ${codeInjectionFailures.length}/${results.length} 个测试中代码没有进入代码编辑区`);
    console.log(`  💡 原因: /confirm-requirement 端点没有返回 openscadCode 字段`);
    console.log(`  🔧 解决方案: 需要修改后端的 handleMentionedRoute 来提取代码并返回`);
  }
}

// 如果在浏览器中运行
if (typeof window !== 'undefined') {
  window.runAllTests = runAllTests;
  console.log('✅ 测试已加载。在控制台运行: runAllTests()');
}

// 如果在Node.js中运行
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runAllTests, runTest };
}
