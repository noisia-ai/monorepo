/** Interpret a Signal calendar boundary in its selected IANA timezone, independent
 * of the browser/server timezone. The end date is inclusive in the filter. */
export function signalListeningDateBoundaryV1(value:string,timezone:string,end=false):string{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('listening_date_invalid');
  const calendar=new Date(`${value}T00:00:00Z`);
  if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==value)throw Error('listening_date_invalid');
  if(end)calendar.setUTCDate(calendar.getUTCDate()+1);
  const target=calendar.getTime(),formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let instant=target;
  for(let iteration=0;iteration<4;iteration++){
    const parts=Object.fromEntries(formatter.formatToParts(instant).map(part=>[part.type,part.value]));
    const observed=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));
    const difference=target-observed;
    if(!difference)return new Date(instant).toISOString();
    instant+=difference;
  }
  throw Error('listening_date_boundary_unavailable');
}
