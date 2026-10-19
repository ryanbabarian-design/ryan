import {DEFAULT_SETTINGS, NOTICE_BUCKET, assertIntakeOpen, validateSettings, validateNotice, sortPublicNotices, buildIntakeNotice, validateAttachmentFile} from './operations-core.js?v=2.7.0';
const KEY='proposal-system:v270:operations';
const FILE_KEY='proposal-system:v270:notice-files';
const MIGRATION_MESSAGE='접수·공지 설정을 불러오지 못했습니다. 관리자에게 V2.7.0 SQL 적용과 연결 상태 확인을 요청하세요. 기존 제안 수정·평가·결재는 계속 가능합니다.';
function errorFrom(error){const e=new Error(error?.message||'요청을 처리하지 못했습니다.');e.code=error?.code;return e;}
function initialData(){return {settings:{...DEFAULT_SETTINGS},notices:[],audit:[]};}
function fromFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('첨부파일을 읽지 못했습니다.'));r.readAsDataURL(file);});}
export function createOperationsRepository({mode,client,getAdmin}) {
  const demo=mode==='demo';
  const read=()=>JSON.parse(localStorage.getItem(KEY)||'null')||initialData();
  const write=data=>localStorage.setItem(KEY,JSON.stringify(data));
  const requireAdmin=async()=>{const a=await getAdmin();if(a?.isSystemAdmin!==true)throw new Error('시스템 관리자만 접수 상태와 공지사항을 변경할 수 있습니다.');return a;};
  const rpc=async(name,params={})=>{const {data,error}=await client.rpc(name,params);if(error)throw errorFrom(error);return data;};
  const audit=(data,action,before,after,a)=>data.audit.unshift({id:crypto.randomUUID(),action,before_data:before,after_data:after,actor_name:a.displayName||a.email||'관리자',happened_at:new Date().toISOString()});
  return {
    async getSettings(){
      if(demo)return read().settings;
      try{const s=await rpc('get_proposal_intake_v270');if(typeof s?.is_open!=='boolean')throw new Error('invalid settings');return s;}
      catch(error){const e=new Error(MIGRATION_MESSAGE);e.code='INTAKE_UNAVAILABLE';e.cause=error;throw e;}
    },
    async assertNewProposalAllowed(){const s=await this.getSettings();assertIntakeOpen(s);return s;},
    async saveSettings(value,revision){
      const a=await requireAdmin(),fields=validateSettings(value);
      if(!Number.isInteger(Number(revision))||Number(revision)<0)throw new Error('현재 설정을 다시 불러온 후 저장하세요.');
      if(!demo)return rpc('admin_save_proposal_intake_v270',{p_settings:fields,p_expected_revision:Number(revision)});
      const data=read(),before=data.settings;
      if(before.revision!==Number(revision))throw new Error('다른 관리자가 설정을 변경했습니다. 현재 상태를 다시 확인하세요.');
      const now=new Date().toISOString();
      data.settings={...before,...fields,revision:before.revision+1,paused_at:fields.is_open?null:before.is_open?now:before.paused_at,updated_at:now};
      const old=data.notices.find(n=>n.system_key==='intake-status'),content=buildIntakeNotice(data.settings);
      const notice={...old,...content,id:old?.id||crypto.randomUUID(),system_key:'intake-status',is_published:true,is_pinned:true,attachments:[],revision:(old?.revision||0)+1,published_at:now,updated_at:now,author_name:a.displayName||'관리자'};
      data.notices=data.notices.filter(n=>n.system_key!=='intake-status');data.notices.unshift(notice);
      audit(data,fields.is_open===before.is_open?'접수 안내 변경':fields.is_open?'신규 접수 재개':'신규 접수 중단',before,data.settings,a);write(data);return data.settings;
    },
    async listNotices({admin=false,limit=null}={}){
      if(admin)await requireAdmin();
      if(demo){const d=read().notices;const rows=admin?d.slice().sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))):sortPublicNotices(d);return limit?rows.slice(0,limit):rows;}
      let q=client.from('proposal_site_notices').select('id,title,body,is_pinned,is_published,attachments,published_at,updated_at,revision,system_key,author_name').order('is_pinned',{ascending:false}).order('published_at',{ascending:false,nullsFirst:false});
      if(!admin)q=q.eq('is_published',true);
      if(limit){const {data,error}=await q.limit(limit);if(error)throw errorFrom(error);return data||[];}
      // Do not silently truncate a year's notices at PostgREST's default row limit.
      const result=[];for(let start=0;;start+=500){const {data,error}=await (admin?client.from('proposal_site_notices').select('*'):client.from('proposal_site_notices').select('id,title,body,is_pinned,is_published,attachments,published_at,updated_at,revision,system_key,author_name').eq('is_published',true)).order('is_pinned',{ascending:false}).order('published_at',{ascending:false,nullsFirst:false}).order('id').range(start,start+499);if(error)throw errorFrom(error);result.push(...(data||[]));if(!data||data.length<500)break;}return result;
    },
    async saveNotice(id,values,revision=0){
      const a=await requireAdmin(),v=validateNotice(values);
      if(!demo)return rpc('admin_save_site_notice_v270',{p_id:id,p_notice:v,p_expected_revision:Number(revision)});
      const data=read(),old=data.notices.find(n=>n.id===id);
      if(old?.system_key)throw new Error('자동 접수 안내는 접수 설정에서 변경하세요.');
      if((old?.revision||0)!==Number(revision))throw new Error('공지사항이 변경되었습니다. 다시 불러온 후 수정하세요.');
      const now=new Date().toISOString(),n={...old,...v,id,system_key:null,revision:(old?.revision||0)+1,author_name:a.displayName||'관리자',updated_at:now,published_at:v.is_published?(old?.is_published?old.published_at:now):old?.published_at||null};
      data.notices=data.notices.filter(x=>x.id!==id);data.notices.unshift(n);audit(data,old?'공지 수정':'공지 등록',old||null,n,a);write(data);return n;
    },
    async listAudit(){
      await requireAdmin();if(demo)return read().audit.slice(0,30);
      const {data,error}=await client.from('proposal_operations_audit').select('id,action,actor_name,happened_at').order('happened_at',{ascending:false}).limit(30);if(error)throw errorFrom(error);return data||[];
    },
    async uploadAttachments(id,files){
      await requireAdmin();if(files.length>3)throw new Error('첨부자료는 최대 3개까지 가능합니다.');
      files.forEach(validateAttachmentFile);const added=[];
      try{for(const file of files){const {ext,mime}=validateAttachmentFile(file),path=`${id}/${crypto.randomUUID()}.${ext}`;
        if(demo){if(file.size>1024*1024)throw new Error('데모에서는 첨부파일 1MB 이하만 검증할 수 있습니다. 운영 환경은 20MB입니다.');const all=JSON.parse(localStorage.getItem(FILE_KEY)||'{}');all[path]=await fromFile(file);localStorage.setItem(FILE_KEY,JSON.stringify(all));}
        else{const {error}=await client.storage.from(NOTICE_BUCKET).upload(path,file,{contentType:mime,upsert:false});if(error)throw errorFrom(error);}
        added.push({path,name:file.name,size:file.size,mime});
      }return added;}catch(e){await this.removeUploaded(added).catch(()=>{});throw e;}
    },
    async removeUploaded(files){
      if(!files.length)return;await requireAdmin();
      if(demo){const all=JSON.parse(localStorage.getItem(FILE_KEY)||'{}');files.forEach(f=>delete all[f.path]);localStorage.setItem(FILE_KEY,JSON.stringify(all));return;}
      const {error}=await client.storage.from(NOTICE_BUCKET).remove(files.map(f=>f.path));if(error)throw errorFrom(error);
    },
    async getAttachmentUrl(noticeId,path){
      // Check the notice as well as Storage RLS, so a hidden notice cannot issue a fresh link.
      const admin=(await getAdmin())?.isSystemAdmin===true;
      const notices=await this.listNotices({admin});const n=notices.find(n=>n.id===noticeId);
      if(!n||!n.attachments.some(f=>f.path===path))throw new Error('현재 게시 중인 첨부자료를 찾지 못했습니다.');
      if(demo){const url=JSON.parse(localStorage.getItem(FILE_KEY)||'{}')[path];if(!url)throw new Error('첨부자료가 없습니다.');return url;}
      const {data,error}=await client.storage.from(NOTICE_BUCKET).createSignedUrl(path,300);if(error)throw errorFrom(error);if(!data?.signedUrl)throw new Error('첨부자료를 열지 못했습니다.');return data.signedUrl;
    },
  };
}
