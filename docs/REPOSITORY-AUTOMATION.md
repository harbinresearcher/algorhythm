# 仓库自动化

维护范围是仓库检查和依赖更新建议，不包含自动合并、发布、部署、Issue 关闭或 PR 评论。工作流使用只读仓库权限；Actions 固定完整提交 SHA，actionlint 固定版本。

## 触发与结果

- `CI`：所有 PR、main push 和手动触发，运行 `npm ci`、lint、format:check、test、build。纯文档 PR 也会运行，避免状态检查缺席。Node 为 24。
- `Repository health`：所有 PR、main push、每周一和手动触发。actionlint 检查 workflow；lychee 离线检查根目录及 docs 下 Markdown 的本地文档和图片引用。外部 URL 只在定时或手动触发时检查，覆盖 README、贡献指南、安全说明、支持说明和行为规范；结果保存在 Actions 日志及任务摘要，不生成评论或 Issue。
- `Dependency security`：PR 检查依赖差异，新增 high / critical 漏洞会失败；每周一及手动触发时，用 `npm ci --ignore-scripts` 和 `npm audit --registry=https://registry.npmjs.org --audit-level=high` 检查现有依赖。审计包括开发依赖，使用官方漏洞接口，不自动改 lockfile。
- `Dependabot`：npm 每周一 02:00、Actions 每周一 02:30（Asia/Shanghai）检查更新。小版本按生产、开发和 Actions 分组，大版本单独提 PR。普通 npm 更新最多同时开放 5 个 PR，Actions 最多 3 个；是否合入由维护者决定。
- `CodeQL`：继续使用仓库现有默认设置；不重复创建扫描 workflow。

Repository health 定时任务为每周一 09:17，Dependency security 为每周一 09:37（Asia/Shanghai）。GitHub cron 使用 UTC，任务可能延迟；定时任务只有合入默认分支后才生效。新配置留在 PR 时，不能称为已上线。

## 检查失败时

在 PR 的 Checks 或仓库 Actions 页查看失败步骤。先核对 run 的 `headSha`，旧提交通过不代表新提交通过。

依赖安装失败先检查 peer 版本范围，不使用 `--force`、`--legacy-peer-deps`、跳过测试或放宽 lint。大版本更新交总架构评估，业务修复交对应开发会话。链接请求失败需区分失效地址、限流和平台故障，不能仅凭超时删除引用。

PR #7 的 GitHub AI 扫描在 2026-10-10 返回 `402 / quota`，原因为 Copilot 月度额度耗尽，运行编号 `38057930653`。这是托管 AI 服务限制，与 CI 和 CodeQL 分开记录；本次没有修改该服务设置，也不添加消耗 AI 额度的工作流。

## 维护边界

本次不配置 required checks、不改变分支保护或仓库开关。工作流存在不等于强制合并门禁；以 GitHub 设置回读为准。发布、部署、分支删除和 PR 合并仍需针对该操作的明确授权。

公共进度由总架构会话统一维护。STATUS、ROADMAP 和交接文档仍需根据 PR #7 的实际交付与验收记录同步；保留真实 AI 分类尚未验收的边界。README 的旧深色截图已标注版本差异，本次不重拍界面。

参考：[actionlint](https://github.com/rhysd/actionlint)、[lychee](https://github.com/lycheeverse/lychee)、[依赖审查](https://github.com/actions/dependency-review-action)、[Dependabot 配置](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)。
