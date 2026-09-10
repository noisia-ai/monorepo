import {createHash} from 'node:crypto';
import {guardEmptyTables} from './target-guard.mjs';
export const identitySql=`SELECT current_database() database,current_user "user",inet_server_addr()::text address,
 inet_server_port() port,current_setting('server_version_num') version,system_identifier::text FROM pg_control_system()`;
export async function publicTables(client){
 const rows=(await client.query(`SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN('r','p') ORDER BY c.relname`)).rows;
 if(rows.length!==269)throw Error('noi19_dev_test_schema_mismatch');
 return rows.map(({name})=>({name,quoted:'public."'+name.replaceAll('"','""')+'"'}));
}
export async function verifyEmpty(client,tables){
 const rows=[];for(const table of tables)rows.push({name:table.name,
  nonempty:(await client.query(`SELECT EXISTS(SELECT 1 FROM ${table.quoted} LIMIT 1) nonempty`)).rows[0].nonempty});
 guardEmptyTables(rows);
}
export async function schemaFingerprint(client){
 return createHash('sha256').update(JSON.stringify((await client.query(`SELECT
  (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl) ORDER BY p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f') functions,
  (SELECT jsonb_agg(jsonb_build_array(t.oid,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.oid)
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') triggers,
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a
   JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN('r','p') AND a.attnum>0) columns,
  (SELECT jsonb_agg(jsonb_build_array(c.oid::regclass::text,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p')) tables,
  (SELECT jsonb_agg(jsonb_build_array(c.conrelid,pg_get_constraintdef(c.oid)) ORDER BY c.oid) FROM pg_constraint c
   JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public') constraints,
  (SELECT jsonb_agg(jsonb_build_array(i.indexrelid,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive) ORDER BY i.indexrelid)
   FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') indexes,
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE p.schemaname='public') policies,
  (SELECT jsonb_agg(jsonb_build_array(e.extname,e.extversion,n.nspname) ORDER BY e.extname)
   FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace) extensions`)).rows[0])).digest('hex');
}
