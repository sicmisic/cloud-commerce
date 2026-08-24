import { type QueryResult, type QueryResultRow } from 'pg';

/** Anything that can run a parameterised query — a `Pool` or a `PoolClient`. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}
