import neo4jDriver, { type ManagedTransaction, type Session } from 'neo4j-driver';
import { env } from './env.js';

let driver: ReturnType<typeof neo4jDriver.driver> | null = null;

export function getDriver() {
  if (!driver) {
    driver = neo4jDriver.driver(
      env.NEO4J_URI,
      neo4jDriver.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
    );
  }
  return driver;
}

export async function closeDriver() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

export async function withSession<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const session = getDriver().session();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

export async function withWriteTx<T>(fn: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  return withSession(async (session) => session.executeWrite((tx) => fn(tx)));
}

export async function withReadTx<T>(fn: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  return withSession(async (session) => session.executeRead((tx) => fn(tx)));
}
