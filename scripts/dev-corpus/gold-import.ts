import { readFile, writeFile } from 'node:fs/promises';
import { importGold } from './gold.mjs';
import { parseCsv } from './csv.mjs';
import { main } from './guard.mjs';
await main(async () => {
  const [csvPath, selectionPath, output = '.data/dev-corpus/gold.jsonl'] = process.argv.slice(2);
  const selection = JSON.parse(await readFile(selectionPath!, 'utf8'));
  const { records } = parseCsv(await readFile(csvPath!, 'utf8'));
  const result = importGold(records, selection.selected, selection.context, selection.concepts.map((concept: {concept_key:string}) => concept.concept_key));
  await writeFile(output, result.map((row: unknown) => JSON.stringify(row)).join('\n') + '\n', { mode:0o600, flag:'wx' });
  console.log(JSON.stringify({ status:'human_gold_imported', roots:result.length, dev:90, test:60 }));
});
