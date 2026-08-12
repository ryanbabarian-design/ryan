import { SEED_EMPLOYEES, SEED_PROPOSALS } from "../data/seed.js";
import { collectProposalImagePaths, isEmployeeEditable, nextProposalNo, normalizeImplementationDetails, sha256 } from "../core.js?v=2.0";
import { mergeRetainedWithUploaded } from "../image-manager.js?v=2.0";

const PROPOSAL_KEY = "proposal-system:v1:proposals";
const EMPLOYEE_KEY = "proposal-system:v1:employees";
const ADMIN_KEY = "proposal-system:v1:admin";
const GOAL_KEY = "proposal-system:v2:department-goals";
const STATUS_HISTORY_KEY = "proposal-system:v2:status-history";
const APPROVAL_STEPS_KEY = "proposal-system:v2:approval-steps";
const APPROVAL_RECORDS_KEY = "proposal-system:v2:approval-records";
const AUDIT_KEY = "proposal-system:v2:audit-logs";
const DEFAULT_APPROVAL_STEPS = [
  { id: 1, step_order: 1, role_name: "담당", description: "제안 내용 및 기본사항 확인", active: true },
  { id: 2, step_order: 2, role_name: "팀장", description: "부서 검토 및 심사 확인", active: true },
  { id: 3, step_order: 3, role_name: "공장장", description: "실시·효과 검토", active: true },
  { id: 4, step_order: 4, role_name: "대표이사", description: "최종 승인", active: true },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeProposal(row) {
  return {
    before_images: [],
    after_images: [],
    score: null,
    award_amount: 0,
    effect_amount: 0,
    cost_amount: 0,
    locked: false,
    review_result: "미심사",
    status: "접수",
    implementation_status: "미실시",
    payment_status: "미지급",
    ...row,
    before_images: asArray(row.before_images),
    after_images: asArray(row.after_images),
  };
}

async function filesToDataUrls(files) {
  return Promise.all(
    Array.from(files ?? []).map(
      (file) =>
        new Promise((resolve, reject) => {
          if (file.size > 5 * 1024 * 1024) {
            reject(new Error(`${file.name}: 파일당 5MB 이하만 등록할 수 있습니다.`));
            return;
          }
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              url: reader.result,
              name: file.name,
              type: file.type,
            });
          reader.onerror = () => reject(new Error(`${file.name} 파일을 읽지 못했습니다.`));
          reader.readAsDataURL(file);
        }),
    ),
  );
}


export async function deleteProposalAndImages(client, storageBucket, id) {
  const { data: proposal, error: readError } = await client
    .from("proposals")
    .select("before_images,after_images")
    .eq("id", id)
    .single();
  if (readError) throw readError;
  if (!proposal) throw new Error("삭제할 제안을 찾지 못했습니다.");

  const imagePaths = collectProposalImagePaths(proposal, storageBucket);
  if (imagePaths.length) {
    const { error: storageError } = await client.storage
      .from(storageBucket)
      .remove(imagePaths);
    if (storageError) throw storageError;
  }

  const { error: deleteError } = await client
    .from("proposals")
    .delete()
    .eq("id", id);
  if (deleteError) throw deleteError;

  return { deletedImageCount: imagePaths.length };
}

class DemoStore {
  constructor(config) {
    this.config = config;
    if (!localStorage.getItem(PROPOSAL_KEY)) {
      localStorage.setItem(PROPOSAL_KEY, JSON.stringify(SEED_PROPOSALS));
    }
    if (!localStorage.getItem(EMPLOYEE_KEY)) {
      localStorage.setItem(EMPLOYEE_KEY, JSON.stringify(SEED_EMPLOYEES));
    }
    if (!localStorage.getItem(GOAL_KEY)) localStorage.setItem(GOAL_KEY, "[]");
    if (!localStorage.getItem(STATUS_HISTORY_KEY)) localStorage.setItem(STATUS_HISTORY_KEY, "[]");
    if (!localStorage.getItem(APPROVAL_STEPS_KEY)) localStorage.setItem(APPROVAL_STEPS_KEY, JSON.stringify(DEFAULT_APPROVAL_STEPS));
    if (!localStorage.getItem(APPROVAL_RECORDS_KEY)) localStorage.setItem(APPROVAL_RECORDS_KEY, "[]");
    if (!localStorage.getItem(AUDIT_KEY)) localStorage.setItem(AUDIT_KEY, "[]");
  }

  get mode() {
    return "demo";
  }

  async getProposals() {
    const rows = JSON.parse(localStorage.getItem(PROPOSAL_KEY) || "[]");
    return rows.map(normalizeProposal);
  }

  async getEmployees() {
    return JSON.parse(localStorage.getItem(EMPLOYEE_KEY) || "[]")
      .filter((employee) => employee.active !== false)
      .sort((a, b) => `${a.department}${a.name}`.localeCompare(`${b.department}${b.name}`, "ko"));
  }

  async createProposal(payload, beforeFiles, afterFiles) {
    const proposals = await this.getProposals();
    const pinHash = await sha256(payload.edit_pin);
    const [beforeImages, afterImages] = await Promise.all([
      filesToDataUrls(beforeFiles),
      filesToDataUrls(afterFiles),
    ]);
    const now = new Date().toISOString();
    const implementation = normalizeImplementationDetails(
      payload.implementation_status,
      payload.implemented_date,
    );

    const proposal = normalizeProposal({
      ...payload,
      ...implementation,
      id: crypto.randomUUID(),
      proposal_no: nextProposalNo(proposals),
      received_date: todayIso(),
      before_images: beforeImages,
      after_images: afterImages,
      edit_pin_hash: pinHash,
      status: "접수",
      review_result: "미심사",
      payment_status: "미지급",
      locked: false,
      created_at: now,
      updated_at: now,
    });

    delete proposal.edit_pin;
    proposals.unshift(proposal);
    localStorage.setItem(PROPOSAL_KEY, JSON.stringify(proposals));
    const history = JSON.parse(localStorage.getItem(STATUS_HISTORY_KEY) || "[]");
    history.push({ id: Date.now(), proposal_id: proposal.id, proposal_no: proposal.proposal_no, stage: "접수", detail: "신규 제안 접수", actor_name: proposal.proposer_name, happened_at: now });
    localStorage.setItem(STATUS_HISTORY_KEY, JSON.stringify(history));
    const steps = await this.getApprovalSteps();
    const records = JSON.parse(localStorage.getItem(APPROVAL_RECORDS_KEY) || "[]");
    for (const step of steps) records.push({ id: `${proposal.id}-${step.id}`, proposal_id: proposal.id, step_id: step.id, status: "대기", created_at: now, updated_at: now });
    localStorage.setItem(APPROVAL_RECORDS_KEY, JSON.stringify(records));
    return proposal;
  }

  async updateProposalWithPin(proposalNo, pin, patch, beforeFiles, afterFiles) {
    const proposals = await this.getProposals();
    const index = proposals.findIndex((item) => item.proposal_no === proposalNo);
    if (index < 0) throw new Error("접수번호를 찾지 못했습니다.");

    const current = proposals[index];
    if (!isEmployeeEditable(current)) {
      throw new Error("관리자가 심사를 시작하여 제안자 수정이 잠겼습니다.");
    }

    const pinHash = await sha256(pin);
    if (!current.edit_pin_hash || pinHash !== current.edit_pin_hash) {
      throw new Error("수정번호가 일치하지 않습니다.");
    }

    const [newBefore, newAfter] = await Promise.all([
      filesToDataUrls(beforeFiles),
      filesToDataUrls(afterFiles),
    ]);

    const retainedBefore = Array.isArray(patch.before_images)
      ? patch.before_images
      : current.before_images;
    const retainedAfter = Array.isArray(patch.after_images)
      ? patch.after_images
      : current.after_images;
    const implementation = normalizeImplementationDetails(
      patch.implementation_status ?? current.implementation_status,
      patch.implemented_date ?? current.implemented_date,
    );

    proposals[index] = normalizeProposal({
      ...current,
      ...patch,
      ...implementation,
      before_images: mergeRetainedWithUploaded(retainedBefore, newBefore),
      after_images: mergeRetainedWithUploaded(retainedAfter, newAfter),
      updated_at: new Date().toISOString(),
    });
    localStorage.setItem(PROPOSAL_KEY, JSON.stringify(proposals));
    return proposals[index];
  }

  async loginAdmin(email, password) {
    if (
      email !== this.config.demoAdminEmail ||
      password !== this.config.demoAdminPassword
    ) {
      throw new Error("관리자 이메일 또는 비밀번호가 올바르지 않습니다.");
    }
    sessionStorage.setItem(ADMIN_KEY, email);
    return { email };
  }

  async logoutAdmin() {
    sessionStorage.removeItem(ADMIN_KEY);
  }

  async getAdminSession() {
    const email = sessionStorage.getItem(ADMIN_KEY);
    return email ? { email } : null;
  }

  async adminUpdateProposal(id, patch) {
    const admin = await this.getAdminSession();
    if (!admin) throw new Error("관리자 로그인이 필요합니다.");
    const proposals = await this.getProposals();
    const index = proposals.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("제안을 찾지 못했습니다.");
    const before = clone(proposals[index]);
    const now = new Date().toISOString();

    proposals[index] = normalizeProposal({
      ...proposals[index],
      ...patch,
      locked: ["심사중", "심사완료"].includes(patch.status ?? proposals[index].status),
      updated_at: now,
    });
    const after = proposals[index];
    localStorage.setItem(PROPOSAL_KEY, JSON.stringify(proposals));

    const tracked = ["status","review_result","implementing_department","implementation_status","implemented_date","score","award_grade","award_amount","payment_status","effect_amount","review_comment"];
    const audits = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
    for (const field of tracked) {
      if (JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)) {
        audits.push({ id: `${Date.now()}-${field}`, proposal_id: id, proposal_no: after.proposal_no, action: "UPDATE", field_name: field, old_value: before[field] ?? null, new_value: after[field] ?? null, actor_name: admin.displayName || admin.email, created_at: now });
      }
    }
    localStorage.setItem(AUDIT_KEY, JSON.stringify(audits));

    const history = JSON.parse(localStorage.getItem(STATUS_HISTORY_KEY) || "[]");
    if (before.status !== after.status && after.status === "심사중") history.push({ proposal_id:id, proposal_no:after.proposal_no, stage:"심사중", detail:"관리자 심사 시작", actor_name:admin.displayName||admin.email, happened_at:now });
    if (before.review_result !== after.review_result && after.review_result !== "미심사") history.push({ proposal_id:id, proposal_no:after.proposal_no, stage:after.review_result, detail:after.review_comment||"심사결과 등록", actor_name:admin.displayName||admin.email, happened_at:now });
    if (before.implementation_status !== after.implementation_status && after.implementation_status === "진행중") history.push({ proposal_id:id, proposal_no:after.proposal_no, stage:"시행중", detail:"시행 진행", actor_name:admin.displayName||admin.email, happened_at:now });
    if (before.implementation_status !== after.implementation_status && after.implementation_status === "완료") history.push({ proposal_id:id, proposal_no:after.proposal_no, stage:"실시완료", detail:"실시 완료", actor_name:admin.displayName||admin.email, happened_at:after.implemented_date || now });
    if (before.payment_status !== after.payment_status && after.payment_status === "완료") history.push({ proposal_id:id, proposal_no:after.proposal_no, stage:"포상지급", detail:"포상금 지급 완료", actor_name:admin.displayName||admin.email, happened_at:now });
    localStorage.setItem(STATUS_HISTORY_KEY, JSON.stringify(history));
    return after;
  }

  async deleteProposal(id) {
    const admin = await this.getAdminSession();
    if (!admin) throw new Error("관리자 로그인이 필요합니다.");
    const proposals = await this.getProposals();
    const target = proposals.find((item) => item.id === id);
    localStorage.setItem(PROPOSAL_KEY, JSON.stringify(proposals.filter((item) => item.id !== id)));
    if (target) {
      const audits = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
      audits.push({ id: Date.now(), proposal_id:id, proposal_no:target.proposal_no, action:"DELETE", field_name:"__deleted__", old_value:target, new_value:null, actor_name:admin.displayName||admin.email, created_at:new Date().toISOString() });
      localStorage.setItem(AUDIT_KEY, JSON.stringify(audits));
    }
  }

  async importEmployees(rows) {
    if (!(await this.getAdminSession())) throw new Error("관리자 로그인이 필요합니다.");
    const current = JSON.parse(localStorage.getItem(EMPLOYEE_KEY) || "[]");
    const keyed = new Map(current.map((row) => [`${row.name}|${row.department}`, row]));
    rows.forEach((row) => {
      keyed.set(`${row.name}|${row.department}`, {
        name: row.name,
        department: row.department,
        employee_no: row.employee_no || "",
        active: row.active !== false,
      });
    });
    const saved = Array.from(keyed.values());
    localStorage.setItem(EMPLOYEE_KEY, JSON.stringify(saved));
    return saved;
  }

  async getStatusHistory(proposalId) {
    return JSON.parse(localStorage.getItem(STATUS_HISTORY_KEY) || "[]")
      .filter((row) => row.proposal_id === proposalId)
      .sort((a, b) => String(a.happened_at).localeCompare(String(b.happened_at)));
  }

  async getDepartmentGoals(year = "") {
    const rows = JSON.parse(localStorage.getItem(GOAL_KEY) || "[]");
    return year && year !== "all" ? rows.filter((row) => String(row.year) === String(year)) : rows;
  }

  async saveDepartmentGoal(goal) {
    if (!(await this.getAdminSession())) throw new Error("관리자 로그인이 필요합니다.");
    const rows = JSON.parse(localStorage.getItem(GOAL_KEY) || "[]");
    const normalized = { ...goal, year: Number(goal.year), annual_goal: Math.max(0, Number(goal.annual_goal || 0)) };
    const index = rows.findIndex((row) => Number(row.year) === normalized.year && row.department === normalized.department);
    if (index >= 0) rows[index] = { ...rows[index], ...normalized, updated_at: new Date().toISOString() };
    else rows.push({ id: Date.now(), ...normalized, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    localStorage.setItem(GOAL_KEY, JSON.stringify(rows));
    return normalized;
  }

  async getApprovalSteps(includeInactive = false) {
    const rows = JSON.parse(localStorage.getItem(APPROVAL_STEPS_KEY) || "[]");
    return rows.filter((row) => includeInactive || row.active !== false).sort((a, b) => a.step_order - b.step_order);
  }

  async saveApprovalStep(step) {
    if (!(await this.getAdminSession())) throw new Error("관리자 로그인이 필요합니다.");
    const rows = JSON.parse(localStorage.getItem(APPROVAL_STEPS_KEY) || "[]");
    const normalized = { ...step, step_order: Number(step.step_order), active: step.active !== false };
    const index = rows.findIndex((row) => String(row.id) === String(normalized.id) || Number(row.step_order) === normalized.step_order);
    if (index >= 0) rows[index] = { ...rows[index], ...normalized };
    else rows.push({ ...normalized, id: Date.now() });
    localStorage.setItem(APPROVAL_STEPS_KEY, JSON.stringify(rows));
    return normalized;
  }

  async getApprovalRecords(proposalId) {
    return JSON.parse(localStorage.getItem(APPROVAL_RECORDS_KEY) || "[]").filter((row) => row.proposal_id === proposalId);
  }

  async actApproval(proposalId, stepId, status, comment = "") {
    const admin = await this.getAdminSession();
    if (!admin) throw new Error("관리자 로그인이 필요합니다.");
    const rows = JSON.parse(localStorage.getItem(APPROVAL_RECORDS_KEY) || "[]");
    let row = rows.find((item) => item.proposal_id === proposalId && String(item.step_id) === String(stepId));
    const now = new Date().toISOString();
    if (!row) {
      row = { id: Date.now(), proposal_id: proposalId, step_id: Number(stepId) };
      rows.push(row);
    }
    Object.assign(row, { status, comment, approver_name: admin.displayName || admin.email, acted_at: now, updated_at: now });
    localStorage.setItem(APPROVAL_RECORDS_KEY, JSON.stringify(rows));
    return row;
  }

  async getAuditLogs(limit = 200, proposalId = "") {
    const rows = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
    return rows.filter((row) => !proposalId || row.proposal_id === proposalId).slice(-limit).reverse();
  }

  async resetDemo() {
    localStorage.setItem(PROPOSAL_KEY, JSON.stringify(SEED_PROPOSALS));
    localStorage.setItem(EMPLOYEE_KEY, JSON.stringify(SEED_EMPLOYEES));
    localStorage.setItem(GOAL_KEY, "[]");
    localStorage.setItem(STATUS_HISTORY_KEY, "[]");
    localStorage.setItem(APPROVAL_STEPS_KEY, JSON.stringify(DEFAULT_APPROVAL_STEPS));
    localStorage.setItem(APPROVAL_RECORDS_KEY, "[]");
    localStorage.setItem(AUDIT_KEY, "[]");
    sessionStorage.removeItem(ADMIN_KEY);
  }
}

class SupabaseStore {
  constructor(config) {
    this.config = config;
    if (!window.supabase?.createClient) {
      throw new Error("Supabase 라이브러리를 불러오지 못했습니다.");
    }
    this.client = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey,
    );
  }

  get mode() {
    return "supabase";
  }

  async getProposals() {
    const { data, error } = await this.client
      .from("proposal_public")
      .select("*")
      .order("received_date", { ascending: false })
      .order("proposal_no", { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeProposal);
  }

  async getEmployees() {
    const { data, error } = await this.client
      .from("employees")
      .select("id,name,department,employee_no,active")
      .eq("active", true)
      .order("department")
      .order("name");
    if (error) throw error;
    return data || [];
  }

  async uploadImages(files, section) {
    const uploaded = [];
    const submissionId = crypto.randomUUID();

    for (const [index, file] of Array.from(files ?? []).entries()) {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error(`${file.name}: 파일당 5MB 이하만 등록할 수 있습니다.`);
      }
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `submissions/${submissionId}/${section}-${index + 1}.${extension}`;
      const { error } = await this.client.storage
        .from(this.config.storageBucket)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (error) throw error;
      const { data } = this.client.storage
        .from(this.config.storageBucket)
        .getPublicUrl(path);
      uploaded.push({ url: data.publicUrl, name: file.name, path });
    }

    return uploaded;
  }

  async createProposal(payload, beforeFiles, afterFiles) {
    const implementation = normalizeImplementationDetails(
      payload.implementation_status,
      payload.implemented_date,
    );
    const [beforeImages, afterImages] = await Promise.all([
      this.uploadImages(beforeFiles, "before"),
      this.uploadImages(afterFiles, "after"),
    ]);

    const body = { ...payload, ...implementation, before_images: beforeImages, after_images: afterImages };
    delete body.edit_pin;

    const { data, error } = await this.client.rpc("create_proposal", {
      p_payload: body,
      p_edit_pin: payload.edit_pin,
    });
    if (error) throw error;
    return normalizeProposal(Array.isArray(data) ? data[0] : data);
  }

  async updateProposalWithPin(proposalNo, pin, patch, beforeFiles, afterFiles) {
    const implementation = normalizeImplementationDetails(
      patch.implementation_status,
      patch.implemented_date,
    );
    const [beforeImages, afterImages] = await Promise.all([
      beforeFiles?.length ? this.uploadImages(beforeFiles, "before-edit") : [],
      afterFiles?.length ? this.uploadImages(afterFiles, "after-edit") : [],
    ]);

    const payload = { ...patch, ...implementation };
    if (Array.isArray(patch.before_images) || beforeImages.length) {
      payload.before_images = mergeRetainedWithUploaded(patch.before_images, beforeImages);
    }
    if (Array.isArray(patch.after_images) || afterImages.length) {
      payload.after_images = mergeRetainedWithUploaded(patch.after_images, afterImages);
    }

    const { data, error } = await this.client.rpc("edit_proposal_with_pin", {
      p_proposal_no: proposalNo,
      p_edit_pin: pin,
      p_payload: payload,
    });
    if (error) throw error;
    return normalizeProposal(Array.isArray(data) ? data[0] : data);
  }

  async cleanupRemovedImages() {
    const { data: queued, error: queueError } = await this.client
      .from("proposal_image_cleanup")
      .select("id,image_path")
      .order("id")
      .limit(100);

    if (queueError) {
      if (queueError.code === "42P01") return 0;
      throw queueError;
    }
    if (!queued?.length) return 0;

    const paths = queued.map((row) => row.image_path).filter(Boolean);
    if (paths.length) {
      const { error: storageError } = await this.client.storage
        .from(this.config.storageBucket)
        .remove(paths);
      if (storageError) throw storageError;
    }

    const { error: deleteError } = await this.client
      .from("proposal_image_cleanup")
      .delete()
      .in("id", queued.map((row) => row.id));
    if (deleteError) throw deleteError;
    return paths.length;
  }

  async loginAdmin(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const { data: admin, error: adminError } = await this.client
      .from("admins")
      .select("user_id,display_name")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (adminError) throw adminError;
    if (!admin) {
      await this.client.auth.signOut();
      throw new Error("관리자 권한이 없는 계정입니다.");
    }
    try {
      await this.cleanupRemovedImages();
    } catch (cleanupError) {
      console.warn("삭제 예약 사진 정리에 실패했습니다.", cleanupError);
    }
    return { email: data.user.email, displayName: admin.display_name };
  }

  async logoutAdmin() {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  async getAdminSession() {
    const { data } = await this.client.auth.getSession();
    if (!data.session) return null;
    const { data: admin } = await this.client
      .from("admins")
      .select("display_name")
      .eq("user_id", data.session.user.id)
      .maybeSingle();
    return admin
      ? { email: data.session.user.email, displayName: admin.display_name }
      : null;
  }

  async adminUpdateProposal(id, patch) {
    const { data, error } = await this.client
      .from("proposals")
      .update(patch)
      .eq("id", id)
      .select("id,proposal_no,received_date,category,proposer_name,department,title,current_problem,improvement_plan,expected_effect,cost_amount,before_images,after_images,status,review_result,implementing_department,implementation_status,implemented_date,score,award_grade,award_amount,payment_status,effect_amount,review_comment,locked,created_at,updated_at")
      .single();
    if (error) throw error;
    return normalizeProposal(data);
  }

  async deleteProposal(id) {
    return deleteProposalAndImages(
      this.client,
      this.config.storageBucket,
      id,
    );
  }

  async importEmployees(rows) {
    const { data, error } = await this.client
      .from("employees")
      .upsert(rows, { onConflict: "name,department" })
      .select();
    if (error) throw error;
    return data || [];
  }

  async getStatusHistory(proposalId) {
    const { data, error } = await this.client
      .from("proposal_status_history")
      .select("id,proposal_id,proposal_no,stage,detail,actor_name,happened_at")
      .eq("proposal_id", proposalId)
      .order("happened_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async getDepartmentGoals(year = "") {
    let query = this.client.from("department_goals").select("id,year,department,annual_goal,note,created_at,updated_at").order("year", { ascending: false }).order("department");
    if (year && year !== "all") query = query.eq("year", Number(year));
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async saveDepartmentGoal(goal) {
    const { data: sessionData } = await this.client.auth.getSession();
    const payload = {
      year: Number(goal.year), department: goal.department,
      annual_goal: Math.max(0, Number(goal.annual_goal || 0)),
      note: goal.note || null, created_by: sessionData.session?.user?.id || null,
    };
    const { data, error } = await this.client.from("department_goals")
      .upsert(payload, { onConflict: "year,department" }).select("id,year,department,annual_goal,note,created_at,updated_at").single();
    if (error) throw error;
    return data;
  }

  async getApprovalSteps(includeInactive = false) {
    let query = this.client.from("approval_steps").select("*").order("step_order");
    if (!includeInactive) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async saveApprovalStep(step) {
    const payload = {
      ...(step.id ? { id: step.id } : {}),
      step_order: Number(step.step_order), role_name: step.role_name,
      description: step.description || null, active: step.active !== false,
    };
    const { data, error } = await this.client.from("approval_steps").upsert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async getApprovalRecords(proposalId) {
    const { data, error } = await this.client.from("approval_records")
      .select("id,proposal_id,step_id,status,approver_name,comment,acted_at,created_at,updated_at").eq("proposal_id", proposalId).order("step_id");
    if (error) throw error;
    return data || [];
  }

  async actApproval(proposalId, stepId, status, comment = "") {
    const { data: sessionData } = await this.client.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) throw new Error("관리자 로그인이 필요합니다.");
    const admin = await this.getAdminSession();
    const payload = {
      proposal_id: proposalId, step_id: Number(stepId), status,
      approved_by: user.id, approver_name: admin?.displayName || admin?.email || user.email,
      comment: comment || null, acted_at: new Date().toISOString(),
    };
    const { data, error } = await this.client.from("approval_records")
      .upsert(payload, { onConflict: "proposal_id,step_id" }).select("id,proposal_id,step_id,status,approver_name,comment,acted_at,created_at,updated_at").single();
    if (error) throw error;
    return data;
  }

  async getAuditLogs(limit = 200, proposalId = "") {
    let query = this.client.from("proposal_audit_logs").select("*").order("created_at", { ascending: false }).limit(limit);
    if (proposalId) query = query.eq("proposal_id", proposalId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
}

export function createStore(config = window.APP_CONFIG) {
  const hasRealConfig =
    config &&
    !config.demoMode &&
    config.supabaseUrl &&
    !config.supabaseUrl.includes("YOUR_PROJECT_REF") &&
    config.supabaseAnonKey &&
    !config.supabaseAnonKey.includes("YOUR_");

  return hasRealConfig ? new SupabaseStore(config) : new DemoStore(config);
}
