import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../hooks';
import { PORTRAIT_DIMENSIONS } from '@zhinu/shared';

type Insight = {
  id: string;
  dimension: string;
  title: string;
  body: string;
  source: 'llm' | 'human';
  status: string;
  pinned: boolean;
  eventIds?: string[];
};

type Note = {
  id: string;
  kind: string;
  currentVersion: number;
  title: string;
  body: string;
  targetType: string;
  targetId: string;
  occurAt?: string;
};

type PortraitDetail = {
  customer: { id: string; name: string; company?: string };
  systems: { id: string; name: string }[];
  contacts: { id: string; name: string; title?: string }[];
  pinned: Insight[];
  buckets: {
    dimension: string;
    insights: Insight[];
    systems: { id: string; name: string }[];
    contacts: { id: string; name: string; title?: string }[];
    notes: Note[];
  }[];
  history?: Insight[];
  lastRecomputedAt?: string;
  needsRecompute?: boolean;
};

type GraphNeighbor = {
  kind: string;
  id: string;
  label: string;
  relation: string;
};

export default function PortraitPage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useAsync(
    () => api<{ portrait: PortraitDetail }>(`/api/customers/${id}`),
    [id],
  );
  const graph = useAsync(
    () => api<{ neighbors: GraphNeighbor[] }>(`/api/customers/${id}/graph`),
    [id],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [insightOpen, setInsightOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [mergeForm, setMergeForm] = useState({ title: '', body: '', dimension: 'service' });
  const [insightForm, setInsightForm] = useState({
    dimension: 'service',
    title: '',
    body: '',
  });
  const [noteForm, setNoteForm] = useState({
    targetType: 'Customer' as 'Customer' | 'System',
    targetId: '',
    kind: 'release',
    title: '',
    body: '',
  });

  if (loading) return <p className="muted">加载画像…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;
  const p = data.portrait;

  async function togglePin(insightId: string, pinned: boolean) {
    await api(`/api/insights/${insightId}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pinned }),
    });
    reload();
  }

  async function retire(insightId: string) {
    if (!confirm('作废这条洞察？')) return;
    await api(`/api/insights/${insightId}/retire`, { method: 'POST' });
    reload();
  }

  async function unmerge(insightId: string) {
    await api(`/api/insights/${insightId}/unmerge`, { method: 'POST' });
    reload();
  }

  async function showVersions(note: Note) {
    const res = await api<{ currentVersion: number; versions: { version: number; title: string; body: string }[] }>(
      `/api/notes/${note.id}/versions`,
    );
    const lines = res.versions
      .map((v) => `v${v.version}${v.version === res.currentVersion ? '（当前）' : ''}: ${v.title}\n${v.body}`)
      .join('\n\n');
    const pick = prompt(`选择要回退到的版本号（1–${res.versions.length}）\n\n${lines}`, String(res.currentVersion));
    const version = Number(pick);
    if (!pick || Number.isNaN(version)) return;
    await api(`/api/notes/${note.id}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ version }),
    });
    reload();
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <Link to="/" className="muted small">
            ← 客户列表
          </Link>
          <h1>
            {p.customer.name}
            {p.customer.company ? <span className="muted"> · {p.customer.company}</span> : null}
          </h1>
          <p className="muted small">
            洞察只增不改；可合并、作废、置顶。实体备注可版本回退。
            {p.lastRecomputedAt ? ` 上次重算：${p.lastRecomputedAt}` : ''}
          </p>
        </div>
        <div className="row">
          <button type="button" onClick={() => setInsightOpen(true)}>
            写洞察
          </button>
          <button type="button" onClick={() => setNoteOpen(true)}>
            写备注
          </button>
          <button
            type="button"
            disabled={recomputing}
            onClick={async () => {
              setRecomputing(true);
              try {
                await api(`/api/customers/${id}/recompute`, { method: 'POST' });
                reload();
                graph.reload();
              } catch (err) {
                alert(err instanceof Error ? err.message : '重算失败');
              } finally {
                setRecomputing(false);
              }
            }}
          >
            {recomputing ? '重算中…' : 'LLM 重算画像'}
          </button>
        </div>
      </div>

      {p.pinned.length > 0 ? (
        <div className="card pinned-block">
          <h2>置顶洞察</h2>
          <ul className="insight-list">
            {p.pinned.map((i) => (
              <li key={i.id}>
                <strong>{i.title}</strong>
                <div>{i.body}</div>
                <button type="button" className="ghost" onClick={() => togglePin(i.id, false)}>
                  取消置顶
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {PORTRAIT_DIMENSIONS.map(({ key, label }) => {
        const bucket = p.buckets.find((b) => b.dimension === key);
        if (!bucket) return null;
        return (
          <section key={key} className="card dim-section">
            <h2>{label}</h2>
            {bucket.systems.length > 0 ? (
              <div className="chips">
                {bucket.systems.map((s) => (
                  <span key={s.id} className="chip">
                    {s.name}
                  </span>
                ))}
              </div>
            ) : null}
            {bucket.contacts.length > 0 ? (
              <div className="chips">
                {bucket.contacts.map((c) => (
                  <span key={c.id} className="chip">
                    {c.name}
                    {c.title ? ` · ${c.title}` : ''}
                  </span>
                ))}
              </div>
            ) : null}
            {bucket.notes.length > 0 ? (
              <div className="notes">
                {bucket.notes.map((n) => (
                  <article key={n.id} className="note-card">
                    <header>
                      <strong>{n.title}</strong>
                      <span className="muted small">
                        {n.kind} · v{n.currentVersion} · {n.targetType}
                      </span>
                    </header>
                    <p>{n.body}</p>
                    <div className="row">
                      <button
                        type="button"
                        className="ghost"
                        onClick={async () => {
                          const body = prompt('备注新内容', n.body);
                          if (body == null) return;
                          await api(`/api/notes/${n.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ title: n.title, body }),
                          });
                          reload();
                        }}
                      >
                        编辑（新版本）
                      </button>
                      <button type="button" className="ghost" onClick={() => showVersions(n)}>
                        版本历史 / 回退
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            <ul className="insight-list">
              {bucket.insights.map((i) => (
                <li key={i.id}>
                  <div className="insight-head">
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(i.id)}
                        onChange={(e) => {
                          setSelected((prev) =>
                            e.target.checked ? [...prev, i.id] : prev.filter((x) => x !== i.id),
                          );
                        }}
                      />
                      <strong>{i.title}</strong>
                    </label>
                    <span className="badge">{i.source}</span>
                    {i.pinned ? <span className="badge pin">置顶</span> : null}
                  </div>
                  <p>{i.body}</p>
                  {i.eventIds?.length ? (
                    <p className="muted small">证据 {i.eventIds.length} 条工作记录</p>
                  ) : null}
                  <div className="row">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => togglePin(i.id, !i.pinned)}
                    >
                      {i.pinned ? '取消置顶' : '置顶'}
                    </button>
                    <button
                        type="button"
                        className="ghost"
                        onClick={() => unmerge(i.id)}
                      >
                        撤销合并
                      </button>
                    <button type="button" className="ghost" onClick={() => retire(i.id)}>
                      作废
                    </button>
                  </div>
                </li>
              ))}
              {bucket.insights.length === 0 && bucket.notes.length === 0 ? (
                <li className="muted">暂无内容</li>
              ) : null}
            </ul>
          </section>
        );
      })}

      <section className="card">
        <h2>历史洞察（已合并 / 已作废）</h2>
        <details>
          <summary className="muted">展开查看（默认折叠）</summary>
          <ul className="insight-list">
            {(p.history ?? []).map((i) => (
              <li key={i.id}>
                <strong>{i.title}</strong>{' '}
                <span className="badge">{i.status}</span>
                <p className="muted">{i.body}</p>
              </li>
            ))}
            {(p.history ?? []).length === 0 ? <li className="muted">暂无历史</li> : null}
          </ul>
        </details>
      </section>

      <section className="card">
        <h2>图邻居（一跳）</h2>
        <div className="chips">
          {(graph.data?.neighbors ?? []).map((n) => (
            <span key={`${n.kind}:${n.id}`} className="chip" title={n.relation}>
              <em>{n.kind}</em> {n.label}
            </span>
          ))}
        </div>
      </section>

      {selected.length >= 2 ? (
        <div className="card sticky-merge">
          <h2>合并 {selected.length} 条洞察</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await api(`/api/insights/${selected[0]}/merge`, {
                method: 'POST',
                body: JSON.stringify({
                  sourceInsightIds: selected,
                  dimension: mergeForm.dimension,
                  title: mergeForm.title,
                  body: mergeForm.body,
                }),
              });
              setSelected([]);
              setMergeForm({ title: '', body: '', dimension: 'service' });
              reload();
            }}
          >
            <select
              value={mergeForm.dimension}
              onChange={(e) => setMergeForm({ ...mergeForm, dimension: e.target.value })}
            >
              {PORTRAIT_DIMENSIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            <input
              placeholder="合并后标题"
              value={mergeForm.title}
              onChange={(e) => setMergeForm({ ...mergeForm, title: e.target.value })}
              required
            />
            <textarea
              placeholder="合并后正文"
              value={mergeForm.body}
              onChange={(e) => setMergeForm({ ...mergeForm, body: e.target.value })}
              required
            />
            <div className="row">
              <button type="submit">合并（旧条目标记 merged）</button>
              <button type="button" className="ghost" onClick={() => setSelected([])}>
                取消
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {insightOpen ? (
        <Modal title="写人工洞察" onClose={() => setInsightOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await api(`/api/customers/${id}/insights`, {
                method: 'POST',
                body: JSON.stringify(insightForm),
              });
              setInsightOpen(false);
              setInsightForm({ dimension: 'service', title: '', body: '' });
              reload();
            }}
          >
            <select
              value={insightForm.dimension}
              onChange={(e) => setInsightForm({ ...insightForm, dimension: e.target.value })}
            >
              {PORTRAIT_DIMENSIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            <input
              placeholder="标题"
              value={insightForm.title}
              onChange={(e) => setInsightForm({ ...insightForm, title: e.target.value })}
              required
            />
            <textarea
              placeholder="正文"
              value={insightForm.body}
              onChange={(e) => setInsightForm({ ...insightForm, body: e.target.value })}
              required
            />
            <button type="submit">保存</button>
          </form>
        </Modal>
      ) : null}

      {noteOpen ? (
        <Modal title="写实体备注" onClose={() => setNoteOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const targetId =
                noteForm.targetType === 'Customer'
                  ? p.customer.id
                  : noteForm.targetId;
              if (!targetId) {
                alert('请选择系统');
                return;
              }
              await api('/api/notes', {
                method: 'POST',
                body: JSON.stringify({
                  customerId: p.customer.id,
                  targetType: noteForm.targetType,
                  targetId,
                  title: noteForm.title,
                  body: noteForm.body,
                  kind: noteForm.kind,
                }),
              });
              setNoteOpen(false);
              setNoteForm({
                targetType: 'Customer',
                targetId: '',
                kind: 'release',
                title: '',
                body: '',
              });
              reload();
            }}
          >
            <select
              value={noteForm.targetType}
              onChange={(e) =>
                setNoteForm({
                  ...noteForm,
                  targetType: e.target.value as 'Customer' | 'System',
                })
              }
            >
              <option value="Customer">客户</option>
              <option value="System">业务系统</option>
            </select>
            {noteForm.targetType === 'System' ? (
              <select
                value={noteForm.targetId}
                onChange={(e) => setNoteForm({ ...noteForm, targetId: e.target.value })}
                required
              >
                <option value="">选择系统</option>
                {p.systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={noteForm.kind}
              onChange={(e) => setNoteForm({ ...noteForm, kind: e.target.value })}
            >
              <option value="general">一般</option>
              <option value="release">发版</option>
              <option value="other">其他</option>
            </select>
            <input
              placeholder="标题，如 CRM 3.2 发版"
              value={noteForm.title}
              onChange={(e) => setNoteForm({ ...noteForm, title: e.target.value })}
              required
            />
            <textarea
              placeholder="详情：窗口、内容、风险…"
              value={noteForm.body}
              onChange={(e) => setNoteForm({ ...noteForm, body: e.target.value })}
              required
            />
            <button type="submit">保存</button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="row space-between">
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
