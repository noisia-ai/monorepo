import { pool } from "./client.js";

async function main() {
  const counts = await pool.query(`
    select
      (select count(*)::int from organizations) as organizations,
      (select count(*)::int from brands) as brands,
      (select count(*)::int from methodologies) as methodologies,
      (select count(*)::int from brand_seeds) as brand_seeds,
      (select count(*)::int from study_corpora) as study_corpora,
      (select count(*)::int from competitors) as competitors,
      (select count(*)::int from memory_industry) as memory_industry,
      (select count(*)::int from query_iterations) as query_iterations
  `);

  const demo = await pool.query(
    `
      select b.slug as brand_slug, m.slug as methodology_slug, sc.status
      from study_corpora sc
      join brands b on b.id = sc.brand_id
      join methodologies m on m.id = sc.methodology_id
      where b.slug = $1
    `,
    ["seguros-el-potosi"]
  );

  const payload = {
    ok:
      counts.rows[0]?.methodologies === 6 &&
      counts.rows[0]?.brand_seeds >= 60 &&
      counts.rows[0]?.memory_industry >= 3 &&
      demo.rows.some((row) => row.methodology_slug === "triggers-barriers"),
    counts: counts.rows[0],
    demo: demo.rows
  };

  if (!payload.ok) {
    throw new Error(`DB verification failed: ${JSON.stringify(payload)}`);
  }

  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
