export function currentStageBalanceV3(balance:{source:string;available_micro_usd:number;observed_at:string;reserved_for_other_lanes_micro_usd?:number},estimate:number,now=Date.now()){
 const observed=Date.parse(balance.observed_at),reserve=balance.reserved_for_other_lanes_micro_usd??0;
 if(balance.source!=='anthropic_console'||!Number.isSafeInteger(balance.available_micro_usd)||balance.available_micro_usd<0||!Number.isFinite(observed)||now-observed>30*60*1000||observed>now)throw new Error('mfp_v3_current_balance_required');
 if(!Number.isSafeInteger(reserve)||reserve<0||!Number.isSafeInteger(estimate)||estimate<0)throw new Error('mfp_v3_balance_reservation_invalid');
 const available=balance.available_micro_usd-reserve;
 if(available<estimate)throw new Error('mfp_v3_credit_insufficient_before_stage');
 return available;
}

/** Corpus/model text is untrusted data, never a provider billing signal. */
export function batchCreditInsufficientV3(resultType:string,rawText:string){
 return resultType==='errored'&&/credit[_ ]balance|insufficient[_ ]credit/i.test(rawText);
}
