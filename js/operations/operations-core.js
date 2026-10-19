// V2.7.0: intake operations are separate from proposal approval/evaluation.
export const OPERATIONS_VERSION = '2.7.0';
export const NOTICE_BUCKET = 'proposal-notice-files';
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const DEFAULT_SETTINGS = Object.freeze({id:1,is_open:true,reason:'',resume_message:'별도 공지',paused_at:null,updated_at:null,revision:0});
export const DOCUMENT_TYPES = Object.freeze({pdf:'application/pdf',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
export function escapeOperationsHtml(value='') {return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function validateSettings(value={}) {
  if (typeof value.is_open !== 'boolean') throw new Error('접수 상태를 선택하세요.');
  const reason=String(value.reason??'').trim(),resume=String(value.resume_message??'').trim()||'별도 공지';
  if (!value.is_open&&!reason) throw new Error('접수 중단 사유를 입력하세요.');
  if(reason.length>1000||resume.length>200) throw new Error('중단 사유는 1,000자, 재개 안내는 200자 이내로 입력하세요.');
  return {is_open:value.is_open,reason,resume_message:resume};
}
export function assertIntakeOpen(settings) {
  if(!settings||typeof settings.is_open!=='boolean') {const e=new Error('신규 접수 상태를 확인하지 못했습니다. 잠시 후 다시 확인하세요. 기존 제안 조회·수정·결재는 계속 이용할 수 있습니다.');e.code='INTAKE_UNAVAILABLE';throw e;}
  if(!settings.is_open){const e=new Error('신규 제안 접수가 일시 중단되었습니다. 작성 내용은 유지됩니다. 기존 제안의 수정·보완·재상신은 가능합니다.');e.code='INTAKE_CLOSED';throw e;}
}
export function validateNotice(value={}) {
  const title=String(value.title??'').trim(),body=String(value.body??'').trim();
  if(!title||!body) throw new Error('공지 제목과 내용을 입력하세요.');
  if(title.length>160||body.length>20000)throw new Error('제목은 160자, 내용은 20,000자 이내로 입력하세요.');
  if(typeof value.is_published!=='boolean'||typeof value.is_pinned!=='boolean')throw new Error('공지 게시 상태를 확인하세요.');
  const attachments=Array.isArray(value.attachments)?value.attachments:[];
  if(attachments.length>MAX_ATTACHMENTS)throw new Error('첨부자료는 최대 3개까지 등록할 수 있습니다.');
  return {title,body,is_published:value.is_published,is_pinned:value.is_pinned,attachments};
}
export function sortPublicNotices(rows=[]) {return rows.filter(x=>x.is_published===true).slice().sort((a,b)=>Number(b.is_pinned)-Number(a.is_pinned)||String(b.published_at||b.updated_at||'').localeCompare(String(a.published_at||a.updated_at||''))||String(a.id).localeCompare(String(b.id)));}
export function formatOperationsDate(value) {if(!value)return '-';const d=new Date(value);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);}
export function buildIntakeNotice(settings) {
  if(settings.is_open)return {title:'신규 제안 접수 재개 안내',body:'신규 제안 접수가 재개되었습니다.\n제안 접수 메뉴에서 새로운 제안을 등록할 수 있습니다.\n\n기존 제안의 평가·결재·수정·보완·재상신 및 실적·엑셀 기능도 정상 이용 가능합니다.\n\n문의: 제안제도 운영담당자'};
  return {title:'신규 제안 접수 일시 중단 안내',body:`신규 제안 접수를 일시 중단합니다.\n\n중단 시작: ${formatOperationsDate(settings.paused_at)} (한국시간)\n중단 사유: ${settings.reason}\n접수 재개: ${settings.resume_message||'별도 공지'}\n\n중단 이전에 접수 완료된 제안은 기존 평가 절차에 따라 정상 진행됩니다. 부서장 및 심사위원께서는 담당 제안의 평가·결재를 계속 진행해 주세요.\n\n반려된 기존 제안은 수정·보완 후 같은 접수번호로 재상신할 수 있습니다. 새 제안으로 중복 제출하지 마세요.\n\n접수현황 조회, 개인별 실적 및 엑셀 다운로드는 정상 이용 가능합니다. 작성창만 열고 제출하지 않은 제안은 접수 완료된 건에 포함되지 않습니다.\n\n문의: 제안제도 운영담당자`};
}
export function validateAttachmentFile(file) {
  const ext=String(file?.name||'').split('.').pop().toLowerCase();
  if(!DOCUMENT_TYPES[ext])throw new Error('첨부자료는 PDF·PPT·PPTX 파일만 가능합니다.');
  if(!Number.isFinite(file.size)||file.size<=0||file.size>MAX_ATTACHMENT_BYTES)throw new Error('첨부자료는 파일당 20MB 이하의 비어 있지 않은 파일만 가능합니다.');
  if(String(file.name).length>180)throw new Error('첨부자료 파일명은 180자 이내로 줄여 주세요.');
  return {ext,mime:DOCUMENT_TYPES[ext]};
}
