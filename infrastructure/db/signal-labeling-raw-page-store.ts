import type {PoolClient} from 'pg';
import type {FacetInput} from '@noisia/query-engine';
import type {LabelingDatabaseV1} from './signal-mention-facets';
import type {LabelingCallV1,LabelingRunV1} from './signal-labeling-runs';
import {buildLabelingRawPageV1,parseLabelingRawPageV1,type LabelingRawPageMemberV1,
  type LabelingRawPageStorageV1,type LabelingRawPageReferenceV1} from './signal-labeling-raw-pages';

type Page={id:string;workspace_id:string;run_id:string;name:string;storage_key:string;sha256:string;
  size_bytes:string|number;member_count:number;status:'planned'|'verified'};
type Member=LabelingRawPageMemberV1&{page_id:string};
const invalid=():never=>{throw new Error('labeling_raw_receipt_invalid');};
const normalize=(m:Member):Member=>({...m,raw_size_bytes:Number(m.raw_size_bytes),byte_offset:Number(m.byte_offset),byte_length:Number(m.byte_length)});
const ref=(p:Page):LabelingRawPageReferenceV1=>({workspace_id:p.workspace_id,run_id:p.run_id,page_id:p.id,
  storage_key:p.storage_key,sha256:p.sha256,size_bytes:Number(p.size_bytes)});
const sameMembers=(a:LabelingRawPageMemberV1[],b:LabelingRawPageMemberV1[])=>a.length===b.length&&a.every((x,i)=>{
  const y=b[i];return y&&x.call_id===y.call_id&&x.request_digest===y.request_digest&&x.raw_sha256===y.raw_sha256
    &&x.raw_size_bytes===Number(y.raw_size_bytes)&&x.byte_offset===Number(y.byte_offset)&&x.byte_length===Number(y.byte_length);
});

/** Read authoritative page membership once. Uncorrelated UUID-array InitPlan;
 * all call row locks remain in global UUID order before the page FOR UPDATE.
 * No status, digest or RAW predicate belongs here: attach validates those later. */
export const labelingRawPageLockSqlV1=`WITH raw_lock_page AS MATERIALIZED(
        SELECT array_agg(call_id) call_ids FROM signal_labeling_raw_page_members
        WHERE page_id=$1 AND workspace_id=$2 AND run_id=$3
      )
      SELECT c.id FROM signal_labeling_calls c
      WHERE c.id=ANY((SELECT call_ids FROM raw_lock_page)::uuid[])
        AND c.workspace_id=$2 AND c.run_id=$3 ORDER BY c.id FOR UPDATE OF c`;

/** One statement-local row per verified page. Scalar subqueries are deliberately
 * uncorrelated: their InitPlans retain IDs/map/scalars independently of the
 * target-call scan, instead of rescanning page members for every run call.
 * UUID map keys and bigint values stay native to PostgreSQL throughout. */
export const labelingRawPageAttachSqlV1=`/* labeling_raw_page_attach_v1 */
      WITH raw_attach_page AS MATERIALIZED(
        SELECT array_agg(m.call_id ORDER BY m.call_id) call_ids,
          jsonb_object_agg(m.call_id::text,jsonb_build_object('request_digest',m.request_digest,
            'raw_sha256',m.raw_sha256,'raw_size_bytes',m.raw_size_bytes)) member_by_call,
          p.storage_key,p.verified_at
        FROM signal_labeling_raw_page_members m JOIN signal_labeling_raw_pages p ON p.id=m.page_id
        WHERE m.page_id=$1 AND m.workspace_id=$2 AND m.run_id=$3 AND p.status='verified'
        GROUP BY p.id,p.storage_key,p.verified_at
      )
      UPDATE signal_labeling_calls c SET
        raw_sha256=((SELECT member_by_call FROM raw_attach_page)->c.id::text)->>'raw_sha256',
        raw_storage_key=(SELECT storage_key FROM raw_attach_page),
        raw_size_bytes=(((SELECT member_by_call FROM raw_attach_page)->c.id::text)->>'raw_size_bytes')::bigint,
        raw_storage_verified_at=COALESCE(c.raw_storage_verified_at,(SELECT verified_at FROM raw_attach_page)),
        raw_storage_verified_key=(SELECT storage_key FROM raw_attach_page),
        updated_at=CASE WHEN c.raw_sha256 IS NULL THEN clock_timestamp() ELSE c.updated_at END
      WHERE c.id=ANY((SELECT call_ids FROM raw_attach_page)::uuid[]) AND c.workspace_id=$2 AND c.run_id=$3
        AND c.request_digest=((SELECT member_by_call FROM raw_attach_page)->c.id::text)->>'request_digest'
        AND (c.raw_sha256 IS NULL OR c.raw_sha256=((SELECT member_by_call FROM raw_attach_page)->c.id::text)->>'raw_sha256'
          AND c.raw_storage_key=(SELECT storage_key FROM raw_attach_page)
          AND c.raw_size_bytes=(((SELECT member_by_call FROM raw_attach_page)->c.id::text)->>'raw_size_bytes')::bigint)
      RETURNING c.id`;

/** References are planned under a shared fence on the existing run lease before uploading. No
 * provider retry permission is created by planning, loading or attaching a page. */
export function createLabelingRawPageStoreV1(options:{database:LabelingDatabaseV1;storage:LabelingRawPageStorageV1;
  withRunReadFence<T>(run:LabelingRunV1,fn:(client:PoolClient)=>Promise<T>):Promise<T>}){
  const {database,storage,withRunReadFence}=options;
  async function members(db:Pick<PoolClient,'query'>,page:Page):Promise<Member[]>{
    const rows=(await db.query<Member>(`SELECT call_id,request_digest,raw_sha256,raw_size_bytes,byte_offset,byte_length,page_id
      FROM signal_labeling_raw_page_members WHERE workspace_id=$1 AND run_id=$2 AND page_id=$3 ORDER BY byte_offset`,
    [page.workspace_id,page.run_id,page.id])).rows.map(normalize);
    if(rows.length!==page.member_count)invalid();return rows;
  }
  async function attach(run:LabelingRunV1,page:Page){
    await withRunReadFence(run,async c=>{
      // Match planning's global call-id order before taking the page lock.
      // Reentry of this same page must not hold calls while attachment holds
      // its page and waits for those calls (a SHARE run fence allows both).
      const locked=(await c.query<{id:string}>(labelingRawPageLockSqlV1,
        [page.id,run.workspace_id,run.id])).rows;
      if(locked.length!==page.member_count)invalid();
      const row=(await c.query<Page>('SELECT * FROM signal_labeling_raw_pages WHERE id=$1 AND workspace_id=$2 AND run_id=$3 FOR UPDATE',
        [page.id,run.workspace_id,run.id])).rows[0];
      if(!row||row.sha256!==page.sha256||row.storage_key!==page.storage_key||Number(row.size_bytes)!==Number(page.size_bytes))invalid();
      await c.query(`UPDATE signal_labeling_raw_pages SET status='verified',verified_at=clock_timestamp() WHERE id=$1 AND status='planned'`,[page.id]);
      const changed=await c.query(labelingRawPageAttachSqlV1,[page.id,run.workspace_id,run.id]);
      if(changed.rows.length!==page.member_count)invalid();
    });
  }
  return {
    async persist<Input extends FacetInput>(run:LabelingRunV1,rows:Array<{call:LabelingCallV1<Input>;raw:string}>){
      const built=buildLabelingRawPageV1({workspace_id:run.workspace_id,run_id:run.id,
        receipts:rows.map(({call,raw})=>({call_id:call.id,request_digest:call.request_digest,raw}))});
      const input={workspace_id:run.workspace_id,run_id:run.id,page_id:built.page_id,name:built.name,
        raw_sha256:built.raw_sha256,size_bytes:built.size_bytes};
      const reference=storage.reference(input);
      if(!reference.storage_key||reference.storage_key.length>2048)invalid();
      const page=await withRunReadFence(run,async c=>{
        const calls=(await c.query<{id:string;request_digest:string;raw_sha256:string|null;raw_storage_key:string|null}>(
          'SELECT id,request_digest,raw_sha256,raw_storage_key FROM signal_labeling_calls WHERE workspace_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE',
          [run.workspace_id,run.id,built.members.map(x=>x.call_id)])).rows;
        if(calls.length!==built.members.length||calls.some((call,i)=>call.id!==built.members[i]!.call_id||call.request_digest!==built.members[i]!.request_digest
          ||call.raw_sha256!==null&&(call.raw_sha256!==built.members[i]!.raw_sha256||call.raw_storage_key!==reference.storage_key)))invalid();
        await c.query(`INSERT INTO signal_labeling_raw_pages(id,workspace_id,run_id,name,storage_key,sha256,size_bytes,member_count)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,
        [built.page_id,run.workspace_id,run.id,built.name,reference.storage_key,built.raw_sha256,built.size_bytes,built.members.length]);
        const p=(await c.query<Page>('SELECT * FROM signal_labeling_raw_pages WHERE id=$1 FOR UPDATE',[built.page_id])).rows[0]!;
        if(p.workspace_id!==run.workspace_id||p.run_id!==run.id||p.sha256!==built.raw_sha256||p.storage_key!==reference.storage_key
          ||Number(p.size_bytes)!==built.size_bytes||p.member_count!==built.members.length||p.name!==built.name)invalid();
        await c.query(`INSERT INTO signal_labeling_raw_page_members(call_id,workspace_id,run_id,page_id,request_digest,raw_sha256,raw_size_bytes,byte_offset,byte_length)
          SELECT x.call_id,$1,$2,$3,x.request_digest,x.raw_sha256,x.raw_size_bytes,x.byte_offset,x.byte_length
          FROM jsonb_to_recordset($4::jsonb) x(call_id uuid,request_digest text,raw_sha256 text,raw_size_bytes bigint,byte_offset bigint,byte_length bigint)
          WHERE NOT EXISTS(SELECT 1 FROM signal_labeling_raw_page_members old WHERE old.call_id=x.call_id)
          ORDER BY x.call_id ON CONFLICT(call_id) DO NOTHING`,[run.workspace_id,run.id,built.page_id,JSON.stringify(built.members)]);
        if(!sameMembers(built.members,await members(c,p)))invalid();return p;
      });
      if(page.status!=='verified'){
        const stored=await storage.store({...input,raw_text:built.raw_text});
        if(stored.verified!==true||stored.storage_key!==reference.storage_key||stored.sha256!==built.raw_sha256||stored.size_bytes!==built.size_bytes)invalid();
        await attach(run,page);
      }
      const byId=new Map(rows.map(row=>[row.call.id,row]));
      for(const member of built.members)byId.get(member.call_id)!.call.raw_body=byId.get(member.call_id)!.raw;
    },
    async loadCalls<Input extends FacetInput>(run:LabelingRunV1,calls:LabelingCallV1<Input>[]):Promise<Set<string>>{
      if(!calls.length)return new Set();
      const linked=(await database.query<{call_id:string;page_id:string}>(`SELECT call_id,page_id FROM signal_labeling_raw_page_members
        WHERE workspace_id=$1 AND run_id=$2 AND call_id=ANY($3::uuid[])`,[run.workspace_id,run.id,calls.map(c=>c.id)])).rows;
      const handled=new Set(linked.map(x=>x.call_id)),byId=new Map(calls.map(c=>[c.id,c]));
      for(const id of new Set(linked.map(x=>x.page_id))){
        const page=(await database.query<Page>('SELECT * FROM signal_labeling_raw_pages WHERE workspace_id=$1 AND run_id=$2 AND id=$3',
          [run.workspace_id,run.id,id])).rows[0];if(!page)return invalid();
        const rows=await members(database,page);
        let raw:string;
        try{raw=await storage.load(ref(page));}
        catch(error){
          // An incomplete upload is ambiguous physical work, never a new send.
          if(page.status==='planned'&&error instanceof Error&&error.message==='workspace_engine_storage_object_missing')continue;
          throw error;
        }
        const decoded=parseLabelingRawPageV1({workspace_id:run.workspace_id,run_id:run.id,raw_text:raw,
          raw_sha256:page.sha256,size_bytes:Number(page.size_bytes),members:rows});
        for(const m of rows){const c=byId.get(m.call_id);if(c&&c.request_digest!==m.request_digest)invalid();}
        if(page.status==='planned')await attach(run,page);
        for(const [callId,text] of decoded){const call=byId.get(callId);if(call)call.raw_body=text;}
      }
      return handled;
    },
  };
}

/** Read-only access for the no-provider recovery path. A null result means an
 * individual historical receipt, never permission to infer or scan a page key.
 * Planned bytes can be authenticated here but are not attached or settled. */
type RawCallPageReadV1={workspace_id:string;run_id:string;call_id:string;request_digest:string};
type RawCallPageReceiptV1={page_id:string;page_status:'planned'|'verified';raw_text:string;
  raw_sha256:string;raw_size_bytes:number;storage_key:string};

/** A reader belongs to one recovery pass. Only its last authenticated page stays
 * resident; neither provider bytes nor mutable references escape into a global cache.
 * Every read still checks current DB scope, page identity and the complete membership. */
export function createLabelingRawCallPageReaderV1(options:{database:Pick<LabelingDatabaseV1,'query'>;
  loadPage:LabelingRawPageStorageV1['load']}){
  let cached:{reference:LabelingRawPageReferenceV1;members:LabelingRawPageMemberV1[];
    decoded:Map<string,string>}|undefined;
  return async(args:RawCallPageReadV1):Promise<RawCallPageReceiptV1|null>=>{
    const linked=(await options.database.query<{page_id:string;request_digest:string;call_request_digest:string}>(`SELECT m.page_id,m.request_digest,c.request_digest call_request_digest
      FROM signal_labeling_raw_page_members m JOIN signal_labeling_calls c ON c.id=m.call_id
      WHERE m.workspace_id=$1 AND m.run_id=$2 AND m.call_id=$3
        AND c.workspace_id=m.workspace_id AND c.run_id=m.run_id
        `,
      [args.workspace_id,args.run_id,args.call_id])).rows[0];
    if(!linked)return null;
    if(linked.request_digest!==args.request_digest||linked.call_request_digest!==args.request_digest)return invalid();
    const page=(await options.database.query<Page>(`SELECT * FROM signal_labeling_raw_pages
      WHERE workspace_id=$1 AND run_id=$2 AND id=$3`,[args.workspace_id,args.run_id,linked.page_id])).rows[0];
    if(!page)return invalid();
    const rows=(await options.database.query<Member>(`SELECT call_id,request_digest,raw_sha256,raw_size_bytes,byte_offset,byte_length,page_id
      FROM signal_labeling_raw_page_members WHERE workspace_id=$1 AND run_id=$2 AND page_id=$3 ORDER BY byte_offset`,
      [args.workspace_id,args.run_id,page.id])).rows.map(normalize);
    if(rows.length!==page.member_count||rows.some(row=>row.page_id!==page.id))return invalid();
    const reference=ref(page);
    if(reference.workspace_id!==args.workspace_id||reference.run_id!==args.run_id||reference.page_id!==linked.page_id)return invalid();
    const hit=cached&&Object.entries(reference).every(([key,value])=>cached!.reference[key as keyof LabelingRawPageReferenceV1]===value)
      &&sameMembers(cached.members,rows);
    if(!hit){
      // Evict before loading another page: failures cannot leave an older authenticated
      // page available under a changed reference. The raw JSONL is not retained.
      cached=undefined;
      const raw=await options.loadPage(reference);
      const decoded=parseLabelingRawPageV1({workspace_id:args.workspace_id,run_id:args.run_id,raw_text:raw,
        raw_sha256:page.sha256,size_bytes:Number(page.size_bytes),members:rows});
      cached={reference:{...reference},members:rows.map(row=>({...row})),decoded};
    }
    const decoded=cached!.decoded;
    const member=rows.find(m=>m.call_id===args.call_id),raw_text=decoded.get(args.call_id);
    if(!member||member.request_digest!==args.request_digest||raw_text===undefined)return invalid();
    return {page_id:page.id,page_status:page.status,raw_text,raw_sha256:member.raw_sha256,
      raw_size_bytes:member.raw_size_bytes,storage_key:page.storage_key};
  };
}

export async function readLabelingRawCallPageV1(args:RawCallPageReadV1&{
  database:Pick<LabelingDatabaseV1,'query'>;loadPage:LabelingRawPageStorageV1['load']}){
  return createLabelingRawCallPageReaderV1(args)(args);
}
