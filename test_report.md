# MarkdownQwenAnonymizer 双轨测试报告

- CI 时间（UTC）: 2026-11-13T08:30:37.903Z
- GitHub run: 43393325313
- Commit SHA: 1d5eaab1e480e6c1b62a04b94bbe655e71ec6595

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
  + '[许*茹]、[何**]、[何*]。[深圳腾*司]。2025年，1970年1月1日。\n'
  - '[许*茹]、[何*]、[何**]。[深圳腾*司]。2025年，1970年1月1日。\n'
  
      at TestContext.<anonymous> (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/masking.test.ts:146:12)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: '[许*茹]、[何**]、[何*]。[深圳腾*司]。2025年，1970年1月1日。\n',
    expected: '[许*茹]、[何*]、[何**]。[深圳腾*司]。2025年，1970年1月1日。\n',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/unit.test.ts:185:1
✖ longest-match single-pass mapping is reversible (1.036417ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /\[星\*司\]/. Input:
  
  '[李*]，[深圳星*司]，[110101************]，HT-2026-0001'
  
      at TestContext.<anonymous> (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/unit.test.ts:189:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: '[李*]，[深圳星*司]，[110101************]，HT-2026-0001',
    expected: /\[星\*司\]/,
    operator: 'match',
    diff: 'simple'
  }

~~~


## 模型与隐私说明

- 实际 GGUF 在 CI 时下载到 tests/，不提交为普通 Git 对象。
- 不上传 GGUF 权重或含真实值的 .anonymize-map.json。
- 真实资料发布前仍必须人工核对遗漏实体。
