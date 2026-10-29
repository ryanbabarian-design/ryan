// Administrator-only legacy score backfill. No approval or award changes here.
export const ADMIN_EVAL_KEYS = Object.freeze(['originality','effort','feasibility','applicability','continuity','tangible_effect']);
const WEIGHTS = [2,2,1,1,1,3];
function checkScores(values, stage) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== ADMIN_EVAL_KEYS.length)
    throw new Error(`${stage} 평가 6개 항목을 모두 입력하세요.`);
  let total = 0;
  for (const [i,key] of ADMIN_EVAL_KEYS.entries()) {
    const val = values[key];
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > 10)
      throw new Error(`${stage} 평가점수는 각 항목 정수 1~10점이어야 합니다.`);
    total += WEIGHTS[i] * val;
  }
  return total;
}
export function adminScoreFlowLabel(teamTotal) {
  if (teamTotal < 50) return '50점 미만 · 기준미달(3차 진행 불가)';
  if (teamTotal < 65) return '50~64점 · 건수처리(3차 심사 제외)';
  return '65점 이상 · 임원 승인 후 3차 심사 가능';
}
export function validateAdminScoreCorrection(first,team,reason) {
  const firstTotal=checkScores(first,'1차');
  const teamTotal=checkScores(team,'2차');
  if (firstTotal < 50) throw new Error(`1차 평가 ${firstTotal}점은 50점 미만입니다. 수정하여 저장하세요.`);
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 1000)
    throw new Error('평가 보완 사유를 5~1,000자로 입력하세요.');
  return {firstTotal,teamTotal,thirdEligible:teamTotal >= 65,reason:reason.trim()};
}
