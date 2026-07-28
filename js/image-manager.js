export const MAX_IMAGES_PER_SECTION = 4;

function cloneSelection(selection) {
  return {
    existing: Array.isArray(selection?.existing) ? [...selection.existing] : [],
    files: Array.isArray(selection?.files) ? [...selection.files] : [],
  };
}

function fileKey(file) {
  return [file?.name || "", Number(file?.size || 0), Number(file?.lastModified || 0)].join(":");
}

export function createImageSelection(existingImages = []) {
  return {
    existing: Array.isArray(existingImages) ? [...existingImages] : [],
    files: [],
  };
}

export function totalSelectedImages(selection) {
  return (selection?.existing?.length || 0) + (selection?.files?.length || 0);
}

export function appendImageFiles(selection, incomingFiles, max = MAX_IMAGES_PER_SECTION) {
  const next = cloneSelection(selection);
  const existingKeys = new Set(next.files.map(fileKey));
  const rejected = [];
  const duplicates = [];

  for (const file of Array.from(incomingFiles || [])) {
    const key = fileKey(file);
    if (existingKeys.has(key)) {
      duplicates.push(file);
      continue;
    }
    if (totalSelectedImages(next) >= max) {
      rejected.push(file);
      continue;
    }
    next.files.push(file);
    existingKeys.add(key);
  }

  return { selection: next, rejected, duplicates };
}

export function removeSelectedImage(selection, kind, index) {
  const next = cloneSelection(selection);
  const key = kind === "existing" ? "existing" : "files";
  if (index >= 0 && index < next[key].length) {
    next[key].splice(index, 1);
  }
  return next;
}

export function getRetainedImages(selection) {
  return Array.isArray(selection?.existing) ? [...selection.existing] : [];
}

export function getNewFiles(selection) {
  return Array.isArray(selection?.files) ? [...selection.files] : [];
}

export function mergeRetainedWithUploaded(retainedImages, uploadedImages) {
  return [
    ...(Array.isArray(retainedImages) ? retainedImages : []),
    ...(Array.isArray(uploadedImages) ? uploadedImages : []),
  ];
}

export function removedImagePaths(previousImages, retainedImages) {
  const retained = new Set(
    (Array.isArray(retainedImages) ? retainedImages : [])
      .map((image) => image?.path)
      .filter(Boolean),
  );

  return (Array.isArray(previousImages) ? previousImages : [])
    .map((image) => image?.path)
    .filter((path) => path && !retained.has(path));
}
