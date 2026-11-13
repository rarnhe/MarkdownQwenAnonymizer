# MarkdownQwenAnonymizer 双轨测试报告

- CI 时间（UTC）: 2026-11-13T18:04:29.625Z
- GitHub run: 43478572952
- Commit SHA: 7b697ff968bc1671fd6212b0b36f4435bbc0ca93

## GitHub Actions 与 test_report.md 阶段结果

| 阶段 | 状态 | 日志 |
|---|---|---|
| npm ci | **SUCCESS** | tests/output/npm-ci.log |
| TypeScript typecheck | **SUCCESS** | tests/output/typecheck.log |
| Anonymizer unit tests | **FAILURE** | tests/output/unit.log |
| Standalone JXA builds | **FAILURE** | tests/output/build.log |
| macOS JXA file/folder tests | **FAILURE** | tests/output/jxa.log |
| Qwen GGUF download | **SUCCESS** | tests/output/download.log |
| Real llama-server startup | **SUCCESS** | tests/output/server-ready.log |
| Real Qwen GGUF integration | **SUCCESS** | tests/output/live.log |

## 失败项

### Anonymizer unit tests

~~~text
      at node:internal/main/run_main_module:33:47
  
  Node.js v24.22.2
  
      at genericNodeError (node:internal/errors:986:15)
      at wrappedFn (node:internal/errors:540:14)
      at checkExecSyncError (node:child_process:943:11)
      at execFileSync (node:child_process:979:15)
      at TestContext.<anonymous> (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/jxa-build.test.ts:6:3)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.start (node:internal/test_runner/test:1262:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    status: 1,
    signal: null,
    output: [ null, <Buffer >, <Buffer 2f 55 73 65 72 73 2f 72 75 6e 6e 65 72 2f 77 6f 72 6b 2f 4d 61 72 6b 64 6f 77 6e 51 77 65 6e 41 6e 6f 6e 79 6d 69 7a 65 72 2f 4d 61 72 6b 64 6f 77 6e ... 622 more bytes> ],
    pid: 1330,
    stdout: <Buffer >,
    stderr: <Buffer 2f 55 73 65 72 73 2f 72 75 6e 6e 65 72 2f 77 6f 72 6b 2f 4d 61 72 6b 64 6f 77 6e 51 77 65 6e 41 6e 6f 6e 79 6d 69 7a 65 72 2f 4d 61 72 6b 64 6f 77 6e ... 622 more bytes>
  }

test at tests/masking.test.ts:123:1
✖ recursive Markdown uses a single reversible dictionary and leaves dates intact (20.506042ms)
  Error: ENOENT: no such file or directory, open '/var/folders/h5/t85nd63d71x27_8gl5gw3l_w0000gn/T/markdown-masking-nLIFEo/cases/.gitignore'
      at async open (node:internal/fs/promises:1345:25)
      at async Object.readFile (node:internal/fs/promises:2003:14)
      at async TestContext.<anonymous> (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/masking.test.ts:145:18)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    errno: -2,
    code: 'ENOENT',
    syscall: 'open',
    path: '/var/folders/h5/t85nd63d71x27_8gl5gw3l_w0000gn/T/markdown-masking-nLIFEo/cases/.gitignore'
  }

~~~

### Standalone JXA builds

~~~text

> markdown-qwen-anonymizer@1.0.0 build
> node build.js

/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/build.js:23
  footer:{js:
             

SyntaxError: Unexpected end of input
    at wrapSafe (node:internal/modules/cjs/loader:1861:18)
    at Module._compile (node:internal/modules/cjs/loader:1903:20)
    at Object..js (node:internal/modules/cjs/loader:2060:10)
    at Module.load (node:internal/modules/cjs/loader:1651:32)
    at Module._load (node:internal/modules/cjs/loader:1443:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:261:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47

Node.js v24.22.2

~~~

### macOS JXA file/folder tests

~~~text

> markdown-qwen-anonymizer@1.0.0 test:jxa
> tsx tests/run-jxa.ts

Error: ENOENT: no such file or directory, open 'dist/anonymizer.osascript.js'
    at async open (node:internal/fs/promises:1345:25)
    at async Object.readFile (node:internal/fs/promises:2003:14)
    at async main (/Users/runner/work/MarkdownQwenAnonymizer/MarkdownQwenAnonymizer/tests/run-jxa.ts:33:16) {
  errno: -2,
  code: 'ENOENT',
  syscall: 'open',
  path: 'dist/anonymizer.osascript.js'
}

~~~


## 模型与隐私说明

- 实际 GGUF 在 CI 时下载到 tests/，不提交为普通 Git 对象。
- 不上传 GGUF 权重或含真实值的 sibling JSON mapping。
- 真实资料发布前仍必须人工核对遗漏实体。
