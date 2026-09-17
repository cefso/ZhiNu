import { useState } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';

type CustomerOption = { id: string; name: string };

type WorkEvent = {
  id: string;
  customerId: string;
  customerName?: string;
  title: string;
  content: string;
  occurredAt: string;
  tags: string[];
  status: 'active' | 'superseded' | 'voided';
  supersedes?: string;
  supersededBy?: string;
  systemNames?: string[];
};

export default function TimelinePage() {
  const [status, setStatus] = useState<'all' | 'active' | 'superseded' | 'voided'>('all');
  const [customerId, setCustomerId] = useState('');
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
    customerId: '',
    title: '',
    content: '',
    occurredAt: new Date().toISOString().slice(0, 16),
    systemNames: '',
  });
  const [supersedeFor, setSupersedeFor] = useState<WorkEvent | null>(null);
  const [supersedeBody, setSupersedeBody] = useState({
    title: '',
    content: '',
    occurredAt: '',
    systemNames: '',
  });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>工作记录时间线</h1>
          <p className="muted">不可变追加；修正产生新事件并 SUPERSEDES 旧事件；可回退历史版</p>
        </div>
      </div>

      <div className="card">
        <h2>录入记录</h2>
        <form
          className="stack-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const cid = form.customerId || customers.data?.customers[0]?.id;
            if (!cid) {
              alert('请先创建客户');
              return;
            }
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
              }),
            });
            setForm({ ...form, title: '', content: '', systemNames: '' });
            events.reload();
          }}
        >
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
            placeholder="标题"
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
          <input
            placeholder="系统标签，逗号分隔（CRM,OA）"
            value={form.systemNames}
            onChange={(e) => setForm({ ...form, systemNames: e.target.value })}
          />
          <button type="submit">追加</button>
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
                  {(ev.systemNames ?? []).length > 0
                    ? ` · ${(ev.systemNames ?? []).join('、')}`
                    : ''}
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
              <div className="row">
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
