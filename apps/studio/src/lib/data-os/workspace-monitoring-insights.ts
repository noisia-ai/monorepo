import {MonitoringInsightsError,type MonitoringInsightAccessV1} from '@noisia/db';
import type {SignalConversationSegmentV1} from '@noisia/query-engine';

export const monitoringInsightHeadersV1={'Cache-Control':'private, no-store'};
/** Only the native request context is accepted. Page dates, supplied packets,
 * provider bodies and arbitrary modes are never forwarded to the store. */
export function monitoringInsightContextV1(request:Request):Pick<MonitoringInsightAccessV1,'conversation_segment'|'locale'>{
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(key=>!['conversation_segment','locale'].includes(key))
  ||params.getAll('conversation_segment').length>1||params.getAll('locale').length>1)
  throw new MonitoringInsightsError('monitoring_insights_context_invalid',422);
 const segment=params.get('conversation_segment')??'conversation',locale=params.get('locale')??'es-MX';
 if(!['all','conversation','advertising','hashtags'].includes(segment)||!['es-MX','en-US'].includes(locale))
  throw new MonitoringInsightsError('monitoring_insights_context_invalid',422);
 return{conversation_segment:segment as SignalConversationSegmentV1,locale:locale as 'es-MX'|'en-US'};
}
export function monitoringInsightBodyV1(value:unknown):value is {quote_digest:string;budget_cap_micro_usd:number}{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const body=value as Record<string,unknown>;
 return Object.keys(body).length===2&&typeof body.quote_digest==='string'&&/^sha256:[a-f0-9]{64}$/.test(body.quote_digest)
  &&body.budget_cap_micro_usd===2000000;
}
export function monitoringInsightErrorV1(error:unknown){
 if(error instanceof MonitoringInsightsError)return Response.json({error:error.code},{status:error.status,headers:monitoringInsightHeadersV1});
 // Network/COMMIT uncertainty is intentionally opaque. The same key remains
 // owned durably; the browser reads status instead of creating another charge.
 return Response.json({error:'monitoring_insights_temporarily_unavailable'},{status:503,headers:monitoringInsightHeadersV1});
}
