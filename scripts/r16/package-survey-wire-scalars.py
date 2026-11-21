#!/usr/bin/env python3
"""Package exactly four private synthetic Survey-scalar artifacts. No network/DB/Node."""
import argparse,hashlib,json,math,os,re,stat,zipfile
from pathlib import Path
CAPS={'survey-wire-scalars-source.json':8*1024**2,'survey-wire-scalars-parity.json':8*1024**2,'survey-wire-scalars-profile.json':8*1024**2,'survey-wire-scalars.tap':1024**2}
TITLES=['Survey scalar synthetic PostgreSQL matrix preserves rows bounds empty and nullable domains','Survey scalar native PostgreSQL parity preserves source0337 permissions and current scope','Survey scalar native32768 PostgreSQL ABBA reports client and server time without capacity claims']
EMPTY=hashlib.sha256(b'').hexdigest();BEFORE='739613a2fceb44f3c00aa9b8b114efe3fd81a6bd76975841cc725773a2419e24';PRODUCT='97a7d61e77268524ba1f9d1557f54ffa0ba2dc9b154ab256ac683b81aa86a469'
def need(v,code):
 if not v:raise ValueError(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def private(p,cap):
 p=Path(p);s=p.lstat();need(stat.S_ISREG(s.st_mode)and not p.is_symlink()and stat.S_IMODE(s.st_mode)==0o600 and 0<s.st_size<=cap,'private_bounded_file');fd=os.open(p,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
 with os.fdopen(fd,'rb')as f:b=f.read(cap+1);need(len(b)==s.st_size and len(b)<=cap,'private_read_changed')
 return b
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'duplicate_JSON');d[k]=v
 return d
def bad(x):raise ValueError('nonfinite_JSON')
def number(x):
 n=float(x);need(math.isfinite(n),'nonfinite_JSON');return n
def parse(raw):
 text=raw.decode('utf8');depth=0;quoted=False;escaped=False;tokens=0
 for c in text:
  if quoted:
   if escaped:escaped=False
   elif c=='\\':escaped=True
   elif c=='"':quoted=False
  elif c=='"':quoted=True
  elif c in '[{':depth+=1;need(depth<=192,'JSON_depth')
  elif c in ']}':depth-=1;need(depth>=0,'JSON_structure')
  if not quoted and c in '{}[],:':tokens+=1;need(tokens<=2000000,'JSON_tokens')
 need(not quoted and depth==0,'JSON_unclosed');return json.loads(text,object_pairs_hook=pairs,parse_constant=bad,parse_float=number)
def full_source(x):
 need(type(x)is dict and set(x)=={'head_sha','source_tree_sha256','tree_status_sha256','file_count','file_manifest'}and re.fullmatch('[a-f0-9]{40}',str(x['head_sha']))and type(x['file_count'])is int and 0<x['file_count']<=10000 and x['tree_status_sha256']=='sha256:'+EMPTY,'full_source_shape')
 rows=x['file_manifest'];need(type(rows)is list and len(rows)==x['file_count'],'source_count');paths=[];tuples=[]
 for row in rows:
  need(type(row)is dict and set(row)=={'path','sha256'}and type(row['path'])is str and not row['path'].startswith('/')and '..'not in row['path'].split('/')and re.fullmatch('sha256:[a-f0-9]{64}',str(row['sha256'])),'source_entry');paths.append(row['path']);tuples.append([row['path'],row['sha256']])
 need(paths==sorted(set(paths))and x['source_tree_sha256']=='sha256:'+sha(json.dumps(tuples,ensure_ascii=False,separators=(',',':')).encode()),'source_tuple')
def flags(x):
 for k,v in {'diagnostic_only':True,'cpu':'UNKNOWN','gain_claim':False,'capacity_claim':False,'H1_accepted':False,'external_provider_requests':0,'external_provider_spend_micro_usd':0}.items():need(type(x.get(k))is type(v)and x[k]==v,'diagnostic_only_claims')
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--directory',required=True);ap.add_argument('--tap',required=True);ap.add_argument('--output',required=True);a=ap.parse_args()
 try:
  root=Path(a.directory);s=root.lstat();need(stat.S_ISDIR(s.st_mode)and not root.is_symlink()and stat.S_IMODE(s.st_mode)==0o700,'private_directory')
  tap=Path(a.tap);need(tap.name=='survey-wire-scalars.tap','tap_basename');allowed=set(CAPS)-{'survey-wire-scalars.tap'};actual={p.name for p in root.iterdir()};need(actual in (allowed,allowed|{'survey-wire-scalars.tap'}),'exact_artifact_directory')
  if 'survey-wire-scalars.tap'in actual:need(tap.resolve()==(root/'survey-wire-scalars.tap').resolve(),'tap_path_conflict')
  data={name:private(tap if name.endswith('.tap')else root/name,cap)for name,cap in CAPS.items()};need(sum(map(len,data.values()))<=32*1024**2 and len(data)==4 and len(data)<=128,'expanded_census')
  docs={name:parse(raw)for name,raw in data.items()if name.endswith('.json')};source=docs['survey-wire-scalars-source.json'];parity=docs['survey-wire-scalars-parity.json'];profile=docs['survey-wire-scalars-profile.json']
  for d,c in [(source,'r16-survey-wire-scalars-source-v1'),(parity,'r16-survey-wire-scalars-parity-v1'),(profile,'r16-survey-wire-scalars-profile-v1')]:need(d.get('contract')==c,'artifact_contract');flags(d)
  sources=source['source'];need(set(sources)=={'expected_git','before','after'},'all_three_full_source_objects')
  for x in sources.values():full_source(x)
  need(sources['before']==sources['expected_git']==sources['after'],'complete_all_fields_and_entries_equal')
  control=source['control'];need(control.get('contract')=='r16-survey-wire-scalars-workflow-control-v1','workflow_control_contract')
  github=control['github'];need(all(type(github.get(k))is str and github[k]for k in ['GITHUB_SHA','GITHUB_REF','GITHUB_EVENT_NAME','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'])and re.fullmatch('[a-f0-9]{40}',github['GITHUB_SHA'])and github['GITHUB_EVENT_NAME']=='workflow_dispatch'and github['GITHUB_RUN_ID'].isdigit()and github['GITHUB_RUN_ATTEMPT'].isdigit(),'actual_GHA_context')
  for name,path in [('workflow','.github/workflows/mfp-postgres.yml'),('packager','scripts/r16/package-survey-wire-scalars.py')]:
   row=control[name];need(row.get('path')==path,'control_path')
   need(type(row.get('sha256_before'))is str and re.fullmatch('[a-f0-9]{64}',row['sha256_before'])and row.get('sha256_before')==row.get('sha256_after'),'actual_pre_post_code_hash')
  need(control['git_status']=={'sha256_before':EMPTY,'sha256_after':EMPTY,'clean_before':True,'clean_after':True},'actual_Git_clean_before_after')
  selfraw=Path(__file__).read_bytes();need(sha(selfraw)==control['packager']['sha256_before'],'actual_packager_self_pin')
  entries={x['path']:x['sha256']for x in sources['expected_git']['file_manifest']}
  # The existing full-source extension contract excludes .py; explicit verified
  # packager pre/post control above binds these bytes without changing that canon.
  need(source['product_reader']=={'source353_sha256':PRODUCT,'actual_sha256':PRODUCT,'activated':False}and entries.get('infrastructure/db/signal-listening-runs.ts')=='sha256:'+PRODUCT,'product_reader_remains_Source353')
  need(source['native_wire'].get('migration_sha256')=='5af216411e8924fa757b3ecae5ae574cb8737ca754f7c06a27eec455396980eb'and source['native_wire'].get('runtime_checked')is True,'native0337_source_binding')
  need(parity.get('all_complete_rows_compared')is True and len(parity.get('cases',[]))>=10 and type(parity.get('runtime_witness'))is dict,'complete_native_parity_receipt')
  witness=parity['runtime_witness'];need(witness.get('before')is not None and witness.get('before')==witness.get('after')and all(type(witness.get(k))is dict and witness[k].get('before')is not None and witness[k]['before']==witness[k].get('after')for k in ['main_money','compact','answer_guard']),'four_MAIN_before_after_exact')
  need(profile.get('params_redacted')is True and profile.get('auto_explain_used')is False and profile.get('materiality_gate')is False,'profile_scope')
  cases=profile.get('cases');need(type(cases)is list and {x['name']for x in cases}=={'base4096','full-null','empty','first-oversize','consumer-mixed4096'}and len(cases)==5,'exact_five_profile_cases')
  order=['old','new','new','old','new','old','old','new']
  for case in cases:
   need(case.get('old_raw_sha256')==BEFORE,'old_SQL_pin')
   need(re.fullmatch('[a-f0-9]{64}',str(case.get('new_raw_sha256')))and case['new_raw_sha256']!=BEFORE and case.get('parity')is True and case.get('order')==order and len(case.get('samples',[]))==8 and [x.get('arm')for x in case['samples']]==order,'balanced_profile_samples')
   need(case.get('cpu')=='UNKNOWN'and case.get('gain_claim')is False and case.get('capacity_claim')is False and case.get('materiality_gate')is False,'case_not_acceptance')
   for sample in case['samples']:
    need(all(type(sample.get(k))in(int,float)and math.isfinite(sample[k])and sample[k]>=0 for k in ['client_wall_ms','server_execution_ms','server_planning_ms','result_read_client_ms']),'finite_elapsed_clocks')
    need(sample.get('rows')==case['complete_row_count']and sample.get('rows_sha256')==case['complete_rows_sha256'],'all_complete_rows_per_sample')
  text=data['survey-wire-scalars.tap'].decode('utf8');need(re.findall(r'^# Subtest: (.*)$',text,re.M)==TITLES and re.findall(r'^ok \d+ - (.*)$',text,re.M)==TITLES,'exact_three_TAP_titles')
  for k,v in {'tests':3,'pass':3,'fail':0,'cancelled':0,'skipped':0,'todo':0}.items():need(re.findall(r'^# '+k+r' (\d+)$',text,re.M)==[str(v)],'exact_TAP_census')
  need(re.findall(r'^1\.\.(\d+)$',text,re.M)==['3'],'TAP_complete_plan')
  output=Path(a.output);need(not os.path.lexists(output),'new_ZIP_only');fd=os.open(output,os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w+b')as f:
   with zipfile.ZipFile(f,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9)as z:
    for name,raw in sorted(data.items()):z.writestr(name,raw)
   f.flush();os.fsync(f.fileno());need(f.tell()<16*1024**2,'raw_ZIP_cap')
  # Preserve source artifacts and any over-cap ZIP; no cleanup or retry.
  for name,raw in data.items():need(private(tap if name.endswith('.tap')else root/name,CAPS[name])==raw,'input_changed_during_package')
  need(sha(Path(__file__).read_bytes())==control['packager']['sha256_before'],'packager_changed_during_package')
  print(json.dumps({'status':'packaged_diagnostic_only','path':str(output),'bytes':output.stat().st_size,'sha256':sha(output.read_bytes()),'entries':4,'expanded_bytes':sum(map(len,data.values())),'CPU':'UNKNOWN','H1_accepted':False}))
 except Exception as e:print(json.dumps({'status':'rejected_preserve_no_retry','error_class':type(e).__name__,'H1_accepted':False}));raise SystemExit(1)
if __name__=='__main__':main()
