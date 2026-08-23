const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8787;

const STUDIO_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(STUDIO_ROOT, '..', '..');
const PROJECTS_ROOT = path.join(STUDIO_ROOT, 'projects');
const POSE_SCRIPT = path.resolve(__dirname, 'pose_drive.py');
const PYTHON_BIN = path.resolve(WORKSPACE_ROOT, '.venv', 'bin', 'python');
const PROJECT_METADATA_FILE = '.actor-studio.json';
const SEEDANCE_SCRIPT = path.resolve(__dirname, 'seedance_runtime.py');
const ASSET_SCRIPT = path.resolve(__dirname, 'asset_runtime.py');

const MOTION_DIR_NAME = 'Motion references';
const CHARACTER_DIR_NAME = 'character sheets';
const PROCESSED_DIR_NAME = 'processed';
const BODY_DIR_NAME = 'body';
const FACIAL_DIR_NAME = 'facial';
const SEEDANCE_REFS_DIR_NAME = 'seedance references';
const REFERENCE_IMAGES_DIR_NAME = 'reference images';
const REFERENCE_VIDEOS_DIR_NAME = 'reference videos';
const REFERENCE_AUDIOS_DIR_NAME = 'reference audios';
const SKELETON_TOOL_DIR_NAME = 'Skeleton reference tool';
const SKELETON_TOOL_SOURCE_DIR_NAME = 'source videos';
const SKELETON_TOOL_OUTPUT_DIR_NAME = 'generated';

const BYTEPLUS_PROJECT_NAME =
  process.env.ARK_PROJECT_NAME || process.env.ARK_PROJECT || 'default';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const TOS_PUBLIC_URL_PREFIX = (process.env.TOS_PUBLIC_URL_PREFIX || '')
  .trim()
  .replace(/\/+$/, '');
const BYTEPLUS_ACCESSKEY =
  process.env.BYTEPLUS_ACCESSKEY || process.env.BYTEPLUS_AK || '';
const BYTEPLUS_SECRETKEY =
  process.env.BYTEPLUS_SECRETKEY || process.env.BYTEPLUS_SK || '';
const ARK_BASE_URL =
  process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3';
const SEEDANCE_MODEL =
  process.env.SEEDANCE_MODEL || 'dreamina-seedance-2-5-260628';

app.use(cors());
app.use(express.json());
app.use('/storage', express.static(PROJECTS_ROOT));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 1024,
  },
});

function slugifyProjectName(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

function titleizeSlug(projectSlug) {
  return projectSlug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function createDefaultProjectMetadata(projectSlug) {
  return {
    name: titleizeSlug(projectSlug),
    assetLibrary: {
      groupId: '',
      groupName: '',
      projectName: BYTEPLUS_PROJECT_NAME,
      assetsByFile: {},
    },
    seedance: {
      jobs: [],
    },
    media: {
      processedByFile: {},
      seedanceReferenceImagesByFile: {},
      seedanceReferenceVideosByFile: {},
      seedanceReferenceAudiosByFile: {},
    },
  };
}

function buildProjectPaths(projectSlug) {
  const root = path.join(PROJECTS_ROOT, projectSlug);
  const motionReferences = path.join(root, MOTION_DIR_NAME);
  const bodyReferences = path.join(motionReferences, BODY_DIR_NAME);
  const facialReferences = path.join(motionReferences, FACIAL_DIR_NAME);
  const characterSheets = path.join(root, CHARACTER_DIR_NAME);
  const seedanceReferences = path.join(root, SEEDANCE_REFS_DIR_NAME);
  const seedanceReferenceImages = path.join(seedanceReferences, REFERENCE_IMAGES_DIR_NAME);
  const seedanceReferenceVideos = path.join(seedanceReferences, REFERENCE_VIDEOS_DIR_NAME);
  const seedanceReferenceAudios = path.join(seedanceReferences, REFERENCE_AUDIOS_DIR_NAME);
  const processed = path.join(motionReferences, PROCESSED_DIR_NAME);
  const processedBody = path.join(processed, BODY_DIR_NAME);
  const processedFacial = path.join(processed, FACIAL_DIR_NAME);
  const skeletonTool = path.join(root, SKELETON_TOOL_DIR_NAME);
  const skeletonToolSource = path.join(skeletonTool, SKELETON_TOOL_SOURCE_DIR_NAME);
  const skeletonToolOutput = path.join(skeletonTool, SKELETON_TOOL_OUTPUT_DIR_NAME);
  const metadata = path.join(root, PROJECT_METADATA_FILE);

  return {
    root,
    motionReferences,
    bodyReferences,
    facialReferences,
    characterSheets,
    seedanceReferences,
    seedanceReferenceImages,
    seedanceReferenceVideos,
    seedanceReferenceAudios,
    processed,
    processedBody,
    processedFacial,
    skeletonTool,
    skeletonToolSource,
    skeletonToolOutput,
    metadata,
  };
}

async function ensureProjectDirs(projectSlug) {
  const paths = buildProjectPaths(projectSlug);
  await Promise.all(
    [
      paths.root,
      paths.motionReferences,
      paths.bodyReferences,
      paths.facialReferences,
      paths.characterSheets,
      paths.seedanceReferences,
      paths.seedanceReferenceImages,
      paths.seedanceReferenceVideos,
      paths.seedanceReferenceAudios,
      paths.processed,
      paths.processedBody,
      paths.processedFacial,
      paths.skeletonTool,
      paths.skeletonToolSource,
      paths.skeletonToolOutput,
    ].map((dirPath) => fsp.mkdir(dirPath, { recursive: true })),
  );
  return paths;
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readProjectMetadata(projectSlug) {
  const paths = buildProjectPaths(projectSlug);
  if (!(await pathExists(paths.metadata))) {
    return createDefaultProjectMetadata(projectSlug);
  }

  const raw = await fsp.readFile(paths.metadata, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    name: parsed.name || titleizeSlug(projectSlug),
    assetLibrary: {
      groupId: parsed.assetLibrary?.groupId || '',
      groupName: parsed.assetLibrary?.groupName || '',
      projectName: parsed.assetLibrary?.projectName || BYTEPLUS_PROJECT_NAME,
      assetsByFile: parsed.assetLibrary?.assetsByFile || {},
    },
    seedance: {
      jobs: Array.isArray(parsed.seedance?.jobs) ? parsed.seedance.jobs : [],
    },
    media: {
      processedByFile: parsed.media?.processedByFile || {},
      seedanceReferenceImagesByFile: parsed.media?.seedanceReferenceImagesByFile || {},
      seedanceReferenceVideosByFile: parsed.media?.seedanceReferenceVideosByFile || {},
      seedanceReferenceAudiosByFile: parsed.media?.seedanceReferenceAudiosByFile || {},
    },
  };
}

async function writeProjectMetadata(projectSlug, metadata) {
  const paths = buildProjectPaths(projectSlug);
  await fsp.mkdir(paths.root, { recursive: true });
  await fsp.writeFile(paths.metadata, JSON.stringify(metadata, null, 2));
}

async function updateProjectMetadata(projectSlug, updater) {
  const metadata = await readProjectMetadata(projectSlug);
  const nextMetadata = (await updater(metadata)) || metadata;
  await writeProjectMetadata(projectSlug, nextMetadata);
  return nextMetadata;
}

async function upsertSeedanceJob(projectSlug, jobPatch) {
  return updateProjectMetadata(projectSlug, (metadata) => {
    const jobs = [...(metadata.seedance?.jobs || [])];
    const existingIndex = jobs.findIndex((job) => job.id === jobPatch.id);
    const mergedJob = {
      ...(existingIndex >= 0 ? jobs[existingIndex] : {}),
      ...jobPatch,
      updatedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      jobs[existingIndex] = mergedJob;
    } else {
      jobs.unshift(mergedJob);
    }

    return {
      ...metadata,
      seedance: {
        jobs,
      },
    };
  });
}

async function updateProcessedMediaEntry(projectSlug, storageKey, value) {
  return updateProjectMetadata(projectSlug, (metadata) => ({
    ...metadata,
    media: {
      ...(metadata.media || {}),
      processedByFile: {
        ...(metadata.media?.processedByFile || {}),
        [storageKey]: value,
      },
    },
  }));
}

async function removeProcessedMediaEntry(projectSlug, storageKey) {
  return updateProjectMetadata(projectSlug, (metadata) => {
    const processedByFile = { ...(metadata.media?.processedByFile || {}) };
    delete processedByFile[storageKey];
    return {
      ...metadata,
      media: {
        ...(metadata.media || {}),
        processedByFile,
      },
    };
  });
}

async function updateSeedanceReferenceEntry(projectSlug, kind, fileName, value) {
  const fieldMap = {
    images: 'seedanceReferenceImagesByFile',
    videos: 'seedanceReferenceVideosByFile',
    audios: 'seedanceReferenceAudiosByFile',
  };
  const fieldName = fieldMap[kind];
  if (!fieldName) {
    throw new Error(`Unsupported seedance reference kind: ${kind}`);
  }

  return updateProjectMetadata(projectSlug, (metadata) => ({
    ...metadata,
    media: {
      ...(metadata.media || {}),
      [fieldName]: {
        ...(metadata.media?.[fieldName] || {}),
        [fileName]: value,
      },
    },
  }));
}

async function removeSeedanceReferenceEntry(projectSlug, kind, fileName) {
  const fieldMap = {
    images: 'seedanceReferenceImagesByFile',
    videos: 'seedanceReferenceVideosByFile',
    audios: 'seedanceReferenceAudiosByFile',
  };
  const fieldName = fieldMap[kind];
  if (!fieldName) {
    throw new Error(`Unsupported seedance reference kind: ${kind}`);
  }

  return updateProjectMetadata(projectSlug, (metadata) => {
    const next = { ...(metadata.media?.[fieldName] || {}) };
    delete next[fileName];
    return {
      ...metadata,
      media: {
        ...(metadata.media || {}),
        [fieldName]: next,
      },
    };
  });
}

function toPublicUrl(projectSlug, ...parts) {
  const encoded = [projectSlug, ...parts].map((part) => encodeURIComponent(part));
  return `/storage/${encoded.join('/')}`;
}

function isImageUpload(file) {
  if (file.mimetype?.startsWith('image/')) {
    return true;
  }

  const ext = path.extname(file.originalname).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.gif', '.heic', '.heif'].includes(
    ext,
  );
}

async function listFiles(dirPath, projectSlug, relativeParts, annotate) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const base = {
        name: entry.name,
        path: path.join(dirPath, entry.name),
        url: toPublicUrl(projectSlug, ...relativeParts, entry.name),
      };

      return annotate ? annotate(base) : base;
    });
}

function runAssetScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [ASSET_SCRIPT, ...args], {
      cwd: STUDIO_ROOT,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Asset helper exited with code ${code}`));
        return;
      }

      try {
        resolve(stdout ? JSON.parse(stdout) : {});
      } catch (error) {
        reject(
          new Error(`Asset helper returned invalid JSON: ${error.message}\n${stdout || stderr}`),
        );
      }
    });
  });
}

async function createAssetInGroup(groupId, fileName, filePath) {
  const result = await runAssetScript([
    'create-asset-from-file',
    '--file-path',
    filePath,
    '--key-hint',
    'character-sheet',
    '--asset-type',
    'Image',
    '--group-id',
    groupId,
  ]);
  if (!result.asset_id || !result.group_id || !result.asset_url) {
    throw new Error(`Asset helper returned incomplete result for ${fileName}.`);
  }
  return {
    fileName,
    assetId: result.asset_id,
    groupId: result.group_id,
    assetUrl: result.asset_url,
    objectKey: result.object_key || '',
  };
}

// Syncs one or more character sheets to the BytePlus asset library. The asset group is
// resolved first (reused if it already exists, created from the first file otherwise) so
// that the remaining files can be synced concurrently without racing to create duplicate
// groups. Metadata is written once at the end from all files that succeeded, so a failure
// partway through a batch doesn't discard the syncs that already completed.
async function syncCharacterSheetAssets(projectSlug, projectName, files) {
  if (!files.length) {
    return [];
  }

  const metadata = await readProjectMetadata(projectSlug);
  let groupId = metadata.assetLibrary.groupId;
  let firstResult = null;
  let remainingFiles = files;

  if (!groupId) {
    const [first, ...rest] = files;
    const result = await runAssetScript([
      'create-asset-from-file',
      '--file-path',
      first.filePath,
      '--key-hint',
      'character-sheet',
      '--asset-type',
      'Image',
      '--group-name',
      projectName,
      '--group-desc',
      `${projectName} character sheets`,
    ]);
    if (!result.asset_id || !result.group_id || !result.asset_url) {
      throw new Error(`Asset helper returned incomplete result for ${first.fileName}.`);
    }
    groupId = result.group_id;
    firstResult = {
      fileName: first.fileName,
      assetId: result.asset_id,
      groupId,
      assetUrl: result.asset_url,
      objectKey: result.object_key || '',
    };
    remainingFiles = rest;
  }

  const settled = await Promise.allSettled(
    remainingFiles.map((file) => createAssetInGroup(groupId, file.fileName, file.filePath)),
  );

  const succeeded = [
    ...(firstResult ? [firstResult] : []),
    ...settled.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value),
  ];
  const failed = settled
    .filter((entry) => entry.status === 'rejected')
    .map((entry) => entry.reason);

  if (succeeded.length) {
    await updateProjectMetadata(projectSlug, (currentMetadata) => ({
      ...currentMetadata,
      name: projectName,
      assetLibrary: {
        ...currentMetadata.assetLibrary,
        groupId,
        groupName: projectName,
        projectName: BYTEPLUS_PROJECT_NAME,
        assetsByFile: {
          ...(currentMetadata.assetLibrary?.assetsByFile || {}),
          ...Object.fromEntries(
            succeeded.map((entry) => [
              entry.fileName,
              {
                assetId: entry.assetId,
                assetUrl: entry.assetUrl,
                objectKey: entry.objectKey,
                uploadedAt: new Date().toISOString(),
              },
            ]),
          ),
        },
      },
    }));
  }

  if (failed.length) {
    throw new Error(
      `Failed to sync ${failed.length} of ${files.length} character sheet(s): ${failed
        .map((error) => error.message)
        .join('; ')}`,
    );
  }

  return succeeded;
}

async function uploadProcessedVideoToTos(projectSlug, referenceType, fileName, filePath) {
  const result = await runAssetScript([
    'upload-file',
    '--file-path',
    filePath,
    '--key-hint',
    path.basename(fileName, path.extname(fileName)).replace(/[^a-z0-9-_]+/gi, '-'),
    '--folder',
    `projects/${projectSlug}/processed`,
  ]);

  if (!result.url) {
    throw new Error(`Asset helper returned no URL for processed file ${fileName}.`);
  }

  const existingMetadata = await readProjectMetadata(projectSlug);
  const projectName = existingMetadata.name || titleizeSlug(projectSlug);
  const args = [
    'create-asset-from-file',
    '--file-path',
    filePath,
    '--key-hint',
    path.basename(fileName, path.extname(fileName)).replace(/[^a-z0-9-_]+/gi, '-'),
    '--asset-type',
    'Video',
  ];

  if (existingMetadata.assetLibrary.groupId) {
    args.push('--group-id', existingMetadata.assetLibrary.groupId);
  } else {
    args.push('--group-name', projectName, '--group-desc', `${projectName} project assets`);
  }

  const assetResult = await runAssetScript(args);
  if (!assetResult.asset_id || !assetResult.asset_url || !assetResult.group_id) {
    throw new Error(`Asset helper returned incomplete asset result for ${fileName}.`);
  }

  await updateProcessedMediaEntry(projectSlug, `${referenceType}:${fileName}`, {
    remoteUrl: assetResult.asset_url,
    objectKey: assetResult.object_key || result.object_key || '',
    assetId: assetResult.asset_id,
    groupId: assetResult.group_id,
    uploadedAt: new Date().toISOString(),
  });

  return assetResult.asset_url;
}

async function ensureProcessedVideoSynced(projectSlug, referenceType, fileName) {
  const metadata = await readProjectMetadata(projectSlug);
  const existing = metadata.media?.processedByFile?.[`${referenceType}:${fileName}`];
  if (existing?.remoteUrl) {
    return existing;
  }

  const paths = buildProjectPaths(projectSlug);
  const targetDir = referenceType === 'facial' ? paths.processedFacial : paths.processedBody;
  const filePath = path.join(targetDir, fileName);
  if (!(await pathExists(filePath))) {
    throw new Error(`Processed file does not exist: ${fileName}`);
  }

  await uploadProcessedVideoToTos(projectSlug, referenceType, fileName, filePath);
  const refreshed = await readProjectMetadata(projectSlug);
  return refreshed.media?.processedByFile?.[`${referenceType}:${fileName}`] || null;
}

async function syncSeedanceReferenceFile(projectSlug, kind, fileName, filePath) {
  const result = await runAssetScript([
    'upload-file',
    '--file-path',
    filePath,
    '--key-hint',
    path.basename(fileName, path.extname(fileName)).replace(/[^a-z0-9-_]+/gi, '-'),
    '--folder',
    `projects/${projectSlug}/seedance/${kind}`,
  ]);

  if (!result.url) {
    throw new Error(`Asset helper returned no URL for Seedance ${kind} file ${fileName}.`);
  }

  await updateSeedanceReferenceEntry(projectSlug, kind, fileName, {
    remoteUrl: result.url,
    objectKey: result.object_key || '',
    uploadedAt: new Date().toISOString(),
  });

  return {
    remoteUrl: result.url,
    objectKey: result.object_key || '',
  };
}

async function readProject(projectSlug) {
  const initialPaths = buildProjectPaths(projectSlug);
  if (!(await pathExists(initialPaths.root))) {
    return null;
  }

  const paths = await ensureProjectDirs(projectSlug);
  const metadata = await readProjectMetadata(projectSlug);
  const bodyReferences = await listFiles(paths.bodyReferences, projectSlug, [
    MOTION_DIR_NAME,
    BODY_DIR_NAME,
  ]);
  const facialReferences = await listFiles(paths.facialReferences, projectSlug, [
    MOTION_DIR_NAME,
    FACIAL_DIR_NAME,
  ]);
  const characterSheets = await listFiles(
    paths.characterSheets,
    projectSlug,
    [CHARACTER_DIR_NAME],
    (file) => ({
      ...file,
      assetLibrary: metadata.assetLibrary.assetsByFile[file.name] || null,
    }),
  );
  const seedanceReferenceImages = await listFiles(
    paths.seedanceReferenceImages,
    projectSlug,
    [SEEDANCE_REFS_DIR_NAME, REFERENCE_IMAGES_DIR_NAME],
    (file) => ({
      ...file,
      remote: metadata.media?.seedanceReferenceImagesByFile?.[file.name] || null,
    }),
  );
  const seedanceReferenceVideos = await listFiles(
    paths.seedanceReferenceVideos,
    projectSlug,
    [SEEDANCE_REFS_DIR_NAME, REFERENCE_VIDEOS_DIR_NAME],
    (file) => ({
      ...file,
      remote: metadata.media?.seedanceReferenceVideosByFile?.[file.name] || null,
    }),
  );
  const seedanceReferenceAudios = await listFiles(
    paths.seedanceReferenceAudios,
    projectSlug,
    [SEEDANCE_REFS_DIR_NAME, REFERENCE_AUDIOS_DIR_NAME],
    (file) => ({
      ...file,
      remote: metadata.media?.seedanceReferenceAudiosByFile?.[file.name] || null,
    }),
  );
  const processedBody = await listFiles(paths.processedBody, projectSlug, [
    MOTION_DIR_NAME,
    PROCESSED_DIR_NAME,
    BODY_DIR_NAME,
  ], (file) => ({
    ...file,
    remote: metadata.media?.processedByFile?.[`body:${file.name}`] || null,
    referenceType: 'body',
  }));
  const processedFacial = await listFiles(paths.processedFacial, projectSlug, [
    MOTION_DIR_NAME,
    PROCESSED_DIR_NAME,
    FACIAL_DIR_NAME,
  ], (file) => ({
    ...file,
    remote: metadata.media?.processedByFile?.[`facial:${file.name}`] || null,
    referenceType: 'facial',
  }));
  const skeletonToolSourceVideos = await listFiles(paths.skeletonToolSource, projectSlug, [
    SKELETON_TOOL_DIR_NAME,
    SKELETON_TOOL_SOURCE_DIR_NAME,
  ]);
  const skeletonToolOutputs = await listFiles(paths.skeletonToolOutput, projectSlug, [
    SKELETON_TOOL_DIR_NAME,
    SKELETON_TOOL_OUTPUT_DIR_NAME,
  ]);
  const motionReferences = [...bodyReferences, ...facialReferences];
  const processed = [...processedBody, ...processedFacial];

  return {
    id: projectSlug,
    name: metadata.name || titleizeSlug(projectSlug),
    folders: {
      root: paths.root,
      motionReferences: paths.motionReferences,
      bodyReferences: paths.bodyReferences,
      facialReferences: paths.facialReferences,
      characterSheets: paths.characterSheets,
      seedanceReferenceImages: paths.seedanceReferenceImages,
      seedanceReferenceVideos: paths.seedanceReferenceVideos,
      seedanceReferenceAudios: paths.seedanceReferenceAudios,
      processed: paths.processed,
      processedBody: paths.processedBody,
      processedFacial: paths.processedFacial,
      skeletonTool: paths.skeletonTool,
      skeletonToolSource: paths.skeletonToolSource,
      skeletonToolOutput: paths.skeletonToolOutput,
    },
    assetLibrary: {
      groupId: metadata.assetLibrary.groupId,
      groupName: metadata.assetLibrary.groupName,
      projectName: metadata.assetLibrary.projectName,
    },
    seedance: {
      jobs: metadata.seedance.jobs,
    },
    media: {
      processedByFile: metadata.media?.processedByFile || {},
      seedanceReferenceImagesByFile: metadata.media?.seedanceReferenceImagesByFile || {},
      seedanceReferenceVideosByFile: metadata.media?.seedanceReferenceVideosByFile || {},
      seedanceReferenceAudiosByFile: metadata.media?.seedanceReferenceAudiosByFile || {},
    },
    bodyReferences,
    facialReferences,
    seedanceReferenceImages,
    seedanceReferenceVideos,
    seedanceReferenceAudios,
    processedBody,
    processedFacial,
    motionReferences,
    characterSheets,
    processed,
    skeletonToolSourceVideos,
    skeletonToolOutputs,
  };
}

async function listProjects() {
  await fsp.mkdir(PROJECTS_ROOT, { recursive: true });
  const entries = await fsp.readdir(PROJECTS_ROOT, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const projects = await Promise.all(directories.map((projectSlug) => readProject(projectSlug)));
  return projects.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

async function writeUploadedFiles(files, targetDir) {
  await fsp.mkdir(targetDir, { recursive: true });
  await Promise.all(
    files.map(async (file) => {
      const targetPath = path.join(targetDir, path.basename(file.originalname));
      await fsp.writeFile(targetPath, file.buffer);
    }),
  );
}

function resolveCategoryDirectory(paths, category) {
  if (category === 'body-references') {
    return paths.bodyReferences;
  }
  if (category === 'facial-references') {
    return paths.facialReferences;
  }
  if (category === 'character-sheets') {
    return paths.characterSheets;
  }
  if (category === 'seedance-reference-images') {
    return paths.seedanceReferenceImages;
  }
  if (category === 'seedance-reference-videos') {
    return paths.seedanceReferenceVideos;
  }
  if (category === 'seedance-reference-audios') {
    return paths.seedanceReferenceAudios;
  }
  if (category === 'processed-body') {
    return paths.processedBody;
  }
  if (category === 'processed-facial') {
    return paths.processedFacial;
  }
  if (category === 'skeleton-tool-source') {
    return paths.skeletonToolSource;
  }
  if (category === 'skeleton-tool-output') {
    return paths.skeletonToolOutput;
  }
  throw new Error('Unsupported file category.');
}

function getGeneratedOutputPaths(videoPath, outputDir) {
  const baseName = path.basename(videoPath, path.extname(videoPath)).replace(/ /g, '_');
  return {
    skeleton: path.join(outputDir, `${baseName}-skeleton.mp4`),
    overlay: path.join(outputDir, `${baseName}-overlay.mp4`),
  };
}

async function removeFileIfExists(targetPath) {
  if (await pathExists(targetPath)) {
    await fsp.unlink(targetPath);
  }
}

function runPoseDrive(videoPath, outputDir, mode, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [POSE_SCRIPT, videoPath, '--out-dir', outputDir, '--mode', mode];
    if (options.kptThr !== undefined && options.kptThr !== null && options.kptThr !== '') {
      args.push('--kpt-thr', `${options.kptThr}`);
    }
    if (options.allPeople) {
      args.push('--all-people');
    }
    if (!options.generateSkeleton) {
      args.push('--no-skeleton');
    }
    if (!options.generateOverlay) {
      args.push('--no-overlay');
    }
    const child = spawn(PYTHON_BIN, args, {
      cwd: STUDIO_ROOT,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `pose_drive.py exited with code ${code}`));
    });
  });
}

function ensureSeedanceConfig() {
  if (!process.env.ARK_API_KEY) {
    throw new Error('ARK_API_KEY must be set in actor-studio/.env.');
  }
  if (!TOS_PUBLIC_URL_PREFIX && !PUBLIC_BASE_URL) {
    throw new Error(
      'TOS_PUBLIC_URL_PREFIX or PUBLIC_BASE_URL must be set so Seedance can access project video references.',
    );
  }
}

function runSeedanceScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [SEEDANCE_SCRIPT, ...args], {
      cwd: STUDIO_ROOT,
      env: {
        ...process.env,
        ARK_BASE_URL,
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Seedance helper exited with code ${code}`));
        return;
      }

      try {
        resolve(stdout ? JSON.parse(stdout) : {});
      } catch (error) {
        reject(
          new Error(
            `Seedance helper returned invalid JSON: ${error.message}\n${stdout || stderr}`,
          ),
        );
      }
    });
  });
}

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    pythonExists: fs.existsSync(PYTHON_BIN),
    poseScriptExists: fs.existsSync(POSE_SCRIPT),
    seedanceScriptExists: fs.existsSync(SEEDANCE_SCRIPT),
    assetScriptExists: fs.existsSync(ASSET_SCRIPT),
    assetLibraryConfigured: Boolean(BYTEPLUS_ACCESSKEY && BYTEPLUS_SECRETKEY),
    publicBaseUrlConfigured: Boolean(TOS_PUBLIC_URL_PREFIX || PUBLIC_BASE_URL),
    tosPublicUrlConfigured: Boolean(TOS_PUBLIC_URL_PREFIX),
    seedanceApiConfigured: Boolean(process.env.ARK_API_KEY),
  });
});

app.get('/api/projects', async (_req, res, next) => {
  try {
    const projects = await listProjects();
    res.json(projects);
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects', async (req, res, next) => {
  try {
    const rawName = `${req.body?.name || ''}`.trim();
    if (!rawName) {
      res.status(400).json({ error: 'Project name is required.' });
      return;
    }

    const projectSlug = slugifyProjectName(rawName);
    await ensureProjectDirs(projectSlug);
    await updateProjectMetadata(projectSlug, (metadata) => ({
      ...metadata,
      name: rawName,
      assetLibrary: {
        ...metadata.assetLibrary,
        groupName: metadata.assetLibrary.groupName || rawName,
        projectName: BYTEPLUS_PROJECT_NAME,
        assetsByFile: metadata.assetLibrary.assetsByFile || {},
      },
    }));
    const project = await readProject(projectSlug);
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:projectId', async (req, res, next) => {
  try {
    const project = await readProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/projects/:projectId', async (req, res, next) => {
  try {
    const projectId = req.params.projectId;
    const paths = buildProjectPaths(projectId);
    if (!(await pathExists(paths.root))) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    await fsp.rm(paths.root, { recursive: true, force: true });
    res.json({ deletedProjectId: projectId });
  } catch (error) {
    next(error);
  }
});

async function handleReferenceUpload(req, res, next, targetDir, label) {
  try {
    if (!req.files?.length) {
      res.status(400).json({ error: `Please upload at least one ${label}.` });
      return;
    }

    await writeUploadedFiles(req.files, targetDir);
    const project = await readProject(req.params.projectId);
    res.json(project);
  } catch (error) {
    next(error);
  }
}

app.post('/api/projects/:projectId/body-references', upload.array('files'), async (req, res, next) => {
  const paths = await ensureProjectDirs(req.params.projectId);
  return handleReferenceUpload(req, res, next, paths.bodyReferences, 'body reference');
});

app.post('/api/projects/:projectId/facial-references', upload.array('files'), async (req, res, next) => {
  const paths = await ensureProjectDirs(req.params.projectId);
  return handleReferenceUpload(req, res, next, paths.facialReferences, 'facial reference');
});

async function handleSeedanceReferenceUpload(req, res, next, kind, targetDir, label) {
  try {
    if (!req.files?.length) {
      res.status(400).json({ error: `Please upload at least one ${label}.` });
      return;
    }

    const projectId = req.params.projectId;
    await writeUploadedFiles(req.files, targetDir);

    for (const file of req.files) {
      const safeName = path.basename(file.originalname);
      const filePath = path.join(targetDir, safeName);
      await syncSeedanceReferenceFile(projectId, kind, safeName, filePath);
    }

    const project = await readProject(projectId);
    res.json(project);
  } catch (error) {
    next(error);
  }
}

app.post(
  '/api/projects/:projectId/seedance-reference-images',
  upload.array('files'),
  async (req, res, next) => {
    const paths = await ensureProjectDirs(req.params.projectId);
    return handleSeedanceReferenceUpload(
      req,
      res,
      next,
      'images',
      paths.seedanceReferenceImages,
      'Seedance reference image',
    );
  },
);

app.post(
  '/api/projects/:projectId/seedance-reference-videos',
  upload.array('files'),
  async (req, res, next) => {
    const paths = await ensureProjectDirs(req.params.projectId);
    return handleSeedanceReferenceUpload(
      req,
      res,
      next,
      'videos',
      paths.seedanceReferenceVideos,
      'Seedance reference video',
    );
  },
);

app.post(
  '/api/projects/:projectId/seedance-reference-audios',
  upload.array('files'),
  async (req, res, next) => {
    const paths = await ensureProjectDirs(req.params.projectId);
    return handleSeedanceReferenceUpload(
      req,
      res,
      next,
      'audios',
      paths.seedanceReferenceAudios,
      'Seedance reference audio',
    );
  },
);

app.post(
  '/api/projects/:projectId/character-sheets',
  upload.array('files'),
  async (req, res, next) => {
    try {
      if (!req.files?.length) {
        res.status(400).json({ error: 'Please upload at least one character sheet.' });
        return;
      }

      const projectId = req.params.projectId;
      const paths = await ensureProjectDirs(projectId);
      const metadata = await readProjectMetadata(projectId);
      const projectName = metadata.name || titleizeSlug(projectId);
      await writeUploadedFiles(req.files, paths.characterSheets);

      const imageFiles = req.files.filter(isImageUpload);
      const skippedFiles = req.files
        .filter((file) => !isImageUpload(file))
        .map((file) => file.originalname);

      await syncCharacterSheetAssets(
        projectId,
        projectName,
        imageFiles.map((file) => {
          const safeName = path.basename(file.originalname);
          return { fileName: safeName, filePath: path.join(paths.characterSheets, safeName) };
        }),
      );

      const project = await readProject(projectId);
      res.json({
        ...project,
        syncSummary: {
          syncedImages: imageFiles.length,
          skippedFiles,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post('/api/projects/:projectId/process', async (req, res, next) => {
  try {
    const {
      videoName,
      mode = 'lightweight',
      generateSkeleton = true,
      generateOverlay = true,
      referenceType = 'body',
    } = req.body || {};
    if (!videoName) {
      res.status(400).json({ error: 'A motion reference video must be selected.' });
      return;
    }
    if (!generateSkeleton && !generateOverlay) {
      res.status(400).json({ error: 'Select at least one reference output to generate.' });
      return;
    }

    const paths = await ensureProjectDirs(req.params.projectId);
    const sourceDir = referenceType === 'facial' ? paths.facialReferences : paths.bodyReferences;
    const outputDir = referenceType === 'facial' ? paths.processedFacial : paths.processedBody;
    const scopedPrefix = referenceType === 'facial' ? 'facial' : 'body';
    const videoPath = path.join(sourceDir, path.basename(videoName));
    if (!(await pathExists(videoPath))) {
      res.status(404).json({ error: 'Selected video does not exist.' });
      return;
    }

    const outputPaths = getGeneratedOutputPaths(videoPath, outputDir);
    if (!generateSkeleton) {
      await removeFileIfExists(outputPaths.skeleton);
      await removeProcessedMediaEntry(
        req.params.projectId,
        `${scopedPrefix}:${path.basename(outputPaths.skeleton)}`,
      );
    }
    if (!generateOverlay) {
      await removeFileIfExists(outputPaths.overlay);
      await removeProcessedMediaEntry(
        req.params.projectId,
        `${scopedPrefix}:${path.basename(outputPaths.overlay)}`,
      );
    }

    await runPoseDrive(videoPath, outputDir, mode, {
      generateSkeleton,
      generateOverlay,
    });
    if (generateSkeleton && (await pathExists(outputPaths.skeleton))) {
      await uploadProcessedVideoToTos(
        req.params.projectId,
        referenceType,
        path.basename(outputPaths.skeleton),
        outputPaths.skeleton,
      );
    }
    if (generateOverlay && (await pathExists(outputPaths.overlay))) {
      await uploadProcessedVideoToTos(
        req.params.projectId,
        referenceType,
        path.basename(outputPaths.overlay),
        outputPaths.overlay,
      );
    }
    const project = await readProject(req.params.projectId);
    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/projects/:projectId/skeleton-tool/videos',
  upload.array('files'),
  async (req, res, next) => {
    const paths = await ensureProjectDirs(req.params.projectId);
    return handleReferenceUpload(req, res, next, paths.skeletonToolSource, 'skeleton reference video');
  },
);

app.post('/api/projects/:projectId/skeleton-tool/generate', async (req, res, next) => {
  try {
    const {
      videoName,
      mode = 'balanced',
      kptThr = 0.43,
      allPeople = false,
      generateSkeleton = true,
      generateOverlay = true,
    } = req.body || {};

    if (!videoName) {
      res.status(400).json({ error: 'A source video must be selected.' });
      return;
    }
    if (!generateSkeleton && !generateOverlay) {
      res.status(400).json({ error: 'Select at least one reference output to generate.' });
      return;
    }
    const parsedKptThr = Number(kptThr);
    if (!Number.isFinite(parsedKptThr) || parsedKptThr < 0 || parsedKptThr > 1) {
      res.status(400).json({ error: 'Keypoint confidence threshold must be a number between 0 and 1.' });
      return;
    }

    const paths = await ensureProjectDirs(req.params.projectId);
    const videoPath = path.join(paths.skeletonToolSource, path.basename(videoName));
    if (!(await pathExists(videoPath))) {
      res.status(404).json({ error: 'Selected video does not exist.' });
      return;
    }

    const outputPaths = getGeneratedOutputPaths(videoPath, paths.skeletonToolOutput);
    if (!generateSkeleton) {
      await removeFileIfExists(outputPaths.skeleton);
    }
    if (!generateOverlay) {
      await removeFileIfExists(outputPaths.overlay);
    }

    await runPoseDrive(videoPath, paths.skeletonToolOutput, mode, {
      generateSkeleton,
      generateOverlay,
      kptThr: parsedKptThr,
      allPeople: Boolean(allPeople),
    });

    const project = await readProject(req.params.projectId);
    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:projectId/seedance/generate', async (req, res, next) => {
  try {
    ensureSeedanceConfig();

    const projectId = req.params.projectId;
    const {
      prompt,
      characterSheetName,
      bodyReferenceVideoName,
      facialReferenceVideoName,
      model = SEEDANCE_MODEL,
      ratio = '9:16',
      resolution = '720p',
      duration = 10,
      generateAudio = true,
      watermark = true,
    } = req.body || {};

    if (!prompt?.trim()) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }
    if (!characterSheetName || !bodyReferenceVideoName || !facialReferenceVideoName) {
      res.status(400).json({
        error: 'Select one character sheet, one body reference video, and one facial reference video.',
      });
      return;
    }

    const project = await readProject(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const characterSheet = project.characterSheets.find(
      (file) => file.name === characterSheetName,
    );
    if (!characterSheet?.assetLibrary?.assetId) {
      res.status(400).json({
        error: 'Selected character sheet is not synced to the asset library yet.',
      });
      return;
    }

    function resolveTypedReference(referenceValue, expectedType) {
      const [requestedReferenceType, ...referenceNameParts] = `${referenceValue}`.split(':');
      const resolvedReferenceType =
        requestedReferenceType === 'facial' || requestedReferenceType === 'body'
          ? requestedReferenceType
          : '';
      const resolvedReferenceName = resolvedReferenceType
        ? referenceNameParts.join(':')
        : `${referenceValue}`;
      const referenceVideo = project.processed.find(
        (file) =>
          file.name === resolvedReferenceName &&
          file.referenceType === (resolvedReferenceType || expectedType),
      );
      return {
        referenceVideo,
        resolvedReferenceType: resolvedReferenceType || expectedType,
      };
    }

    const bodySelection = resolveTypedReference(bodyReferenceVideoName, 'body');
    if (!bodySelection.referenceVideo) {
      res.status(404).json({ error: 'Selected body reference video does not exist.' });
      return;
    }
    const facialSelection = resolveTypedReference(facialReferenceVideoName, 'facial');
    if (!facialSelection.referenceVideo) {
      res.status(404).json({ error: 'Selected facial reference video does not exist.' });
      return;
    }

    const syncedBodyReferenceVideo =
      bodySelection.referenceVideo.remote?.remoteUrl
        ? bodySelection.referenceVideo.remote
        : await ensureProcessedVideoSynced(
            projectId,
            bodySelection.referenceVideo.referenceType || bodySelection.resolvedReferenceType,
            bodySelection.referenceVideo.name,
          );
    if (!syncedBodyReferenceVideo?.remoteUrl) {
      throw new Error('Selected body reference video could not be synced to TOS.');
    }

    const syncedFacialReferenceVideo =
      facialSelection.referenceVideo.remote?.remoteUrl
        ? facialSelection.referenceVideo.remote
        : await ensureProcessedVideoSynced(
            projectId,
            facialSelection.referenceVideo.referenceType || facialSelection.resolvedReferenceType,
            facialSelection.referenceVideo.name,
          );
    if (!syncedFacialReferenceVideo?.remoteUrl) {
      throw new Error('Selected facial reference video could not be synced to TOS.');
    }

    const syncedReferenceImages = project.seedanceReferenceImages
      .filter((file) => file.remote?.remoteUrl)
      .map((file) => ({ name: file.name, remoteUrl: file.remote.remoteUrl }));
    const syncedReferenceVideos = project.seedanceReferenceVideos
      .filter((file) => file.remote?.remoteUrl)
      .map((file) => ({ name: file.name, remoteUrl: file.remote.remoteUrl }));
    const syncedReferenceAudios = project.seedanceReferenceAudios
      .filter((file) => file.remote?.remoteUrl)
      .map((file) => ({ name: file.name, remoteUrl: file.remote.remoteUrl }));

    const taskResult = await runSeedanceScript([
      'create',
      '--model',
      model,
      '--prompt',
      prompt,
      '--image-asset-uri',
      `asset://${characterSheet.assetLibrary.assetId}`,
      '--body-reference-video-url',
      syncedBodyReferenceVideo.remoteUrl,
      '--facial-reference-video-url',
      syncedFacialReferenceVideo.remoteUrl,
      '--ratio',
      ratio,
      '--resolution',
      resolution,
      '--duration',
      `${duration}`,
      '--generate-audio',
      `${Boolean(generateAudio)}`,
      '--watermark',
      `${Boolean(watermark)}`,
      '--return-last-frame',
      'true',
      ...syncedReferenceImages.flatMap((file) => ['--reference-image-url', file.remoteUrl]),
      ...syncedReferenceVideos.flatMap((file) => ['--reference-video-url', file.remoteUrl]),
      ...syncedReferenceAudios.flatMap((file) => ['--reference-audio-url', file.remoteUrl]),
    ]);

    const taskId = taskResult.id;
    if (!taskId) {
      throw new Error('Seedance task creation did not return an id.');
    }

    await upsertSeedanceJob(projectId, {
      id: taskId,
      status: taskResult.status || 'queued',
      model,
      prompt,
      ratio,
      resolution,
      duration,
      generateAudio: Boolean(generateAudio),
      watermark: Boolean(watermark),
      characterSheetName,
      characterSheetAssetId: characterSheet.assetLibrary.assetId,
      bodyReferenceVideoName: bodySelection.referenceVideo.name,
      bodyReferenceVideoUrl: syncedBodyReferenceVideo.remoteUrl,
      facialReferenceVideoName: facialSelection.referenceVideo.name,
      facialReferenceVideoUrl: syncedFacialReferenceVideo.remoteUrl,
      extraReferenceImages: syncedReferenceImages,
      extraReferenceVideos: syncedReferenceVideos,
      extraReferenceAudios: syncedReferenceAudios,
      createdAt: new Date().toISOString(),
      result: taskResult,
    });

    const updatedProject = await readProject(projectId);
    res.status(201).json(updatedProject);
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:projectId/seedance/tasks/:taskId', async (req, res, next) => {
  try {
    ensureSeedanceConfig();

    const projectId = req.params.projectId;
    const taskId = req.params.taskId;
    const taskResult = await runSeedanceScript(['get', '--task-id', taskId]);

    await upsertSeedanceJob(projectId, {
      id: taskId,
      status: taskResult.status || 'unknown',
      result: taskResult,
      videoUrl: taskResult.content?.video_url || '',
      lastFrameUrl: taskResult.content?.last_frame_url || '',
      errorMessage:
        taskResult.error?.message ||
        taskResult.error ||
        taskResult?.content?.error ||
        '',
    });

    const updatedProject = await readProject(projectId);
    res.json(updatedProject);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/projects/:projectId/files', async (req, res, next) => {
  try {
    const { category, fileName } = req.body || {};
    if (!category || !fileName) {
      res.status(400).json({ error: 'category and fileName are required.' });
      return;
    }

    const projectId = req.params.projectId;
    const paths = await ensureProjectDirs(projectId);
    const targetDir = resolveCategoryDirectory(paths, category);
    const safeFileName = path.basename(fileName);
    const targetPath = path.join(targetDir, safeFileName);

    if (!(await pathExists(targetPath))) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    await fsp.unlink(targetPath);

    if (category === 'character-sheets') {
      await updateProjectMetadata(projectId, (metadata) => {
        const assetsByFile = { ...(metadata.assetLibrary?.assetsByFile || {}) };
        delete assetsByFile[safeFileName];
        return {
          ...metadata,
          assetLibrary: {
            ...metadata.assetLibrary,
            assetsByFile,
          },
        };
      });
    }
    if (category === 'processed-body') {
      await removeProcessedMediaEntry(projectId, `body:${safeFileName}`);
    }
    if (category === 'processed-facial') {
      await removeProcessedMediaEntry(projectId, `facial:${safeFileName}`);
    }
    if (category === 'seedance-reference-images') {
      await removeSeedanceReferenceEntry(projectId, 'images', safeFileName);
    }
    if (category === 'seedance-reference-videos') {
      await removeSeedanceReferenceEntry(projectId, 'videos', safeFileName);
    }
    if (category === 'seedance-reference-audios') {
      await removeSeedanceReferenceEntry(projectId, 'audios', safeFileName);
    }

    const project = await readProject(projectId);
    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: error.message || 'Unexpected server error.',
  });
});

app.listen(PORT, async () => {
  await fsp.mkdir(PROJECTS_ROOT, { recursive: true });
  console.log(`Actor motion studio server running on http://localhost:${PORT}`);
});
