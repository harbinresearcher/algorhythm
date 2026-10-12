# AlgoRhythm 路线图

以已验证的学习闭环为基线。勾选表示已经完成，未勾选不等于已授权开发。具体当前工作以 [STATUS.md](STATUS.md) 为准。

2026-10-12：新学习产品的设计基线与验证顺序见 [CONTINUITY](CONTINUITY.md)。下列阶段保留原型演进历史，不覆盖新规格中的首版范围，也不代表相关新能力已经完成。

## 第一阶段 / P0：本地 MVP

- [x] Vite + React 18 + TypeScript 本地应用
- [x] 文本或链接导入（Jina Reader 读取正文）
- [x] OpenAI 兼容 API 配置与分析请求
- [x] 固定 16 种模式，字段校验与可见错误
- [x] IndexedDB 题库、模式筛选与详情
- [x] 先回忆再揭示答案，FSRS 评分与持久化
- [x] 深色桌面与移动布局
- [x] 核心测试、构建与模拟 AI 浏览器闭环
- [x] README 与运行截图
- [x] MIT、协作模板、进度与架构文档、lint / format 脚本
- [ ] 用用户自己的 Key 验证真实题目分类质量

## 第二阶段 / P1：模式化增强

- [ ] 模式掌握度计算与薄弱模式推荐
- [ ] 学习统计、热力图与题单进度
- [ ] LeetCode 提交记录同步
- [ ] 牛客、洛谷等平台专用导入
- [ ] 评估本地题库备份与导出需求

## 第三阶段 / P2：面试训练

- [ ] 45 分钟限时、无提示模拟
- [ ] 口头表达训练
- [ ] AI 评分与面试报告

## 后续 / P3：多形态与同步

- [ ] 浏览器扩展，复用核心逻辑
- [ ] Tauri 桌面应用与 SQLite
- [ ] Supabase 云同步与账号设计

## 开源协作演进

- [x] 贡献指南、Issue / PR 模板、编辑器与格式配置
- [x] 社区健康文件：SECURITY.md、CODE_OF_CONDUCT.md、SUPPORT.md、CHANGELOG.md、CODEOWNERS
- [x] 公开仓库，启用密钥扫描与推送保护、Dependabot、CodeQL 代码扫描与私有漏洞报告
- [x] `main` 分支保护：要求 PR、禁止强推与删除
- [x] GitHub Actions 验证 lint / format:check / test / build；Dependabot 分组周更
- [ ] 发布版本时维护 CHANGELOG（0.1.0 已记录）
- [ ] 整理发布材料：社交预览图、GitHub Pages 项目页（按需）

仓库已于 2026-10-09 公开，采用 MIT 许可证。公开仓库不等于承诺支持范围：功能边界仍以 [STATUS.md](STATUS.md) 的“已知问题与边界”为准。


## 10 月 9 日导入修复

原题链接与题目描述二选一。有链接时，浏览器先通过 [Jina Reader](https://jina.ai/reader/) 获取公开网页正文，再发送到配置的 AI 服务；API Key 不发送给 Reader。网页可能受登录、反爬、网络和 Reader 限流影响，读取失败会提示，请清空链接后粘贴完整题干。模型必须明确确认完整算法题，拒绝无关内容；失败不会保存题目。导入成功和错误均显示可关闭的醒目浮层。此需求覆盖早期“不读取链接”的范围约定。

