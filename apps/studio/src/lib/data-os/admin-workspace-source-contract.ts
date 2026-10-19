export const ADMIN_WORKSPACE_SOURCE_TYPE = "social-listening" as const;
export const ADMIN_WORKSPACE_CONNECTION_METHOD = "manual-csv" as const;
export const ADMIN_WORKSPACE_CONNECTOR_CONTRACT_VERSION = "signal-data-source-connector-v1" as const;

export function buildAdminWorkspacePrimarySourceInput(input: {
  name: string;
  provider: string;
}) {
  return {
    name: input.name.trim(),
    provider: input.provider.trim(),
    source_type: ADMIN_WORKSPACE_SOURCE_TYPE,
    connection_method: ADMIN_WORKSPACE_CONNECTION_METHOD,
    scope: "primary_brand" as const,
    entity_id: null
  };
}

export function buildAdminWorkspaceConnectorInput(input: {
  name: string;
  provider: string;
}) {
  return {
    contract_version: ADMIN_WORKSPACE_CONNECTOR_CONTRACT_VERSION,
    name: input.name.trim(),
    provider: input.provider.trim().toLowerCase(),
    source_type: ADMIN_WORKSPACE_SOURCE_TYPE,
    connection_method: ADMIN_WORKSPACE_CONNECTION_METHOD
  };
}
