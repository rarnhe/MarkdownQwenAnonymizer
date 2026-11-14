# MarkdownQwenAnonymizer

本地 Qwen GGUF / llama-server 法律 Markdown 可逆脱敏，支持 Node CLI 与 macOS JXA + Finder Automator 双产物。

## 使用

```bash
npm ci
python -m pip install 'huggingface_hub>=1,<2'
python tests/huggleface_downloader.py
brew install llama.cpp
llama-server -m tests/qwen2.5-0.5b-instruct-q4_0.gguf -ngl 0 -c 8192 -t 4 --host 127.0.0.1 --port 9931
```

另开终端：

```bash
npx tsx src/hosts/node.ts ./docs/sample.md
npx tsx src/hosts/node.ts ./docs/contracts
npm run build
./dist/anonymizer.osascript.js ./docs/sample.md
./dist/anonymizer.osascript.js ./docs/contracts
```

- 输入一个 `.md`/`.markdown` 文件，或包含 Markdown 文件的目录（仅目录模式递归）。
- Markdown **原位覆盖**；`「李*」`、`「深圳星*司」`、`「1380013****」` 等 `「...」` 掩码，不再使用中括号。
- **目录映射文件位于目录外同级**，例如 `/a/contracts/` → `/a/contracts.json`。单 Markdown `/a/case.md` → `/a/case.json`。遇到对应 JSON 则执行反脱敏并删除映射，不调用模型。
- 全目录共用一份全局实体映射、6,000 字符切片与 50 字符重叠，重复实体复用掩码，身份证/统一社会信用代码冲突时才露末位，普通合同编号、日期和金额不修改。
- `dist/anonymizer.osascript.js` 通过 macOS `osascript -l JavaScript` 执行，使用 Cocoa/Objective-C 文件系统与 Foundation NSTask + macOS 内置 curl 请求本地服务，运行时不需要 Node；编译期使用 esbuild。
- `dist/anonymizer.automator.js` 将源码复制到 Automator「快速操作」→「运行 JavaScript」，设置工作流程接收 Finder 的文件或文件夹；`run(input, parameters)` 接收**恰好一个**选中项并调用已在函数外初始化的引擎。
- 两个 JXA 产物均依赖**已启动**的本地 llama-server，模型不嵌入 JavaScript。

## 提取输出截断保护

Node 与 JXA 的实体提取请求均设置 `max_tokens: 2048`，并检查本地 llama-server 返回的 `finish_reason`。如果为 `length`，**直接报错，不解析或接受可能不完整的 JSON，也不会将不完整的映射应用到 Markdown**。Chunk 使用最多 6,000 个字符、相邻块重叠 50 字符；这是字符上限，不等于模型 tokens，上下文窗口仍须容纳输入、提示词及输出空间。

## 保护措施

同级 JSON 映射含有原始姓名、手机号和身份证号，使用 POSIX `0600` 权限。**该文件并不处在被处理文件夹内，不能依靠文件夹里的 `.gitignore` 防止提交**；应自行保护父目录、备份原件并确保 JSON 不进入 Git。原位替换会在相同目录暂存权限受控的回滚副本；进程强杀、断电或回滚失败可能要求人工恢复。若已经存在同名且无效的 JSON，程序会报错而非覆盖。

## 双轨测试

```bash
npm run typecheck
npm run test:unit
npm run build
npm run test:live
npm run test:jxa
```

GitHub Actions `push` 和 `pull_request` 使用 `macos-latest`，同时维护 `test_report.md`，任何阶段失败仍生成报告并使 job 失败。测试包括 osascript 单文件、目录及反脱敏、Automator 产物结构检查、真实模型集成。

GGUF 模型（约 429 MB）运行时下载，未提交 Git。

单请求默认超时 600 秒；Node/JXA 均支持 ANONYMIZER_TIMEOUT_MS（毫秒）。进度和耗时写入 stderr，不记录实体原文。

### 大目录恢复

识别结果以 SHA256 为键保存至同级 `文件夹名.progress.json`（单文件为 `文件名.progress.json`），权限 0600；包含明文实体，请勿分享或提交。相同命令自动复用已成功的分块和拆分片段。只有全部识别完成才生成最终映射并覆盖 Markdown，成功后删除进度文件。失败保留进度及原文。输入内容、路径、模型标识、语法或分块配置改变时拒绝复用，需移走旧进度文件再启动。

超时、输出截断、无效 JSON、429/5xx 会触发带 50 字符重叠的二分重试，最多三层；最小片段 750 字符，仍失败则终止并保留进度，不跳过实体。日志不记录模型输出原文。模型身份来自 `/v1/models`；若同名模型权重替换，请设置不同的 `ANONYMIZER_MODEL_REVISION`，避免复用旧识别结果。
