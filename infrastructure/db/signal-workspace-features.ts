export type SignalWorkspaceFeatureV1 = "mention_facets" | "concept_membership" | "mfp_discovery" | "mass_labeling" | "monitoring_insights";

const switches: Record<SignalWorkspaceFeatureV1, string> = {
  mention_facets: "NOISIA_MENTION_FACETS_ENABLED",
  concept_membership: "NOISIA_CONCEPT_MEMBERSHIP_ENABLED",
  mfp_discovery: "NOISIA_MENTION_FACETS_ENABLED",
  monitoring_insights: "NOISIA_MONITORING_INSIGHTS_ENABLED",
  mass_labeling: "NOISIA_MASS_LABELING_ENABLED",
};

/** Product mass labeling defaults on unless explicitly disabled. Other features keep their opt-in. */
function runtimeEnabled(args: { feature: SignalWorkspaceFeatureV1; env?: Record<string, string | undefined> }) {
  const setting = (args.env ?? process.env)[switches[args.feature]];
  return args.feature === "mass_labeling" ? setting !== "false" : setting === "true";
}
export async function signalWorkspaceFeatureEnabledV1(args: {
  queryable: { query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }> };
  workspace_id: string;
  feature: SignalWorkspaceFeatureV1;
  env?: Record<string, string | undefined>;
}): Promise<boolean> {
  if (!runtimeEnabled(args)) return false;
  const row = (await args.queryable.query<{ enabled: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM signal_workspace_features
      WHERE workspace_id=$1::uuid AND feature=$2) enabled`,
    [args.workspace_id, args.feature],
  )).rows[0];
  return row?.enabled === true;
}

export async function signalWorkspaceFeatureEnabledWithDatabaseV1(args: {
  database: { connect(): Promise<{ query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>; release(): void }> };
  workspace_id: string;
  feature: SignalWorkspaceFeatureV1;
  env?: Record<string, string | undefined>;
}): Promise<boolean> {
  if (!runtimeEnabled(args)) return false;
  const client = await args.database.connect();
  try { return await signalWorkspaceFeatureEnabledV1({queryable:client,workspace_id:args.workspace_id,feature:args.feature,env:args.env}); }
  finally { client.release(); }
}
