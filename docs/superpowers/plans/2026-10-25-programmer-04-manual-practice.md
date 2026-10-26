# 程序员任务 04：手动建题、练习与完整备份

> **For agentic workers:** 使用 executing-plans 顺序实施。应用实现交编码会话；总架构只定义与审查。本任务不授权合并任何 PR。

**Goal:** 用户可记录自己正在练习的题，在既有两端续写，并完整备份恢复。

**Architecture:** 复用现有四表、动作事务和工作台/侧栏，扩展严格来源 union；在线协议 v2 与历史 v1 回放分开；默认备份 v2、继续导入 v1。

**Tech Stack:** 现有 React、TypeScript、Dexie、Zod、Vitest、Playwright，不增加依赖或权限。

## 入口与范围

先读 AGENTS、CONTINUITY、STATUS，再读 [RFC-03](../specs/2026-10-25-manual-practice-design.md) M-01 至 M-06。任务 02 的原子恢复、任务 03 的合成来源边界继续有效。不必读全部历史聊天。

独立分支 `codex/task-04-manual-practice`，从包含本任务定义的提交建立独立工作树。定义 PR 尚未合并时暂以该分支为 base，已合并时从最新 main 开始。不要在总架构或程序员旧工作树直接改动。

主要改动位置：

- `apps/extension/src/shared/protocol.ts`：在线 v2、manual 来源、startManual。
- 新增 `apps/extension/src/shared/legacy-protocol.ts`：冻结 v1 命令及相关合成约束，仅供历史回放；不新增宽松兜底。
- 新增 `apps/extension/src/shared/manual-problem.ts`：标题/链接规范化与校验单源函数，核心和 UI 复用，不做网络访问。
- `apps/extension/src/core/store.ts`：startManual 原子写入、按快照来源生成事件；表和索引不变。
- `apps/extension/src/shared/backup.ts`、`src/core/backup.ts`、`src/core/backup-handler.ts`、`src/client/backup.ts`：显式 v1/v2 分派和同源响应类型，保留原事务和摘要规则。
- `apps/extension/src/ui/main.tsx`、新增 `src/ui/ManualProblemForm.tsx`：表单、真实快照标题和来源展示；`src/ui/BackupPanel.tsx` 适配格式版本预览。只按实际需要修改 `style.css`、客户端和后台分派，不重做 UI。
- 新增 `tests/manual-practice.test.ts`、`tests/backup-v2.test.ts`、`tests/fixtures/backup-v2.json`、`scripts/manual-browser-check.mjs`；更新受版本影响的原测试，保留冻结 v1 fixture。
- `apps/extension/package.json` 仅新增 `check:manual-browser` 脚本；允许 manifest 更新版本/说明文字，禁止改 permissions、CSP、content_scripts 或 host 权限。
- README、ARCHITECTURE、ROADMAP、STATUS、CONTINUITY 及新增 `docs/verification/2026-10-25-manual-practice.md`，同步实际结果。

## 第一步：基线与失败证据

- [ ] 保存当前 head、状态及基线 `npm test`、`npm run build` 输出；应包含原 272 项，不从历史日志复制结果。
- [ ] 按 MP-01/02 为现有 Store.handle 添加 startManual 行为用例。输入使用合法顶层工作台 sender，原型 envelope 中 protocolVersion 改为 2，新的 actionId、sessionId、problemSnapshotId，title=`我的数组练习`，url=null。期望 committed、problemKey=manual、revision=0、四表各新增一行、来源对应 manual。保存实现前失败输出。
- [ ] 增加同 actionId 再发相同输入只返回原回执；改 title 后返回 ACTION_COLLISION；最后回执写入故障时四表无变化的行为反例。
- [ ] 为 title 空白/201 字符、HTTP、伪造域名、userinfo、端口、编码路径、其他路径、query/hash 的清理建立逐项用例。规范化后的 URL 例：`https://leetcode.cn/problems/two-sum/description/?x=1#part` → `https://leetcode.cn/problems/two-sum/`。不得通过访问 URL 验证。

## 第二步：核心契约与记录

- [ ] 实现 RFC M-02/M-03。先冻结旧 schema，再修改在线版本；禁止批量替换所有版本字面量。
- [ ] 新增 pure `normalizeManualProblem(input: { title: string; url: string }): { title: string; url: string | null }`；失败抛固定 `INVALID_TITLE` 或 `INVALID_URL` 错误，不附原输入。空链接转 null。在线命令 schema 只接收规范结果。
- [ ] startManual 复用既有幂等、来源验证和事务，不新建第二套写入层。原动作在 manual 会话中产生 manual-workspace 事件；legacy 事实不变。
- [ ] 按 MP-02/06 验证旧库继续练习、混合读取、历史回执查询和跨版本消息拒绝；错误保留用户内容、不删除数据库。

## 第三步：先完成备份兼容，再开放界面

- [ ] 新增失败用例：旧 v1 fixture 导入/查询；混合四表导出 v2；v2 manual 来源冒充 synthetic、快照标题与 startManual fingerprint 不同、事件来源不符均拒绝。
- [ ] 按 M-04 实现 formatVersion/scope 精确分派。legacy v1 schema 不接受 manual 或 v2 动作；v2 允许旧事实，但不修改旧 fingerprint 协议版本。
- [ ] 继续沿用旧摘要算法，在转换前对原格式算摘要；跨实例仅改 extensionId。不同版本复用 backupId 的摘要碰撞不可覆盖原回执。
- [ ] 覆盖五表原子回滚、跨文件关系冲突、重复导入后续练不回退、v1/v2 指纹跨扩展恢复、未知结果先查回执。对照 MP-07/08/09。
- [ ] 运行完整单测和构建，通过后才把建题入口接入 UI。禁止先让用户写入不能导出的新记录。

## 第四步：两端最小闭环

- [ ] 表单仅标题和可选链接，字段说明和来源标识按 M-01/M-05；确认前 flush 当前草稿，失败保留表单且不创建新会话。
- [ ] 复用当前互斥和未知结果恢复，不重复点击生成新 actionId；表单取消不写库。成功后进入已确认会话。
- [ ] 会话列表、题目区从快照读标题，移除 manual 路径对 SYNTHETIC_PROBLEMS 的直接索引；两道合成演示继续可用。
- [ ] 标题与内容纯文本渲染，原题链接使用安全新标签属性，未链接场景也能完整记录。侧栏只增加必要来源展示，不放第二套建题入口。
- [ ] 查看桌面、360px 侧栏截图；键盘完成表单、取消、确认、导航和尝试记录。只修本轮问题。

## 第五步：验收与交付

- [ ] 根目录文档检查与差异检查，应用目录 `npm test`、`npm run build`，新旧用例分别统计。
- [ ] 原型 `npm run check:browser`、备份 `npm run check:backup-browser` 和新增 `npm run check:manual-browser`。脚本按需要显式兼容新协议；不能删掉旧版本导入断言。
- [ ] Chrome 稳定版独立临时配置实际建题→两端编辑→关闭工作台→恢复→下载→另一配置恢复→续写；不使用个人登录档案，不访问题目网站、不自动提交。
- [ ] Chromium 验证冲突、迟到、未知回执、表单失败、键盘与窄屏；浏览器故障注入和真实故障分开记录。版本不匹配可用受控旧页面消息验证，不需要删除或重装用户扩展。
- [ ] 备份采用合成自建记录做测试，比较恢复后的来源、标题、链接、尝试、动作及草稿；个人学习记录不可提交。
- [ ] 按 MP-01 至 MP-10 记录证据、版本、未测边界，更新交接与 README。报告本轮实际测试数，不硬凑预定数。
- [ ] 提交、推送独立 PR，等适用 CI 完成后交回总架构。完成即停止；不合并、不接采集/模型/FSRS、不自动开始任务 05。

## 完成标准

用户能保存自己的题而非只试两道演示题，两端续练与完整恢复均有实际浏览器证据。未覆盖的真实配额、进程中途终止和完整支持矩阵继续显式保留。该任务仍不是学习效果验收或正式发布。
