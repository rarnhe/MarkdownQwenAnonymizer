# MarkdownQwenAnonymizer

调用本地 `llama-server` / Qwen GGUF，对 Markdown 法律文档进行可逆脱敏。该仓库是**独立项目**，仅参考 `AnydocVisionExportMarkdown` 的模块分层与双轨 CI 报告方式；不包含 AnyDoc、JXA 或 WASM 源码。

## 架构

```text
src/
├── core/
│   ├── types.ts       # 抽取数据结构与接口
│   ├── grammar.ts     # GBNF 强控 JSON
│   ├── store.ts       # 跨 Chunk 全局去重 + 正则兜底
│   ├── chunks.ts      # 全目录合并切片：每块至多 20,000 字符、相邻块重叠 50 字符
│   ├── dates.ts       # 日期识别与原文保护
│   ├── numbers.ts     # 身份证/手机号/统一社会信用代码识别、金额保护
│   ├── mapping.ts     # 中文姓名/机构缩写、身份证/手机/信用代码掩码
│   └── processor.ts   # 递归处理、原位原子替换及失败回滚
├── ports/file-port.ts
├── adapters/
│   ├── node-fs.ts     # Node 文件系统
│   └── llama-server.ts# CoT 探测、GBNF、HTTP 400 重试
└── hosts/node.ts      # CLI 入口
tests/
├── fixtures/          # 虚构的 Markdown 测试材料（含合同附件）
├── huggleface_downloader.py
├── unit.test.ts
├── run-live.ts
└── summarize-ci.cjs
```

## 下载模型与启动服务

安装 Node.js 24+，在仓库根部运行：

```bash
npm ci
python -m pip install 'huggingface_hub>=1,<2'
python tests/huggleface_downloader.py
```

模型保存为 `tests/qwen2.5-0.5b-instruct-q4_0.gguf`。

macOS 安装并运行 `llama-server`（CPU 示例）：

```bash
brew install llama.cpp
llama-server -m tests/qwen2.5-0.5b-instruct-q4_0.gguf -ngl 0 -c 8192 -b 512 -ub 128 -t 4 --host 127.0.0.1 --port 9931
```

Windows 已安装 `llama-server` 时：

```powershell
llama-server -m ".\tests\qwen2.5-0.5b-instruct-q4_0.gguf" -ngl 0 -c 8192 -b 512 -ub 128 -t 4 --host 127.0.0.1 --port 9931
```

这是纯文本 GGUF，**不要将相同 GGUF 传给 `--mmproj`**；该参数是多模态投影文件参数。GPU 支持时可根据显存调整 `-ngl`。

另开终端，直接运行 TypeScript 入口（无需 npm 自定义脱敏脚本）：

```bash
npx tsx ./src/hosts/node.ts ./tests
```

程序递归读取输入目录的 `.md`、`.markdown`，**原位覆盖这些文件**，不生成额外输出文件夹。先递归收集并合并全部 Markdown 文本；合并后总长度不超过 20,000 字符时只生成 **1 个 chunk**，超过才按最多 20,000 字符、相邻块重叠 50 字符切片。因此两个短 Markdown 通常为 **1 个 chunk**，`fileCount` 仍为 2。整个目录使用一份隐藏的 `.anonymize-map.json` 可逆映射；姓名按首末字掩码、同姓重复时增加 `*`，较长的机构全名保留前置城市名（如 `深圳腾讯计算机有限公司 → [深圳腾*司]`），机构简称不带城市（如 `腾讯公司 → [腾*司]`）。身份证、手机号、统一社会信用代码都使用 `[...]` 包围的星号掩码；相同前缀发生冲突时增加星号而非 `-1`，合同编号、案号等普通编码保留原文。**GBNF 用来约束本地模型仅输出四数组的实体 JSON；星号掩码和中括号由 TypeScript 后处理生成，而非让模型生成或改写。**若发现 `.anonymize-map.json`，本次运行会跳过 LLM，使用映射递归恢复全部 `.md` / `.markdown` 文件，并在成功后删除映射文件；下一次运行才重新执行脱敏。恢复结果只包含动作、目录、映射路径和文件数，不显示无意义的 `chunkCount=0` 或零值分类统计。

### 隐私与错误处理

**输入目录根部自动创建或补充 `.gitignore`**，其中包含独立一行 `.anonymize-map.json`。已有 `.gitignore` 的其他规则保持不变；忽略规则在写入映射文件之前安装，失败时尽可能回滚。`.anonymize-map.json` 以明文保存敏感原值（在 POSIX 系统上使用 `0600` 权限），仅用于受控恢复，切勿公开。注意：`.gitignore` 不会自动取消已经由 Git 跟踪的文件，也不能防止 `git add -f` 强制添加。**原 Markdown 会被直接覆盖，强烈建议运行前自行备份或在 Git 中提交原稿。** 全部模型抽取和替换文本预生成成功后才写入映射和执行原位替换；采用同目录临时文件原子重命名，运行中保留权限为 `0600` 的临时原文副本用于回滚；出错时尝试恢复，若回滚不完整则保留备份并报错，需要手动处理。系统断电、进程强杀等极端情况不能保证跨文件原子性。小模型仍可能漏识别，发布前需要人工复查。

## 双轨测试

```bash
npm run typecheck
npm run test:unit
npm run test:live   # 需要本地 9931 端口的 llama-server
```

`.github/workflows/test.yml` 在 `macos-latest` 上执行静态检查、单元测试、官方 GGUF 下载、真实 llama-server 与端到端测试。每次运行生成 `test_report.md` 并上传日志，无论成功失败都会记录状态；功能分支 push 会自动写回报告，忽略仅报告变更防止 CI 循环；任意必要步骤失败则整个 job 失败。

### 模型权重为何不直接纳入 Git

官方 Qwen Q4_0 GGUF 约 429 MB，超过 GitHub 普通 Git 文件的 100 MB 限制。此仓库提交官方下载器并将模型自动下载到 `tests/`，**并未把真实 429 MB 二进制提交到 Git**。如果必须版本控制该文件，则需要配置 Git LFS、上传真实 LFS 对象并确保有足够额度；单独提交 LFS 指针不能代替实际权重。

测试 Markdown 使用虚构身份及号码，供功能验证，不能代表隐私合规认证。

> **命令说明**：`tsc` 是 TypeScript 编译器，不会执行 `.ts`；这里使用已安装的 `tsx` 直接运行入口。也可以改用 `npm exec -- tsx ./src/hosts/node.ts ./tests`。
