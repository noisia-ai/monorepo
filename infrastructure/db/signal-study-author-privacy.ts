import{createHash}from'node:crypto';
import{signalWorkspaceEmbeddingDigestV1 as digest}from'@noisia/query-engine';
export type SignalStudyAuthorMetadataV1={source_author_label_recorded:boolean;source_author_label:string|null;legacy_author:string|null;linked_author_display_name:string|null;linked_author_handle:string|null};
/** Known import/linked author labels are conservatively private. They may be
 * pseudonyms; this is not person detection, legal-name inference, or a claim
 * about voice. Explicit import null suppresses every historical fallback. The
 * caller must load these fields through its authorized workspace/root binding. */
export function signalStudyKnownAuthorPrivacyV1(metadata:SignalStudyAuthorMetadataV1){
 const fields=['source_author_label','legacy_author','linked_author_display_name','linked_author_handle']as const;
 if(typeof metadata.source_author_label_recorded!=='boolean'||fields.some(k=>metadata[k]!==null&&typeof metadata[k]!=='string'))throw Error('study_author_metadata_invalid');
 const selected=metadata.source_author_label_recorded?['source_author_label']as const:['legacy_author','linked_author_display_name','linked_author_handle']as const;
 const provenance:Array<{field:typeof fields[number];sha256:string}>=[],names=new Set<string>();
 for(const field of selected){const label=metadata[field]?.normalize('NFC').trim();if(!label)continue;names.add(label);provenance.push({field,sha256:'sha256:'+createHash('sha256').update(label).digest('hex')});}
 const private_person_names=[...names].sort(),contract_version='signal-study-known-author-privacy-v1' as const;
 const metadata_snapshot={contract_version,source_author_label_recorded:metadata.source_author_label_recorded,fields:Object.fromEntries(selected.map(field=>[field,metadata[field]]))};
 return{contract_version,private_person_names,provenance,metadata_snapshot,
  metadata_digest:digest(metadata_snapshot),
  roster_digest:digest(private_person_names)};
}
