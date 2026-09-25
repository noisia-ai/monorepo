import type { PoolClient } from 'pg';

export function schemaFingerprint(client: Pick<PoolClient, 'query'>): Promise<string>;
