# AlgoRhythm 架构

纯前端、本地 Web App。没有后端、账号或云存储。原题链接由 Jina Reader 读取，题目正文发送到用户配置的外部 AI 服务；AI Key 不发送给 Reader。

## 技术栈

- React 18 + TypeScript：三个页面与设置窗口。
- Vite 6 + Tailwind 4：开发、构建和样式。
- Dexie + dexie-react-hooks：IndexedDB 持久化与响应式题库。
- ts-fsrs：默认参数与 enable_fuzz 排期。
- Vitest + fake-indexeddb：核心边界和存储一致性测试。
- ESLint flat config + Prettier：代码与格式检查。

精确依赖版本由 package-lock.json 固定。

## 目录

```text
src/
├── main.tsx / App.tsx       入口、导航与存储错误边界
├── patterns.ts             16 个固定模式与骨架
├── types.ts                题目、分析结果和配置类型
├── ai.ts                   Prompt、HTTP 请求、校验、AI 配置
├── source.ts               原题链接校验与 Jina Reader 正文读取
├── backup.ts               白名单导出、解析校验与事务恢复
├── db.ts                   存储、到期查询、评分事务
├── fsrs.ts                 新卡与评分排期
├── logger.ts               不包含个人数据的动作日志
├── components/             分析展示与 AI 设置
└── pages/                  导入、题库、复习
tests/core.test.ts          核心行为验证
docs/                      进度、路线、架构与历史决策
.github/                   Issue 与 PR 模板
```

## 核心模块

`patterns` 是 AI 可选模式的唯一列表，ID 固定。`ai` 接收文本与配置，返回已校验结果或可见错误，不负责写题库。`db` 负责 CRUD 和评分一致性，`fsrs` 只负责算法排期。四个模块不依赖 React，方便以后复用；当前不增加单独 core 包或多包工程。

UI 通过存储模块读取题目。题库使用响应式查询；复习队列是进入本轮时的快照，避免分钟学习步骤立即反复插入题目。

## 数据流

```text
[学习闭环] ──┬── 导入 ──┬── 手动题干 → AI 请求 → 字段校验
             │          └── 新卡片 → IndexedDB
             ├── 题库 ───── 模式筛选 → 题干与分析
             └── 复习 ──┬── 到期快照 → 独立回忆 → 揭示
                        └── 评分 → FSRS → 事务保存 → 切题
```

评分事务重新读取当前记录，对照 updatedAt 与卡片 reps。过期快照不覆盖其他页面的更新。UI 同步锁防重复点击，数据库事务防并发写入；这不等同于跨浏览器或云端同步。

## 数据位置与边界

- IndexedDB `algorhythm` / `problems`：题干、标签、分析、卡片和时间戳；`fsrsCard.due` 使用 Date 索引。
- localStorage `algorhythm.ai.v1`：API Key、Base URL、Model。2026-10-10 更名前为 `companion.ai.v1`，更名后不读取旧键，需要重新填写 AI 设置。
- 请求：`${baseUrl}/chat/completions`，发送题目正文和约束 Prompt；有链接时先通过 source.ts 请求 Jina Reader。

AI 结果不能视为标准答案；非法 JSON 不入库，字段默认值带警告。密钥未加密，清除站点数据会丢题库，不同访问地址的数据隔离。题库提供 JSON 备份与恢复；没有云同步、复习日志表或模式掌握度统计，不把未来模块写成已有能力。

备份链路：完整题库 → 白名单 JSON（不含 AI 设置）→ 校验并恢复卡片 Date → 只读预览 → skip / overwrite → 单事务写入。写入时重新读取实际 ID；保留卡片排期，不重新调度。


## 10 月 9 日导入修复

原题链接与题目描述二选一。有链接时，浏览器先通过 [Jina Reader](https://jina.ai/reader/) 获取公开网页正文，再发送到配置的 AI 服务；API Key 不发送给 Reader。网页可能受登录、反爬、网络和 Reader 限流影响，读取失败会提示，请清空链接后粘贴完整题干。模型必须明确确认完整算法题，拒绝无关内容；失败不会保存题目。导入成功和错误均显示可关闭的醒目浮层。此需求覆盖早期“不读取链接”的范围约定。
