import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const PRESETS = [
  { key: 'mysql_dependency', label: '哪些客户最依赖 MySQL 运维？' },
  { key: 'k8s_growth', label: '哪些客户最近 K8s 需求增长最快？' },
  { key: 'fault_ratio', label: '哪些客户故障处理占比最高？' },
  { key: 'volume_growth', label: '哪些客户服务请求正在明显增加？' },
];

type PresetResult = {
  preset: string;
  question: string;
  rows: Record<string, string | number>[];
};

type CrossResult = {
  dims: string[];
  rows: { keys: Record<string, string>; count: number }[];
};

export default function AnalyticsPage() {
  const [preset, setPreset] = useState('mysql_dependency');
  const [dims, setDims] = useState('domain,customer');
  const [presetRes, setPresetRes] = useState<PresetResult | null>(null);
  const [crossRes, setCrossRes] = useState<CrossResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function runPreset(key = preset) {
    setBusy(true);
    setError('');
    try {
      const res = await api<PresetResult>(`/api/analytics/cross?preset=${key}`);
      setPresetRes(res);
      setCrossRes(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败');
    } finally {
      setBusy(false);
    }
  }

  async function runCross() {
    setBusy(true);
    setError('');
    try {
      const res = await api<CrossResult>(`/api/analytics/cross?dims=${encodeURIComponent(dims)}`);
      setCrossRes(res);
      setPresetRes(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-pad stack">
      <div className="page-head">
        <div>
          <h1>多维分析</h1>
          <p className="muted">用服务分类交叉回答「谁最依赖什么、谁在变化」</p>
        </div>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>预设问题</h2>
        <div className="chip-row" style={{ marginBottom: '0.75rem' }}>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`chip as-button ${preset === p.key ? 'accent' : ''}`}
              onClick={() => {
                setPreset(p.key);
                void runPreset(p.key);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => runPreset()} disabled={busy}>
          {busy ? '查询中…' : '执行预设'}
        </button>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>交叉维度</h2>
        <div className="row wrap" style={{ marginBottom: '0.75rem' }}>
          <select value={dims} onChange={(e) => setDims(e.target.value)}>
            <option value="domain,customer">领域 × 客户</option>
            <option value="domain,month">领域 × 月份</option>
            <option value="serviceType,customer">服务类型 × 客户</option>
            <option value="tech,customer">技术 × 客户</option>
            <option value="serviceType,month">服务类型 × 月份</option>
          </select>
          <button type="button" className="btn ghost" onClick={runCross} disabled={busy}>
            查询交叉
          </button>
        </div>
        <p className="muted small">支持组合：domain | serviceType | tech × customer | month</p>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {presetRes ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>{presetRes.question}</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>客户</th>
                  {Object.keys(presetRes.rows[0] ?? {})
                    .filter((k) => k !== 'customer' && k !== 'customerId')
                    .map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {presetRes.rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.customerId ? (
                        <Link to={`/customers/${r.customerId}`}>{String(r.customer)}</Link>
                      ) : (
                        String(r.customer ?? '—')
                      )}
                    </td>
                    {Object.entries(r)
                      .filter(([k]) => k !== 'customer' && k !== 'customerId')
                      .map(([k, v]) => (
                        <td key={k}>{String(v)}</td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {crossRes ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>
            交叉结果 · {crossRes.dims.join(' × ')}
          </h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {crossRes.dims.map((d) => (
                    <th key={d}>{d}</th>
                  ))}
                  <th>次数</th>
                </tr>
              </thead>
              <tbody>
                {crossRes.rows.map((r, i) => (
                  <tr key={i}>
                    {crossRes.dims.map((d) => (
                      <td key={d}>{r.keys[d] ?? '—'}</td>
                    ))}
                    <td>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
