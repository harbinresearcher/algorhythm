# 贡献指南

先读 [续接入口](docs/CONTINUITY.md)、[当前进度](docs/STATUS.md) 和 [Agent 约束](AGENTS.md)。当前只有合成数据扩展原型，完整学习产品尚在建设。

## 环境与检查

```sh
git clone https://github.com/harbinresearcher/algorhythm.git
cd algorhythm
node scripts/check-docs.mjs
```

检查脚本使用 Node.js 24 标准库，无 npm 依赖。提交前还需运行 `git diff --check`。修改检查脚本时验证有效文档和故意损坏的引用，不能只看脚本能启动。

扩展开发：

```sh
cd apps/extension
npm ci
npm test
npm run build
```

跨端行为变更还需 `npx playwright install chromium` 与 `npm run check:browser`。使用临时测试配置，产物不提交个人数据；见 [原型验收](docs/verification/2026-10-13-extension-prototype.md)。当前用严格 TypeScript 和行为测试，不把尚未配置的 ESLint / Prettier 写成已通过检查。

## 协作

- 从最新主分支创建小范围工作分支；不要覆盖其他会话未提交内容。
- 共享 schema、数据库和跨端协议先定契约，再安排前端与核心接入。
- 每项交付引用规格条款与验收编号，记录实际结果和未验证边界。
- 更新 STATUS；设计结论放对应规格，续接入口只留短指针。
- 提交使用 `feat:`、`fix:`、`docs:` 或 `chore:`。PR 写清为什么改、怎么验证。
- 新增模块同时增加对应的类型、测试、构建和浏览器验证；文档检查不能代替它们。

旧版本只在 [退役记录](docs/DEMO-RETIREMENT.md) 指向的 Git 历史中追溯，不继续派发原 demo 的开发任务。

遵守 [行为准则](CODE_OF_CONDUCT.md)。不要公开提交 Key、个人题库、Cookie 或完整请求日志。安全报告见 [SECURITY](SECURITY.md)。所有贡献须允许按 [MIT](LICENSE) 分发。
