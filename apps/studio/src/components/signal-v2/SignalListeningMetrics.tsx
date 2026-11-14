'use client';
import {useEffect,useState} from 'react';
import {useLocale,useTranslations} from 'next-intl';
import type {SignalListeningConfigurationV1} from '@noisia/query-engine';
import type {SignalListeningQuestionMetricsV1} from '@noisia/db';
import {signalListeningDateBoundaryV1} from '../../lib/data-os/signal-listening-date';

type Status={configuration:{id:string;configuration:SignalListeningConfigurationV1}|null;map:{id:string}|null};
export function SignalListeningMetrics({workspaceId,from,to,timezone,granularity='day'}:{workspaceId:string;
  from:string;to:string;timezone:string;granularity?:'day'|'week'|'month'}){
  const locale=useLocale(),t=useTranslations('Listening'),[status,setStatus]=useState<Status|null>(null),[question,setQuestion]=useState(''),[topic,setTopic]=useState('');
  const [metrics,setMetrics]=useState<SignalListeningQuestionMetricsV1|null>(null),[error,setError]=useState(false),[outside,setOutside]=useState(false),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[statusRetry,setStatusRetry]=useState(0);
  const url=`/api/data-os/signal/${encodeURIComponent(workspaceId)}/listening`;
  useEffect(()=>{
    const controller=new AbortController();setStatus(null);setMetrics(null);setError(false);setQuestion('');setTopic('');
    fetch(url,{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if([403,404].includes(response.status))return;if(!response.ok)throw Error();const next=await response.json()as Status;
      if(!controller.signal.aborted){setStatus(next);setQuestion(next.configuration?.configuration.questions[0]?.key??'');}
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[url,statusRetry]);
  const configurationId=status?.configuration?.id,mapId=status?.map?.id;
  useEffect(()=>{
    if(!question||!configurationId||!mapId)return;
    const controller=new AbortController();setBusy(true);setError(false);setMetrics(null);
    let params:URLSearchParams;
    try{params=new URLSearchParams({question_key:question,timezone,granularity,include_outside:String(outside),
      from:signalListeningDateBoundaryV1(from,timezone),to:signalListeningDateBoundaryV1(to,timezone,true),...(topic?{topic_key:topic}:{})});}
    catch{setError(true);setBusy(false);return;}
    fetch(`${url}/metrics?${params}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if(!response.ok)throw Error();const next=await response.json()as SignalListeningQuestionMetricsV1;
      if(next.contract_version!=='signal-listening-question-metrics-v1'||next.configuration_id!==configurationId||next.question_key!==question)throw Error();
      if(!controller.signal.aborted)setMetrics(next);
    }).catch(()=>{if(!controller.signal.aborted)setError(true);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[url,question,topic,from,to,timezone,granularity,configurationId,mapId,retry,outside]);
  if(!status?.configuration&&!error)return null;
  const configuration=status?.configuration?.configuration;
  return <section className="signal-v2-card" aria-busy={busy}>
    <header className="signal-v2-card__heading"><h2>{t('metricsTitle')}</h2></header>
    {error?<p role="alert">{t('error')} <button className="signal-v2-tertiary-button" type="button" onClick={()=>status?setRetry(value=>value+1):setStatusRetry(value=>value+1)}>{t('retry')}</button></p>:null}
    {configuration?<div className="admin-form">
      <label className="admin-form-field">{t('selectQuestion')} <select value={question} onChange={event=>setQuestion(event.target.value)}>
        {configuration.questions.filter(row=>outside||row.domain!=='outside').map(row=><option key={row.key} value={row.key}>{row.text}</option>)}
      </select></label>
      <label className="admin-form-field">{t('selectTopic')} <select value={topic} onChange={event=>setTopic(event.target.value)}>
        <option value="">{t('allTopics')}</option>{configuration.questions.filter(row=>row.topic_source&&(outside||row.domain!=='outside')).map(row=><option key={row.key} value={row.key}>{row.localization?.[locale==='en-US'?'en':'es'].name??row.text}</option>)}
      </select></label>
      <label><input type="checkbox" checked={outside} onChange={event=>{setOutside(event.target.checked);setQuestion('voice');setTopic('');}}/> {t('includeOutside')}</label>
    </div>:null}
    {metrics?<SignalListeningMetricTables metrics={metrics} topicNames={Object.fromEntries((configuration?.questions??[]).filter(row=>row.topic_source).map(row=>[row.key,row.localization?.[locale==='en-US'?'en':'es'].name??row.text]))}/>:busy?<p role="status">{t('loading')}</p>:null}
  </section>;
}
export function SignalListeningMetricTables({metrics,topicNames={}}:{metrics:SignalListeningQuestionMetricsV1;topicNames?:Record<string,string>}){
  const t=useTranslations('Listening');
  return <>
    <p>{t('answered')}: {metrics.counts.asked} / {metrics.counts.eligible} {t('eligible')} · {t('unasked')}: {metrics.counts.pending}</p>
    {!metrics.counts.asked?<p>{t('empty')}</p>:null}
    <h3>{t('distribution')}</h3><table className="admin-table"><thead><tr><th>{t('option')}</th><th>{t('answered')}</th></tr></thead>
      <tbody>{metrics.distribution.map(row=><tr key={row.option_key}><td>{row.option_key}</td><td>{row.count}</td></tr>)}</tbody></table>
    <h3>{t('trend')}</h3><table className="admin-table"><thead><tr><th>{t('date')}</th><th>{t('answered')}</th><th>{t('unasked')}</th><th>{t('distribution')}</th></tr></thead>
      <tbody>{metrics.trend.map(row=><tr key={row.bucket}><td>{row.bucket}</td><td>{row.asked}</td><td>{row.pending}</td><td>{Object.keys(row.choices).length?Object.entries(row.choices).map(([key,value])=>`${key}: ${value}`).join(' · '):`${t('positiveAnswer')}: ${row.positive} · ${t('negativeAnswer')}: ${row.negative} · ${t('uncertainAnswer')}: ${row.uncertain}`}</td></tr>)}</tbody></table>
    <h3>{t('topicCross')}</h3><table className="admin-table"><thead><tr><th>{t('topic')}</th><th>{t('answered')}</th><th>{t('distribution')}</th></tr></thead>
      <tbody>{metrics.topic_cross.map(row=><tr key={row.topic_key}><td>{topicNames[row.topic_key]??row.topic_key}</td><td>{row.asked} / {row.eligible}</td><td>{Object.keys(row.choices).length?Object.entries(row.choices).map(([key,value])=>`${key}: ${value}`).join(' · '):`${t('positiveAnswer')}: ${row.positive}`}</td></tr>)}</tbody></table>
  </>;
}
