# 首版路线

当前事实见 [STATUS](STATUS.md)，新会话从 [CONTINUITY](CONTINUITY.md) 开始。勾选只表示相应交付完成，不把设计当作功能。

- [x] 明确服务对象、学习过程与首版范围。
- [x] 保存四份产品设计基线和 12 类验收条款。
- [x] 按用户要求退役旧 demo，保留 Git 历史。
- [x] 选择扩展内工作台与侧栏，写明关闭、恢复和数据归属规则。
- [x] 用合成数据在 Chromium 验证同源存储、原生侧栏、后台重启、命令去重和多标签冲突。
- [x] 程序员任务 01：从 Chrome 155 稳定版官方扩展页面加载，验证工作台与原生侧栏最小闭环，保留[分层证据](verification/2026-10-13-prototype-acceptance-followup.md)。
- [x] 程序员任务 02：按 [RFC-01](superpowers/specs/2026-10-14-prototype-backup-restore-design.md)完成四表备份、非覆盖恢复、持久回执、数据库 1→2 加表及 Chromium/稳定版文件闭环；[分层验收](verification/2026-10-14-backup-restore.md)交回审查，不等于正式发布批准。
- [ ] 发布前补齐原 SC-04/08/09 的真实故障与来源边界，以及浏览器支持矩阵；任务 02 的模拟回滚、迁移单测和浏览器闭环不替代这些缺口。
- [ ] 核实站点/内容使用边界，验证一次题目、提交代码与判题准确关联。
- [x] [程序员任务 03](superpowers/plans/2026-10-25-programmer-03-submission-correlation.md)：来源核查与离线提交关联实验完成，[分层证据](verification/2026-10-25-submission-correlation.md)交回审查。真实准入仍 unresolved；不勾选上一项真实接入验收或 AC-06。
- [ ] 扩展到完整领域共享 schema、存储、正式备份版本和模型调用契约；原型 scope 只覆盖现有四张学习表。
- [ ] 准备固定教学场景，评估少量真实模型配置。
- [ ] 打通今日任务、力扣练习、求助、保存与后续安排。
- [ ] 审核首批 Python 内容，开展连续内测。

竞赛、社区、排名、云同步、账号、独立后端、自由生成变式、面试模拟与多站点均不进入当前切片。
