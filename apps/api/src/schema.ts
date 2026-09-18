import { withWriteTx } from './neo4j.js';

const CONSTRAINTS = [
  'CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
  'CREATE CONSTRAINT user_email IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE',
  'CREATE CONSTRAINT invite_code IF NOT EXISTS FOR (i:Invite) REQUIRE i.code IS UNIQUE',
  'CREATE CONSTRAINT customer_id IF NOT EXISTS FOR (c:Customer) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT system_id IF NOT EXISTS FOR (s:System) REQUIRE s.id IS UNIQUE',
  'CREATE CONSTRAINT system_name IF NOT EXISTS FOR (s:System) REQUIRE s.name IS UNIQUE',
  'CREATE CONSTRAINT contact_id IF NOT EXISTS FOR (c:Contact) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE',
  'CREATE CONSTRAINT insight_id IF NOT EXISTS FOR (i:Insight) REQUIRE i.id IS UNIQUE',
  'CREATE CONSTRAINT note_id IF NOT EXISTS FOR (n:Note) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT version_id IF NOT EXISTS FOR (v:PortraitVersion) REQUIRE v.id IS UNIQUE',
  'CREATE CONSTRAINT version_num IF NOT EXISTS FOR (v:PortraitVersion) REQUIRE (v.customerId, v.number) IS UNIQUE',
  'CREATE INDEX event_customer IF NOT EXISTS FOR (e:Event) ON (e.customerId)',
  'CREATE INDEX insight_customer IF NOT EXISTS FOR (i:Insight) ON (i.customerId)',
  'CREATE INDEX insight_dimension IF NOT EXISTS FOR (i:Insight) ON (i.dimension)',
  'CREATE INDEX portrait_version_customer IF NOT EXISTS FOR (v:PortraitVersion) ON (v.customerId)',
  'CREATE CONSTRAINT app_settings_id IF NOT EXISTS FOR (s:AppSettings) REQUIRE s.id IS UNIQUE',
  'CREATE CONSTRAINT http_session_sid IF NOT EXISTS FOR (s:HttpSession) REQUIRE s.sid IS UNIQUE',
];

export async function ensureSchema() {
  await withWriteTx(async (tx) => {
    for (const q of CONSTRAINTS) {
      await tx.run(q);
    }
  });
}
