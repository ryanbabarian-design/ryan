import { SEED_EMPLOYEES, SEED_PROPOSALS } from "../data/seed.js";
import { isEmployeeEditable, nextProposalNo, sha256 } from "../core.js";

const PROPOSAL_KEY = "proposal-system:v1:proposals";
const EMPLOYEE_KEY = "proposal-system:v1:employees";
const ADMIN_KEY = "proposal-system:v1:admin";

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

class DemoStore {
  constructor(config) {
    this.config = config;
    if (!localStorage.getItem(PROPOSAL_KEY)) {
      localStorage.setItem(PROPOSAL_KEY, JSON.stringify(SEED_PROPOSALS));
    }
    if (!localStorage.getItem(EMPLOYEE_KEY)) {
      localStorage.setItem(EMPLOYEE_KEY, JSON.stringify(SEED_EMPLOYEES));
    }
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

    const proposal = normalizeProposal({
      ...payload,
      id: crypto.randomUUID(),
      proposal_no: nextProposalNo(proposals),
      received_date: todayIso(),
      before_images: beforeImages,
      after_images: afterImages,
      edit_pin_hash: pinHash,
      status: "접수",
      review_result: "미심사",
      implementation_status: "미실시",
      payment_status: "미지급",
      locked: false,
      created_at: now,
      updated_at: now,
    });

    delete proposal.edit_pin;
    proposals.unshift(proposal);
    localStorage.setItem(PROPOSAL_KEY, JSON.stringify(proposals));
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

    proposals[index] = normalizeProposal({
      ...current,
      ...patch,
      before_images: newBefore.length ? newBefore : current.before_images,
      after_images: newAfter.length ? newAfter : current.after_images,
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
    if (!(await this.getAdminSession())) throw new Error("관리자 로그인이 필요합니다.");
    const proposals = await this.getProposals();
    const index = proposals.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("제안을 찾지 못했습니다.");

    proposals[index] = normalizeProposal({
      ...proposals[index],
      ...patch,
      locked: ["심사중", "심사완료"].includes(patch.status ?? proposals[index].status),
      updated_at: new Date().toISOString(),
    });
    localStorage.setItem(PROPOSAL_KEY, JSON.stringify(proposals));
    return proposals[index];
  }

  async deleteProposal(id) {
    if (!(await this.getAdminSession())) throw new Error("관리자 로그인이 필요합니다.");
    const proposals = await this.getProposals();
    localStorage.setItem(
      PROPOSAL_KEY,
      JSON.stringify(proposals.filter((item) => item.id !== id)),
    );
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

  async resetDemo() {
    localStorage.setItem(PROPOSAL_KEY, JSON.stringify(SEED_PROPOSALS));
    localStorage.setItem(EMPLOYEE_KEY, JSON.stringify(SEED_EMPLOYEES));
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
    const [beforeImages, afterImages] = await Promise.all([
      this.uploadImages(beforeFiles, "before"),
      this.uploadImages(afterFiles, "after"),
    ]);

    const body = { ...payload, before_images: beforeImages, after_images: afterImages };
    delete body.edit_pin;

    const { data, error } = await this.client.rpc("create_proposal", {
      p_payload: body,
      p_edit_pin: payload.edit_pin,
    });
    if (error) throw error;
    return normalizeProposal(Array.isArray(data) ? data[0] : data);
  }

  async updateProposalWithPin(proposalNo, pin, patch, beforeFiles, afterFiles) {
    const [beforeImages, afterImages] = await Promise.all([
      beforeFiles?.length ? this.uploadImages(beforeFiles, "before-edit") : [],
      afterFiles?.length ? this.uploadImages(afterFiles, "after-edit") : [],
    ]);

    const payload = { ...patch };
    if (beforeImages.length) payload.before_images = beforeImages;
    if (afterImages.length) payload.after_images = afterImages;

    const { data, error } = await this.client.rpc("edit_proposal_with_pin", {
      p_proposal_no: proposalNo,
      p_edit_pin: pin,
      p_payload: payload,
    });
    if (error) throw error;
    return normalizeProposal(Array.isArray(data) ? data[0] : data);
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
    const { error } = await this.client.from("proposals").delete().eq("id", id);
    if (error) throw error;
  }

  async importEmployees(rows) {
    const { data, error } = await this.client
      .from("employees")
      .upsert(rows, { onConflict: "name,department" })
      .select();
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
