import { useRef, useState, type FormEvent } from 'react';
import { ManualProblemError, normalizeManualProblem } from '../shared/manual-problem';

export type ManualProblemFields = ReturnType<typeof normalizeManualProblem>;
type Props = { disabled: boolean; onConfirm: (problem: ManualProblemFields) => void; onCancel: () => void };
const logger = console;

export default function ManualProblemForm({ disabled, onConfirm, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [titleError, setTitleError] = useState('');
  const [urlError, setUrlError] = useState('');
  const titleInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    /*
     * ========================================================================
     * 步骤1：校验本地表单后交给既有写入流程
     * ========================================================================
     * 数据源：用户填写的标题和可选链接、共享规范化函数。
     * 操作：1) 字段错误保留输入并聚焦。2) 仅提交规范结果，不访问链接。
     */
    event.preventDefault();
    if (disabled) return;
    logger.info('开始校验建题表单');
    try {
      // 1.1 复用共享规则；表单不截断原输入，也不另设链接规则。
      setTitleError(''); setUrlError('');
      const problem = normalizeManualProblem({ title, url });
      // 1.2 父工作台负责草稿确认、同步互斥和原命令恢复。
      onConfirm(problem);
    } catch (failure) {
      if (!(failure instanceof ManualProblemError)) throw failure;
      if (failure.code === 'INVALID_TITLE') {
        setTitleError('请填写题目标题。去除首尾空白后，长度不能超过200个字符单位。');
        titleInput.current?.focus();
      } else {
        setUrlError('请填写有效的 https://leetcode.cn/problems/题目名/ 链接，或留空。');
        urlInput.current?.focus();
      }
    } finally { logger.info('建题表单校验结束'); }
  }

  return <form className="manual-problem-form" aria-labelledby="manual-form-title" noValidate onSubmit={submit}>
    <h2 id="manual-form-title">记录自己的题目</h2>
    <label htmlFor="manual-title">题目标题</label>
    <input ref={titleInput} id="manual-title" type="text" value={title} autoFocus disabled={disabled}
      onChange={(event) => { setTitle(event.target.value); setTitleError(''); }}
      aria-invalid={!!titleError} aria-describedby={`manual-title-help${titleError ? ' manual-title-error' : ''}`} />
    <p id="manual-title-help" className="muted hint">必填，去除首尾空白后最多200个字符单位；表情可能占两个。</p>
    {titleError && <p id="manual-title-error" className="field-error" role="alert">{titleError}</p>}
    <label htmlFor="manual-url">原题链接（可选）</label>
    <input ref={urlInput} id="manual-url" type="text" inputMode="url" value={url} disabled={disabled}
      onChange={(event) => { setUrl(event.target.value); setUrlError(''); }}
      aria-invalid={!!urlError} aria-describedby={`manual-url-help${urlError ? ' manual-url-error' : ''}`} />
    <p id="manual-url-help" className="muted hint">仅保存链接，不自动解析。可填写力扣中国站题目链接，也可留空。</p>
    {urlError && <p id="manual-url-error" className="field-error" role="alert">{urlError}</p>}
    <div className="button-row">
      <button className="primary" type="submit" disabled={disabled}>保存并开始练习</button>
      <button type="button" disabled={disabled} onClick={onCancel}>取消建题</button>
    </div>
  </form>;
}
