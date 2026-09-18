import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { env } from '../env.js';
import { withReadTx, withWriteTx } from '../neo4j.js';
import { snapshotAfter } from '../services/snapshotAfter.js';
import type { ServiceDomain, ServiceType } from '@zhinu/shared';

type SeedEvent = {
  title: string;
  content: string;
  monthsAgo: number;
  day: number;
  domain: ServiceDomain;
  serviceType: ServiceType;
  techs: string[];
  systems: string[];
};

type SeedCustomer = {
  name: string;
  company: string;
  events: SeedEvent[];
};

function dateFrom(monthsAgo: number, day: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  d.setUTCDate(Math.min(day, 28));
  return d.toISOString().slice(0, 10);
}

function ev(
  title: string,
  content: string,
  monthsAgo: number,
  day: number,
  domain: ServiceDomain,
  serviceType: ServiceType,
  techs: string[],
  systems: string[] = [],
): SeedEvent {
  return { title, content, monthsAgo, day, domain, serviceType, techs, systems };
}

function expand(base: SeedEvent, count: number, variants: string[]): SeedEvent[] {
  const out: SeedEvent[] = [base];
  for (let i = 1; i < count; i++) {
    const v = variants[i % variants.length];
    out.push({
      ...base,
      title: `${base.title}${i > 1 ? ` #${i}` : ''}`,
      content: `${base.content}（第 ${i + 1} 次：${v}）`,
      monthsAgo: Math.max(0, base.monthsAgo - Math.floor(i / 2)),
      day: ((base.day + i * 3) % 27) + 1,
    });
  }
  return out;
}

const xxTech: SeedCustomer = {
  name: 'XX科技',
  company: 'XX互联网科技有限公司',
  events: [
    ...expand(
      ev('MySQL慢查询排查', '协助排查订单库慢查询，定位缺失索引', 1, 12, 'database', 'incident', ['MySQL'], ['订单系统']),
      28,
      ['补充执行计划', '调整索引', '会话阻塞分析'],
    ),
    ...expand(
      ev('Redis扩容', '缓存节点扩容与内存水位优化', 2, 18, 'cache', 'change', ['Redis'], ['会话缓存']),
      8,
      ['扩容从节点', '清理大key'],
    ),
    ...expand(
      ev('K8s节点故障处理', 'Worker 节点 NotReady，驱离与替换', 1, 22, 'container', 'incident', ['Kubernetes'], ['生产集群']),
      12,
      ['节点排水', '镜像拉取失败', 'Ingress 配置'],
    ),
    ...expand(
      ev('Java应用发布', '支付服务滚动发布与回滚预案', 3, 8, 'app', 'change', ['Java'], ['支付服务']),
      6,
      ['配置中心刷新', '灰度发布'],
    ),
    ...expand(
      ev('服务器扩容', '应用节点 CPU/内存扩容', 4, 15, 'server', 'change', ['Linux'], []),
      4,
      ['磁盘扩容'],
    ),
    ...expand(
      ev('K8s配置修改', 'Deployment 与 Ingress 调整', 0, 5, 'container', 'change', ['Kubernetes'], ['生产集群']),
      10,
      ['HPA 参数', '资源 request/limit'],
    ),
  ],
};

const xxGroup: SeedCustomer = {
  name: 'XX集团',
  company: 'XX集团信息中心',
  events: [
    ...expand(
      ev('Oracle 例行巡检', '表空间与监听状态检查', 2, 10, 'database', 'routine', ['Oracle'], ['ERP']),
      10,
      ['AWR 简报', '备份校验'],
    ),
    ...expand(
      ev('VMware 虚机迁移', '测试环境虚机迁移与快照清理', 5, 20, 'server', 'change', ['VMware'], ['虚拟化平台']),
      6,
      ['资源池调整'],
    ),
    ...expand(
      ev('Oracle 参数调整', '根据会话数调整 processes/sessions', 3, 12, 'database', 'change', ['Oracle'], ['ERP']),
      4,
      ['归档目录扩容'],
    ),
    ...expand(
      ev('月度运维报告', '输出系统可用性与容量报告', 1, 3, 'server', 'routine', ['Linux'], []),
      6,
      ['容量趋势'],
    ),
  ],
};

const xxMfg: SeedCustomer = {
  name: 'XX制造',
  company: 'XX精密制造',
  events: [
    ...expand(
      ev('Windows 文件服务故障', '文件服务器共享不可用', 2, 14, 'server', 'incident', ['Windows Server'], ['文件服务']),
      8,
      ['磁盘只读', '权限异常'],
    ),
    ...expand(
      ev('SQL Server 报警处理', '事务日志占满导致写入失败', 1, 9, 'database', 'incident', ['SQL Server'], ['MES']),
      7,
      ['日志备份', '锁等待'],
    ),
    ...expand(
      ev('杀毒与加固咨询', '终端安全与补丁策略咨询', 4, 11, 'security', 'consult', ['堡垒机'], []),
      4,
      ['基线核查'],
    ),
    ...expand(
      ev('MES 发布支持', '制造执行系统版本更新协助', 3, 25, 'app', 'project', ['Java'], ['MES']),
      3,
      ['回滚演练'],
    ),
  ],
};

const SEED_CUSTOMERS = [xxTech, xxGroup, xxMfg];

export async function seedRoutes(app: FastifyInstance) {
  app.post('/dev/seed', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const allow =
      env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_SEED === 'true' || process.env.ALLOW_DEV_SEED === '1';
    if (!allow) {
      return reply.code(403).send({ error: 'Dev seed disabled in production' });
    }

    const seeded: { customer: string; eventCount: number }[] = [];
    const skipped: string[] = [];

    for (const spec of SEED_CUSTOMERS) {
      const existing = await withReadTx(async (tx) => {
        const res = await tx.run(`MATCH (c:Customer {name: $name}) RETURN c.id AS id LIMIT 1`, {
          name: spec.name,
        });
        return res.records[0]?.get('id') as string | undefined;
      });
      if (existing) {
        skipped.push(spec.name);
        continue;
      }

      const customerId = randomUUID();
      await withWriteTx(async (tx) => {
        await tx.run(
          `CREATE (c:Customer {
            id: $id, name: $name, company: $company, createdAt: datetime(), createdBy: $createdBy
          })`,
          {
            id: customerId,
            name: spec.name,
            company: spec.company,
            createdBy: auth.userId,
          },
        );

        for (const e of spec.events) {
          const eventId = randomUUID();
          const occurredAt = dateFrom(e.monthsAgo, e.day);
          await tx.run(
            `CREATE (ev:Event {
              id: $id,
              customerId: $customerId,
              title: $title,
              content: $content,
              occurredAt: $occurredAt,
              tags: $tags,
              status: 'active',
              domain: $domain,
              serviceType: $serviceType,
              techs: $techs,
              classifiedAt: datetime(),
              classifySource: 'seed',
              createdAt: datetime(),
              createdBy: $createdBy
            })
            WITH ev
            MATCH (c:Customer {id: $customerId})
            MERGE (ev)-[:ABOUT]->(c)`,
            {
              id: eventId,
              customerId,
              title: e.title,
              content: e.content,
              occurredAt,
              tags: [e.domain, e.serviceType],
              domain: e.domain,
              serviceType: e.serviceType,
              techs: e.techs,
              createdBy: auth.userId,
            },
          );
          for (const sys of e.systems) {
            const systemId = randomUUID();
            await tx.run(
              `MERGE (s:System {name: $name})
               ON CREATE SET s.id = $systemId
               WITH s
               MATCH (ev:Event {id: $eventId})
               MATCH (c:Customer {id: $customerId})
               MERGE (ev)-[:MENTIONS]->(s)
               MERGE (c)-[:HAS_SYSTEM]->(s)`,
              { name: sys, systemId, eventId, customerId },
            );
          }
        }
      });

      await snapshotAfter(customerId, `MSP 种子数据：${spec.name}`, 'init', auth.userId);
      seeded.push({ customer: spec.name, eventCount: spec.events.length });
    }

    return { seeded, skipped };
  });
}
