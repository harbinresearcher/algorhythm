# 架构入口

当前没有应用代码。旧 demo 已退役，新设计以以下文件为准：

- [领域与共享契约](superpowers/specs/2026-10-12-v1-domain-contracts-design.md)
- [教练与学习安排](superpowers/specs/2026-10-12-v1-coach-scheduling-design.md)
- [存储与力扣接入](superpowers/specs/2026-10-12-v1-storage-integration-design.md)
- [验收与发布](superpowers/specs/2026-10-12-v1-acceptance-release-design.md)
- [扩展内工作台与侧栏](superpowers/specs/2026-10-12-extension-workspace-design.md)

首版部署选择：完整工作台与侧栏均为同一 Chrome 扩展中的页面。应用核心不依赖 UI，扩展后台负责命令校验及数据库写入，数据保存在扩展来源的 IndexedDB。力扣内容脚本仅提供授权观察，不持有 Key 或写入权限。

理由：关闭主页面后仍可保存，避免首版同时维护网站数据库、扩展数据库和双向同步。

技术路线保留 React、TypeScript、Vite、Tailwind、Dexie 与 ts-fsrs，具体版本和依赖在技术验证时选择并锁定。此处是设计选择，不是已经搭建的工程。

旧架构只在 [退役记录](DEMO-RETIREMENT.md) 指向的历史版本中追溯。
