import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://ryanbabarian-design.github.io/ryan/").replace(/\/$/, "");
const APPROVAL_EMAIL_HOOK_SECRET = Deno.env.get("APPROVAL_EMAIL_HOOK_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const htmlEscape = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const typeLabel = (type: string) => ({
  new: "신규 결재 요청",
  reminder_1d: "1일 미결재 안내",
  reminder_3d: "결재 지연 안내",
  reminder_7d: "장기 미결재 안내",
  admin_7d: "장기 미결재 관리자 안내",
  ceo_batch: "대표이사 결재 일괄상신",
}[type] ?? "결재 알림");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const hookSecret = req.headers.get("x-approval-hook-secret") ?? "";
  if (!APPROVAL_EMAIL_HOOK_SECRET || hookSecret !== APPROVAL_EMAIL_HOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return Response.json({ error: "Edge Function secrets are not configured." }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { data: queue, error: queueError } = await supabase
    .from("proposal_notification_queue")
    .select("id,proposal_id,step_id,recipient_email,recipient_name,notification_type,status,attempts,ceo_batch_id,proposals(proposal_no,title,department,proposer_name),approval_steps(role_name,step_order)")
    .eq("status", "pending")
    .lte("available_at", now)
    .order("created_at", { ascending: true })
    .limit(20);

  if (queueError) return Response.json({ error: queueError.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const item of queue ?? []) {
    const { data: claimed } = await supabase
      .from("proposal_notification_queue")
      .update({ status: "sending", attempts: Number(item.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const proposal = Array.isArray(item.proposals) ? item.proposals[0] : item.proposals;
    const step = Array.isArray(item.approval_steps) ? item.approval_steps[0] : item.approval_steps;

    if (item.notification_type === "ceo_batch") {
      const { data: currentAssignments } = await supabase.from("approval_assignments")
        .select("email,department,active,id")
        .eq("step_id", item.step_id)
        .eq("active", true)
        .order("id", { ascending: false });
      const currentEmail = String((currentAssignments ?? []).find((row) => (row.department == null || row.department === "") && row.email)?.email ?? "").toLowerCase();
      if (!currentEmail || currentEmail !== String(item.recipient_email ?? "").toLowerCase()) {
        await supabase.from("proposal_notification_queue").update({ status: "failed", last_error: "대표이사 결재자 배정이 변경되어 발송을 중단했습니다.", updated_at: new Date().toISOString() }).eq("id", item.id);
        failed += 1;
        continue;
      }

      const { data: batchProposals, error: batchError } = await supabase
        .from("proposals")
        .select("id,proposal_no,title,department,proposer_name,review_result,score,award_amount,proposer_effect_amount,effect_amount")
        .eq("ceo_batch_id", item.ceo_batch_id)
        .eq("ceo_submission_status", "상신완료")
        .order("proposal_no", { ascending: true });
      if (batchError || !(batchProposals ?? []).length) {
        await supabase.from("proposal_notification_queue").update({ status: "failed", last_error: batchError?.message ?? "현재 대표이사 상신대상 제안이 없습니다.", updated_at: new Date().toISOString() }).eq("id", item.id);
        failed += 1;
        continue;
      }

      const batchRows = (batchProposals ?? []).map((row) => `<tr>
        <td style="padding:7px;border-bottom:1px solid #eaecf0"><b>${htmlEscape(row.proposal_no)}</b></td>
        <td style="padding:7px;border-bottom:1px solid #eaecf0">${htmlEscape(row.title)}</td>
        <td style="padding:7px;border-bottom:1px solid #eaecf0">${htmlEscape(row.proposer_name)} · ${htmlEscape(row.department)}</td>
      </tr>`).join("");
      const inboxUrl = `${SITE_URL}/#admin/inbox`;
      const subject = `[하나금속 제안관리] 대표이사 결재 ${(batchProposals ?? []).length}건이 상신되었습니다.`;
      const html = `
        <div style="font-family:Arial,'Noto Sans KR',sans-serif;line-height:1.6;color:#172033;max-width:760px;margin:auto">
          <div style="padding:18px 22px;background:#10213b;color:white"><strong style="font-size:20px">HANA METAL 제안관리</strong></div>
          <div style="padding:24px;border:1px solid #e4e7ec;border-top:0">
            <h2 style="margin:0 0 16px">대표이사 결재 일괄상신</h2>
            <p>${htmlEscape(item.recipient_name || "대표이사")}님, 심사가 완료된 제안 <strong>${(batchProposals ?? []).length}건</strong>이 대표이사 결재로 상신되었습니다.</p>
            <table style="width:100%;border-collapse:collapse;margin:18px 0"><thead><tr><th style="text-align:left;padding:7px;background:#f8fafc">접수번호</th><th style="text-align:left;padding:7px;background:#f8fafc">제안명</th><th style="text-align:left;padding:7px;background:#f8fafc">제안자</th></tr></thead><tbody>${batchRows}</tbody></table>
            <div style="margin:20px 0;padding:16px 18px;background:#f8fafc;border:1px solid #d0d5dd;border-radius:10px">
              <strong style="display:block;margin-bottom:10px;color:#10213b">결재 로그인 정보</strong>
              <div style="margin:4px 0"><b>결재 아이디</b> : ${htmlEscape(item.recipient_email)}</div>
              <div style="margin:4px 0"><b>최초 발급 비밀번호</b> : <strong>1111</strong></div>
              <div style="margin-top:8px;color:#667085;font-size:12px">이미 비밀번호를 변경한 경우에는 변경한 비밀번호를 사용하세요. 비밀번호 변경은 선택사항입니다.</div>
            </div>
            <a href="${htmlEscape(inboxUrl)}" style="display:inline-block;background:#d92d20;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">대표이사 결재함 열기</a>
            <p style="margin-top:20px;color:#667085;font-size:12px">본 메일은 하나금속 제안관리 시스템에서 자동 발송되었습니다.</p>
          </div>
        </div>`;

      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `hana-proposal/${item.id}/ceo_batch`,
          },
          body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [item.recipient_email], subject, html }),
        });
        const responseBody = await response.text();
        if (!response.ok) throw new Error(`Resend ${response.status}: ${responseBody.slice(0, 500)}`);
        await supabase.from("proposal_notification_queue").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", item.id);
        sent += 1;
      } catch (error) {
        await supabase.from("proposal_notification_queue").update({ status: "failed", last_error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }).eq("id", item.id);
        failed += 1;
      }
      continue;
    }
    if (item.notification_type !== "admin_7d") {
      const { data: currentAssignments } = await supabase.from("approval_assignments")
        .select("email,department,active,id")
        .eq("step_id", item.step_id)
        .eq("active", true)
        .order("id", { ascending: false });
      const applicable = (currentAssignments ?? []).filter((row) => row.department == null || row.department === "" || String(row.department) === String(proposal?.department ?? ""));
      const exact = applicable.find((row) => String(row.department ?? "") === String(proposal?.department ?? ""));
      const global = applicable.find((row) => row.department == null || row.department === "");
      const currentEmail = String((exact ?? global)?.email ?? "").toLowerCase();
      if (!currentEmail || currentEmail !== String(item.recipient_email ?? "").toLowerCase()) {
        await supabase.from("proposal_notification_queue").update({ status: "failed", last_error: "결재자 배정이 변경되어 발송을 중단했습니다.", updated_at: new Date().toISOString() }).eq("id", item.id);
        failed += 1;
        continue;
      }
    }
    const { data: approvalRecord } = await supabase.from("approval_records")
      .select("status,actionable_at")
      .eq("proposal_id", item.proposal_id)
      .eq("step_id", item.step_id)
      .maybeSingle();
    if (approvalRecord?.status !== "대기" || !approvalRecord?.actionable_at) {
      await supabase.from("proposal_notification_queue").update({
        status: "failed",
        last_error: "이미 처리되었거나 현재 결재대상이 아닌 단계라 발송하지 않았습니다.",
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      failed += 1;
      continue;
    }
    const actionableAt = new Date(approvalRecord.actionable_at);
    const pendingDays = Math.max(0, Math.floor((Date.now() - actionableAt.getTime()) / 86400000));
    const detailUrl = `${SITE_URL}/#admin/review/${encodeURIComponent(item.proposal_id)}`;
    const label = typeLabel(item.notification_type);
    const subject = `[하나금속 제안관리] ${proposal?.proposal_no ?? "제안"} ${step?.role_name ?? ""} ${label}`.trim();
    const loginGuide = item.notification_type === "admin_7d" ? "" : `
      <div style="margin:20px 0;padding:16px 18px;background:#f8fafc;border:1px solid #d0d5dd;border-radius:10px">
        <strong style="display:block;margin-bottom:10px;color:#10213b">결재 로그인 정보</strong>
        <div style="margin:4px 0"><b>결재 아이디</b> : ${htmlEscape(item.recipient_email)}</div>
        <div style="margin:4px 0"><b>최초 발급 비밀번호</b> : <strong>1111</strong></div>
        <div style="margin-top:8px;color:#667085;font-size:12px">이미 비밀번호를 변경한 경우에는 변경한 비밀번호를 사용하세요. 비밀번호 변경은 선택사항입니다.</div>
      </div>`;
    const html = `
      <div style="font-family:Arial,'Noto Sans KR',sans-serif;line-height:1.6;color:#172033;max-width:620px;margin:auto">
        <div style="padding:18px 22px;background:#10213b;color:white"><strong style="font-size:20px">HANA METAL 제안관리</strong></div>
        <div style="padding:24px;border:1px solid #e4e7ec;border-top:0">
          <h2 style="margin:0 0 16px">${htmlEscape(label)}</h2>
          <p>${htmlEscape(item.recipient_name || "결재자")}님, 처리할 전자결재가 있습니다.</p>
          <table style="width:100%;border-collapse:collapse;margin:18px 0">
            <tr><td style="padding:7px;font-weight:bold">제안번호</td><td>${htmlEscape(proposal?.proposal_no)}</td></tr>
            <tr><td style="padding:7px;font-weight:bold">제안명</td><td>${htmlEscape(proposal?.title)}</td></tr>
            <tr><td style="padding:7px;font-weight:bold">제안자</td><td>${htmlEscape(proposal?.proposer_name)}</td></tr>
            <tr><td style="padding:7px;font-weight:bold">부서</td><td>${htmlEscape(proposal?.department)}</td></tr>
            <tr><td style="padding:7px;font-weight:bold">현재단계</td><td>${htmlEscape(step?.role_name)}</td></tr>
            <tr><td style="padding:7px;font-weight:bold">결재 대기</td><td>${pendingDays}일</td></tr>
          </table>
          ${loginGuide}
          <a href="${htmlEscape(detailUrl)}" style="display:inline-block;background:#d92d20;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">제안 확인 및 결재하기</a>
          <p style="margin-top:20px;color:#667085;font-size:12px">본 메일은 하나금속 제안관리 시스템에서 자동 발송되었습니다.</p>
        </div>
      </div>`;

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `hana-proposal/${item.id}/${item.notification_type}`,
        },
        body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [item.recipient_email], subject, html }),
      });
      const responseBody = await response.text();
      if (!response.ok) throw new Error(`Resend ${response.status}: ${responseBody.slice(0, 500)}`);

      await supabase.from("proposal_notification_queue").update({
        status: "sent", sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      sent += 1;
    } catch (error) {
      await supabase.from("proposal_notification_queue").update({
        status: "failed", last_error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      failed += 1;
    }
  }

  return Response.json({ processed: (queue ?? []).length, sent, failed });
});

