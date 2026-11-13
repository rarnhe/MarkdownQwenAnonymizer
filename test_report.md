# MarkdownQwenAnonymizer 双轨测试报告

- CI 时间（UTC）: 2026-11-13T18:14:15.372Z
- GitHub run: 43480606325
- Commit SHA: 7c6c9eb94fd6bdd9532aaf51e5304e7cb56e2db6

## GitHub Actions 与 test_report.md 阶段结果

| 阶段 | 状态 | 日志 |
|---|---|---|
| npm ci | **SUCCESS** | tests/output/npm-ci.log |
| TypeScript typecheck | **SUCCESS** | tests/output/typecheck.log |
| Anonymizer unit tests | **SUCCESS** | tests/output/unit.log |
| Standalone JXA builds | **SUCCESS** | tests/output/build.log |
| macOS JXA file/folder tests | **FAILURE** | tests/output/jxa.log |
| Qwen GGUF download | **SKIPPED** | tests/output/download.log |
| Real llama-server startup | **SKIPPED** | tests/output/server-ready.log |
| Real Qwen GGUF integration | **SKIPPED** | tests/output/live.log |

## 失败项

### macOS JXA file/folder tests

~~~text

> markdown-qwen-anonymizer@1.0.0 test:jxa
> tsx tests/run-jxa.ts

/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/dist/anonymizer.osascript.js: execution error: Error: Error: No Markdown files found (-2700)
Error: Command failed: /Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/dist/anonymizer.osascript.js /var/folders/h5/t85nd63d71x27_8gl5gw3l_w0000gn/T/jxa-anonymizer-CHR5CN/cases
/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/dist/anonymizer.osascript.js: execution error: Error: Error: No Markdown files found (-2700)

    at genericNodeError (node:internal/errors:986:15)
    at wrappedFn (node:internal/errors:540:14)
    at checkExecSyncError (node:child_process:943:11)
    at execFileSync (node:child_process:979:15)
    at execute (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/run-jxa.ts:25:16)
    at main (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/run-jxa.ts:71:21) {
  status: 1,
  signal: null,
  output: [
    null,
    '',
    '/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/dist/anonymizer.osascript.js: execution error: Error: Error: No Markdown files found (-2700)\n'
  ],
  pid: 1399,
  stdout: '',
  stderr: '/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/dist/anonymizer.osascript.js: execution error: Error: Error: No Markdown files found (-2700)\n'
}

~~~

### Qwen GGUF download

- 没有对应日志（阶段可能未启动）。

### Real llama-server startup

- 没有对应日志（阶段可能未启动）。

### Real Qwen GGUF integration

- 没有对应日志（阶段可能未启动）。


## 模型与隐私说明

- 实际 GGUF 在 CI 时下载到 tests/，不提交为普通 Git 对象。
- 不上传 GGUF 权重或含真实值的 sibling JSON mapping。
- 真实资料发布前仍必须人工核对遗漏实体。
