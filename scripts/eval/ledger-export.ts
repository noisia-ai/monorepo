import type { Prediction, Variant } from './contract';

export type LedgerCall = { status:string; settled_micro_usd:string|null; reserved_micro_usd:string;
  created_at:string; updated_at:string; request:unknown; inputs:unknown; results:unknown; raw_body:string|null;
  run_id?:string; raw_storage_key?:string|null; raw_sha256?:string|null; raw_size_bytes?:number|null };

/** Hydrate JEV probabilities only from verified private receipts; never return raw bodies in the bundle. */
export async function loadJevReceiptBodies(calls:LedgerCall[], load:(call:LedgerCall)=>Promise<string>, width=8):Promise<void> {
  if(!Number.isInteger(width)||width<1||width>16)throw new Error('mfp_eval_receipt_width_invalid');
  for(let start=0;start<calls.length;start+=width){
    await Promise.all(calls.slice(start,start+width).map(async call=>{
      const reference=[call.raw_storage_key,call.raw_sha256,call.raw_size_bytes];
      if(reference.every(value=>value==null)){
        if(call.status==='settled'&&rows(call.results).some(result=>['labeled','abstained'].includes(str(result.status))))
          throw new Error('mfp_eval_jev_receipt_missing');
        return;
      }
      if(!call.run_id||!call.raw_storage_key||!call.raw_sha256||typeof call.raw_size_bytes!=='number'||
        !Number.isInteger(call.raw_size_bytes)||call.raw_size_bytes<0)
        throw new Error('mfp_eval_jev_receipt_reference_invalid');
      call.raw_body=await load(call);
    }));
  }
}

const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.map(object).filter((v):v is Record<string,unknown>=>!!v):[];
const str=(value:unknown)=>typeof value==='string'?value:'';
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;

export function jevFacetProbabilities(call:LedgerCall):Prediction['probabilities'] {
  if(!call.raw_body)return [];
  try {
    const raw=object(JSON.parse(call.raw_body));
    const body=object(JSON.parse(str(raw?.body)));
    const answers=object(body?.answers);
    const request=object(call.request),state=object(request?.state),context=object(state?.entity_context);
    if(!answers||!context)return [];
    const probabilities:NonNullable<Prediction['probabilities']>=[];
    for(const [ordinal,entity] of rows(context.entities).entries()) {
      const key=str(entity.entity_id),presence=object(answers[`entity_${ordinal}`]),salience=object(answers[`main_${ordinal}`]);
      if(key&&number(presence?.noul)!==null)probabilities.push({task:'entity',key,probability:number(presence?.noul)!});
      if(key&&number(salience?.noul)!==null)probabilities.push({task:'salience',key,probability:number(salience?.noul)!});
    }
    const spam=object(answers.spam_or_bot);
    if(number(spam?.noul)!==null)probabilities.push({task:'spam',key:'true',probability:number(spam?.noul)!});
    for(const task of ['voice','act'] as const) {
      const answer=object(answers[task]),key=str(answer?.choice),probability=number(answer?.confidence);
      if(key&&probability!==null)probabilities.push({task,key,probability});
    }
    return probabilities;
  } catch {return [];}
}

export function ledgerCosts(calls:LedgerCall[],attemptedRoots:number):Variant['costs'] {
  const settled=calls.filter(c=>c.status==='settled');
  const unknown=calls.filter(c=>['unknown','submitting','submitted'].includes(c.status));
  const reserved=calls.filter(c=>['reserved','unknown','submitting','submitted'].includes(c.status));
  const dates=calls.flatMap(c=>[Date.parse(c.created_at),Date.parse(c.updated_at)]).filter(Number.isFinite);
  return {settled_usd:settled.every(c=>c.settled_micro_usd!==null)?settled.reduce((sum,c)=>sum+Number(c.settled_micro_usd),0)/1_000_000:null,
    reserved_usd:reserved.reduce((sum,c)=>sum+Number(c.reserved_micro_usd),0)/1_000_000,
    unknown_calls:unknown.length,mentions_attempted:attemptedRoots,wall_ms:dates.length?Math.max(...dates)-Math.min(...dates):null};
}

export function facetPredictions(calls:LedgerCall[],jev=false):Prediction[] {
  const latest=new Map<string,Prediction>();
  for(const call of [...calls].sort((a,b)=>Date.parse(a.updated_at)-Date.parse(b.updated_at))) {
    for(const result of rows(call.results)) {
      const root_id=str(result.root_id),input_digest=str(result.input_digest),status=str(result.status);
      if(!root_id||!input_digest||!['labeled','abstained','refused','error','pending'].includes(status))continue;
      latest.set(root_id,{root_id,input_digest,status:status as Prediction['status'],
        ...(object(result.facets)?{facets:result.facets as Prediction['facets']}:{}),
        ...(jev?{probabilities:jevFacetProbabilities(call)}:{})});
    }
  }
  return [...latest.values()];
}

export function membershipPredictions(calls:LedgerCall[],selectedConcepts?:ReadonlySet<string>):Prediction[] {
  const latest=new Map<string,Prediction>();
  for(const call of [...calls].sort((a,b)=>Date.parse(a.updated_at)-Date.parse(b.updated_at))) {
    for(const result of rows(call.results)) {
      const root_id=str(result.root_id),input_digest=str(result.input_digest),concept_key=str(result.concept_key),verdict=str(result.verdict);
      if(!root_id||!input_digest||!concept_key||(selectedConcepts&&!selectedConcepts.has(concept_key))||
        !['belongs','not_belongs','insufficient','refused','error','pending'].includes(verdict))continue;
      const prior=latest.get(root_id);
      const row:Prediction=prior?.input_digest===input_digest?prior:{root_id,input_digest,status:'labeled',memberships:{}};
      row.memberships![concept_key]=verdict as NonNullable<Prediction['memberships']>[string];
      latest.set(root_id,row);
    }
  }
  return [...latest.values()];
}
