import { useEffect, useRef, useState, type FormEvent } from 'react';
import { loadAIConfig, saveAIConfig } from '../ai';
import { logger } from '../logger';

/**
 * 预设供应商：点一下自动填好 Base URL 与 Model。
 * 模型名会过时（例如 DeepSeek 已于 2026-07-24 停用 deepseek-chat），
 * 所以这里只是起点，用户随时可以手改。
 */
const PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6-luna',
  },
] as const;

export default function Settings({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [config, setConfig] = useState(loadAIConfig);
  const [error, setError] = useState('');
  useEffect(() => {
    /*
     * ========================================================================
     * 步骤1：打开可键盘操作的设置窗口
     * ========================================================================
     * 目标：原生 dialog；操作：1) 模态显示 2) 卸载时关闭并恢复入口焦点
     */
    logger.info('开始打开 AI 设置');
    // 1.1 原生模态负责焦点约束和 Escape 行为
    const element = dialog.current;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    logger.info('AI 设置打开完成');
    return () => {
      // 1.2 保存元素快照，卸载后 ref 可能已经清空
      element?.close();
      returnFocus?.focus();
    };
  }, []);

  // 当前配置与某个预设完全一致才算命中；否则视为自定义
  const activePreset = PRESETS.find(
    (preset) => preset.baseUrl === config.baseUrl && preset.model === config.model,
  );

  function applyPreset(preset: (typeof PRESETS)[number]) {
    /*
     * ========================================================================
     * 步骤1：套用预设供应商
     * ========================================================================
     * 数据源：预设表；操作：1) 覆盖 Base URL 与 Model 2) 保留已填的密钥
     */
    logger.info('开始套用预设供应商');
    // 1.1 不动 apiKey，避免用户重新粘贴
    setConfig((current) => ({ ...current, baseUrl: preset.baseUrl, model: preset.model }));
    setError('');
    logger.info('预设供应商套用完成');
  }

  function save(event: FormEvent) {
    event.preventDefault();
    /*
     * ========================================================================
     * 步骤1：确认用户配置
     * ========================================================================
     * 数据源：设置表单；操作：1) 校验并写入 2) 成功后关闭
     */
    logger.info('开始提交 AI 设置');
    // 1.1 写入失败保留表单与密钥输入，不显示成功
    try {
      saveAIConfig(config);
      onSaved();
      onClose();
      logger.info('AI 设置提交完成');
    } catch (e) {
      setError(e instanceof Error ? e.message : '配置保存失败。');
    }
  }
  return (
    <dialog
      className="settings-dialog"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="settings-title"
    >
      <form onSubmit={save} className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="settings-title">AI 设置</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭设置">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="field">
          预设供应商
          <div className="preset-row" role="group" aria-label="预设供应商">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`preset-chip${activePreset?.id === preset.id ? ' active' : ''}`}
                aria-pressed={activePreset?.id === preset.id}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
            {!activePreset && <span className="preset-chip active">自定义</span>}
          </div>
          <span className="field-hint">
            选一个就自动填好下面两项；用别的服务商时直接手动填写即可。
          </span>
        </div>
        <label className="field">
          API Key
          <input
            type="password"
            name="api-key"
            autoComplete="off"
            required
            value={config.apiKey}
            placeholder="输入你的 API Key"
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
          />
          <span className="field-hint">只保存在此浏览器，不会上传到任何地方。</span>
        </label>
        <label className="field">
          Base URL
          <input
            type="url"
            name="base-url"
            spellCheck={false}
            autoComplete="off"
            required
            value={config.baseUrl}
            placeholder="https://api.deepseek.com"
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
          />
          <span className="field-hint">
            API 根地址，不含 /chat/completions；本机服务可以填 http://。
          </span>
        </label>
        <label className="field">
          Model
          <input
            name="model"
            spellCheck={false}
            autoComplete="off"
            required
            value={config.model}
            placeholder="deepseek-flash"
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
          />
          <span className="field-hint">填服务商当前的模型名；填了已下线的名字会返回 400。</span>
        </label>
        <p className="muted text-sm leading-relaxed">
          兼容 OpenAI 风格的 <code>/chat/completions</code>
          ；服务需支持浏览器跨域请求和 JSON 输出。
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary w-full" type="submit">
          保存配置
        </button>
      </form>
    </dialog>
  );
}
