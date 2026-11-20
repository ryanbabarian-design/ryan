import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadProposalImages } from '../js/reliability/image-upload.js';
const requestId='a8070c6d-41e6-4d13-b41c-2583489c3a02';
function fixture(){
  const objects=new Map(),writes=[];
  const bucket={upload:async(path,file)=>{writes.push(path);if(objects.has(path))return {error:{statusCode:'409',message:'exists'}};objects.set(path,file);return {data:{path}};},getPublicUrl:path=>({data:{publicUrl:`https://images.example/${path}`}})};
  const client={storage:{from:()=>bucket}};
  const fetcher=async url=>new Response(objects.get(String(url).replace('https://images.example/',''))||'',{status:200});
  return {client,bucket,objects,writes,fetcher};
}
test('identical draft images keep paths and metadata across reload-style retries',async()=>{
  const f=fixture(),file=new File(['photo bytes'],'before.png',{type:'image/png'});
  const a=await uploadProposalImages(f.client,'photos',[file],'before',{requestId,fetcher:f.fetcher});
  const b=await uploadProposalImages(f.client,'photos',[new File(['photo bytes'],'before.png',{type:'image/png'})],'before',{requestId,fetcher:f.fetcher});
  assert.deepEqual(a,b);assert.equal(f.objects.size,1);assert.match(a[0].path,new RegExp(`^submissions/${requestId}/before-1-[a-f0-9]{64}\\.png$`));
});
test('changed bytes in the same draft produce a different fingerprinted image path',async()=>{
  const f=fixture();const a=await uploadProposalImages(f.client,'photos',[new File(['a'],'same.png',{type:'image/png'})],'before',{requestId});
  const b=await uploadProposalImages(f.client,'photos',[new File(['b'],'same.png',{type:'image/png'})],'before',{requestId});
  assert.notEqual(a[0].path,b[0].path);
});
test('an existing object with different bytes is rejected instead of silently reused',async()=>{
  const f=fixture(),file=new File(['real'],'one.png',{type:'image/png'});
  const first=await uploadProposalImages(f.client,'photos',[file],'before',{requestId});f.objects.set(first[0].path,new Blob(['wrong']));
  await assert.rejects(uploadProposalImages(f.client,'photos',[file],'before',{requestId,fetcher:f.fetcher}),/일치/);
});
test('permission or network errors are not mistaken for duplicate objects',async()=>{
  const f=fixture();f.bucket.upload=async()=>({error:{statusCode:'403',message:'denied'}});
  await assert.rejects(uploadProposalImages(f.client,'photos',[new File(['a'],'a.png',{type:'image/png'})],'before',{requestId}),e=>e.message==='denied');
});
test('legacy 400 Asset Already Exists verifies bytes and safely reuses the same photo',async()=>{
  const f=fixture(),file=new File(['original'],'a.png',{type:'image/png'});
  const first=await uploadProposalImages(f.client,'photos',[file],'before',{requestId});
  f.bucket.upload=async()=>({error:{statusCode:'400',message:'The resource already exists',error:'Asset Already Exists'}});
  assert.deepEqual(await uploadProposalImages(f.client,'photos',[file],'before',{requestId,fetcher:f.fetcher}),first);
  f.bucket.upload=async()=>({error:{statusCode:'400',message:'Invalid mime type'}});
  await assert.rejects(uploadProposalImages(f.client,'photos',[file],'before',{requestId,fetcher:f.fetcher}),e=>e.message==='Invalid mime type');
});
test('draft upload rejects unsupported type, oversized data and invalid request key',async()=>{
  const f=fixture();
  await assert.rejects(uploadProposalImages(f.client,'photos',[new File(['x'],'a.svg',{type:'image/svg+xml'})],'before',{requestId}),/사진/);
  await assert.rejects(uploadProposalImages(f.client,'photos',[new File([new Uint8Array(5*1024*1024+1)],'a.png',{type:'image/png'})],'before',{requestId}),/5MB/);
  await assert.rejects(uploadProposalImages(f.client,'photos',[],'before',{requestId:'../bad'}),/요청/);
});
