import {awardForScore,validAwardScore} from './award-policy.js?v=2.9.1';
export const LEGACY_RESULTS=Object.freeze(['채택','미채택','보류','중복제안','건수처리']);
export const hasLegacyScore=p=>Number(p?.legacy_score_revision)>0 && !!p?.legacy_score_registered_at && validAwardScore(p?.score)!==null;
export function legacyScoreDecision(p,c,admin=false){
 const no=reason=>({allowed:false,reason});
 if(!admin)return no('시스템 관리자만 기존 심사점수를 등록할 수 있습니다.');
 if(!p||p.deleted_at||p.is_deleted===true||p.status==='삭제')return no('제안정보를 확인하지 못했습니다.');
 if(p.approval_required!==false)return no('전자결재 대상 제안은 기존 1·2·3차 심사를 사용하세요.');
 if(!['미지급','예정'].includes(p.payment_status))return no('미지급 과거 건 전용입니다. 지급완료 기록은 변경하지 않습니다.');
 if(!['','미상신'].includes(String(p.ceo_submission_status??'').trim())||p.legacy_ceo_direct===true)return no('대표이사 상신·승인·반려 이력이 있어 점수 등록을 잠갔습니다.');
 if(p.second_evaluation_total!=null || (p.second_evaluation && Object.keys(p.second_evaluation).length))return no('항목별 3차 평가가 이미 있습니다. 기존 심사절차를 사용하세요.');
 if(c?.source!=='v293'||String(c.proposal_id)!==String(p.id)||c.approval_required!==false||c.legacy_eligible!==true||c.blocking_count!==0||!Array.isArray(c.records)||!Array.isArray(c.steps))return no('실제 결재기록 또는 조회 상태를 확인해야 합니다. 기록을 삭제하지 마세요.');
 if(!p.updated_at||!c.proposal_updated_at||!Number.isFinite(Date.parse(p.updated_at))||Date.parse(p.updated_at)!==Date.parse(c.proposal_updated_at))return no('자료가 변경되었습니다. 최신 제안을 다시 조회하세요.');
 return {allowed:true,reason:'기존 확정 총점만 등록합니다. 1·2차/3차 항목별 점수나 과거 승인기록을 만들지 않습니다. 저장 후 별도 확인을 거쳐 대표이사에게 상신합니다.'};
}
export function validateLegacyScoreInput(v){
 const fields=['score','result','basis','reason','expectedUpdatedAt','confirm'];
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!fields.includes(k)))throw new Error('기존 총점·결과·근거·사유만 입력하세요.');
 if(typeof v.score!=='number'||!Number.isInteger(v.score)||v.score<0||v.score>100)throw new Error('기존 심사 총점을 0~100 정수로 입력하세요.');
 if(!LEGACY_RESULTS.includes(v.result))throw new Error('기존 확정 심사결과를 선택하세요.');
 if(v.result==='채택'&&v.score<50)throw new Error('채택은 50점 이상입니다. 원본 점수를 확인하세요.');
 if(v.result==='건수처리'&&(v.score<50||v.score>65))throw new Error('건수처리 지급기준은 50~65점입니다.');
 for(const key of ['basis','reason'])if(typeof v[key]!=='string'||v[key].trim().length<5||v[key].trim().length>1000)throw new Error('기존 심사 근거와 등록 사유를 각각 5~1,000자로 입력하세요.');
 if(v.confirm!==true)throw new Error('기존 심사자료의 총점이며 새 평가점수가 아님을 확인하세요.');
 if(typeof v.expectedUpdatedAt!=='string'||!/^[0-9]{4}-/.test(v.expectedUpdatedAt)||!Number.isFinite(Date.parse(v.expectedUpdatedAt)))throw new Error('최신 제안을 다시 조회하세요.');
 return {...v,basis:v.basis.trim(),reason:v.reason.trim(),award:awardForScore(v.score,v.result)};
}
export function legacyCeoPermission(p,steps,records,assignments){
 const empty={assigned:false,canAct:false,step:null,assignment:null,record:null,reason:'지정된 대표이사만 결재할 수 있습니다.'};
 if(!hasLegacyScore(p)||p.approval_required!==false||p.legacy_ceo_direct!==true)return empty;
 const step=steps?.find(s=>s.role_name==='대표이사'&&s.active!==false&&s.auto_author!==true);
 const record=records?.find(r=>String(r.proposal_id)===String(p.id)&&String(r.step_id)===String(step?.id));
 const assignment=assignments?.find(a=>a.active!==false&&!String(a.department??'').trim()&&String(a.step_id)===String(step?.id)&&a.user_id&&String(a.user_id)===String(record?.assigned_user_id));
 if(!step||!record||!assignment)return empty;
 const base={assigned:true,step,record,assignment};
 if(p.ceo_submission_status!=='상신완료'||record.status!=='대기'||!record.actionable_at||p.payment_status==='완료')return {...base,canAct:false,reason:'대표상신 상태·처리완료 여부를 확인하세요.'};
 return {...base,canAct:true,reason:'기존 심사 총점에 대한 대표이사 최종결재입니다. 과거 부서장·임원 승인을 새로 만든 건이 아닙니다.'};
}
