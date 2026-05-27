import { pool } from "./client.js";

const insuranceMemories = [
  {
    memory_type: "query_pattern",
    content: {
      terms: [
        "seguro auto",
        "seguro de auto",
        "poliza auto",
        "aseguradora auto",
        "me cubrio el seguro",
        "no me quieren pagar"
      ]
    },
    evidence_count: 3
  },
  {
    memory_type: "exclusion",
    content: {
      exclusion: [
        "Potosi municipio",
        "San Luis Potosi turismo",
        "Potosi estado",
        "casas de empeno Potosi"
      ]
    },
    evidence_count: 2
  },
  {
    memory_type: "failure_mode",
    content: {
      note: "La marca Potosi puede arrastrar ruido geografico. La query inicial debe amarrar la marca a seguros, poliza, siniestro o aseguradora."
    },
    evidence_count: 1
  }
];

export async function seedMemory() {
  await pool.query(
    "delete from memory_industry where industry = $1 and methodology_slug = $2 and memory_type = any($3::text[])",
    ["seguros", "triggers-barriers", insuranceMemories.map((memory) => memory.memory_type)]
  );

  for (const memory of insuranceMemories) {
    await pool.query(
      `
        insert into memory_industry (
          industry,
          industry_sub,
          methodology_slug,
          memory_type,
          content,
          evidence_count,
          shareable
        )
        values ($1, $2, $3, $4, $5::jsonb, $6, true)
      `,
      [
        "seguros",
        "seguros_generales",
        "triggers-barriers",
        memory.memory_type,
        JSON.stringify(memory.content),
        memory.evidence_count
      ]
    );
  }

  return { memoryIndustry: insuranceMemories.length };
}
