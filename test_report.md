# MarkdownQwenAnonymizer 双轨测试报告

- CI 时间（UTC）: 2026-11-13T03:34:11.771Z
- GitHub run: 43359016768
- Commit SHA: 8722f90707ef27f126def13e14a1bca430f7bada

## GitHub Actions 与 test_report.md 阶段结果

| 阶段 | 状态 | 日志 |
|---|---|---|
| npm ci | **SUCCESS** | tests/output/npm-ci.log |
| TypeScript typecheck | **FAILURE** | tests/output/typecheck.log |
| Anonymizer unit tests | **SUCCESS** | tests/output/unit.log |
| Qwen GGUF download | **SUCCESS** | tests/output/download.log |
| Real llama-server startup | **SUCCESS** | tests/output/server-ready.log |
| Real Qwen GGUF integration | **FAILURE** | tests/output/live.log |

## 失败项

### TypeScript typecheck

~~~text

> markdown-qwen-anonymizer@1.0.0 typecheck
> tsc --noEmit

src/core/processor.ts(128,80): error TS2554: Expected 0-1 arguments, but got 2.

~~~

### Real Qwen GGUF integration

~~~text

> markdown-qwen-anonymizer@1.0.0 test:live
> tsx tests/run-live.ts

[DOMException [TimeoutError]: The operation was aborted due to timeout]

~~~


## 模型与隐私说明

- 实际 GGUF 在 CI 时下载到 tests/，不提交为普通 Git 对象。
- 不上传 GGUF 权重或含真实值的 .anonymize_map.json。
- 真实资料发布前仍必须人工核对遗漏实体。
