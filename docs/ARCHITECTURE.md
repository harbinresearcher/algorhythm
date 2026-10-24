# 架构入口

旧 demo 已退役。`apps/extension` 是按新设计编写的合成数据原型，产品设计以以下文件为准：

- [领域与共享契约](superpowers/specs/2026-10-12-v1-domain-contracts-design.md)
- [教练与学习安排](superpowers/specs/2026-10-12-v1-coach-scheduling-design.md)
- [存储与力扣接入](superpowers/specs/2026-10-12-v1-storage-integration-design.md)
- [验收与发布](superpowers/specs/2026-10-12-v1-acceptance-release-design.md)
- [扩展内工作台与侧栏](superpowers/specs/2026-10-12-extension-workspace-design.md)

首版部署选择：完整工作台与侧栏均为同一 Chrome 扩展中的页面。应用核心不依赖 UI，扩展后台负责命令校验及数据库写入，数据保存在扩展来源的 IndexedDB。力扣内容脚本仅提供授权观察，不持有 Key 或写入权限。

理由：关闭主页面后仍可保存，避免首版同时维护网站数据库、扩展数据库和双向同步。

当前原型使用 React 18、TypeScript、Vite、Dexie、Zod，版本固定在 package-lock 中。简单界面使用本地 CSS；Tailwind 与 ts-fsrs 不因旧技术列表而提前安装，后续页面与复习功能需要时再引入。

```text
[工作台 / 侧栏] ─── client/draft + transport ─── Chrome runtime
                                                      │
                                      background ─── core/store
                                                      │
                                    sessions / problems / events / actions
```

- `src/shared/protocol.ts`：严格 schema、由 schema 推导的类型、两道合成题。
- `src/core/store.ts`：来源/权限、协议版本、题目引用、状态、revision；一个事务内记录事实和原回执。核心无 React 或 chrome 全局依赖。
- `src/client/draft.ts`：编辑代次、500ms 保存、串行确认、保留失败内容。
- `src/client/transport.ts`：响应校验、5 秒超时、先查询丢失回执；写请求不自动重发。
- `src/background.ts`：Chrome sender 来源、同步注册监听；工作台关闭与后台休眠不改变数据归属。

协议 v1 只覆盖此切片。schema 1 新数据库名为 `algorhythm-prototype-v1`，不读旧 demo 数据。会话保存当前草稿，事件保留历史事实，actions 保存请求指纹与原回执。诊断仅存合法动作 ID、错误码和时间；原始文本不进诊断。原型没有账号、模型 Key 或外部网络权限。

当前 read 返回整个原型快照，适合两道合成题验证；正式学习记录增长前需增加分页、索引与保留策略。完整备份、迁移和内容采集未包含在此切片。来源判定只接受两个扩展页面；未来 content script 应另建窄权限协议，不扩大现有白名单。

旧架构只在 [退役记录](DEMO-RETIREMENT.md) 指向的历史版本中追溯。
