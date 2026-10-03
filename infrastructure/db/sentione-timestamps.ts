import { DateTime, IANAZone } from "luxon";

export type SentioneTimestampErrorCode =
  | "source_timezone_required" | "source_timezone_invalid"
  | "source_timestamp_required" | "source_timestamp_invalid"
  | "source_timestamp_ambiguous" | "source_timestamp_nonexistent";

export class SentioneTimestampError extends Error {
  constructor(readonly code: SentioneTimestampErrorCode, readonly field?: "Created" | "Added to system") {
    // Error receipts identify the column, never expose the source row or its contents.
    super(field ? `${code}: ${field}` : code);
    this.name="SentioneTimestampError";
  }
}

// Supported source forms are calendar dates or ISO/SentiOne local timestamps, with
// optional millisecond precision and explicit Z/+HH:MM/+HHMM offsets on timed values.
const TIMESTAMP=/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?([Zz]|[+-]\d{2}:?\d{2})?)?$/u;

/** A parser belongs to one import: its declared source zone never follows the host zone. */
export function createSentioneTimestampParser(sourceTimezone?: string | null) {
  const zone=sourceTimezone?.trim();
  if(sourceTimezone!=null && (!zone || !IANAZone.isValidZone(zone))) {
    throw new SentioneTimestampError("source_timezone_invalid");
  }
  function parse(value: string, field: "Created" | "Added to system", required: boolean): Date | null {
    const input=value.trim();
    if(!input) {
      if(required)throw new SentioneTimestampError("source_timestamp_required",field);
      return null;
    }
    const match=TIMESTAMP.exec(input);
    if(!match)throw new SentioneTimestampError("source_timestamp_invalid",field);
    const units={year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),
      hour:Number(match[4]??0),minute:Number(match[5]??0),second:Number(match[6]??0),
      millisecond:Number((match[7]??"").padEnd(3,"0"))};
    const sameFields=(date:DateTime)=>date.year===units.year && date.month===units.month && date.day===units.day
      && date.hour===units.hour && date.minute===units.minute && date.second===units.second
      && date.millisecond===units.millisecond;
    // Validate the calendar independently of timezone transitions. In particular, 24:00,
    // impossible month days and leap seconds must not normalize into another timestamp.
    const calendar=DateTime.fromObject(units,{zone:"UTC"});
    if(!calendar.isValid || !sameFields(calendar))throw new SentioneTimestampError("source_timestamp_invalid",field);
    const offset=match[8];
    if(offset) {
      if(offset.toUpperCase()!=="Z") {
        const compact=offset.replace(":","");
        if(Number(compact.slice(1,3))>23 || Number(compact.slice(3))>59) {
          throw new SentioneTimestampError("source_timestamp_invalid",field);
        }
      }
      const explicit=DateTime.fromISO(input.replace(" ","T").replace(/z$/u,"Z"),{setZone:true});
      if(!explicit.isValid || !sameFields(explicit))throw new SentioneTimestampError("source_timestamp_invalid",field);
      return new Date(explicit.toMillis());
    }
    if(!zone)throw new SentioneTimestampError("source_timezone_required",field);
    const zoned=DateTime.fromObject(units,{zone});
    if(!zoned.isValid)throw new SentioneTimestampError("source_timestamp_invalid",field);
    // Luxon advances nonexistent wall times by default; that policy is unsuitable for evidence.
    if(!sameFields(zoned))throw new SentioneTimestampError("source_timestamp_nonexistent",field);
    if(zoned.getPossibleOffsets().length!==1)throw new SentioneTimestampError("source_timestamp_ambiguous",field);
    return new Date(zoned.toMillis());
  }
  return {
    required:(value:string,field:"Created"|"Added to system"="Created")=>parse(value,field,true)!,
    optional:(value:string,field:"Created"|"Added to system"="Added to system")=>parse(value,field,false)
  };
}
