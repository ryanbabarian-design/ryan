const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
async function digest(bytes){return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}

/** Deterministic objects make a retried submission identical, including its images. */
export async function uploadProposalImages(client,bucketName,files,section,{requestId=globalThis.crypto.randomUUID(),fetcher=globalThis.fetch}={}) {
  if(!UUID.test(requestId)||!['before','after','before-edit','after-edit'].includes(section))throw new Error('사진 업로드 요청을 확인하지 못했습니다.');
  const bucket=client.storage.from(bucketName),uploaded=[];
  for(const [index,file] of Array.from(files||[]).entries()) {
    if(file.size>5*1024*1024)throw new Error(`${file.name}: 파일당 5MB 이하만 등록할 수 있습니다.`);
    const extension=extensions[file.type];
    if(!extension)throw new Error(`${file.name}: JPG·PNG·WEBP 사진만 등록할 수 있습니다.`);
    const hash=await digest(await file.arrayBuffer());
    const path=`submissions/${requestId.toLowerCase()}/${section}-${index+1}-${hash}.${extension}`;
    const url=bucket.getPublicUrl(path)?.data?.publicUrl;
    if(!url)throw new Error('사진 주소를 확인하지 못했습니다.');
    const {error}=await bucket.upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
    if(error) {
      const status=Number(error.statusCode??error.status);
      const legacyDuplicate=status===400&&[/^(?:The )?resource already exists\.?$/i,/^Asset Already Exists$/i,/^Duplicate$/i].some(pattern=>pattern.test(String(error.message||'').trim())||pattern.test(String(error.error||'').trim()));
      if(status!==409&&!legacyDuplicate)throw error;
      const existing=await fetcher(url,{signal:AbortSignal.timeout(15000)});
      if(!existing.ok)throw new Error('이미 저장된 사진을 확인하지 못했습니다. 잠시 후 다시 제출하세요.');
      if(await digest(await existing.arrayBuffer())!==hash)throw new Error('이미 저장된 사진과 작성 중인 사진이 일치하지 않습니다.');
    }
    uploaded.push({url,name:file.name,path});
  }
  return uploaded;
}
