"use client";

import {
  ArrowsClockwise,
  BookmarkSimple,
  CheckCircle,
  ClockCounterClockwise,
  FileCsv,
  MagicWand,
  PencilSimple,
  Plug,
  Plus,
  Stack,
  Target,
  UploadSimple,
  UsersThree,
  WarningCircle
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AdminFeedbackState,
  AdminResourceSection,
  AdminStatus,
  formatAdminDate,
  formatAdminNumber
} from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";
import { buildAdminWorkspaceConnectorInput } from "@/lib/data-os/admin-workspace-source-contract";

type PlanSummary = {
  version: number;
  status: string;
  draft_revision: number;
  draft_digest: string;
  effective_from: string | null;
  brand_os_revision: number;
  blockers: string[];
};

type QuerySummary = {
  provider: "sentione";
  version: number;
  source_key: string;
  cadence: "manual" | "ad-hoc" | "daily" | "weekly" | "monthly";
  status: string;
  default_period: { start: string;end: string;timezone: string } | null;
  timezone: string;
  origin: "operator" | "legacy-query-pack" | "engine-generated";
  generation_state: "generated" | "generated_with_fallback";
  fallback: { used: boolean;reason: string | null } | null;
  review: { status: "pending" | "approved" | "rejected";reviewed_at: string | null };
};

type QueryGenerationPreflight = {
  readiness:"ready"|"blocked";blockers:string[];plan_version:number|null;
  required_slots:Array<{slot_key:string;scope:"primary_brand"|"category"|"competitor";
    label:string;state:"not_generated"|"generated"|"generated_with_fallback"}>;
  slot_count:number;maximum_provider_calls:number;
  provider:{key:string;model:string;pricing_version:string};
  budget:{estimated_max_cost_usd:string;hard_cap_usd:string;within_hard_cap:boolean};
  runtime:{provider_configured:boolean};
};

type QueryDetail = {
  slot_key:string;query_version:number;query_text:string;status:string;
  origin:"operator"|"legacy-query-pack"|"engine-generated";
  generation_state:"generated"|"generated_with_fallback";
  validation_summary:{fallback_used:boolean;fallback_reason:string|null};
  lineage:{model:string|null;pipeline_version:string|null;generated_at:string|null};
  structured_terms:{include:string[];exclude:string[];aliases:string[]};
  cadence:string;default_period:{start:string;end:string;timezone:string}|null;
  review:{status:"pending"|"approved"|"rejected";reviewed_at:string|null};
  previous_query_text?:string|null;
};

type PlanSlot = {
  slot_key: string;
  scope: "primary_brand" | "competitor" | "category" | "reference";
  label: string;
  desired_state: "active" | "retired";
  plan_status: "current" | "draft" | "retired";
  plan_version: number;
  query_versions: QuerySummary[];
  blockers: string[];
  warnings: string[];
};

type ReferenceCandidate = {
  identity_key: string;
  label: string;
  decision: "include" | "exclude" | "revert" | "undecided";
};

type PlanPayload = {
  contract_version: string;
  state: "missing" | "draft" | "ready" | "current" | "stale" | string;
  current_plan: PlanSummary | null;
  draft_plan: PlanSummary | null;
  slots: PlanSlot[];
  reference_candidates: ReferenceCandidate[];
  readiness: { ready_to_promote: boolean;ready_for_import:boolean;
    query_playbook_complete:boolean;blockers: string[];warnings:string[] };
};

type AcquisitionBriefContext = {
  contract_version:"signal-acquisition-brief-management-v1";
  status:"missing"|"sealed"|"stale";
  revision_token:string;
  values:{
    objective:string;purpose:string;market_country:string|null;countries:string[];languages:string[];
    default_capture_period:{start:string;end:string}|null;target_window_months:number|null;
    construction_mode:"exploratory"|"detection";include_knowledge_context:boolean;
  };
  options:{countries:Array<{code:string}>;languages:Array<{key:string;label:string}>;
    construction_modes:Array<"exploratory"|"detection">};
  knowledge_context:{available:boolean;source_count:number;included:boolean};
  timezone:string;blockers:string[];
};

type Connector = {
  source_key: string;
  source_contract_version: string;
  name: string;
  provider: string;
  source_type: string;
  connection_method: string;
  governance_readiness: string;
  status: string;
};

type SlotView = {
  slotKey: string;
  label: string;
  scope: PlanSlot["scope"];
  current: PlanSlot | null;
  draft: PlanSlot | null;
};

type ImportItem = {
  id: string;
  status: string;
  phase: string;
  source_file_name: string | null;
  supersedes_import_batch_id: string | null;
  acquisition: {
    slot_key: string;
    query_version: number|null;
    query_evidence:{class:"provider_verified"|"operator_attested"|"unavailable";
      reason:"historical_export"|"provider_did_not_embed_query"|"source_context_unavailable"|"other"|null;
      attested_at:string|null};
    period: { start: string;end: string;timezone: string } | null;
  } | null;
  progress: {
    records_processed: number;bytes_processed: number;bytes_total: number | null;percent: number | null;
  };
  final_counts: {
    record_count: number;included_count: number;excluded_count: number;duplicate_count: number;
  } | null;
  observed:{period:{start:string;end:string}|null;languages:string[];countries:string[];
    platforms:string[];warnings:string[]}|null;
  failure: { code: string;recoverable: boolean } | null;
  recovery?: { recoverable_from_storage: boolean };
  created_at: string;
};

type DrawerState =
  | { mode: "brief" }
  | { mode: "connector" }
  | { mode: "query";slot: SlotView }
  | { mode: "generate" }
  | { mode: "review";slot: SlotView;query: QuerySummary }
  | { mode: "import";slot: SlotView }
  | { mode: "history";slot: SlotView;sourceKey:string }
  | { mode: "promote" }
  | { mode: "reference";reference: ReferenceCandidate }
  | null;

export function AcquisitionPlanManager({
  timezone,
  workspaceId
}: {
  timezone: string;
  workspaceId: string;
}) {
  const t = useTranslations("AdminWorkspace.data.acquisition");
  const common = useTranslations("AdminWorkspace");
  const locale = useLocale();
  const router = useRouter();
  const [plan,setPlan] = useState<PlanPayload | null>(null);
  const [brief,setBrief] = useState<AcquisitionBriefContext | null>(null);
  const [connectors,setConnectors] = useState<Connector[]>([]);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState<string | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [drawer,setDrawer] = useState<DrawerState>(null);
  const [imports,setImports] = useState<ImportItem[] | null>(null);
  const [importResult,setImportResult] = useState<ImportItem | null>(null);
  const [generationPreflight,setGenerationPreflight] = useState<QueryGenerationPreflight | null>(null);
  const [generationConfirmed,setGenerationConfirmed] = useState(false);
  const [generationHardCap,setGenerationHardCap] = useState("1.00");
  const [generationSourceKey,setGenerationSourceKey] = useState("");
  const [queryDetail,setQueryDetail] = useState<QueryDetail | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const uploadRef = useRef<XMLHttpRequest | null>(null);

  const loadState = useCallback(async (quiet = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [planResponse,sourceResponse] = await Promise.all([
        fetch(`/api/data-os/signal/${workspaceId}/acquisition-plan`,{
          cache: "no-store",signal: controller.signal
        }),
        fetch(`/api/data-os/signal/${workspaceId}/sources`,{
          cache: "no-store",signal: controller.signal
        })
      ]);
      const planPayload = await planResponse.json() as PlanPayload & { message?: string };
      const sourcePayload = await sourceResponse.json() as { sources?: Connector[];message?: string };
      if (!planResponse.ok) throw new Error(planPayload.message ?? t("errors.load"));
      if (!sourceResponse.ok) throw new Error(sourcePayload.message ?? t("errors.sources"));
      setPlan(planPayload);
      setConnectors((sourcePayload.sources ?? []).filter((source) => (
        source.source_contract_version === "signal-data-source-connector-v1"
      )));
      if(planPayload.draft_plan){
        const briefResponse=await fetch(`/api/data-os/signal/${workspaceId}/acquisition-plan/brief`,{
          cache:"no-store",signal:controller.signal
        });
        const briefPayload=await briefResponse.json() as AcquisitionBriefContext&{message?:string};
        if(!briefResponse.ok)throw new Error(briefPayload.message??t("errors.briefLoad"));
        setBrief(briefPayload);
      }else setBrief(null);
    } catch (loadError) {
      if (!isAbort(loadError)) setError(message(loadError,t("errors.load")));
    } finally {
      if (!quiet) setLoading(false);
    }
  },[t,workspaceId]);

  useEffect(() => {
    const uploadRequest = uploadRef;
    void loadState();
    return () => {
      requestRef.current?.abort();
      uploadRequest.current?.abort();
    };
  },[loadState]);

  const slotViews = useMemo(() => buildSlotViews(plan?.slots ?? []),[plan?.slots]);
  const activeConnectors = useMemo(
    () => connectors.filter((source) => source.status === "active"),
    [connectors]
  );

  const closeDrawer = () => {
    if (busy) return;
    uploadRef.current?.abort();
    setDrawer(null);
    setImports(null);
    setImportResult(null);
    setGenerationPreflight(null);
    setGenerationConfirmed(false);
    setQueryDetail(null);
    setError(null);
  };

  const reconcile = async () => {
    setBusy("reconcile");setError(null);
    try {
      const result = await postJson<PlanPayload>(
        `/api/data-os/signal/${workspaceId}/acquisition-plan`,
        {
          expected_current_version: plan?.current_plan?.version ?? null,
          expected_brand_os_revision:
            plan?.state==="stale"?null:
              plan?.draft_plan?.brand_os_revision ?? plan?.current_plan?.brand_os_revision ?? null
        }
      );
      setPlan(result);
      return result;
    } catch (operationError) {
      setError(message(operationError,t("errors.reconcile")));
      return null;
    } finally { setBusy(null); }
  };

  const openQuery = async (slot: SlotView) => {
    if (plan?.draft_plan && slot.draft) {
      setDrawer({ mode: "query",slot });
      return;
    }
    const next = await reconcile();
    const nextSlot = buildSlotViews(next?.slots ?? []).find((item) => item.slotKey===slot.slotKey);
    if (nextSlot?.draft) setDrawer({ mode: "query",slot: nextSlot });
  };

  const loadGenerationPreflight = async (sourceKey=generationSourceKey,hardCap=generationHardCap) => {
    if(!sourceKey||!hardCap.trim())return;
    setBusy("generation-preflight");setError(null);setGenerationConfirmed(false);
    try{
      const params=new URLSearchParams({source_key:sourceKey,hard_cap_usd:hardCap.trim()});
      const response=await fetch(`/api/data-os/signal/${workspaceId}/acquisition-plan/query-generation?${params}`,{cache:"no-store"});
      const payload=await response.json() as QueryGenerationPreflight&{message?:string};
      if(!response.ok)throw new Error(payload.message??t("errors.generationPreflight"));
      setGenerationPreflight(payload);
    }catch(operationError){setError(message(operationError,t("errors.generationPreflight")));}
    finally{setBusy(null);}
  };

  const openGeneration = async () => {
    let next=plan;
    if(!plan?.draft_plan)next=await reconcile();
    if(!next?.draft_plan)return;
    const sourceKey=activeConnectors[0]?.source_key??"";
    setGenerationSourceKey(sourceKey);setGenerationHardCap("1.00");setGenerationPreflight(null);
    setGenerationConfirmed(false);setError(null);setDrawer({mode:"generate"});
    if(sourceKey)window.setTimeout(()=>void loadGenerationPreflight(sourceKey,"1.00"),0);
  };

  const loadBrief = async () => {
    const response=await fetch(`/api/data-os/signal/${workspaceId}/acquisition-plan/brief`,{cache:"no-store"});
    const payload=await response.json() as AcquisitionBriefContext&{message?:string};
    if(!response.ok)throw new Error(payload.message??t("errors.briefLoad"));
    setBrief(payload);return payload;
  };

  const openBrief = async () => {
    setBusy("brief-load");setError(null);
    try{
      let next=plan;
      if(!next?.draft_plan||next.state==="stale"||brief?.status==="stale")next=await reconcile();
      if(!next?.draft_plan)return;
      await loadBrief();setDrawer({mode:"brief"});
    }catch(operationError){setError(message(operationError,t("errors.briefLoad")));}
    finally{setBusy(null);}
  };

  const saveBrief = async (form:FormData) => {
    if(!brief)return;
    const start=String(form.get("period_start")??"");
    const end=String(form.get("period_end")??"");
    if((start&&!end)||(!start&&end)||start>end){setError(t("errors.periodPair"));return;}
    setBusy("brief");setError(null);
    try{
      const result=await postJson<AcquisitionBriefContext>(
        `/api/data-os/signal/${workspaceId}/acquisition-plan/brief`,{
          revision_token:brief.revision_token,
          objective:String(form.get("objective")??""),purpose:String(form.get("purpose")??""),
          market_country:String(form.get("market_country")??"")||null,
          countries:form.getAll("countries").map(String),languages:form.getAll("languages").map(String),
          default_capture_period:start&&end?{start,end}:null,
          target_window_months:Number(form.get("target_window_months")??12),
          construction_mode:String(form.get("construction_mode")??"exploratory"),
          include_knowledge_context:form.get("include_knowledge_context")==="on"
        }
      );
      setBrief(result);await loadState(true);router.refresh();
      const sourceKey=activeConnectors[0]?.source_key??"";
      if(sourceKey){
        setGenerationSourceKey(sourceKey);setGenerationHardCap("1.00");setGenerationConfirmed(false);
        setDrawer({mode:"generate"});
        window.setTimeout(()=>void loadGenerationPreflight(sourceKey,"1.00"),0);
      }else setDrawer(null);
    }catch(operationError){setError(message(operationError,t("errors.briefSave")));}
    finally{setBusy(null);}
  };

  const generateQueries = async () => {
    if(!generationPreflight||!generationConfirmed)return;
    setBusy("generate");setError(null);
    try{
      await postJson(`/api/data-os/signal/${workspaceId}/acquisition-plan/query-generation`,{
        source_key:generationSourceKey,hard_cap_usd:generationPreflight.budget.hard_cap_usd,
        confirmation:true
      });
      setDrawer(null);setGenerationPreflight(null);setGenerationConfirmed(false);
      await loadState(true);router.refresh();
    }catch(operationError){setError(message(operationError,t("errors.generate")));}
    finally{setBusy(null);}
  };

  const openReview = async (slot:SlotView,query:QuerySummary) => {
    setDrawer({mode:"review",slot,query});setQueryDetail(null);setBusy("review-detail");setError(null);
    try{
      const path=(version:number)=>`/api/data-os/signal/${workspaceId}/acquisition-plan/slots/${encodeURIComponent(slot.slotKey)}/query-versions/${version}`;
      const previous=activeQuery(slot.current);
      const [detailResponse,previousResponse]=await Promise.all([
        fetch(path(query.version),{cache:"no-store"}),
        previous&&previous.version!==query.version?fetch(path(previous.version),{cache:"no-store"}):Promise.resolve(null)
      ]);
      const detail=await detailResponse.json() as QueryDetail&{message?:string};
      if(!detailResponse.ok)throw new Error(detail.message??t("errors.queryDetail"));
      let previousText:string|null=null;
      if(previousResponse?.ok){const prior=await previousResponse.json() as QueryDetail;previousText=prior.query_text;}
      setQueryDetail({...detail,previous_query_text:previousText});
    }catch(operationError){setError(message(operationError,t("errors.queryDetail")));}
    finally{setBusy(null);}
  };

  const reviewQuery = async (slot:SlotView,query:QuerySummary,form:FormData) => {
    setBusy("review-query");setError(null);
    try{
      await postJson(`/api/data-os/signal/${workspaceId}/acquisition-plan/slots/${encodeURIComponent(slot.slotKey)}/query-versions/${query.version}`,{
        decision:String(form.get("decision")??"approved"),evidence:String(form.get("evidence")??"")
      });
      setDrawer(null);setQueryDetail(null);await loadState(true);router.refresh();
    }catch(operationError){setError(message(operationError,t("errors.review")));}
    finally{setBusy(null);}
  };

  const createConnector = async (form: FormData) => {
    setBusy("connector");setError(null);
    try {
      await postJson(`/api/data-os/signal/${workspaceId}/sources`,buildAdminWorkspaceConnectorInput({
        name: String(form.get("name") ?? ""),provider: "sentione"
      }));
      setDrawer(null);
      await loadState(true);
      router.refresh();
    } catch (operationError) {
      setError(message(operationError,t("errors.connector")));
    } finally { setBusy(null); }
  };

  const saveQuery = async (slot: SlotView,form: FormData) => {
    const start = String(form.get("period_start") ?? "");
    const end = String(form.get("period_end") ?? "");
    if ((start && !end) || (!start && end)) {
      setError(t("errors.periodPair"));
      return;
    }
    setBusy("query");setError(null);
    try {
      await postJson(
        `/api/data-os/signal/${workspaceId}/acquisition-plan/slots/${encodeURIComponent(slot.slotKey)}/query-versions`,
        {
          source_key: String(form.get("source_key") ?? ""),
          provider: "sentione",
          provider_syntax_version: "sentione-query-v1",
          provider_schema_version: "sentione-csv-47-v1",
          query_text: String(form.get("query_text") ?? ""),
          structured_terms: {
            include: termList(form.get("include_terms")),
            exclude: termList(form.get("exclude_terms")),
            aliases: termList(form.get("aliases"))
          },
          cadence: String(form.get("cadence") ?? "manual"),
          default_period: start && end ? { start,end,timezone } : null
        }
      );
      setDrawer(null);
      await loadState(true);
      router.refresh();
    } catch (operationError) {
      setError(message(operationError,t("errors.query")));
    } finally { setBusy(null); }
  };

  const registerExecutedQuery = async (slot:SlotView) => {
    setBusy("query-draft");setError(null);
    try{
      let target=slot;
      if(!plan?.draft_plan){
        const next=await postJson<PlanPayload>(
          `/api/data-os/signal/${workspaceId}/acquisition-plan`,{
            expected_current_version:plan?.current_plan?.version??null,
            expected_brand_os_revision:plan?.current_plan?.brand_os_revision??null
          });
        setPlan(next);
        target=buildSlotViews(next.slots).find((candidate)=>candidate.slotKey===slot.slotKey)??slot;
      }
      setQueryDetail(null);setDrawer({mode:"query",slot:target});
    }catch(operationError){setError(message(operationError,t("errors.query")));}
    finally{setBusy(null);}
  };

  const promote = async (form: FormData) => {
    if (!plan?.draft_plan) return;
    setBusy("promote");setError(null);
    try {
      await postJson(`/api/data-os/signal/${workspaceId}/acquisition-plan/promote`,{
        expected_draft_version: plan.draft_plan.version,
        expected_draft_revision: plan.draft_plan.draft_revision,
        expected_draft_digest: plan.draft_plan.draft_digest,
        effective_from: new Date().toISOString(),
        evidence: String(form.get("evidence") ?? "")
      });
      setDrawer(null);
      await loadState(true);
      router.refresh();
    } catch (operationError) {
      setError(message(operationError,t("errors.promote")));
    } finally { setBusy(null); }
  };

  const decideReference = async (reference: ReferenceCandidate,form: FormData) => {
    setBusy("reference");setError(null);
    try {
      await postJson(`/api/data-os/signal/${workspaceId}/acquisition-plan/reference-decisions`,{
        identity_key: reference.identity_key,
        action: String(form.get("action") ?? "include"),
        evidence: String(form.get("evidence") ?? ""),
        effective_from: new Date().toISOString()
      });
      await postJson<PlanPayload>(`/api/data-os/signal/${workspaceId}/acquisition-plan`,{
        expected_current_version: plan?.current_plan?.version ?? null,
        expected_brand_os_revision:
          plan?.draft_plan?.brand_os_revision ?? plan?.current_plan?.brand_os_revision ?? null
      });
      setDrawer(null);
      await loadState(true);
    } catch (operationError) {
      setError(message(operationError,t("errors.reference")));
    } finally { setBusy(null); }
  };

  const importCsv = async (slot: SlotView,form: FormData) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size===0) {
      setError(t("errors.fileRequired"));return;
    }
    const start=String(form.get("period_start")??"");
    const end=String(form.get("period_end")??"");
    if (!start || !end || start>end) { setError(t("errors.period"));return; }
    const sourceKey=String(form.get("source_key")??"");
    const evidenceClass=String(form.get("query_evidence_class")??"");
    const operatorConfirmed=form.get("operator_confirmed")==="on";
    if(!operatorConfirmed){setError(t("errors.evidenceConfirmation"));return;}
    const queryRef=String(form.get("query_ref")??"");
    const [querySourceKey,queryVersionRaw]=queryRef.split(":");
    const queryVersion=Number(queryVersionRaw);
    const unavailableReason=String(form.get("unavailable_reason")??"historical_export") as
      "historical_export"|"provider_did_not_embed_query"|"source_context_unavailable"|"other";
    const queryEvidence=evidenceClass==="operator_attested"
      ? {class:"operator_attested" as const,query_version:queryVersion,reason:null,
          operator_confirmed:true as const}
      : {class:"unavailable" as const,query_version:null,
          reason:unavailableReason,
          operator_confirmed:true as const};
    if(evidenceClass==="operator_attested"
      && (!Number.isSafeInteger(queryVersion)||queryVersion<1||querySourceKey!==sourceKey)){
      setError(t("errors.queryEvidence"));return;
    }
    setBusy("import");setError(null);setImportResult(null);
    let pollingUrl:string|null=null;
    const key=crypto.randomUUID();
    try {
      const created=await postJson<ImportCreatePayload>(
        `/api/data-os/signal/${workspaceId}/acquisition-plan/imports`,{
          source_key:sourceKey,slot_key:slot.slotKey,query_evidence:queryEvidence,
          period:{start,end,timezone},file_name:file.name,file_size_bytes:file.size,
          content_type:file.type||"text/csv",supersedes_import_key:null
        },key
      );
      pollingUrl=created.polling_url;
      setImportResult(created.import);
      if(created.upload)await uploadMultipart(file,created.upload,(percent)=>setImportResult((current)=>(
        current ? {...current,progress:{...current.progress,percent}} : current
      )),uploadRef);
      const finalized=await postJson<ImportPollPayload>(created.polling_url,{action:"complete-upload"},`${key}:finalize`);
      setImportResult(finalized.import);
      setBusy(null);
      const terminal=await pollImport(finalized.polling_url??created.polling_url,(item)=>setImportResult(item));
      setImportResult(terminal);
      await loadState(true);
      router.refresh();
    } catch (operationError) {
      if(pollingUrl)await reportUploadFailure(pollingUrl,key,isAbort(operationError)?"upload_aborted":"upload_transport_failed");
      if(!isAbort(operationError))setError(message(operationError,t("errors.import")));
    } finally { setBusy(null); }
  };

  const openHistory = async (slot:SlotView,sourceKey:string) => {
    setDrawer({mode:"history",slot,sourceKey});setImports(null);setBusy("history");setError(null);
    try {
      const params=new URLSearchParams({source_key:sourceKey,slot_key:slot.slotKey});
      const response=await fetch(`/api/data-os/signal/${workspaceId}/acquisition-plan/imports?${params}`,{cache:"no-store"});
      const payload=await response.json() as {imports?:ImportItem[];message?:string};
      if(!response.ok)throw new Error(payload.message??t("errors.history"));
      setImports(payload.imports??[]);
    }catch(operationError){setError(message(operationError,t("errors.history")));}
    finally{setBusy(null);}
  };

  const retryImport = async (item:ImportItem) => {
    setBusy(`retry:${item.id}`);setError(null);
    try{
      const result=await postJson<ImportPollPayload>(
        `/api/data-os/signal/${workspaceId}/acquisition-plan/imports/${item.id}`,
        {action:"retry-from-storage"}
      );
      const terminal=await pollImport(result.polling_url??`/api/data-os/signal/${workspaceId}/acquisition-plan/imports/${result.import.id}`,
        (next)=>setImports((current)=>replaceImport(current,next)));
      setImports((current)=>replaceImport(current,terminal));
    }catch(operationError){setError(message(operationError,t("errors.retry")));}
    finally{setBusy(null);}
  };

  const currentSlots=slotViews.filter((slot)=>slot.current?.desired_state==="active").length;
  const draftSlots=slotViews.filter((slot)=>slot.draft?.desired_state==="active").length;
  const configuredSlots=slotViews.filter((slot)=>activeQuery(slot.draft??slot.current)).length;
  const blockers=plan?.state==="current"?[]:plan?.readiness.blockers??[];

  return <>
    <AdminResourceSection
      actions={<div className="admin-workspace-actions">
        <button aria-label={t("actions.refresh")} className="admin-button admin-button--compact" disabled={Boolean(busy)} onClick={()=>void loadState()} type="button">
          <ArrowsClockwise aria-hidden size={14}/>{t("actions.refresh")}
        </button>
        <button className="admin-button" disabled={Boolean(busy)} onClick={()=>void reconcile()} type="button">
          {plan?.draft_plan?t("actions.sync"):plan?.current_plan?t("actions.newDraft"):t("actions.prepare")}
        </button>
        {plan?.draft_plan?<button className="admin-button" disabled={Boolean(busy)||!activeConnectors.length} onClick={()=>void openGeneration()} type="button">
          <MagicWand aria-hidden size={15}/>{configuredSlots?t("actions.regenerate"):t("actions.generate")}
        </button>:null}
        {plan?.draft_plan?<button className="admin-button admin-button--primary" disabled={!plan.readiness.ready_to_promote||Boolean(busy)} onClick={()=>setDrawer({mode:"promote"})} type="button">
          <CheckCircle aria-hidden size={15}/>{t("actions.promote")}
        </button>:null}
      </div>}
      className="admin-acquisition"
      subtitle={t("subtitle")}
      title={t("title")}
    >
      {loading?<AcquisitionSkeleton/>:null}
      {!loading&&error&&!plan?<AdminFeedbackState actions={<button className="admin-button" onClick={()=>void loadState()} type="button">{t("actions.retry")}</button>} body={error} icon={<WarningCircle size={22}/>} title={t("errors.title")} tone="danger"/>:null}
      {!loading&&plan?<>
        <div className="admin-acquisition__overview">
          <div><span>{t("overview.current")}</span><strong>{plan.current_plan?t("overview.version",{version:plan.current_plan.version}):t("states.none")}</strong></div>
          <div><span>{t("overview.draft")}</span><strong>{plan.draft_plan?t("overview.revision",{version:plan.draft_plan.version,revision:plan.draft_plan.draft_revision}):t("states.none")}</strong></div>
          <div><span>{t("overview.slots")}</span><strong>{draftSlots||currentSlots}</strong></div>
          <div><span>{t("overview.configured")}</span><strong>{configuredSlots}</strong></div>
          <div><span>{t("overview.state")}</span><AdminStatus state={planTone(plan.state)}>{t(`states.${plan.state}`)}</AdminStatus></div>
        </div>

        <div className="admin-acquisition__connector-bar">
          <div className="admin-acquisition__connector-copy"><Plug aria-hidden size={17}/><div><strong>{t("connectors.title")}</strong><small>{activeConnectors.length?t("connectors.count",{count:activeConnectors.length}):t("connectors.empty")}</small></div></div>
          <div className="admin-acquisition__connector-actions">
            {activeConnectors.slice(0,2).map((source)=><span className="admin-acquisition__connector" key={source.source_key}>{source.name}</span>)}
            <button className="admin-button admin-button--compact" onClick={()=>setDrawer({mode:"connector"})} type="button"><Plus aria-hidden size={14}/>{t("actions.addConnector")}</button>
          </div>
        </div>

        {plan.draft_plan?<div className="admin-acquisition__connector-bar">
          <div className="admin-acquisition__connector-copy"><BookmarkSimple aria-hidden size={17}/><div>
            <strong>{t("brief.title")}</strong>
            <small>{t(`brief.states.${brief?.status??"missing"}`)}</small>
          </div></div>
          <div className="admin-acquisition__connector-actions">
            <AdminStatus state={brief?.status==="sealed"?"good":brief?.status==="stale"?"danger":"warning"}>
              {t(`brief.badges.${brief?.status??"missing"}`)}
            </AdminStatus>
            <button className="admin-button admin-button--compact" disabled={Boolean(busy)} onClick={()=>void openBrief()} type="button">
              {brief?.status==="missing"?t("actions.prepareBrief"):t("actions.updateBrief")}
            </button>
          </div>
        </div>:null}

        {error&&!drawer?<div className="admin-acquisition__operation-error" role="alert"><WarningCircle aria-hidden size={17}/><span>{error}</span></div>:null}

        {blockers.length?<div className="admin-acquisition__blockers" role="status"><WarningCircle aria-hidden size={17}/><div><strong>{t("blockers.title",{count:blockers.length})}</strong><ul>{blockers.slice(0,6).map((blocker)=><li key={blocker}>{blockerLabel(t,blocker)}</li>)}</ul></div></div>:null}
        {!plan.readiness.query_playbook_complete?<div className="admin-acquisition__blockers" role="status"><WarningCircle aria-hidden size={17}/><div><strong>{t("queryPlaybook.incompleteTitle")}</strong><p>{t("queryPlaybook.incompleteBody")}</p></div></div>:null}

        {slotViews.length===0?<div className="admin-empty"><Target aria-hidden size={24}/><strong>{t("empty.title")}</strong><p>{t("empty.body")}</p><button className="admin-button admin-button--primary" onClick={()=>void reconcile()} type="button">{t("actions.prepare")}</button></div>:<div className="admin-acquisition__slots">
          <div className="admin-acquisition__slots-head"><span>{t("columns.slot")}</span><span>{t("columns.query")}</span><span>{t("columns.state")}</span><span aria-label={t("columns.actions")}/></div>
          {slotViews.map((slot)=>{
            const working=slot.draft??slot.current;
            const draftQuery=activeQuery(slot.draft);
            const currentQuery=activeQuery(slot.current);
            const connector=activeConnectors.find((source)=>source.source_key===(draftQuery??currentQuery)?.source_key);
            const isRetired=working?.desired_state==="retired";
            return <div className="admin-acquisition-slot" data-retired={isRetired||undefined} key={slot.slotKey}>
              <div className="admin-acquisition-slot__identity">{scopeIcon(slot.scope)}<div><strong>{slot.label}</strong><small>{t(`scopes.${slot.scope}`)}</small></div></div>
              <div className="admin-acquisition-slot__query">{draftQuery??currentQuery?<><strong>{connector?.name??t("connectors.unavailable")}</strong><small>{t("query.summary",{version:(draftQuery??currentQuery)!.version,cadence:t(`cadence.${(draftQuery??currentQuery)!.cadence}`)})}</small>{(draftQuery??currentQuery)?.origin==="engine-generated"?<small>{(draftQuery??currentQuery)?.fallback?.used?t("query.generatedFallback"):t("query.generated")}</small>:null}</>:<><strong>{t("query.missing")}</strong><small>{t("query.missingHelp")}</small></>}</div>
              <div className="admin-acquisition-slot__state"><AdminStatus state={isRetired?"not_available":draftQuery?.review.status==="approved"?"good":draftQuery?.review.status==="rejected"?"danger":draftQuery?"warning":currentQuery?"good":"warning"}>{isRetired?t("states.retired"):draftQuery?t(`review.states.${draftQuery.review.status}`):currentQuery?t("states.current"):t("states.pending")}</AdminStatus>{slot.draft&&slot.current?<small>{t("states.currentPreserved",{version:slot.current.plan_version})}</small>:null}</div>
              <div className="admin-acquisition-slot__actions">
                {slot.draft&&draftQuery&&!isRetired?<button className="admin-button admin-button--compact" disabled={Boolean(busy)} onClick={()=>void openReview(slot,draftQuery)} type="button"><CheckCircle aria-hidden size={14}/>{t("actions.review")}</button>:null}
                {slot.draft&&!draftQuery&&!isRetired?<button className="admin-button admin-button--compact" disabled={Boolean(busy)} onClick={()=>void openQuery(slot)} type="button"><PencilSimple aria-hidden size={14}/>{t("actions.manualQuery")}</button>:null}
                {slot.current&&!isRetired?<button className="admin-button admin-button--compact" disabled={Boolean(busy)||plan.state==="stale"||!activeConnectors.length} onClick={()=>{setImportResult(null);setDrawer({mode:"import",slot});}} type="button"><UploadSimple aria-hidden size={14}/>{t("actions.import")}</button>:null}
                {slot.current&&activeConnectors[0]?<button aria-label={t("actions.history")} className="admin-button admin-button--plain" disabled={Boolean(busy)} onClick={()=>void openHistory(slot,currentQuery?.source_key??activeConnectors[0]!.source_key)} type="button"><ClockCounterClockwise aria-hidden size={15}/></button>:null}
              </div>
            </div>;
          })}
        </div>}

        {plan.reference_candidates.length?<div className="admin-acquisition__references"><header><div><h3>{t("references.title")}</h3><p>{t("references.subtitle")}</p></div></header>{plan.reference_candidates.map((reference)=><div className="admin-acquisition-reference" key={reference.identity_key}><div><strong>{reference.label}</strong><small>{t(`references.states.${reference.decision}`)}</small></div><AdminStatus state={reference.decision==="include"?"good":reference.decision==="exclude"?"not_available":"warning"}>{t(`references.states.${reference.decision}`)}</AdminStatus><button className="admin-button admin-button--compact" onClick={()=>setDrawer({mode:"reference",reference})} type="button">{t("actions.decide")}</button></div>)}</div>:null}
      </>:null}
    </AdminResourceSection>

    {drawer?.mode==="connector"?<WorkspaceDrawer ariaLabel={t("drawers.connector.title")} closeLabel={common("actions.close")} eyebrow={t("eyebrow")} onClose={closeDrawer} title={t("drawers.connector.title")}><form className="admin-drawer-form" onSubmit={(event)=>{event.preventDefault();void createConnector(new FormData(event.currentTarget));}}><p className="admin-drawer-form__intro">{t("drawers.connector.body")}</p><label className="workspace-field"><span>{t("fields.connectorName")}</span><input className="workspace-control" maxLength={160} name="name" placeholder={t("fields.connectorPlaceholder")} required/></label><div className="admin-form__metadata"><div className="admin-settings-row admin-settings-row--plain"><div><strong>{t("fields.provider")}</strong><small>{t("fields.providerHelp")}</small></div><div className="admin-settings-row__value">SentiOne</div></div><div className="admin-settings-row admin-settings-row--plain"><div><strong>{t("fields.connection")}</strong><small>{t("fields.connectionHelp")}</small></div><div className="admin-settings-row__value">CSV</div></div></div>{error?<p className="workspace-form__error" role="alert">{error}</p>:null}<button className="admin-button admin-button--primary" disabled={busy==="connector"} type="submit">{busy==="connector"?t("actions.saving"):t("actions.createConnector")}</button></form></WorkspaceDrawer>:null}

    {drawer?.mode==="brief"&&brief?<WorkspaceDrawer ariaLabel={t("drawers.brief.title")} closeLabel={common("actions.close")} eyebrow={t("eyebrow")} onClose={closeDrawer} title={t("drawers.brief.title")}>
      <AcquisitionBriefForm brief={brief} busy={busy==="brief"} error={error} locale={locale} onSubmit={(form)=>void saveBrief(form)} t={t}/>
    </WorkspaceDrawer>:null}

    {drawer?.mode==="generate"?<WorkspaceDrawer ariaLabel={t("drawers.generate.title")} closeLabel={common("actions.close")} eyebrow={t("eyebrow")} onClose={closeDrawer} title={t("drawers.generate.title")}>
      <div className="semantic-resolution-flight__body admin-query-generation">
        <p className="semantic-resolution-flight__intro">{t("drawers.generate.body")}</p>
        <div className="admin-query-generation__controls">
          <label className="workspace-field"><span>{t("fields.connector")}</span><select className="workspace-control" onChange={(event)=>{setGenerationSourceKey(event.target.value);setGenerationPreflight(null);setGenerationConfirmed(false);}} value={generationSourceKey}>{activeConnectors.map((source)=><option key={source.source_key} value={source.source_key}>{source.name}</option>)}</select></label>
          <label className="workspace-field"><span>{t("generation.hardCap")}</span><input className="workspace-control" inputMode="decimal" onChange={(event)=>{setGenerationHardCap(event.target.value);setGenerationPreflight(null);setGenerationConfirmed(false);}} value={generationHardCap}/><small>{t("generation.hardCapHelp")}</small></label>
          <button className="admin-button" disabled={busy==="generation-preflight"||!generationSourceKey||!generationHardCap.trim()} onClick={()=>void loadGenerationPreflight()} type="button">{busy==="generation-preflight"?t("generation.calculating"):t("generation.calculate")}</button>
        </div>
        {error?<p className="workspace-form__error" role="alert">{error}</p>:null}
        {generationPreflight?<QueryGenerationFlightCard confirmed={generationConfirmed} locale={locale} onConfirmedChange={setGenerationConfirmed} preflight={generationPreflight} t={t}/>:<div className="semantic-resolution-flight__empty"><MagicWand aria-hidden size={20}/><strong>{t("generation.emptyTitle")}</strong><p>{t("generation.emptyBody")}</p></div>}
        <div className="semantic-resolution-flight__footer"><button className="admin-button" disabled={busy==="generate"} onClick={closeDrawer} type="button">{common("actions.close")}</button><button className="admin-button admin-button--primary" disabled={busy==="generate"||!generationConfirmed||generationPreflight?.readiness!=="ready"||!generationPreflight.runtime.provider_configured} onClick={()=>void generateQueries()} type="button"><MagicWand aria-hidden size={15}/>{busy==="generate"?t("generation.generating"):t("generation.confirm")}</button></div>
      </div>
    </WorkspaceDrawer>:null}

    {drawer?.mode==="review"?<WorkspaceDrawer ariaLabel={t("drawers.review.title",{slot:drawer.slot.label})} closeLabel={common("actions.close")} eyebrow={`${t(`scopes.${drawer.slot.scope}`)} · ${drawer.slot.label}`} onClose={closeDrawer} title={t("drawers.review.title",{slot:drawer.slot.label})}>
      {busy==="review-detail"&&!queryDetail?<AcquisitionSkeleton compact/>:null}
      {queryDetail?<QueryReview detail={queryDetail} error={error} locale={locale} onAdvancedEdit={()=>setDrawer({mode:"query",slot:drawer.slot})} onSubmit={(form)=>void reviewQuery(drawer.slot,drawer.query,form)} t={t} busy={busy==="review-query"}/>:null}
      {error&&!queryDetail?<p className="workspace-form__error" role="alert">{error}</p>:null}
    </WorkspaceDrawer>:null}

    {drawer?.mode==="query"?<WorkspaceDrawer ariaLabel={t("drawers.query.title",{slot:drawer.slot.label})} closeLabel={common("actions.close")} eyebrow={`${t(`scopes.${drawer.slot.scope}`)} · ${drawer.slot.label}`} onClose={closeDrawer} title={t("drawers.query.title",{slot:drawer.slot.label})}><QueryForm busy={busy==="query"} connectors={activeConnectors} error={error} initial={queryDetail} onSubmit={(form)=>void saveQuery(drawer.slot,form)} t={t} timezone={timezone}/></WorkspaceDrawer>:null}

    {drawer?.mode==="promote"&&plan?.draft_plan?<WorkspaceDrawer ariaLabel={t("drawers.promote.title")} closeLabel={common("actions.close")} eyebrow={t("eyebrow")} onClose={closeDrawer} title={t("drawers.promote.title")}><form className="admin-drawer-form" onSubmit={(event)=>{event.preventDefault();void promote(new FormData(event.currentTarget));}}><p className="admin-drawer-form__intro">{t("drawers.promote.body",{version:plan.draft_plan.version,slots:draftSlots})}</p><label className="workspace-field"><span>{t("fields.evidence")}</span><textarea className="workspace-control" maxLength={500} name="evidence" required rows={4}/><small>{t("fields.evidenceHelp")}</small></label>{error?<p className="workspace-form__error" role="alert">{error}</p>:null}<button className="admin-button admin-button--primary" disabled={busy==="promote"} type="submit">{busy==="promote"?t("actions.promoting"):t("actions.confirmPromote")}</button></form></WorkspaceDrawer>:null}

    {drawer?.mode==="reference"?<WorkspaceDrawer ariaLabel={t("drawers.reference.title",{reference:drawer.reference.label})} closeLabel={common("actions.close")} eyebrow={t("references.title")} onClose={closeDrawer} title={drawer.reference.label}><form className="admin-drawer-form" onSubmit={(event)=>{event.preventDefault();void decideReference(drawer.reference,new FormData(event.currentTarget));}}><p className="admin-drawer-form__intro">{t("drawers.reference.body")}</p><label className="workspace-field"><span>{t("fields.referenceDecision")}</span><select className="workspace-control" defaultValue={drawer.reference.decision==="undecided"?"include":drawer.reference.decision} name="action"><option value="include">{t("references.actions.include")}</option><option value="exclude">{t("references.actions.exclude")}</option><option value="revert">{t("references.actions.revert")}</option></select></label><label className="workspace-field"><span>{t("fields.evidence")}</span><textarea className="workspace-control" maxLength={500} name="evidence" required rows={4}/></label>{error?<p className="workspace-form__error" role="alert">{error}</p>:null}<button className="admin-button admin-button--primary" disabled={busy==="reference"} type="submit">{busy==="reference"?t("actions.saving"):t("actions.saveDecision")}</button></form></WorkspaceDrawer>:null}

    {drawer?.mode==="import"?<WorkspaceDrawer ariaLabel={t("drawers.import.title",{slot:drawer.slot.label})} closeLabel={common("actions.close")} eyebrow={`${t(`scopes.${drawer.slot.scope}`)} · ${drawer.slot.label}`} onClose={closeDrawer} title={t("drawers.import.title",{slot:drawer.slot.label})}><ImportForm busy={busy==="import"||busy==="query-draft"} connectors={activeConnectors} error={error} locale={locale} onRegisterQuery={()=>void registerExecutedQuery(drawer.slot)} onSubmit={(form)=>void importCsv(drawer.slot,form)} queries={(drawer.slot.current?.query_versions??[]).filter((query)=>query.status==="current"&&query.review.status==="approved")} readyForImport={plan?.readiness.ready_for_import??false} result={importResult} t={t} timezone={timezone}/></WorkspaceDrawer>:null}

    {drawer?.mode==="history"?<WorkspaceDrawer ariaLabel={t("drawers.history.title",{slot:drawer.slot.label})} closeLabel={common("actions.close")} eyebrow={`${t(`scopes.${drawer.slot.scope}`)} · ${drawer.slot.label}`} onClose={closeDrawer} title={t("drawers.history.title",{slot:drawer.slot.label})}>{busy==="history"&&!imports?<AcquisitionSkeleton compact/>:null}{error?<p className="workspace-form__error" role="alert">{error}</p>:null}{imports?.length===0?<div className="admin-empty"><FileCsv aria-hidden size={22}/><strong>{t("history.empty")}</strong></div>:null}{imports&&imports.length?<div className="admin-acquisition-history">{imports.map((item)=><div className="admin-acquisition-history__item" key={item.id}><div><strong>{item.source_file_name??t("history.unnamed")}</strong><small>{formatAdminDate(item.created_at,locale)} · {t(`importStates.${item.status}`)}</small>{item.acquisition?.query_evidence?<AdminStatus state={item.acquisition.query_evidence.class==="unavailable"?"warning":"good"}>{t(`queryEvidence.badges.${item.acquisition.query_evidence.class}`)}</AdminStatus>:null}{item.observed?<small>{observedSummary(item,locale,t)}</small>:null}{item.observed?.warnings.map((warning)=><small key={warning}>{t(`observed.warnings.${warning}`)}</small>)}</div><div>{item.final_counts?<span>{t("history.counts",{records:formatAdminNumber(item.final_counts.record_count,locale),included:formatAdminNumber(item.final_counts.included_count,locale),duplicates:formatAdminNumber(item.final_counts.duplicate_count,locale)})}</span>:<span>{t("history.progress",{count:formatAdminNumber(item.progress.records_processed,locale)})}</span>}{item.status==="failed"&&item.recovery?.recoverable_from_storage?<button className="admin-button admin-button--plain" disabled={Boolean(busy)} onClick={()=>void retryImport(item)} type="button">{t("actions.retryStorage")}</button>:null}</div></div>)}</div>:null}</WorkspaceDrawer>:null}
  </>;
}

function QueryGenerationFlightCard({confirmed,locale,onConfirmedChange,preflight,t}:{
  confirmed:boolean;locale:string;onConfirmedChange:(value:boolean)=>void;
  preflight:QueryGenerationPreflight;t:ReturnType<typeof useTranslations<"AdminWorkspace.data.acquisition">>;
}){
  return <div className="semantic-resolution-flight__card">
    <div className="semantic-resolution-flight__status"><AdminStatus state={preflight.readiness==="ready"&&preflight.runtime.provider_configured?"good":"danger"}>{preflight.readiness==="ready"&&preflight.runtime.provider_configured?t("generation.ready"):t("generation.blocked")}</AdminStatus><span>{t("generation.freePreflight")}</span></div>
    <dl className="semantic-resolution-flight__metrics">
      <div><dt>{t("generation.slots")}</dt><dd>{formatAdminNumber(preflight.slot_count,locale)}</dd></div>
      <div><dt>{t("generation.calls")}</dt><dd>{formatAdminNumber(preflight.maximum_provider_calls,locale)}</dd></div>
      <div><dt>{t("generation.estimate")}</dt><dd>{formatCurrency(preflight.budget.estimated_max_cost_usd,locale)}</dd></div>
      <div><dt>{t("generation.hardCap")}</dt><dd>{formatCurrency(preflight.budget.hard_cap_usd,locale)}</dd></div>
    </dl>
    <div className="admin-query-generation__slots">{preflight.required_slots.map((slot)=><div key={slot.slot_key}>{scopeIcon(slot.scope)}<span>{slot.label}</span><AdminStatus state={slot.state==="not_generated"?"warning":"good"}>{t(`generation.slotStates.${slot.state}`)}</AdminStatus></div>)}</div>
    <div className="semantic-resolution-flight__authority"><div><span>{t("generation.model")}</span><strong>{preflight.provider.model}</strong></div><div><span>{t("generation.pricing")}</span><strong>{preflight.provider.pricing_version}</strong></div><div><span>{t("generation.provider")}</span><strong>{preflight.runtime.provider_configured?t("generation.available"):t("generation.notAvailable")}</strong></div></div>
    {preflight.blockers.length||!preflight.runtime.provider_configured?<div className="semantic-resolution-flight__blockers" role="alert"><WarningCircle aria-hidden size={17}/><div><strong>{t("generation.blockersTitle")}</strong><ul>{[...preflight.blockers,...(!preflight.runtime.provider_configured?["provider_unavailable"]:[])].map((blocker)=><li key={blocker}>{generationBlockerLabel(t,blocker)}</li>)}</ul></div></div>:null}
    {preflight.readiness==="ready"&&preflight.runtime.provider_configured?<label className="semantic-resolution-flight__confirmation"><input checked={confirmed} onChange={(event)=>onConfirmedChange(event.target.checked)} type="checkbox"/><span>{t("generation.confirmation",{slots:preflight.slot_count,cap:formatCurrency(preflight.budget.hard_cap_usd,locale)})}</span></label>:null}
  </div>;
}

function AcquisitionBriefForm({brief,busy,error,locale,onSubmit,t}:{
  brief:AcquisitionBriefContext;busy:boolean;error:string|null;locale:string;
  onSubmit:(form:FormData)=>void;t:ReturnType<typeof useTranslations<"AdminWorkspace.data.acquisition">>;
}){
  const regionNames=new Intl.DisplayNames([locale],{type:"region"});
  const market=(brief.options.countries.some((item)=>item.code===brief.values.market_country)
    ?brief.values.market_country:brief.options.countries[0]?.code)??"";
  return <form className="admin-drawer-form" onSubmit={(event)=>{event.preventDefault();onSubmit(new FormData(event.currentTarget));}}>
    <p className="admin-drawer-form__intro">{t("drawers.brief.body")}</p>
    {brief.status==="stale"?<div className="admin-acquisition__blockers" role="alert"><WarningCircle aria-hidden size={17}/><div><strong>{t("brief.staleTitle")}</strong><p>{t("brief.staleBody")}</p></div></div>:null}
    <label className="workspace-field"><span>{t("brief.fields.objective")}</span><textarea className="workspace-control" defaultValue={brief.values.objective} maxLength={1000} name="objective" required rows={3}/><small>{t("brief.fields.objectiveHelp")}</small></label>
    <label className="workspace-field"><span>{t("brief.fields.purpose")}</span><textarea className="workspace-control" defaultValue={brief.values.purpose} maxLength={500} name="purpose" required rows={2}/></label>
    <label className="workspace-field"><span>{t("brief.fields.market")}</span><select className="workspace-control" defaultValue={market} name="market_country" required>{brief.options.countries.map((country)=><option key={country.code} value={country.code}>{regionNames.of(country.code)??country.code}</option>)}</select><small>{t("brief.fields.marketHelp")}</small></label>
    <fieldset className="workspace-field"><legend>{t("brief.fields.countries")}</legend><div className="admin-acquisition__term-grid">{brief.options.countries.map((country)=><label className="semantic-resolution-flight__confirmation" key={country.code}><input defaultChecked={brief.values.countries.includes(country.code)} name="countries" type="checkbox" value={country.code}/><span>{regionNames.of(country.code)??country.code}</span></label>)}</div></fieldset>
    <fieldset className="workspace-field"><legend>{t("brief.fields.languages")}</legend><div className="admin-acquisition__term-grid">{brief.options.languages.map((language)=><label className="semantic-resolution-flight__confirmation" key={language.key}><input defaultChecked={brief.values.languages.includes(language.key)} name="languages" type="checkbox" value={language.key}/><span>{language.label}</span></label>)}</div><small>{t("brief.fields.languagesHelp")}</small></fieldset>
    <div className="admin-acquisition__period-grid"><label className="workspace-field"><span>{t("brief.fields.periodStart")}</span><input className="workspace-control" defaultValue={brief.values.default_capture_period?.start??""} name="period_start" type="date"/></label><label className="workspace-field"><span>{t("brief.fields.periodEnd")}</span><input className="workspace-control" defaultValue={brief.values.default_capture_period?.end??""} name="period_end" type="date"/></label></div>
    <label className="workspace-field"><span>{t("brief.fields.window")}</span><input className="workspace-control" defaultValue={brief.values.target_window_months??12} max={120} min={1} name="target_window_months" required type="number"/><small>{t("brief.fields.windowHelp")}</small></label>
    <label className="workspace-field"><span>{t("brief.fields.mode")}</span><select className="workspace-control" defaultValue={brief.values.construction_mode} name="construction_mode">{brief.options.construction_modes.map((mode)=><option key={mode} value={mode}>{t(`brief.modes.${mode}`)}</option>)}</select></label>
    <div className="admin-acquisition__timezone"><span>{t("fields.timezone")}</span><strong>{brief.timezone}</strong></div>
    {brief.knowledge_context.available?<label className="semantic-resolution-flight__confirmation"><input defaultChecked={brief.values.include_knowledge_context} name="include_knowledge_context" type="checkbox"/><span>{t("brief.fields.knowledge",{count:brief.knowledge_context.source_count})}</span></label>:null}
    {error?<p className="workspace-form__error" role="alert">{error}</p>:null}
    <button className="admin-button admin-button--primary" disabled={busy} type="submit"><CheckCircle aria-hidden size={15}/>{busy?t("actions.saving"):brief.status==="missing"?t("actions.prepareBrief"):t("actions.updateBrief")}</button>
  </form>;
}

function QueryReview({busy,detail,error,locale,onAdvancedEdit,onSubmit,t}:{
  busy:boolean;detail:QueryDetail;error:string|null;locale:string;onAdvancedEdit:()=>void;
  onSubmit:(form:FormData)=>void;t:ReturnType<typeof useTranslations<"AdminWorkspace.data.acquisition">>;
}){
  const changed=detail.previous_query_text&&detail.previous_query_text!==detail.query_text;
  return <form className="admin-drawer-form admin-query-review" onSubmit={(event)=>{event.preventDefault();onSubmit(new FormData(event.currentTarget));}}>
    <div className="admin-query-review__status"><AdminStatus state={detail.review.status==="approved"?"good":detail.review.status==="rejected"?"danger":"warning"}>{t(`review.states.${detail.review.status}`)}</AdminStatus><span>{t("review.version",{version:detail.query_version})}</span>{detail.origin==="engine-generated"?<span>{t("query.generated")}</span>:<span>{t("review.manual")}</span>}</div>
    {detail.validation_summary.fallback_used?<div className="admin-acquisition__blockers" role="alert"><WarningCircle aria-hidden size={17}/><div><strong>{t("review.fallbackTitle")}</strong><p>{t("review.fallbackBody")}</p></div></div>:null}
    <section className="admin-query-review__query"><header><div><h3>{t("review.proposal")}</h3><p>{detail.lineage.generated_at?t("review.generatedAt",{date:formatAdminDate(detail.lineage.generated_at,locale)}):t("review.operatorVersion")}</p></div><button className="admin-button admin-button--compact" onClick={onAdvancedEdit} type="button"><PencilSimple aria-hidden size={14}/>{t("actions.advancedEdit")}</button></header><pre>{detail.query_text}</pre></section>
    {changed?<details className="admin-query-review__previous"><summary>{t("review.comparePrevious")}</summary><pre>{detail.previous_query_text}</pre></details>:null}
    <div className="admin-query-review__terms"><div><strong>{t("fields.includeTerms")}</strong><p>{detail.structured_terms.include.join(" · ")||t("review.none")}</p></div><div><strong>{t("fields.excludeTerms")}</strong><p>{detail.structured_terms.exclude.join(" · ")||t("review.none")}</p></div><div><strong>{t("fields.aliases")}</strong><p>{detail.structured_terms.aliases.join(" · ")||t("review.none")}</p></div></div>
    <label className="workspace-field"><span>{t("review.decision")}</span><select className="workspace-control" defaultValue={detail.review.status==="rejected"?"rejected":"approved"} name="decision"><option value="approved">{t("review.actions.approve")}</option><option value="rejected">{t("review.actions.reject")}</option></select><small>{t("review.decisionHelp")}</small></label>
    <label className="workspace-field"><span>{t("fields.evidence")}</span><textarea className="workspace-control" maxLength={500} name="evidence" required rows={3}/><small>{t("review.evidenceHelp")}</small></label>
    {error?<p className="workspace-form__error" role="alert">{error}</p>:null}
    <button className="admin-button admin-button--primary" disabled={busy} type="submit"><CheckCircle aria-hidden size={15}/>{busy?t("actions.saving"):t("review.actions.save")}</button>
  </form>;
}

function QueryForm({busy,connectors,error,initial,onSubmit,t,timezone}:{
  busy:boolean;connectors:Connector[];error:string|null;initial:QueryDetail|null;onSubmit:(form:FormData)=>void;
  t:ReturnType<typeof useTranslations<"AdminWorkspace.data.acquisition">>;timezone:string;
}){
  return <form className="admin-drawer-form" onSubmit={(event)=>{event.preventDefault();onSubmit(new FormData(event.currentTarget));}}><p className="admin-drawer-form__intro">{t("drawers.query.body")}</p>{connectors.length?<><label className="workspace-field"><span>{t("fields.connector")}</span><select className="workspace-control" name="source_key" required>{connectors.map((source)=><option key={source.source_key} value={source.source_key}>{source.name}</option>)}</select><small>{t("fields.connectorHelp")}</small></label><label className="workspace-field"><span>{t("fields.queryText")}</span><textarea className="workspace-control admin-acquisition__query-text" defaultValue={initial?.query_text??""} maxLength={50000} name="query_text" required rows={7}/><small>{t("fields.queryTextHelp")}</small></label><div className="admin-acquisition__term-grid"><label className="workspace-field"><span>{t("fields.includeTerms")}</span><textarea className="workspace-control" defaultValue={initial?.structured_terms.include.join("\n")??""} name="include_terms" rows={3}/></label><label className="workspace-field"><span>{t("fields.excludeTerms")}</span><textarea className="workspace-control" defaultValue={initial?.structured_terms.exclude.join("\n")??""} name="exclude_terms" rows={3}/></label></div><label className="workspace-field"><span>{t("fields.aliases")}</span><textarea className="workspace-control" defaultValue={initial?.structured_terms.aliases.join("\n")??""} name="aliases" rows={2}/><small>{t("fields.termsHelp")}</small></label><label className="workspace-field"><span>{t("fields.cadence")}</span><select className="workspace-control" defaultValue={initial?.cadence??"manual"} name="cadence"><option value="manual">{t("cadence.manual")}</option><option value="ad-hoc">{t("cadence.ad-hoc")}</option><option value="weekly">{t("cadence.weekly")}</option><option value="monthly">{t("cadence.monthly")}</option></select></label><div className="admin-acquisition__period-grid"><label className="workspace-field"><span>{t("fields.periodStart")}</span><input className="workspace-control" defaultValue={initial?.default_period?.start??""} name="period_start" type="date"/></label><label className="workspace-field"><span>{t("fields.periodEnd")}</span><input className="workspace-control" defaultValue={initial?.default_period?.end??""} name="period_end" type="date"/></label></div><div className="admin-acquisition__timezone"><span>{t("fields.timezone")}</span><strong>{timezone}</strong></div></>:<div className="admin-empty"><Plug aria-hidden size={22}/><strong>{t("connectors.required")}</strong><p>{t("connectors.requiredHelp")}</p></div>}{error?<p className="workspace-form__error" role="alert">{error}</p>:null}<button className="admin-button admin-button--primary" disabled={busy||!connectors.length} type="submit">{busy?t("actions.saving"):t("actions.saveQuery")}</button></form>;
}

function ImportForm({busy,connectors,error,locale,onRegisterQuery,onSubmit,queries,readyForImport,result,t,timezone}:{
  busy:boolean;connectors:Connector[];error:string|null;locale:string;onRegisterQuery:()=>void;
  onSubmit:(form:FormData)=>void;queries:QuerySummary[];readyForImport:boolean;result:ImportItem|null;
  t:ReturnType<typeof useTranslations<"AdminWorkspace.data.acquisition">>;timezone:string;
}){
  const [evidenceClass,setEvidenceClass]=useState<"operator_attested"|"unavailable">(
    queries.length?"operator_attested":"unavailable");
  const selected=queries[0]??null;
  const defaults=selected?.default_period;
  return <form className="admin-drawer-form" onSubmit={(event)=>{event.preventDefault();onSubmit(new FormData(event.currentTarget));}}>
    <p className="admin-drawer-form__intro">{t("drawers.import.bodyV2")}</p>
    <label className="workspace-field"><span>{t("fields.connector")}</span><select className="workspace-control" defaultValue={selected?.source_key??connectors[0]?.source_key} name="source_key" required>{connectors.map((source)=><option key={source.source_key} value={source.source_key}>{source.name}</option>)}</select></label>
    <fieldset className="workspace-field admin-acquisition__evidence"><legend>{t("queryEvidence.title")}</legend>
      <label className="semantic-resolution-flight__confirmation"><input checked={evidenceClass==="operator_attested"} disabled={!queries.length} name="query_evidence_class" onChange={()=>setEvidenceClass("operator_attested")} type="radio" value="operator_attested"/><span><strong>{t("queryEvidence.attested")}</strong><small>{t("queryEvidence.attestedHelp")}</small></span></label>
      {evidenceClass==="operator_attested"&&queries.length?<label className="workspace-field"><span>{t("queryEvidence.registeredQuery")}</span><select className="workspace-control" name="query_ref" required>{queries.map((query)=><option key={`${query.source_key}:${query.version}`} value={`${query.source_key}:${query.version}`}>{t("queryEvidence.queryVersion",{version:query.version})}</option>)}</select></label>:null}
      <button className="admin-button admin-button--compact" onClick={onRegisterQuery} type="button"><PencilSimple aria-hidden size={14}/>{t("queryEvidence.registerExecuted")}</button>
      <label className="semantic-resolution-flight__confirmation"><input checked={evidenceClass==="unavailable"} name="query_evidence_class" onChange={()=>setEvidenceClass("unavailable")} type="radio" value="unavailable"/><span><strong>{t("queryEvidence.unavailable")}</strong><small>{t("queryEvidence.unavailableHelp")}</small></span></label>
      {evidenceClass==="unavailable"?<label className="workspace-field"><span>{t("queryEvidence.reason")}</span><select className="workspace-control" defaultValue="historical_export" name="unavailable_reason" required><option value="historical_export">{t("queryEvidence.reasons.historical_export")}</option><option value="provider_did_not_embed_query">{t("queryEvidence.reasons.provider_did_not_embed_query")}</option><option value="source_context_unavailable">{t("queryEvidence.reasons.source_context_unavailable")}</option><option value="other">{t("queryEvidence.reasons.other")}</option></select></label>:null}
      <label className="semantic-resolution-flight__confirmation"><input name="operator_confirmed" required type="checkbox"/><span>{evidenceClass==="unavailable"?t("queryEvidence.confirmUnavailable"):t("queryEvidence.confirmAttested")}</span></label>
    </fieldset>
    {!readyForImport?<div className="admin-acquisition__blockers" role="status"><WarningCircle aria-hidden size={17}/><div><strong>{t("importReadiness.blockedTitle")}</strong><p>{t("importReadiness.blockedBody")}</p></div></div>:null}
    <label className="workspace-field"><span>{t("fields.file")}</span><input accept=".csv,text/csv" className="workspace-control workspace-control--file" disabled={!readyForImport} name="file" required type="file"/><small>{t("fields.fileHelp")}</small></label>
    <div className="admin-acquisition__period-grid"><label className="workspace-field"><span>{t("fields.captureStart")}</span><input className="workspace-control" defaultValue={defaults?.start??""} name="period_start" required type="date"/></label><label className="workspace-field"><span>{t("fields.captureEnd")}</span><input className="workspace-control" defaultValue={defaults?.end??""} name="period_end" required type="date"/></label></div>
    <div className="admin-acquisition__timezone"><span>{t("fields.timezone")}</span><strong>{timezone}</strong></div>
    {result?<div className="admin-acquisition-import" aria-live="polite"><div><AdminStatus state={result.status==="completed"?"good":result.status==="failed"?"danger":"warning"}>{t(`importStates.${result.status}`)}</AdminStatus><span>{result.progress.percent==null?t("importProgress.records",{count:formatAdminNumber(result.progress.records_processed,locale)}):t("importProgress.percent",{percent:result.progress.percent,count:formatAdminNumber(result.progress.records_processed,locale)})}</span></div>{result.final_counts?<dl><div><dt>{t("importCounts.records")}</dt><dd>{formatAdminNumber(result.final_counts.record_count,locale)}</dd></div><div><dt>{t("importCounts.included")}</dt><dd>{formatAdminNumber(result.final_counts.included_count,locale)}</dd></div><div><dt>{t("importCounts.duplicates")}</dt><dd>{formatAdminNumber(result.final_counts.duplicate_count,locale)}</dd></div></dl>:null}{result.observed?<small>{observedSummary(result,locale,t)}</small>:null}</div>:null}
    {error?<p className="workspace-form__error" role="alert">{error}</p>:null}<button className="admin-button admin-button--primary" disabled={busy||!readyForImport} type="submit"><UploadSimple aria-hidden size={15}/>{busy?t("actions.uploading"):t("actions.importCsv")}</button>
  </form>;
}

function AcquisitionSkeleton({compact=false}:{compact?:boolean}){
  return <div aria-hidden className={`admin-acquisition-skeleton${compact?" admin-acquisition-skeleton--compact":""}`}>{Array.from({length:compact?3:4},(_,index)=><div key={index}><span/><i/><b/></div>)}</div>;
}

function buildSlotViews(slots:PlanSlot[]):SlotView[]{
  const views=new Map<string,SlotView>();
  for(const slot of slots){
    const current=views.get(slot.slot_key)??{slotKey:slot.slot_key,label:slot.label,scope:slot.scope,current:null,draft:null};
    current.label=slot.label;current.scope=slot.scope;
    if(slot.plan_status==="draft")current.draft=slot;
    if(slot.plan_status==="current")current.current=slot;
    views.set(slot.slot_key,current);
  }
  return [...views.values()].sort((left,right)=>scopeRank(left.scope)-scopeRank(right.scope)||left.label.localeCompare(right.label));
}

function activeQuery(slot:PlanSlot|null){
  if(!slot)return null;
  return [...slot.query_versions].filter((query)=>!["retired","superseded"].includes(query.status))
    .sort((left,right)=>right.version-left.version)[0]??null;
}

function scopeRank(scope:PlanSlot["scope"]){return {primary_brand:0,category:1,competitor:2,reference:3}[scope];}
function scopeIcon(scope:PlanSlot["scope"]){
  if(scope==="primary_brand")return <Target aria-hidden size={19}/>;
  if(scope==="category")return <Stack aria-hidden size={19}/>;
  if(scope==="competitor")return <UsersThree aria-hidden size={19}/>;
  return <BookmarkSimple aria-hidden size={19}/>;
}
function planTone(state:string){if(state==="current")return "good" as const;if(state==="ready"||state==="draft")return "warning" as const;if(state==="stale")return "danger" as const;return "not_available" as const;}
function termList(value:FormDataEntryValue|null){return [...new Set(String(value??"").split(/[\n,]/gu).map((term)=>term.trim()).filter(Boolean))];}
function blockerLabel(t:ReturnType<typeof useTranslations<"AdminWorkspace.data.acquisition">>,blocker:string){
  const [code]=blocker.split(":");
  const known=["draft_required","authority_drift","primary_slot_required","query_required","query_source_unavailable","query_review_required","query_rejected","category_identity_required","category_identity_ambiguous","governance_unavailable"];
  return known.includes(code!)?t(`blockers.items.${code}`):t("blockers.items.unknown");
}
function generationBlockerLabel(t:ReturnType<typeof useTranslations<"AdminWorkspace.data.acquisition">>,blocker:string){
  const known=["hard_cap_insufficient","connector_unavailable","primary_slot_required","category_slot_required","competitor_slot_drift","retired_competitor_slot_present","acquisition_brief_required","acquisition_brief_drift","acquisition_provider_contract_unavailable","knowledge_context_drift","provider_unavailable"];
  return known.includes(blocker)?t(`generation.blockers.${blocker}`):t("generation.blockers.unknown");
}
function formatCurrency(value:string,locale:string){
  const amount=Number(value);return Number.isFinite(amount)?new Intl.NumberFormat(locale,{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:6}).format(amount):value;
}
function observedSummary(item:ImportItem,locale:string,
  t:ReturnType<typeof useTranslations<"AdminWorkspace.data.acquisition">>){
  if(!item.observed)return "";
  const period=item.observed.period
    ? `${item.observed.period.start}–${item.observed.period.end}`:t("observed.notAvailable");
  return t("observed.summary",{period,languages:item.observed.languages.join(", ")||"—",
    countries:item.observed.countries.join(", ")||"—",
    platforms:item.observed.platforms.join(", ")||"—"});
}
function isAbort(error:unknown){return error instanceof DOMException&&error.name==="AbortError";}
function message(error:unknown,fallback:string){return error instanceof Error&&error.message?error.message:fallback;}

async function postJson<T=unknown>(url:string,body:unknown,key=crypto.randomUUID()):Promise<T>{
  const response=await fetch(url,{body:JSON.stringify(body),cache:"no-store",headers:{"Content-Type":"application/json","Idempotency-Key":key},method:"POST"});
  const payload=await response.json() as T&{message?:string;error?:string};
  if(!response.ok)throw new Error(payload.message??payload.error??"Request failed.");
  return payload;
}

type ImportCreatePayload={import:ImportItem;polling_url:string;upload:{parts:Array<{part_number:number;expected_size_bytes:number;upload_url:string}>}|null};
type ImportPollPayload={import:ImportItem;polling_url?:string};

async function uploadMultipart(file:File,authority:NonNullable<ImportCreatePayload["upload"]>,onProgress:(percent:number)=>void,requestRef:{current:XMLHttpRequest|null}){
  let offset=0;
  for(const part of authority.parts){
    const slice=file.slice(offset,offset+part.expected_size_bytes,file.type);
    await new Promise<void>((resolve,reject)=>{
      const request=new XMLHttpRequest();requestRef.current=request;
      request.open("PUT",part.upload_url,true);request.setRequestHeader("x-upsert","false");
      request.upload.onprogress=(event)=>onProgress(Math.min(99,Math.floor(((offset+event.loaded)/file.size)*100)));
      request.onerror=()=>reject(new Error("Signed upload transport failed."));
      request.onabort=()=>reject(new DOMException("Upload aborted.","AbortError"));
      request.onload=()=>request.status>=200&&request.status<300?resolve():reject(new Error(`Signed upload failed (${request.status}).`));
      const body=new FormData();body.append("cacheControl","3600");body.append("",new File([slice],`${file.name}.part-${String(part.part_number).padStart(5,"0")}`,{type:file.type||"text/csv"}));request.send(body);
    });
    offset+=part.expected_size_bytes;onProgress(Math.min(99,Math.floor((offset/file.size)*100)));
  }
  requestRef.current=null;if(offset!==file.size)throw new Error("Multipart upload size mismatch.");
}

async function pollImport(url:string,onProgress:(item:ImportItem)=>void){
  while(true){
    const response=await fetch(url,{cache:"no-store"});const payload=await response.json() as ImportPollPayload&{message?:string};
    if(!response.ok)throw new Error(payload.message??"Import status is unavailable.");
    onProgress(payload.import);if(["completed","failed"].includes(payload.import.status))return payload.import;
    await new Promise((resolve)=>window.setTimeout(resolve,1500));
  }
}

async function reportUploadFailure(url:string,key:string,code:"upload_aborted"|"upload_transport_failed"){
  try{await postJson(url,{action:"fail-upload",failure_code:code},`${key}:failed`);}catch{return;}
}

function replaceImport(current:ImportItem[]|null,next:ImportItem){
  if(!current)return [next];const found=current.some((item)=>item.id===next.id);
  return found?current.map((item)=>item.id===next.id?next:item):[next,...current];
}
