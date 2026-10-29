// One narrowly scoped administrative correction. Never used for normal scoring.
export const ONE_OFF_NUMBER = 'Q26-043';
export const SCORE_FIELDS = Object.freeze([
  'originality','effort','feasibility','applicability','continuity','tangible_effect',
]);
const WEIGHTS = Object.freeze([2,2,1,1,1,3]);

export function evaluationTotal(scores) {
  return SCORE_FIELDS.reduce((total, key, index) => total + Number(scores[key]) * WEIGHTS[index], 0);
}
export function validateOneOffEvaluation(first, team, reason) {
  for (const [label, scores] of [['1차',first], ['2차',team]]) {
    if (!scores || typeof scores !== 'object' || Array.isArray(scores)
      || Object.keys(scores).length !== SCORE_FIELDS.length
      || SCORE_FIELDS.some(key => !Object.hasOwn(scores, key) || typeof scores[key] !== 'number'
          || !Number.isInteger(scores[key]) || scores[key] < 1 || scores[key] > 10)) {
      throw new Error(`${label} 평가 6개 항목은 각각 1~10점의 정수로 입력하세요.`);
    }
  }
  const firstTotal=evaluationTotal(first), teamTotal=evaluationTotal(team);
  if (firstTotal < 50) throw new Error(`1차 평가가 ${firstTotal}점입니다. 50점 이상이어야 합니다.`);
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 1000)
    throw new Error('점수 보완 사유를 5~1,000자로 입력하세요.');
  return { firstTotal, teamTotal, reason:reason.trim() };
}
