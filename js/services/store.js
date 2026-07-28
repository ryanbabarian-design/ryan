import { SEED_EMPLOYEES, SEED_PROPOSALS } from "../data/seed.js";
import { collectProposalImagePaths, isEmployeeEditable, nextProposalNo, sha256 } from "../core.js";
import { mergeRetainedWithUploaded } from "../image-manager.js?v=1.7";

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
// ==================================================
// 사진 자동축소 및 WebP 압축 설정
// ==================================================

const IMAGE_MAX_EDGE = 1600;
const IMAGE_WEBP_QUALITY = 0.78;
const IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/**
 * 브라우저에서 이미지 파일을 디코딩합니다.
 */
async function decodeImageFile(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });

      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup() {
          bitmap.close();
        },
      };
    } catch (firstError) {
      try {
        const bitmap = await createImageBitmap(file);

        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          cleanup() {
            bitmap.close();
          },
        };
      } catch (secondError) {
        // 아래의 Image 방식으로 다시 시도합니다.
      }
    }
  }

  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        cleanup() {
          URL.revokeObjectURL(objectUrl);
        },
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        new Error(
          `${file.name}: 사진을 읽을 수 없습니다. JPG, PNG 또는 WebP 사진을 사용해주세요.`,
        ),
      );
    };

    image.src = objectUrl;
  });
}

/**
 * Canvas 이미지를 WebP Blob으로 변환합니다.
 */
function canvasToWebpBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("사진 WebP 변환에 실패했습니다."));
          return;
        }

        if (blob.type !== "image/webp") {
          reject(
            new Error(
              "현재 브라우저에서 WebP 변환을 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해주세요.",
            ),
          );
          return;
        }

        resolve(blob);
      },
      "image/webp",
      IMAGE_WEBP_QUALITY,
    );
  });
}

/**
 * 원본 사진을 최대 1600px로 축소하고 WebP로 압축합니다.
 */
async function compressImageToWebp(file) {
  if (!(file instanceof File)) {
    throw new Error("올바른 사진 파일이 아닙니다.");
  }

  if (!file.type?.startsWith("image/")) {
    throw new Error(`${file.name}: 사진 파일만 등록할 수 있습니다.`);
  }

  if (file.size > IMAGE_MAX_SOURCE_BYTES) {
    throw new Error(`${file.name}: 원본 사진은 파일당 20MB 이하만 가능합니다.`);
  }

  const decoded = await decodeImageFile(file);

  try {
    const sourceWidth = decoded.width;
    const sourceHeight = decoded.height;

    if (!sourceWidth || !sourceHeight) {
      throw new Error(`${file.name}: 사진 크기를 확인할 수 없습니다.`);
    }

    const longestEdge = Math.max(sourceWidth, sourceHeight);
    const scale = Math.min(1, IMAGE_MAX_EDGE / longestEdge);

    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d", {
      alpha: true,
    });

    if (!context) {
      throw new Error(`${file.name}: 사진 압축 기능을 실행할 수 없습니다.`);
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    context.drawImage(
      decoded.source,
      0,
      0,
      sourceWidth,
      sourceHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    );

    const webpBlob = await canvasToWebpBlob(canvas);

    const originalBaseName =
      file.name.replace(/\.[^/.]+$/, "") || "proposal-image";

    const compressedFile = new File(
      [webpBlob],
      `${originalBaseName}.webp`,
      {
        type: "image/webp",
        lastModified: Date.now(),
      },
    );

    console.info(
      `[사진 압축] ${file.name}: ` +
        `${Math.round(file.size / 1024).toLocaleString("ko-KR")}KB → ` +
        `${Math.round(compressedFile.size / 1024).toLocaleString("ko-KR")}KB ` +
        `(${sourceWidth}×${sourceHeight} → ${targetWidth}×${targetHeight})`,
    );

    return compressedFile;
  } finally {
    decoded.cleanup();
  }
}

/**
 * File을 Data URL로 변환합니다.
 * 데모 모드의 localStorage 저장에 사용합니다.
 */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);

    reader.onerror = () => {
      reject(new Error(`${file.name} 파일을 읽지 못했습니다.`));
    };

    reader.readAsDataURL(file);
  });
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

    const retainedBefore = Array.isArray(patch.before_images)
      ? patch.before_images
      : current.before_images;
    const retainedAfter = Array.isArray(patch.after_images)
      ? patch.after_images
      : current.after_images;

    proposals[index] = normalizeProposal({
      ...current,
      ...patch,
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
