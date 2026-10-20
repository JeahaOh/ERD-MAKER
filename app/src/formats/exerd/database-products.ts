/** Product identity/namespace facts observed in the supplied 3.3.56 registration.
 * defaultSchema/defaultType are editable application starting choices, not vendor defaults.
 */
export const NATIVE_DATABASE_PRODUCTS = [
  { productId: 'com.tomato.db.postgresql', name: 'PostgreSQL', namespace: 'http://exerd.tomato.com/postgresql/model', defaultType: 'BIGINT', defaultSchema: 'public' },
  { productId: 'com.tomato.db.oracle_10g', name: 'Oracle', namespace: 'http://exerd.tomato.com/oracle10g', defaultType: 'INTEGER', defaultSchema: 'default_schema' },
  { productId: 'com.tomato.db.sqlserver_2005', name: 'SQL Server', namespace: 'http://exerd.tomato.com/sqlserver/model', defaultType: 'INTEGER', defaultSchema: 'default_schema' },
  { productId: 'com.tomato.db.db2', name: 'DB2', namespace: 'http://exerd.tomato.com/db2/model', defaultType: 'INTEGER', defaultSchema: 'default_schema' },
  { productId: 'com.tomato.db.mysql', name: 'MySQL', namespace: 'http://exerd.tomato.com/mysql/model', defaultType: 'INTEGER', defaultSchema: 'default_schema' },
  { productId: 'com.tomato.db.tibero', name: 'Tibero', namespace: 'http://exerd.tomato.com/tibero/model', defaultType: 'INTEGER', defaultSchema: 'default_schema' },
  { productId: 'com.tomato.db.mariadb', name: 'MariaDB', namespace: 'http://exerd.tomato.com/mariadb/model', defaultType: 'INTEGER', defaultSchema: 'default_schema' },
  { productId: 'com.tomato.db.cubrid', name: 'CUBRID 9', namespace: 'http://exerd.tomato.com/cubrid/model', defaultType: 'INTEGER', defaultSchema: 'default_schema' },
  { productId: 'com.tomato.db.cubrid10', name: 'CUBRID 10 / 11', namespace: 'http://exerd.tomato.com/cubrid/model', defaultType: 'INTEGER', defaultSchema: 'default_schema' },
] as const;
export type NativeDatabaseProductId = typeof NATIVE_DATABASE_PRODUCTS[number]['productId'];
export interface CreateNativeOptions { database: { productId: NativeDatabaseProductId; databaseVersion?: string } }
