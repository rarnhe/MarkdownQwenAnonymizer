# MarkdownQwenAnonymizer 双轨测试报告

- CI 时间（UTC）: 2026-11-14T00:47:42.028Z
- GitHub run: 43536211444
- Commit SHA: b62920eb3a60bda704534d4cfdff4bf0eaa681c8

## GitHub Actions 与 test_report.md 阶段结果

| 阶段 | 状态 | 日志 |
|---|---|---|
| npm ci | **SUCCESS** | tests/output/npm-ci.log |
| TypeScript typecheck | **SUCCESS** | tests/output/typecheck.log |
| Anonymizer unit tests | **SUCCESS** | tests/output/unit.log |
| Standalone JXA builds | **SUCCESS** | tests/output/build.log |
| macOS JXA file/folder tests | **SUCCESS** | tests/output/jxa.log |
| Qwen GGUF download | **SUCCESS** | tests/output/download.log |
| Real llama-server startup | **SUCCESS** | tests/output/server-ready.log |
| Real Qwen GGUF integration | **SUCCESS** | tests/output/live.log |

## 失败项

- 无，所有必须阶段成功。

## 模型与隐私说明

- 实际 GGUF 在 CI 时下载到 tests/，不提交为普通 Git 对象。
- 不上传 GGUF 权重或含真实值的 sibling JSON mapping。
- 真实资料发布前仍必须人工核对遗漏实体。
