export async function assertLabelingReceiptGateV1(client){
  const {rows:[required]}=await client.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE raw_body IS NOT NULL');
  if(required.n===0)return;
  const {rows:[marker]}=await client.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='signal_labeling_calls' AND column_name='raw_storage_verified_at') present`);
  if(!marker.present)throw new Error('labeling_receipt_verification_missing');
  const {rows:[keyMarker]}=await client.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='signal_labeling_calls' AND column_name='raw_storage_verified_key') present`);
  if(!keyMarker.present)throw new Error('labeling_receipt_verification_missing');
  const {rows:[unchecked]}=await client.query(`SELECT count(*)::int n FROM signal_labeling_calls
    WHERE raw_body IS NOT NULL AND (raw_storage_verified_at IS NULL OR raw_storage_key IS NULL
      OR raw_storage_verified_key IS DISTINCT FROM raw_storage_key
      OR raw_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(raw_body,'UTF8')),'hex'))`);
  if(unchecked.n>0)throw new Error('labeling_receipt_verification_missing');
}
