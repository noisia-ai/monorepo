/** Server-owned read budget. A reader must select IDs before returning any body. */
export type LabelingInputBoundsV1={max_rows:number;max_working_bytes:number;on_oversize?:'empty'|'error';
 /** Private synchronous notification: only an encountered root exceeds remaining bytes. */
 on_byte_limit?:()=>void;
};
export const LABELING_INPUT_MAX_WORKING_BYTES_V1=512*1024*1024;
export function validateLabelingInputBoundsV1(bounds:LabelingInputBoundsV1,pageSize:number):LabelingInputBoundsV1{
 if(!Number.isSafeInteger(bounds.max_rows)||bounds.max_rows<1||bounds.max_rows>4096
  ||!Number.isSafeInteger(bounds.max_working_bytes)||bounds.max_working_bytes<0||bounds.max_working_bytes>LABELING_INPUT_MAX_WORKING_BYTES_V1
  ||bounds.on_oversize!==undefined&&!['empty','error'].includes(bounds.on_oversize)
  ||bounds.on_byte_limit!==undefined&&typeof bounds.on_byte_limit!=='function')throw Error('labeling_input_bounds_invalid');
 return{...bounds,max_rows:Math.min(bounds.max_rows,pageSize)};
}
/** Stop at the first non-fitting root. Never skip a root, reserve, or advance a cursor. */
export function selectLabelingInputPrefixV1<T extends{root_id:string;working_bytes:number|string}>(rows:T[],bounds:LabelingInputBoundsV1):string[]{
 const selected:string[]=[];let total=0;
 for(const row of rows){const bytes=Number(row.working_bytes);
  if(!Number.isSafeInteger(bytes)||bytes<8192)throw Error('labeling_input_metadata_invalid');
  if(selected.length>=bounds.max_rows||bytes>bounds.max_working_bytes-total){
   if(selected.length<bounds.max_rows)bounds.on_byte_limit?.();
   if(!selected.length&&bounds.on_oversize==='error')throw Error('labeling_input_memory_bound');break;
  }
  selected.push(row.root_id);total+=bytes;
 }
 return selected;
}
