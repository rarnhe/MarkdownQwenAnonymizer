# MarkdownQwenAnonymizer 双轨测试报告

- CI 时间（UTC）: 2026-11-13T07:11:09.241Z
- GitHub run: 43383513235
- Commit SHA: 5a7d1bd63841f410a99e3eff31943591799fda28

## GitHub Actions 与 test_report.md 阶段结果

| 阶段 | 状态 | 日志 |
|---|---|---|
| npm ci | **SUCCESS** | tests/output/npm-ci.log |
| TypeScript typecheck | **SUCCESS** | tests/output/typecheck.log |
| Anonymizer unit tests | **FAILURE** | tests/output/unit.log |
| Qwen GGUF download | **SUCCESS** | tests/output/download.log |
| Real llama-server startup | **SUCCESS** | tests/output/server-ready.log |
| Real Qwen GGUF integration | **SUCCESS** | tests/output/live.log |

## 失败项

### Anonymizer unit tests

~~~text
      at TestContext.<anonymous> (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/unit.test.ts:167:12)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at tests/unit.test.ts:243:1
✖ invalid map is rejected without modifying Markdown (2.706875ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Invalid \\.anonymize-map\\.json/. Input:
  
  "Error: Invalid .anonymize-map.json: SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)"
  
      at async TestContext.<anonymous> (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/unit.test.ts:255:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: Error: Invalid .anonymize-map.json: SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
        at MarkdownDirectoryAnonymizer.readExistingMap (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/src/core/processor.ts:71:25)
        at async MarkdownDirectoryAnonymizer.process (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/src/core/processor.ts:86:23)
        at async waitForActual (node:assert:646:5)
        at async strict.rejects (node:assert:769:25)
        at async TestContext.<anonymous> (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/unit.test.ts:255:5)
        at async Test.run (node:internal/test_runner/test:1409:7)
        at async Test.processPendingSubtests (node:internal/test_runner/test:974:7),
    expected: /Invalid \\.anonymize-map\\.json/,
    operator: 'rejects',
    diff: 'simple'
  }

~~~


## 模型与隐私说明

- 实际 GGUF 在 CI 时下载到 tests/，不提交为普通 Git 对象。
- 不上传 GGUF 权重或含真实值的 anonymize-map.json。
- 真实资料发布前仍必须人工核对遗漏实体。
