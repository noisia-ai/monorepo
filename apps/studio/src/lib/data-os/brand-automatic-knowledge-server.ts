import { pool } from "@/lib/db";
import { buildAutomaticBrandContextText } from "./brand-automatic-knowledge";

/** Refreshes only the generated source. Once a user edits it, `source` becomes
 * `manual_editor` and the row is deliberately left under user control. */
export async function refreshAutomaticBrandContextKnowledgeV1(brandId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const state = await client.query<{
      name: string; description: string | null; industry: string | null;
      industry_sub: string | null; countries: string[]; aliases: string[];
      competitors: string[];
    }>(`
      SELECT COALESCE(brand.display_name,brand.name) AS name,brand.description,
        brand.industry,brand.industry_sub,COALESCE(brand.countries,ARRAY[]::char(2)[])::text[] AS countries,
        COALESCE(brand.brand_seed_handles,ARRAY[]::text[]) AS aliases,
        COALESCE((SELECT array_agg(seed.canonical_name ORDER BY lower(seed.canonical_name),seed.id)
          FROM competitors competitor JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id
          WHERE competitor.brand_id=brand.id AND competitor.status='current' AND seed.active),ARRAY[]::text[]) AS competitors
      FROM brands brand WHERE brand.id=$1::uuid FOR SHARE
    `, [brandId]);
    const brand = state.rows[0];
    if (!brand) throw new Error("brand_context_brand_unavailable");
    const sources = await client.query<{ id: string; extracted_payload: Record<string, unknown> | null }>(`
      SELECT id::text,extracted_payload FROM brand_knowledge_sources
      WHERE brand_id=$1::uuid AND source_kind='brand_os_context'
        AND study_corpus_id IS NULL
        AND extracted_payload->>'source'='automatic_brand_os'
      ORDER BY created_at,id FOR UPDATE
    `, [brandId]);
    for (const source of sources.rows) {
      const payload = source.extracted_payload ?? {};
      const notes = typeof payload.confirmed_additional_context === "string"
        ? payload.confirmed_additional_context : null;
      const rawText = buildAutomaticBrandContextText({
        ...brand,
        industrySub: brand.industry_sub,
        notes
      });
      await client.query(`
        UPDATE brand_knowledge_sources SET raw_text=$2,
          extracted_payload=COALESCE(extracted_payload,'{}'::jsonb)||jsonb_build_object(
            'summary',left($2,1200),'source','automatic_brand_os',
            'confirmed_additional_context',$3::text),
          status='processed',error_message=NULL,updated_at=clock_timestamp()
        WHERE id=$1::uuid AND brand_id=$4::uuid AND study_corpus_id IS NULL
      `, [source.id, rawText, notes, brandId]);
    }
    await client.query("COMMIT");
    return { refreshed_count: sources.rowCount ?? sources.rows.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
