# 旧 demo 退役记录

开始：2026-10-12；更新：2026-10-13。授权：用户明确要求清除之前的项目 demo，包括仓库与本地文件，同时保留并继续新产品设计。

## 恢复依据

归档标签：`archive/demo-before-redesign-2026-10-12`。

对应提交：`82a34f69df3d4bb7e070e152b55a17bb55473de9`。

[浏览归档](https://github.com/harbinresearcher/algorhythm/tree/archive/demo-before-redesign-2026-10-12)。历史包含旧源码、测试、截图和旧规格；新默认目录无需再保留一份 legacy 实现。

## 清理范围

- 旧 React demo 的源码、测试、依赖清单、锁文件、构建和代码格式配置。
- 旧截图、视觉素材、备份与教练开发任务书、旧阶段执行方案和重复交接。
- 本地依赖、构建目录、安装验证副本、历史导出副本和源码压缩包属于待清理范围，尚未清完，原因见下文。
- README、STATUS、ROADMAP、ARCHITECTURE 与仓库协作说明改为新产品设计阶段。

保留 Git 历史、许可证、社区与安全渠道、新产品初稿、四份 v1 基线、续接入口，以及新的场景设计。不触碰用户实际浏览器档案、IndexedDB 或 API 配置。

## 检查与局限

已移除当前工作分支中的旧源码、测试、依赖清单、截图和交接。新应用尚不存在，不能报告其测试或构建成功。

本地物理清理受阻：自动审批拒绝了批量删除，随后也拒绝单独删除经过路径核实的 node_modules，错误仅为 `blocked by policy`。没有换解释器或绕过限制删除。

仍需清理：各旧工作区的 node_modules/dist，当前会话的 `work/clean-install-verification`、`outputs/algo-mentor`、`outputs/leetcode-companion-source.zip`。这些不是正在使用的新实现，保留是审批限制，不是保留 demo 的架构决定。原仓库 Git 历史继续保留；缓存与历史导出不会提交到 GitHub。

本轮检查：Node 语法检查；21 份 Markdown 的 59 个本地引用；git diff 空白检查；文档检查器五个正反例。均取得实际通过或预期拒绝结果。真实扩展、力扣、模型及教学验收未运行。

独立审查后的提交范围空白检查已用临时 Git 仓库验证：工作树干净但提交含空白错误时，新 CI 命令确实拒绝。草稿保存语义增加本地编辑代次与 SC-11，等待后续浏览器验证。

旧环境下记录过的检查只属于历史。当前 CI 改查 Markdown 引用、必要文档和旧 demo 入口残留；将来引入源码时必须补上对应测试及构建门禁。
