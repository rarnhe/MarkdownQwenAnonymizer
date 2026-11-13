# MarkdownQwenAnonymizer 双轨测试报告

- CI 时间（UTC）: 2026-11-13T03:41:07.721Z
- GitHub run: 43360157910
- Commit SHA: df8e0ab2d2ab056b9b5a7e6c96ef25838a53da0b

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

[DOMException [TimeoutError]: The operation was aborted due to timeout]

~~~


## 模型与隐私说明

- 实际 GGUF 在 CI 时下载到 tests/，不提交为普通 Git 对象。
- 不上传 GGUF 权重或含真实值的 anonymize-map.json。
- 真实资料发布前仍必须人工核对遗漏实体。
