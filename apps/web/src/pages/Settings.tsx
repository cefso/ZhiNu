import { useEffect, useState } from 'react';
import { api } from '../api';

type SettingsView = {
  llmBaseUrl: string;
  llmModel: string;
  temperature: number;
  llmApiKeySet: boolean;
  llmApiKeyMasked: string;
};

type SettingsResponse = {
  settings: SettingsView;
  editable: boolean;
};

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState('0.3');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [testResult, setTestResult] = useState('');

  useEffect(() => {
    api<SettingsResponse>('/api/settings')
      .then((r) => {
        setData(r);
        setBaseUrl(r.settings.llmBaseUrl);
        setModel(r.settings.llmModel);
        setTemperature(String(r.settings.temperature));
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data?.editable) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const body: Record<string, unknown> = {
        llmBaseUrl: baseUrl,
        llmModel: model,
        temperature: Number(temperature),
      };
      if (clearKey) body.llmApiKey = '';
      else if (apiKey) body.llmApiKey = apiKey;
      const r = await api<{ settings: SettingsView }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setData({ settings: r.settings, editable: true });
      setApiKey('');
      setClearKey(false);
      setMsg('已保存。重算画像将使用新配置。');
    } catch (error) {
      setErr(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function testLlm() {
    setBusy(true);
    setTestResult('');
    setErr('');
    try {
      const r = await api<{ ok: boolean; model?: string; error?: string }>(
        '/api/settings/test-llm',
        { method: 'POST' },
      );
      setTestResult(r.ok ? `连接成功 · 模型 ${r.model ?? ''}` : r.error ?? '失败');
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : '测试失败');
    } finally {
      setBusy(false);
    }
  }

  if (err && !data) return <div className="page-pad error">{err}</div>;
  if (!data) return <div className="page-pad muted">加载设置…</div>;

  return (
    <div className="page-pad stack">
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <p className="muted">LLM 等运行时配置 · 仅管理员可改</p>
        </div>
      </div>

      {err ? <p className="error">{err}</p> : null}
      {msg ? <p className="muted">{msg}</p> : null}

      <form className="card stack-form" onSubmit={save}>
        <h2>OpenAI 兼容 LLM</h2>
        {!data.editable ? (
          <p className="muted small">当前账号无权限修改，仅可查看。</p>
        ) : null}

        <label>
          Base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            disabled={!data.editable}
            required
          />
        </label>

        <label>
          模型
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini / deepseek-chat …"
            disabled={!data.editable}
            required
          />
        </label>

        <label>
          Temperature（0–2）
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            disabled={!data.editable}
          />
        </label>

        <label>
          API Key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setClearKey(false);
            }}
            placeholder={
              data.settings.llmApiKeySet
                ? `已配置（${data.settings.llmApiKeyMasked}），留空则保持不变`
                : 'sk-…'
            }
            disabled={!data.editable || clearKey}
            autoComplete="off"
          />
        </label>

        {data.settings.llmApiKeySet && data.editable ? (
          <label className="row" style={{ gap: '0.45rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(e) => setClearKey(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span className="small">清除已保存的 API Key</span>
          </label>
        ) : null}

        <div className="row">
          <button type="submit" className="btn" disabled={!data.editable || busy}>
            保存设置
          </button>
          {data.editable ? (
            <button type="button" className="btn ghost" disabled={busy} onClick={testLlm}>
              测试连接
            </button>
          ) : null}
        </div>
        {testResult ? <p className="muted small">{testResult}</p> : null}
      </form>

      <section className="card muted" style={{ fontSize: '0.88rem' }}>
        配置保存在 Neo4j（AppSettings），优先于环境变量 <code>LLM_*</code>。
        未配置 API Key 时，「LLM 重算」会失败并提示到本页设置。
      </section>
    </div>
  );
}
