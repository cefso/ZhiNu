import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../hooks';
import { SERVICE_DOMAINS, SERVICE_TYPES } from '@zhinu/shared';

type CustomerOption = { id: string; name: string };

type WorkEvent = {
  id: string;
  customerId: string;
  customerName?: string;
  title: string;
  content: string;
  occurredAt: string;
  tags: string[];
  domain?: string;
  serviceType?: string;
  techs?: string[];
  classifySource?: string;
  status: 'active' | 'superseded' | 'voided';
  supersedes?: string;
  supersededBy?: string;
  systemNames?: string[];
};

export default function TimelinePage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<'all' | 'active' | 'superseded' | 'voided'>('all');
  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const customers = useAsync(
    () => api<{ customers: CustomerOption[] }>('/api/customers'),
    [],
  );
  const events = useAsync(
    () =>
      api<{ events: WorkEvent[] }>(
        `/api/events?status=${status}${customerId ? `&customerId=${customerId}` : ''}`,
      ),
    [status, customerId],
  );
  const [form, setForm] = useState({
    customerId: params.get('customerId') ?? '',
    title: '',
    content: '',
    occurredAt: new Date().toISOString().slice(0, 16),
    systemNames: '',
    domain: '',
    serviceType: '',
    techs: '',
  });
  const [supersedeFor, setSupersedeFor] = useState<WorkEvent | null>(null);
  const [supersedeBody, setSupersedeBody] = useState({
    title: '',
    content: '',
    occurredAt: '',
    systemNames: '',
    domain: '',
    serviceType: '',
    techs: '',
  });

  useEffect(() => {
    const cid = params.get('customerId');
    if (cid) {
      setCustomerId(cid);
      setForm((f) => ({ ...f, customerId: cid }));
    }
  }, [params]);

  async function submitEvent(e: React.FormEvent) {
    e.preventDefault();
    const cid = form.customerId || customers.data?.customers[0]?.id;
    if (!cid) {
      alert('请先创建客户');
      return;
    }
    try {
      await api('/api/events', {
        method: 'POST',
        body: JSON.stringify({
          customerId: cid,
          title: form.title,
          content: form.content,
          occurredAt: new Date(form.occurredAt).toISOString(),
          systemNames: form.systemNames
            .split(/[,，\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          domain: form.domain || undefined,
          serviceType: form.serviceType || undefined,
          techs: form.techs
            .split(/[,，\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setForm({ ...form, title: '', content: '', systemNames: '', techs: '' });
      events.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    }
  }

  return (
    <div className="page-pad stack">
      <div className="page-head">
        <div>
          <h1>服务记录</h1>
          <p className="muted">
            结构化服务记录驱动客户画像：可手选分类，或留空由 LLM/规则自动识别
          </p>
        </div>
      </div>

      <div className="card">
        <h2>录入服务记录</h2>
        <form className="stack-form" onSubmit={submitEvent}>
          <select
            value={form.customerId}
            onChange={(e) => setForm({ ...form, customerId: e.target.value })}
          >
            <option value="">选择客户</option>
            {(customers.data?.customers ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            placeholder="标题（如 MySQL慢查询排查）"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
          <textarea
            placeholder="记录内容"
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            required
          />
          <input
            type="datetime-local"
            value={form.occurredAt}
            onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
          />
          <div className="grid-2">
            <select
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
            >
              <option value="">服务领域（自动/手选）</option>
              {SERVICE_DOMAINS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            <select
              value={form.serviceType}
              onChange={(e) => setForm({ ...form, serviceType: e.target.value })}
            >
              <option value="">服务类型（自动/手选）</option>
              {SERVICE_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <input
            placeholder="技术标签，逗号分隔（MySQL,Redis）"
            value={form.techs}
            onChange={(e) => setForm({ ...form, techs: e.target.value })}
          />
          <input
            placeholder="系统标签，逗号分隔（CRM,OA）"
            value={form.systemNames}
            onChange={(e) => setForm({ ...form, systemNames: e.target.value })}
          />
          <button type="submit" className="btn">
            追加
          </button>
        </form>
      </div>

      <div className="row">
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">全部状态</option>
          <option value="active">有效</option>
          <option value="superseded">已被修正</option>
          <option value="voided">已作废</option>
        </select>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">全部客户</option>
          {(customers.data?.customers ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="list">
        {(events.data?.events ?? []).map((ev) => (
          <article key={ev.id} className="card event-card">
            <header className="row space-between">
              <div>
                <strong>{ev.title}</strong>
                <div className="muted small">
                  {ev.customerName ?? ''} · {String(ev.occurredAt).slice(0, 16).replace('T', ' ')} ·
                  <span className={`badge status-${ev.status}`}>{ev.status}</span>
                  {(ev.systemNames ?? []).length > 0 ? ` · ${(ev.systemNames ?? []).join('、')}` : ''}
                </div>
                <div className="chip-row" style={{ marginTop: '0.4rem' }}>
                  {ev.domain ? (
                    <span className="chip accent">
                      {SERVICE_DOMAINS.find((d) => d.key === ev.domain)?.label ?? ev.domain}
                    </span>
                  ) : (
                    <span className="chip">待分类</span>
                  )}
                  {ev.serviceType ? (
                    <span className="chip">
                      {SERVICE_TYPES.find((t) => t.key === ev.serviceType)?.label ?? ev.serviceType}
                    </span>
                  ) : null}
                  {(ev.techs ?? []).map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                  {ev.classifySource ? (
                    <span className="chip muted-chip">{ev.classifySource}</span>
                  ) : null}
                </div>
              </div>
            </header>
            <p>{ev.content}</p>
            {ev.supersedes ? (
              <p className="muted small">修正自事件 {ev.supersedes.slice(0, 8)}…</p>
            ) : null}
            {ev.supersededBy ? (
              <p className="muted small">已被 {ev.supersededBy.slice(0, 8)}… 修正</p>
            ) : null}
            {ev.status === 'active' ? (
              <div className="row wrap">
                <button
                  type="button"
                  className="ghost"
                  onClick={async () => {
                    await api(`/api/events/${ev.id}/classify`, {
                      method: 'POST',
                      body: JSON.stringify({}),
                    });
                    events.reload();
                  }}
                >
                  自动分类
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setSupersedeFor(ev);
                    setSupersedeBody({
                      title: ev.title,
                      content: ev.content,
                      occurredAt: String(ev.occurredAt).slice(0, 16),
                      systemNames: (ev.systemNames ?? []).join(','),
                      domain: ev.domain ?? '',
                      serviceType: ev.serviceType ?? '',
                      techs: (ev.techs ?? []).join(','),
                    });
                  }}
                >
                  修正
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={async () => {
                    const versionEventId = prompt(
                      '回退到的历史事件 ID（可在 superseded 列表复制）',
                      ev.supersedes ?? '',
                    );
                    if (!versionEventId) return;
                    await api(`/api/events/${ev.id}/rollback`, {
                      method: 'POST',
                      body: JSON.stringify({ versionEventId }),
                    });
                    events.reload();
                  }}
                >
                  回退到历史版
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={async () => {
                    if (!confirm('作废该记录？')) return;
                    await api(`/api/events/${ev.id}/void`, { method: 'POST' });
                    events.reload();
                  }}
                >
                  作废
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {supersedeFor ? (
        <div className="modal-backdrop" onClick={() => setSupersedeFor(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>修正记录</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await api(`/api/events/${supersedeFor.id}/supersede`, {
                  method: 'POST',
                  body: JSON.stringify({
                    title: supersedeBody.title,
                    content: supersedeBody.content,
                    occurredAt: supersedeBody.occurredAt
                      ? new Date(supersedeBody.occurredAt).toISOString()
                      : new Date().toISOString(),
                    systemNames: supersedeBody.systemNames
                      .split(/[,，\s]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                    domain: supersedeBody.domain || undefined,
                    serviceType: supersedeBody.serviceType || undefined,
                    techs: supersedeBody.techs
                      .split(/[,，\s]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }),
                });
                setSupersedeFor(null);
                events.reload();
              }}
            >
              <input
                value={supersedeBody.title}
                onChange={(e) => setSupersedeBody({ ...supersedeBody, title: e.target.value })}
                required
              />
              <textarea
                value={supersedeBody.content}
                onChange={(e) => setSupersedeBody({ ...supersedeBody, content: e.target.value })}
                required
              />
              <input
                type="datetime-local"
                value={supersedeBody.occurredAt}
                onChange={(e) =>
                  setSupersedeBody({ ...supersedeBody, occurredAt: e.target.value })
                }
              />
              <div className="grid-2">
                <select
                  value={supersedeBody.domain}
                  onChange={(e) => setSupersedeBody({ ...supersedeBody, domain: e.target.value })}
                >
                  <option value="">服务领域</option>
                  {SERVICE_DOMAINS.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <select
                  value={supersedeBody.serviceType}
                  onChange={(e) =>
                    setSupersedeBody({ ...supersedeBody, serviceType: e.target.value })
                  }
                >
                  <option value="">服务类型</option>
                  {SERVICE_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                placeholder="技术标签，逗号分隔"
                value={supersedeBody.techs}
                onChange={(e) => setSupersedeBody({ ...supersedeBody, techs: e.target.value })}
              />
              <input
                placeholder="系统标签，逗号分隔"
                value={supersedeBody.systemNames}
                onChange={(e) =>
                  setSupersedeBody({ ...supersedeBody, systemNames: e.target.value })
                }
              />
              <div className="row">
                <button type="submit">生成新版本</button>
                <button type="button" className="ghost" onClick={() => setSupersedeFor(null)}>
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
