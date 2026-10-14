import { useEffect, useState, type FormEvent } from 'react';
import { Cpu, KeyRound, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react';
import type { ModelSettings } from '@atoms/shared';
import { request } from './client';

export function ModelSettingsDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial?: ModelSettings;
  onClose: () => void;
  onSaved: (value: ModelSettings) => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl || '');
  const [modelName, setModelName] = useState(initial?.modelName || '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!initial);
  const [feedback, setFeedback] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    void request<ModelSettings>('/model-config')
      .then((value) => {
        if (cancelled) return;
        setSaved(value);
        setBaseUrl(value.baseUrl);
        setModelName(value.modelName);
      })
      .catch((error) => {
        if (!cancelled) setFeedback((error as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onClose]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFeedback('');
    try {
      const value = await request<ModelSettings>(
        '/model-config',
        {
          baseUrl: baseUrl.trim(),
          modelName: modelName.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
        'PUT',
      );
      setApiKey('');
      onSaved(value);
      onClose();
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setFeedback('');
    try {
      await request('/model-config', undefined, 'DELETE');
      const empty: ModelSettings = {
        configured: false,
        baseUrl: '',
        modelName: '',
        apiKeyConfigured: false,
        updatedAt: null,
      };
      setSaved(empty);
      setBaseUrl('');
      setModelName('');
      setApiKey('');
      setConfirmDelete(false);
      onSaved(empty);
      setFeedback('已删除模型配置。重新配置后即可继续开发项目。');
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="auth-modal model-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-settings-title"
      >
        <button className="modal-close" onClick={onClose} disabled={busy} aria-label="关闭模型配置">
          <X size={18} />
        </button>
        <div className="model-settings-icon">
          <Cpu size={25} />
        </div>
        <span className="section-kicker">YOUR MODEL, YOUR WORKSPACE</span>
        <h2 id="model-settings-title">{saved?.configured ? '管理你的模型' : '连接你的模型'}</h2>
        <p>用你自己的模型服务开始开发。配置仅属于当前账号，可在不同设备登录后使用。</p>
        <div className={`model-settings-status ${saved?.configured ? 'connected' : ''}`}>
          <span className={saved?.configured ? 'online-dot' : 'offline-dot'} />
          {loading ? '正在读取配置…' : saved?.configured ? '配置已保存' : '尚未配置模型'}
          <small>OpenAI 兼容 · Chat Completions · 支持工具调用</small>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            模型服务 Base URL
            <input
              type="url"
              required
              autoFocus
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              maxLength={2048}
              disabled={busy || loading}
              autoComplete="off"
            />
          </label>
          <label>
            模型名称
            <input
              required
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              placeholder="填写服务商提供的模型 ID"
              maxLength={200}
              disabled={busy || loading}
              autoComplete="off"
            />
          </label>
          <label>
            <span className="model-key-label">
              <KeyRound size={12} /> API Key
            </span>
            <input
              type="password"
              required={!saved?.apiKeyConfigured}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                saved?.apiKeyConfigured ? '已安全保存；留空保留，填写则替换' : '粘贴你的 API Key'
              }
              maxLength={8192}
              disabled={busy || loading}
              autoComplete="new-password"
              spellCheck={false}
            />
          </label>
          <div className="model-security-note">
            <ShieldCheck size={16} />
            <span>服务端加密后存入数据库。已保存的 API Key 不会读回网页，保存不会调用模型。</span>
          </div>
          {feedback && (
            <div className="auth-feedback" role="status">
              {feedback}
            </div>
          )}
          <button className="primary-button" type="submit" disabled={busy || loading}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}{' '}
            保存配置
          </button>
        </form>
        {saved?.configured && (
          <div className="model-delete-area">
            {confirmDelete ? (
              <>
                <span>删除后需要重新配置才能继续开发。</span>
                <div>
                  <button disabled={busy} onClick={() => setConfirmDelete(false)}>
                    取消
                  </button>
                  <button className="model-delete" disabled={busy} onClick={() => void remove()}>
                    确认删除
                  </button>
                </div>
              </>
            ) : (
              <button
                className="model-delete"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} /> 删除配置
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
