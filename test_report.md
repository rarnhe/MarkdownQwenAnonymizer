# MarkdownQwenAnonymizer 双轨测试报告

- CI 时间（UTC）: 2026-11-09T08:07:09.586Z
- GitHub run: 42582931947
- Commit SHA: de464aff7e821788e8ade175c11a985ebef4cfc2

## GitHub Actions 与 test_report.md 阶段结果

| 阶段 | 状态 | 日志 |
|---|---|---|
| npm ci | **SUCCESS** | tests/output/npm-ci.log |
| TypeScript typecheck | **SUCCESS** | tests/output/typecheck.log |
| Anonymizer unit tests | **SUCCESS** | tests/output/unit.log |
| Qwen GGUF download | **SUCCESS** | tests/output/download.log |
| Real llama-server startup | **SUCCESS** | tests/output/server-ready.log |
| Real Qwen GGUF integration | **FAILURE** | tests/output/live.log |

## 失败项

### Real Qwen GGUF integration

~~~text

> markdown-qwen-anonymizer@1.0.0 test:live
> tsx tests/run-live.ts

SyntaxError: Unterminated string in JSON at position 636 (line 5 column 535)
    at JSON.parse (<anonymous>)
    at parseEntities (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/src/adapters/llama-server.ts:6:29)
    at LlamaServerClient.extractEntitiesFromChunk (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/src/adapters/llama-server.ts:79:12)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async MarkdownDirectoryAnonymizer.process (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/src/core/processor.ts:45:27)
    at async main (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/run-live.ts:20:18)

~~~


## 模型与隐私说明

- 实际 GGUF 在 CI 时下载到 tests/，不提交为普通 Git 对象。
- 不上传 GGUF 权重或含真实值的 .anonymize_map.json。
- 真实资料发布前仍必须人工核对遗漏实体。
