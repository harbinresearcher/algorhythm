# Agent 工作约束

- 开始前必须先读 docs/STATUS.md 和 docs/ROADMAP.md，再读 README.md 与 docs/ARCHITECTURE.md；历史背景按需读 docs/project-context.md、docs/phase-1-plan.md、docs/HANDOFF.md。
- 严格限定第一阶段范围，不能自行加后端、账号、批量抓取、扩展、面试或掌握度统计。用户已授权通过 Jina Reader 读取单条原题链接；不据此扩展爬虫或平台同步。
- 固定使用方案中的 16 种模式。FSRS 默认参数并 enable_fuzz。
- 核心逻辑与 UI 分离，存储职责独立，不引入单次使用的过度抽象。
- 改动前说明假设和验收方式；有实质歧义先确认。
- 只改任务必需内容，保持现有风格；新增主要逻辑按用户要求使用步骤块注释、子步骤注释、开始与结束 logger.info。日志不得包含 API Key、Authorization、完整请求响应或个人题目文本。
- 新功能和修复优先用可复现测试验证；构建、浏览器验证和真实 AI 调用分开报告。
- 不将 API Key、.env、个人数据库或浏览器配置提交到仓库。
- 每次工作结束必须更新 docs/STATUS.md，记录完成项、实际验证、问题和下一步。需要额外交接细节时更新 docs/HANDOFF.md，避免两份文档重复维护当前进度。
- 提交前运行 npm run lint、npm run format:check、npm test、npm run build。提交信息使用 feat: / fix: / docs: / chore:。
- 每完成一段可验证工作，提交并推送，保证其他 Agent 能从仓库接手；未授权时不自行合并其他人的 PR。
- 不能把计划、模拟请求或未运行的检查写成已完成。
- 许可证为 MIT。仓库已公开，发布网站仍需用户授权。
- CI 会验证 lint / format:check / test / build，PR 必须全绿才能合并。不要为了绕过 CI 而放宽 eslint、tsconfig 或跳过测试。
