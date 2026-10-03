import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "dotenv";
import pg from "pg";

import {
  adoptSignalTopicCandidateStoreV1,
  createSignalTopicStoreV1,
  loadLegacySignalTopicDiscoveryCandidatesStoreV1,
  loadSignalTopicCatalogStoreV1,
  updateSignalTopicStoreV1
} from "../signal-topic-catalog";

const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const workspaceId = process.env.NOISIA_TOPIC_CATALOG_UAT_WORKSPACE_ID;
const acknowledged = process.env.NOISIA_TOPIC_CATALOG_FIXTURE_APPROVED === "true";
const envFile = process.env.NOISIA_ENV_FILE ?? resolve(process.cwd(), "../../apps/studio/.env.local");

if (target !== "noisia-staging" || !workspaceId?.match(/^[0-9a-f-]{36}$/u) || !acknowledged) {
  throw new Error("The Topics acceptance fixture is restricted to an acknowledged staging workspace.");
}

const env = { ...parse(await readFile(envFile, "utf8")), ...process.env };
const databaseUrl = env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is unavailable in the selected environment file.");

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  application_name: "noisia-topics-to-signal-uat-acceptance"
});

try {
  const actorId = process.env.NOISIA_TOPIC_CATALOG_UAT_ACTOR_ID ?? (await pool.query<{ id: string }>(`
    SELECT id::text FROM users
    WHERE user_type='noisia_internal' AND status='active'
      AND signal_data_governance_actor_is_valid($1::uuid,id)
    ORDER BY created_at,id LIMIT 1
  `, [workspaceId])).rows[0]?.id;
  if (!actorId) throw new Error("No active internal UAT actor is available.");

  const discovered = await loadLegacySignalTopicDiscoveryCandidatesStoreV1({
    queryable: pool,
    workspace_id: workspaceId
  });
  const delivery = discovered.items.find((item) => item.candidate_key === "entrega_y_logistica");
  if (!discovered.run_key || !delivery) {
    throw new Error("The Laika delivery discovery fixture is unavailable in the selected workspace.");
  }

  const manual = await createSignalTopicStoreV1({
    pool,
    workspace_id: workspaceId,
    actor_user_id: actorId,
    idempotency_key: "uat-topics-2026-09-07-manual-postpurchase-v1",
    input: {
      label: "Fricciones posteriores a la compra",
      definition: "Experiencias después de comprar productos para mascotas en las que el pedido, la entrega, el cobro, la devolución o el soporte no cumplen lo esperado. Excluye conversaciones generales sin una compra o solicitud concreta.",
      scope: "primary_brand",
      inclusion: ["mi pedido", "sigo esperando", "reembolso", "me cobraron dos veces", "no llegó"],
      exclusion: ["entrega de premios", "entrega de documentos", "consejos generales"],
      positive_examples: [
        "Mi pedido no llegó y soporte no responde",
        "Me cobraron dos veces y sigo esperando el reembolso"
      ],
      negative_examples: [
        "Hoy es la entrega de premios",
        "Busco consejos generales para mi mascota"
      ]
    }
  });

  const adopted = await adoptSignalTopicCandidateStoreV1({
    pool,
    workspace_id: workspaceId,
    actor_user_id: actorId,
    idempotency_key: "uat-topics-2026-09-07-adopt-delivery-v1",
    input: {
      run_key: discovered.run_key,
      candidate_key: delivery.candidate_key,
      scope: "primary_brand"
    }
  });
  const adoptedTopic = adopted.topics.find((item) => item.term_key === adopted.term_key);
  if (!adoptedTopic) throw new Error("The adopted topic was not returned by the catalog.");

  const edited = adoptedTopic.definition_revision >= 2 ? adopted : await updateSignalTopicStoreV1({
    pool,
    workspace_id: workspaceId,
    actor_user_id: actorId,
    idempotency_key: "uat-topics-2026-09-07-edit-delivery-v1",
    term_key: adopted.term_key,
    input: {
      expected_definition_revision:adoptedTopic.definition_revision,expected_definition_digest:adoptedTopic.definition_digest,
      definition: "Experiencias con órdenes de productos para mascotas en las que el envío se retrasa, no llega, llega incompleto o carece de seguimiento. Excluye usos de entrega sin relación con un pedido.",
      inclusion: ["pedido", "envío", "guía", "sigo esperando", "todavía no llega"],
      exclusion: ["entrega de premios", "entrega de documentos", "entrega de proyecto"]
    }
  });

  const replay = await adoptSignalTopicCandidateStoreV1({
    pool,
    workspace_id: workspaceId,
    actor_user_id: actorId,
    idempotency_key: "uat-topics-2026-09-07-adopt-delivery-replay-v1",
    input: {
      run_key: discovered.run_key,
      candidate_key: delivery.candidate_key,
      scope: "primary_brand"
    }
  });
  const catalog = await loadSignalTopicCatalogStoreV1({ queryable: pool, workspace_id: workspaceId });
  process.stdout.write(`${JSON.stringify({
    contract_version: catalog.contract_version,
    workspace_id: workspaceId,
    profile_id: catalog.profile?.id ?? null,
    profile_status: catalog.profile?.status ?? null,
    topics: catalog.topics.map((topic) => ({
      term_key: topic.term_key,
      origin: topic.origin,
      definition_revision: topic.definition_revision,
      source_candidate: topic.source?.candidate_key ?? null
    })),
    manual_term_key: manual.term_key,
    discovered_term_key: edited.term_key,
    repeated_adoption_reused: replay.reused === true,
    provider_calls: 0
  }, null, 2)}\n`);
} finally {
  await pool.end();
}
