import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = '/api'
const DEFAULT_SEEDANCE_PROMPT =
  'Create a video of the person using @Image1 as the identity reference for both the full body and facial features. Use @Video1 as the body motion reference and match the exact body posture, movement, and timing from the generated body skeleton video. Use @Video2 as the facial motion reference and match the facial motion, expressions, and timing from the generated facial skeleton video.'

function getOutputBaseName(fileName) {
  return fileName.replace(/\.[^/.]+$/, '').replaceAll(' ', '_')
}

function findGeneratedOutputs(processedFiles, sourceFileName) {
  const baseName = getOutputBaseName(sourceFileName)
  return {
    skeleton:
      processedFiles.find((file) => file.name === `${baseName}-skeleton.mp4`) || null,
    overlay:
      processedFiles.find((file) => file.name === `${baseName}-overlay.mp4`) || null,
  }
}

function isImageFile(fileName) {
  return /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(fileName)
}

function getInitials(name) {
  const value = `${name || ''}`.trim()
  if (!value) {
    return '?'
  }
  const parts = value.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase()
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function UploadIcon({ kind }) {
  if (kind === 'image') {
    return (
      <svg viewBox="0 0 20 20" fill="none">
        <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="7.4" cy="8.1" r="1.4" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M5 14l3.4-3 2.4 2 3.1-3 2.1 2.4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (kind === 'audio') {
    return (
      <svg viewBox="0 0 20 20" fill="none">
        <path
          d="M8 5v8.5a2.25 2.25 0 1 1-1.2-2M14 4v6.5a2.25 2.25 0 1 1-1.2-2M8 6.5l6-1.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <rect x="3" y="4.5" width="10" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M13 8l4-2.2v8.4L13 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function UploadBoxContent({ icon, title, hint }) {
  return (
    <>
      <span className="upload-icon" aria-hidden="true">
        <UploadIcon kind={icon} />
      </span>
      <span className="upload-title">{title}</span>
      <span className="upload-subtitle">{hint}</span>
    </>
  )
}

async function requestJson(url, options) {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.')
  }

  return data
}

function App() {
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [selectedMode, setSelectedMode] = useState('lightweight')
  const [busyKeys, setBusyKeys] = useState(() => new Set())
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [bodyGenerateSkeleton, setBodyGenerateSkeleton] = useState(true)
  const [bodyGenerateOverlay, setBodyGenerateOverlay] = useState(true)
  const [facialGenerateSkeleton, setFacialGenerateSkeleton] = useState(true)
  const [facialGenerateOverlay, setFacialGenerateOverlay] = useState(true)
  const [skeletonToolMode, setSkeletonToolMode] = useState('balanced')
  const [skeletonToolKptThr, setSkeletonToolKptThr] = useState(0.43)
  const [skeletonToolAllPeople, setSkeletonToolAllPeople] = useState(false)
  const [skeletonToolGenerateSkeleton, setSkeletonToolGenerateSkeleton] = useState(true)
  const [skeletonToolGenerateOverlay, setSkeletonToolGenerateOverlay] = useState(true)
  const [seedancePrompt, setSeedancePrompt] = useState(DEFAULT_SEEDANCE_PROMPT)
  const [selectedCharacterSheetName, setSelectedCharacterSheetName] = useState('')
  const [selectedBodySeedanceVideoName, setSelectedBodySeedanceVideoName] = useState('')
  const [selectedFacialSeedanceVideoName, setSelectedFacialSeedanceVideoName] = useState('')
  const [seedanceRatio, setSeedanceRatio] = useState('9:16')
  const [seedanceResolution, setSeedanceResolution] = useState('720p')
  const [seedanceDuration, setSeedanceDuration] = useState(10)
  const [seedanceGenerateAudio, setSeedanceGenerateAudio] = useState(true)
  const [seedanceWatermark, setSeedanceWatermark] = useState(true)

  function beginBusy(key) {
    setBusyKeys((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }

  function endBusy(key) {
    setBusyKeys((prev) => {
      if (!prev.has(key)) {
        return prev
      }
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  function isBusy(key) {
    return busyKeys.has(key)
  }

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  )
  const selectableCharacterSheets = useMemo(
    () =>
      (selectedProject?.characterSheets || []).filter((file) => file.assetLibrary?.assetId),
    [selectedProject],
  )
  const selectableBodyReferenceVideos = useMemo(
    () => (selectedProject?.processedBody || []).filter((file) => file.name.endsWith('.mp4')),
    [selectedProject],
  )
  const selectableFacialReferenceVideos = useMemo(
    () => (selectedProject?.processedFacial || []).filter((file) => file.name.endsWith('.mp4')),
    [selectedProject],
  )
  const activeSeedanceJobs = useMemo(
    () =>
      (selectedProject?.seedance?.jobs || []).filter(
        (job) => !['succeeded', 'failed', 'cancelled', 'expired'].includes(job.status),
      ),
    [selectedProject],
  )

  async function loadProjects(nextProjectId = null) {
    const data = await requestJson(`${API_BASE}/projects`)
    setProjects(data)

    if (nextProjectId) {
      setSelectedProjectId(nextProjectId)
      return
    }

    if (!selectedProjectId && data.length > 0) {
      setSelectedProjectId(data[0].id)
    }
  }

  useEffect(() => {
    loadProjects().catch((loadError) => setError(loadError.message))
  }, [])

  useEffect(() => {
    if (!selectedProject) {
      return
    }

    if (
      !selectableCharacterSheets.find((file) => file.name === selectedCharacterSheetName)
    ) {
      setSelectedCharacterSheetName(selectableCharacterSheets[0]?.name || '')
    }

    if (
      !selectableBodyReferenceVideos.find(
        (file) => `${file.referenceType}:${file.name}` === selectedBodySeedanceVideoName,
      )
    ) {
      setSelectedBodySeedanceVideoName(
        selectableBodyReferenceVideos[0]
          ? `${selectableBodyReferenceVideos[0].referenceType}:${selectableBodyReferenceVideos[0].name}`
          : '',
      )
    }

    if (
      !selectableFacialReferenceVideos.find(
        (file) => `${file.referenceType}:${file.name}` === selectedFacialSeedanceVideoName,
      )
    ) {
      setSelectedFacialSeedanceVideoName(
        selectableFacialReferenceVideos[0]
          ? `${selectableFacialReferenceVideos[0].referenceType}:${selectableFacialReferenceVideos[0].name}`
          : '',
      )
    }
  }, [
    selectedProject,
    selectableCharacterSheets,
    selectableBodyReferenceVideos,
    selectableFacialReferenceVideos,
    selectedCharacterSheetName,
    selectedBodySeedanceVideoName,
    selectedFacialSeedanceVideoName,
  ])

  async function handleCreateProject(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    const busyKey = 'create'
    beginBusy(busyKey)

    try {
      const project = await requestJson(`${API_BASE}/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newProjectName }),
      })

      setNewProjectName('')
      setMessage(`Created project "${project.name}".`)
      await loadProjects(project.id)
    } catch (createError) {
      setError(createError.message)
    } finally {
      endBusy(busyKey)
    }
  }

  async function handleUpload(projectId, category, files) {
    if (!files.length) {
      return
    }

    setError('')
    setMessage('')
    const busyKey = category
    beginBusy(busyKey)

    const formData = new FormData()
    Array.from(files).forEach((file) => {
      formData.append('files', file)
    })

    try {
      const project = await requestJson(`${API_BASE}/projects/${projectId}/${category}`, {
        method: 'POST',
        body: formData,
      })

      setProjects((currentProjects) =>
        currentProjects.map((currentProject) =>
          currentProject.id === project.id ? project : currentProject,
        ),
      )
      if (category === 'character-sheets') {
        const synced = project.syncSummary?.syncedImages ?? 0
        const skipped = project.syncSummary?.skippedFiles?.length ?? 0
        setMessage(
          `Uploaded ${files.length} file(s). Synced ${synced} image(s) to the asset library${skipped ? `, skipped ${skipped} non-image file(s)` : ''}.`,
        )
      } else {
        setMessage(`Uploaded ${files.length} file(s) to ${category}.`)
      }
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      endBusy(busyKey)
    }
  }

  async function handleProcessVideo(referenceType, videoName) {
    if (!selectedProject) {
      return
    }

    const generateSkeleton =
      referenceType === 'facial' ? facialGenerateSkeleton : bodyGenerateSkeleton
    const generateOverlay =
      referenceType === 'facial' ? facialGenerateOverlay : bodyGenerateOverlay

    setError('')
    setMessage('')
    const busyKey = `${referenceType}:${videoName}`
    beginBusy(busyKey)

    try {
      const project = await requestJson(`${API_BASE}/projects/${selectedProject.id}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoName,
          mode: selectedMode,
          generateSkeleton,
          generateOverlay,
          referenceType,
        }),
      })

      setProjects((currentProjects) =>
        currentProjects.map((currentProject) =>
          currentProject.id === project.id ? project : currentProject,
        ),
      )
      const generatedKinds = [
        generateSkeleton ? 'skeleton reference' : null,
        generateOverlay ? 'overlay reference' : null,
      ]
        .filter(Boolean)
        .join(' and ')
      setMessage(`Generated ${generatedKinds} for ${videoName}.`)
    } catch (processError) {
      setError(processError.message)
    } finally {
      endBusy(busyKey)
    }
  }

  async function handleGenerateSkeletonTool(videoName) {
    if (!selectedProject) {
      return
    }

    setError('')
    setMessage('')
    const busyKey = `skeleton-tool:${videoName}`
    beginBusy(busyKey)

    try {
      const project = await requestJson(
        `${API_BASE}/projects/${selectedProject.id}/skeleton-tool/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoName,
            mode: skeletonToolMode,
            kptThr: Number(skeletonToolKptThr),
            allPeople: skeletonToolAllPeople,
            generateSkeleton: skeletonToolGenerateSkeleton,
            generateOverlay: skeletonToolGenerateOverlay,
          }),
        },
      )

      setProjects((currentProjects) =>
        currentProjects.map((currentProject) =>
          currentProject.id === project.id ? project : currentProject,
        ),
      )
      const generatedKinds = [
        skeletonToolGenerateSkeleton ? 'skeleton reference' : null,
        skeletonToolGenerateOverlay ? 'overlay reference' : null,
      ]
        .filter(Boolean)
        .join(' and ')
      setMessage(`Generated ${generatedKinds} for ${videoName}.`)
    } catch (generateError) {
      setError(generateError.message)
    } finally {
      endBusy(busyKey)
    }
  }

  async function handleRemoveFile(category, fileName) {
    if (!selectedProject) {
      return
    }

    setError('')
    setMessage('')
    const busyKey = `remove:${category}:${fileName}`
    beginBusy(busyKey)

    try {
      const project = await requestJson(`${API_BASE}/projects/${selectedProject.id}/files`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category,
          fileName,
        }),
      })

      setProjects((currentProjects) =>
        currentProjects.map((currentProject) =>
          currentProject.id === project.id ? project : currentProject,
        ),
      )
      setMessage(`Removed ${fileName}.`)
    } catch (removeError) {
      setError(removeError.message)
    } finally {
      endBusy(busyKey)
    }
  }

  async function handleDeleteProject(projectId, projectName) {
    setError('')
    setMessage('')
    const busyKey = `delete-project:${projectId}`
    beginBusy(busyKey)

    try {
      await requestJson(`${API_BASE}/projects/${projectId}`, {
        method: 'DELETE',
      })

      setProjects((currentProjects) => {
        const remainingProjects = currentProjects.filter(
          (currentProject) => currentProject.id !== projectId,
        )
        if (selectedProjectId === projectId) {
          setSelectedProjectId(remainingProjects[0]?.id || '')
        }
        return remainingProjects
      })
      setMessage(`Deleted project "${projectName}".`)
    } catch (deleteError) {
      setError(deleteError.message)
    } finally {
      endBusy(busyKey)
    }
  }

  async function refreshSeedanceTask(taskId, options = {}) {
    if (!selectedProject) {
      return
    }

    const busyKey = `seedance:refresh:${taskId}`
    if (!options.silent) {
      setError('')
      setMessage('')
      beginBusy(busyKey)
    }

    try {
      const project = await requestJson(
        `${API_BASE}/projects/${selectedProject.id}/seedance/tasks/${taskId}`,
      )
      setProjects((currentProjects) =>
        currentProjects.map((currentProject) =>
          currentProject.id === project.id ? project : currentProject,
        ),
      )
    } catch (refreshError) {
      if (!options.silent) {
        setError(refreshError.message)
      }
    } finally {
      if (!options.silent) {
        endBusy(busyKey)
      }
    }
  }

  async function handleGenerateSeedance() {
    if (!selectedProject) {
      return
    }

    setError('')
    setMessage('')
    const busyKey = 'seedance:create'
    beginBusy(busyKey)

    try {
      const project = await requestJson(
        `${API_BASE}/projects/${selectedProject.id}/seedance/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: seedancePrompt,
            characterSheetName: selectedCharacterSheetName,
            bodyReferenceVideoName: selectedBodySeedanceVideoName,
            facialReferenceVideoName: selectedFacialSeedanceVideoName,
            ratio: seedanceRatio,
            resolution: seedanceResolution,
            duration: Number(seedanceDuration),
            generateAudio: seedanceGenerateAudio,
            watermark: seedanceWatermark,
          }),
        },
      )

      setProjects((currentProjects) =>
        currentProjects.map((currentProject) =>
          currentProject.id === project.id ? project : currentProject,
        ),
      )
      setMessage('Started Seedance 2.5 video generation.')
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      endBusy(busyKey)
    }
  }

  useEffect(() => {
    if (!selectedProject || activeSeedanceJobs.length === 0) {
      return
    }

    const interval = setInterval(() => {
      activeSeedanceJobs.forEach((job) => {
        refreshSeedanceTask(job.id, { silent: true })
      })
    }, 10000)

    return () => clearInterval(interval)
  }, [selectedProject, activeSeedanceJobs])

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Motion reference workspace</p>
          <h1>Actor studio</h1>
          <p className="hero-copy">
            Organize each actor as its own project, upload their motion clips and character art,
            and generate DWPose skeleton references without leaving the browser.
          </p>
        </div>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel">
            <h2>Create project</h2>
            <form className="stack" onSubmit={handleCreateProject}>
              <label className="field">
                <span>Actor / project name</span>
                <input
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  placeholder="Actor name"
                  required
                />
              </label>
              <button type="submit" disabled={isBusy('create')}>
                {isBusy('create') ? 'Creating...' : 'Create project'}
              </button>
            </form>
          </div>

          <div className="panel">
            <div className="section-title">
              <h2>Projects</h2>
              <span>{projects.length}</span>
            </div>
            <div className="project-list">
              {projects.length === 0 ? (
                <p className="empty-state">No projects yet.</p>
              ) : (
                projects.map((project) => (
                  <div className="project-row" key={project.id}>
                    <button
                      type="button"
                      className={`project-item ${selectedProjectId === project.id ? 'active' : ''}`}
                      onClick={() => setSelectedProjectId(project.id)}
                    >
                      <span className="project-avatar">{getInitials(project.name)}</span>
                      <span className="project-meta">
                        <strong>{project.name}</strong>
                        <span>{project.motionReferences.length} motion videos</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="danger-button project-delete-button"
                      onClick={() => handleDeleteProject(project.id, project.name)}
                      disabled={isBusy(`delete-project:${project.id}`)}
                    >
                      {isBusy(`delete-project:${project.id}`)
                        ? 'Deleting...'
                        : 'Delete'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        <section className="content">
          {error ? <div className="banner error">{error}</div> : null}
          {message ? <div className="banner success">{message}</div> : null}

          {!selectedProject ? (
            <div className="panel empty-panel">
              <h2>Select or create a project</h2>
              <p>Once a project exists, you can upload motion references and character sheets.</p>
            </div>
          ) : (
            <>
              <div className="panel">
                <div className="section-title actor-headline">
                  <div className="actor-title-block">
                    <span className="project-avatar large">
                      {getInitials(selectedProject.name)}
                    </span>
                    <div>
                      <h2>{selectedProject.name}</h2>
                      <p className="muted">
                        Asset group: {selectedProject.assetLibrary?.groupId || 'Not created yet'}
                      </p>
                    </div>
                  </div>
                  <label className="mode-picker">
                    <span>Processing mode</span>
                    <select
                      value={selectedMode}
                      onChange={(event) => setSelectedMode(event.target.value)}
                    >
                      <option value="lightweight">lightweight</option>
                      <option value="balanced">balanced</option>
                      <option value="performance">performance</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="grid">
                <div className="panel">
                  <div className="section-title">
                    <h2>Motion references</h2>
                    <span>{selectedProject.motionReferences.length}</span>
                  </div>
                  <div className="reference-stack">
                    <div className="reference-box">
                      <div className="section-title">
                        <h3>Body reference</h3>
                        <span>{selectedProject.bodyReferences.length}</span>
                      </div>
                      <div className="generation-options motion-generation-options">
                        <label>
                          <input
                            type="checkbox"
                            checked={bodyGenerateSkeleton}
                            onChange={(event) => setBodyGenerateSkeleton(event.target.checked)}
                          />
                          <span>Skeleton reference generation</span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={bodyGenerateOverlay}
                            onChange={(event) => setBodyGenerateOverlay(event.target.checked)}
                          />
                          <span>Overlay reference generation</span>
                        </label>
                      </div>
                      {!bodyGenerateSkeleton && !bodyGenerateOverlay ? (
                        <p className="warning-text">
                          Select at least one generation option before processing.
                        </p>
                      ) : null}
                      <label className="upload-box">
                        <UploadBoxContent
                          icon="video"
                          title="Body reference videos"
                          hint="MP4, MOV · full body motion"
                        />
                        <input
                          className="upload-input"
                          type="file"
                          accept="video/*"
                          multiple
                          onChange={(event) =>
                            handleUpload(
                              selectedProject.id,
                              'body-references',
                              event.target.files || [],
                            )
                          }
                        />
                      </label>
                      <div className="file-list">
                        {selectedProject.bodyReferences.length === 0 ? (
                          <p className="empty-state">No body reference videos uploaded.</p>
                        ) : (
                          selectedProject.bodyReferences.map((file) => {
                            const outputs = findGeneratedOutputs(
                              selectedProject.processedBody || [],
                              file.name,
                            )
                            return (
                              <div className="file-card" key={`body-${file.name}`}>
                                <div className="file-content">
                                  <div>
                                    <strong>{file.name}</strong>
                                    <a href={file.url} target="_blank" rel="noreferrer">
                                      Open source video
                                    </a>
                                  </div>
                                  {outputs.skeleton ? (
                                    <div className="preview-block">
                                      <span className="preview-label">Skeleton preview</span>
                                      <video
                                        className="video-preview"
                                        controls
                                        preload="metadata"
                                        src={outputs.skeleton.url}
                                      />
                                      {outputs.overlay ? (
                                        <a href={outputs.overlay.url} target="_blank" rel="noreferrer">
                                          Open overlay video
                                        </a>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="file-actions">
                                  <button
                                    type="button"
                                    className={
                                      isBusy(`body:${file.name}`) ? 'loading-button' : ''
                                    }
                                    onClick={() => handleProcessVideo('body', file.name)}
                                    disabled={
                                      isBusy(`body:${file.name}`) ||
                                      (!bodyGenerateSkeleton && !bodyGenerateOverlay)
                                    }
                                  >
                                    {isBusy(`body:${file.name}`)
                                      ? 'Generating...'
                                      : 'Generate reference'}
                                  </button>
                                  <button
                                    type="button"
                                    className="danger-button"
                                    onClick={() => handleRemoveFile('body-references', file.name)}
                                    disabled={isBusy(`remove:body-references:${file.name}`)}
                                  >
                                    {isBusy(`remove:body-references:${file.name}`)
                                      ? 'Removing...'
                                      : 'Remove'}
                                  </button>
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>

                    <div className="reference-box">
                      <div className="section-title">
                        <h3>Facial reference</h3>
                        <span>{selectedProject.facialReferences.length}</span>
                      </div>
                      <div className="generation-options motion-generation-options">
                        <label>
                          <input
                            type="checkbox"
                            checked={facialGenerateSkeleton}
                            onChange={(event) => setFacialGenerateSkeleton(event.target.checked)}
                          />
                          <span>Skeleton reference generation</span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={facialGenerateOverlay}
                            onChange={(event) => setFacialGenerateOverlay(event.target.checked)}
                          />
                          <span>Overlay reference generation</span>
                        </label>
                      </div>
                      {!facialGenerateSkeleton && !facialGenerateOverlay ? (
                        <p className="warning-text">
                          Select at least one generation option before processing.
                        </p>
                      ) : null}
                      <label className="upload-box">
                        <UploadBoxContent
                          icon="video"
                          title="Facial reference videos"
                          hint="Frontal clips · clear facial motion"
                        />
                        <input
                          className="upload-input"
                          type="file"
                          accept="video/*"
                          multiple
                          onChange={(event) =>
                            handleUpload(
                              selectedProject.id,
                              'facial-references',
                              event.target.files || [],
                            )
                          }
                        />
                      </label>
                      <div className="file-list">
                        {selectedProject.facialReferences.length === 0 ? (
                          <p className="empty-state">No facial reference videos uploaded.</p>
                        ) : (
                          selectedProject.facialReferences.map((file) => {
                            const outputs = findGeneratedOutputs(
                              selectedProject.processedFacial || [],
                              file.name,
                            )
                            return (
                              <div className="file-card" key={`facial-${file.name}`}>
                                <div className="file-content">
                                  <div>
                                    <strong>{file.name}</strong>
                                    <a href={file.url} target="_blank" rel="noreferrer">
                                      Open source video
                                    </a>
                                  </div>
                                  {outputs.skeleton ? (
                                    <div className="preview-block">
                                      <span className="preview-label">Skeleton preview</span>
                                      <video
                                        className="video-preview"
                                        controls
                                        preload="metadata"
                                        src={outputs.skeleton.url}
                                      />
                                      {outputs.overlay ? (
                                        <a href={outputs.overlay.url} target="_blank" rel="noreferrer">
                                          Open overlay video
                                        </a>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="file-actions">
                                  <button
                                    type="button"
                                    className={
                                      isBusy(`facial:${file.name}`) ? 'loading-button' : ''
                                    }
                                    onClick={() => handleProcessVideo('facial', file.name)}
                                    disabled={
                                      isBusy(`facial:${file.name}`) ||
                                      (!facialGenerateSkeleton && !facialGenerateOverlay)
                                    }
                                  >
                                    {isBusy(`facial:${file.name}`)
                                      ? 'Generating...'
                                      : 'Generate reference'}
                                  </button>
                                  <button
                                    type="button"
                                    className="danger-button"
                                    onClick={() => handleRemoveFile('facial-references', file.name)}
                                    disabled={isBusy(`remove:facial-references:${file.name}`)}
                                  >
                                    {isBusy(`remove:facial-references:${file.name}`)
                                      ? 'Removing...'
                                      : 'Remove'}
                                  </button>
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="section-title">
                    <h2>Character sheets</h2>
                    <span>{selectedProject.characterSheets.length}</span>
                  </div>
                  <label className="upload-box">
                    <UploadBoxContent
                      icon="image"
                      title="Character sheets"
                      hint="Images or PDF · face and full body"
                    />
                    <input
                      className="upload-input"
                      type="file"
                      accept="image/*,.pdf"
                      multiple
                      onChange={(event) =>
                        handleUpload(
                          selectedProject.id,
                          'character-sheets',
                          event.target.files || [],
                        )
                      }
                    />
                  </label>
                  <div className="file-list">
                    {selectedProject.characterSheets.length === 0 ? (
                      <p className="empty-state">No character sheets uploaded.</p>
                    ) : (
                      selectedProject.characterSheets.map((file) => (
                        <div className="file-card" key={file.name}>
                          <div className="file-content">
                            <strong>{file.name}</strong>
                            {isImageFile(file.name) ? (
                              <img className="image-preview" src={file.url} alt={file.name} />
                            ) : null}
                            <div className="muted">
                              Asset ID: {file.assetLibrary?.assetId || 'Pending asset sync'}
                            </div>
                            <a href={file.url} target="_blank" rel="noreferrer">
                              Open file
                            </a>
                          </div>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleRemoveFile('character-sheets', file.name)}
                            disabled={isBusy(`remove:character-sheets:${file.name}`)}
                          >
                            {isBusy(`remove:character-sheets:${file.name}`)
                              ? 'Removing...'
                              : 'Remove'}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="section-title">
                  <h2>Skeleton reference generator</h2>
                  <span>{selectedProject.skeletonToolSourceVideos.length}</span>
                </div>
                <p className="muted">
                  A standalone DWPose/RTMPose tool: upload any video and generate a skeleton
                  reference with full control over detection settings, independent of the
                  body/facial motion library above.
                </p>
                <div className="seedance-form">
                  <div className="seedance-grid">
                    <label className="field">
                      <span>Processing mode</span>
                      <select
                        value={skeletonToolMode}
                        onChange={(event) => setSkeletonToolMode(event.target.value)}
                      >
                        <option value="lightweight">lightweight</option>
                        <option value="balanced">balanced</option>
                        <option value="performance">performance</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Keypoint confidence threshold</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={skeletonToolKptThr}
                        onChange={(event) => setSkeletonToolKptThr(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Subject selection</span>
                      <select
                        value={skeletonToolAllPeople ? 'all' : 'primary'}
                        onChange={(event) =>
                          setSkeletonToolAllPeople(event.target.value === 'all')
                        }
                      >
                        <option value="primary">Primary subject only</option>
                        <option value="all">Keep every detected person</option>
                      </select>
                    </label>
                  </div>
                  <div className="generation-options">
                    <label>
                      <input
                        type="checkbox"
                        checked={skeletonToolGenerateSkeleton}
                        onChange={(event) =>
                          setSkeletonToolGenerateSkeleton(event.target.checked)
                        }
                      />
                      <span>Skeleton reference generation</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={skeletonToolGenerateOverlay}
                        onChange={(event) => setSkeletonToolGenerateOverlay(event.target.checked)}
                      />
                      <span>Overlay reference generation</span>
                    </label>
                  </div>
                  {!skeletonToolGenerateSkeleton && !skeletonToolGenerateOverlay ? (
                    <p className="warning-text">
                      Select at least one generation option before processing.
                    </p>
                  ) : null}
                </div>
                <label className="upload-box">
                  <UploadBoxContent
                    icon="video"
                    title="Source video"
                    hint="MP4, MOV · any subject or framing"
                  />
                  <input
                    className="upload-input"
                    type="file"
                    accept="video/*"
                    multiple
                    onChange={(event) =>
                      handleUpload(
                        selectedProject.id,
                        'skeleton-tool/videos',
                        event.target.files || [],
                      )
                    }
                  />
                </label>
                <div className="file-list">
                  {selectedProject.skeletonToolSourceVideos.length === 0 ? (
                    <p className="empty-state">No videos uploaded yet.</p>
                  ) : (
                    selectedProject.skeletonToolSourceVideos.map((file) => {
                      const outputs = findGeneratedOutputs(
                        selectedProject.skeletonToolOutputs || [],
                        file.name,
                      )
                      return (
                        <div className="file-card" key={`skeleton-tool-${file.name}`}>
                          <div className="file-content">
                            <div>
                              <strong>{file.name}</strong>
                              <a href={file.url} target="_blank" rel="noreferrer">
                                Open source video
                              </a>
                            </div>
                            {outputs.skeleton ? (
                              <div className="preview-block">
                                <span className="preview-label">Skeleton preview</span>
                                <video
                                  className="video-preview"
                                  controls
                                  preload="metadata"
                                  src={outputs.skeleton.url}
                                />
                                {outputs.overlay ? (
                                  <a href={outputs.overlay.url} target="_blank" rel="noreferrer">
                                    Open overlay video
                                  </a>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <div className="file-actions">
                            <button
                              type="button"
                              className={
                                isBusy(`skeleton-tool:${file.name}`) ? 'loading-button' : ''
                              }
                              onClick={() => handleGenerateSkeletonTool(file.name)}
                              disabled={
                                isBusy(`skeleton-tool:${file.name}`) ||
                                (!skeletonToolGenerateSkeleton && !skeletonToolGenerateOverlay)
                              }
                            >
                              {isBusy(`skeleton-tool:${file.name}`)
                                ? 'Generating...'
                                : 'Generate reference'}
                            </button>
                            <button
                              type="button"
                              className="danger-button"
                              onClick={() => handleRemoveFile('skeleton-tool-source', file.name)}
                              disabled={isBusy(`remove:skeleton-tool-source:${file.name}`)}
                            >
                              {isBusy(`remove:skeleton-tool-source:${file.name}`)
                                ? 'Removing...'
                                : 'Remove'}
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="section-title">
                  <h2>Seedance 2.5 generation</h2>
                  <span>{selectedProject.seedance?.jobs?.length || 0}</span>
                </div>
                <p className="muted">
                  Standard prompt template uses <code>@Image1</code> for the character sheet,
                  <code>@Video1</code> for the body skeleton reference, and <code>@Video2</code>{' '}
                  for the facial skeleton reference. Extra uploaded reference images continue as{' '}
                  <code>@Image2+</code>, extra videos continue as <code>@Video3+</code>, and
                  uploaded audios continue as <code>@Audio1+</code>.
                </p>
                <div className="seedance-form">
                  <label className="field">
                    <span>Character sheet asset</span>
                    <select
                      value={selectedCharacterSheetName}
                      onChange={(event) => setSelectedCharacterSheetName(event.target.value)}
                    >
                      <option value="">Select a synced character sheet</option>
                      {selectableCharacterSheets.map((file) => (
                        <option key={file.name} value={file.name}>
                          {file.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Body reference video</span>
                    <select
                      value={selectedBodySeedanceVideoName}
                      onChange={(event) => setSelectedBodySeedanceVideoName(event.target.value)}
                    >
                      <option value="">Select a body skeleton video</option>
                      {selectableBodyReferenceVideos.map((file) => (
                        <option
                          key={`${file.referenceType}:${file.name}`}
                          value={`${file.referenceType}:${file.name}`}
                        >
                          {file.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Facial reference video</span>
                    <select
                      value={selectedFacialSeedanceVideoName}
                      onChange={(event) => setSelectedFacialSeedanceVideoName(event.target.value)}
                    >
                      <option value="">Select a facial skeleton video</option>
                      {selectableFacialReferenceVideos.map((file) => (
                        <option
                          key={`${file.referenceType}:${file.name}`}
                          value={`${file.referenceType}:${file.name}`}
                        >
                          {file.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field seedance-prompt">
                    <span>Prompt</span>
                    <textarea
                      value={seedancePrompt}
                      onChange={(event) => setSeedancePrompt(event.target.value)}
                      rows={5}
                    />
                  </label>
                  <div className="seedance-reference-grid">
                    <div className="reference-box">
                      <label className="upload-box upload-box-first">
                        <UploadBoxContent
                          icon="image"
                          title="Reference images"
                          hint="Additional identity and style"
                        />
                        <input
                          className="upload-input"
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) =>
                            handleUpload(
                              selectedProject.id,
                              'seedance-reference-images',
                              event.target.files || [],
                            )
                          }
                        />
                      </label>
                      <div className="file-list compact-list">
                        {selectedProject.seedanceReferenceImages.length === 0 ? (
                          <p className="empty-state">No extra reference images uploaded.</p>
                        ) : (
                          selectedProject.seedanceReferenceImages.map((file) => (
                            <div className="file-card" key={`seedance-image-${file.name}`}>
                              <div className="file-content">
                                <strong>{file.name}</strong>
                                {isImageFile(file.name) ? (
                                  <img className="image-preview" src={file.url} alt={file.name} />
                                ) : null}
                                <a href={file.url} target="_blank" rel="noreferrer">
                                  Open file
                                </a>
                              </div>
                              <button
                                type="button"
                                className="danger-button"
                                onClick={() =>
                                  handleRemoveFile('seedance-reference-images', file.name)
                                }
                                disabled={
                                  isBusy(`remove:seedance-reference-images:${file.name}`)
                                }
                              >
                                {isBusy(`remove:seedance-reference-images:${file.name}`)
                                  ? 'Removing...'
                                  : 'Remove'}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="reference-box">
                      <label className="upload-box upload-box-first">
                        <UploadBoxContent
                          icon="video"
                          title="Reference videos"
                          hint="Additional motion and camera cues"
                        />
                        <input
                          className="upload-input"
                          type="file"
                          accept="video/*"
                          multiple
                          onChange={(event) =>
                            handleUpload(
                              selectedProject.id,
                              'seedance-reference-videos',
                              event.target.files || [],
                            )
                          }
                        />
                      </label>
                      <div className="file-list compact-list">
                        {selectedProject.seedanceReferenceVideos.length === 0 ? (
                          <p className="empty-state">No extra reference videos uploaded.</p>
                        ) : (
                          selectedProject.seedanceReferenceVideos.map((file) => (
                            <div className="file-card" key={`seedance-video-${file.name}`}>
                              <div className="file-content">
                                <strong>{file.name}</strong>
                                <video
                                  className="video-preview"
                                  controls
                                  preload="metadata"
                                  src={file.url}
                                />
                                <a href={file.url} target="_blank" rel="noreferrer">
                                  Open file
                                </a>
                              </div>
                              <button
                                type="button"
                                className="danger-button"
                                onClick={() =>
                                  handleRemoveFile('seedance-reference-videos', file.name)
                                }
                                disabled={
                                  isBusy(`remove:seedance-reference-videos:${file.name}`)
                                }
                              >
                                {isBusy(`remove:seedance-reference-videos:${file.name}`)
                                  ? 'Removing...'
                                  : 'Remove'}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="reference-box">
                      <label className="upload-box upload-box-first">
                        <UploadBoxContent
                          icon="audio"
                          title="Reference audios"
                          hint="Guide rhythm, voice, or mood"
                        />
                        <input
                          className="upload-input"
                          type="file"
                          accept="audio/*"
                          multiple
                          onChange={(event) =>
                            handleUpload(
                              selectedProject.id,
                              'seedance-reference-audios',
                              event.target.files || [],
                            )
                          }
                        />
                      </label>
                      <div className="file-list compact-list">
                        {selectedProject.seedanceReferenceAudios.length === 0 ? (
                          <p className="empty-state">No reference audios uploaded.</p>
                        ) : (
                          selectedProject.seedanceReferenceAudios.map((file) => (
                            <div className="file-card" key={`seedance-audio-${file.name}`}>
                              <div className="file-content">
                                <strong>{file.name}</strong>
                                <audio controls preload="metadata" src={file.url} />
                                <a href={file.url} target="_blank" rel="noreferrer">
                                  Open file
                                </a>
                              </div>
                              <button
                                type="button"
                                className="danger-button"
                                onClick={() =>
                                  handleRemoveFile('seedance-reference-audios', file.name)
                                }
                                disabled={
                                  isBusy(`remove:seedance-reference-audios:${file.name}`)
                                }
                              >
                                {isBusy(`remove:seedance-reference-audios:${file.name}`)
                                  ? 'Removing...'
                                  : 'Remove'}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="seedance-grid">
                    <label className="field">
                      <span>Ratio</span>
                      <select
                        value={seedanceRatio}
                        onChange={(event) => setSeedanceRatio(event.target.value)}
                      >
                        <option value="21:9">21:9</option>
                        <option value="9:16">9:16</option>
                        <option value="16:9">16:9</option>
                        <option value="4:3">4:3</option>
                        <option value="1:1">1:1</option>
                        <option value="3:4">3:4</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Resolution</span>
                      <select
                        value={seedanceResolution}
                        onChange={(event) => setSeedanceResolution(event.target.value)}
                      >
                        <option value="480p">480p</option>
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Duration (seconds)</span>
                      <input
                        type="number"
                        min="4"
                        max="30"
                        value={seedanceDuration}
                        onChange={(event) => setSeedanceDuration(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="generation-options">
                    <label>
                      <input
                        type="checkbox"
                        checked={seedanceGenerateAudio}
                        onChange={(event) => setSeedanceGenerateAudio(event.target.checked)}
                      />
                      <span>Generate audio</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={seedanceWatermark}
                        onChange={(event) => setSeedanceWatermark(event.target.checked)}
                      />
                      <span>Add watermark</span>
                    </label>
                  </div>
                  <div className="seedance-actions">
                    <button
                      type="button"
                      onClick={handleGenerateSeedance}
                      disabled={
                        isBusy('seedance:create') ||
                        !selectedCharacterSheetName ||
                        !selectedBodySeedanceVideoName ||
                        !selectedFacialSeedanceVideoName ||
                        !seedancePrompt.trim()
                      }
                    >
                      {isBusy('seedance:create')
                        ? 'Starting...'
                        : 'Generate with Seedance 2.5'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSeedancePrompt(DEFAULT_SEEDANCE_PROMPT)}
                    >
                      Reset prompt template
                    </button>
                  </div>
                </div>

                <div className="file-list">
                  {(selectedProject.seedance?.jobs || []).length === 0 ? (
                    <p className="empty-state">
                      No Seedance generations yet. Select one character asset, one body skeleton
                      video, and one facial skeleton video to start.
                    </p>
                  ) : (
                    selectedProject.seedance.jobs.map((job) => (
                      <div className="file-card" key={job.id}>
                        <div className="file-content">
                          <div className="muted">Task ID: {job.id}</div>
                          {job.videoUrl ? (
                            <video
                              className="video-preview"
                              controls
                              preload="metadata"
                              src={job.videoUrl}
                            />
                          ) : null}
                          {job.videoUrl ? (
                            <a href={job.videoUrl} target="_blank" rel="noreferrer">
                              Open generated video
                            </a>
                          ) : null}
                          {job.lastFrameUrl ? (
                            <a href={job.lastFrameUrl} target="_blank" rel="noreferrer">
                              Open last frame
                            </a>
                          ) : null}
                          {job.errorMessage ? (
                            <div className="error-inline">{job.errorMessage}</div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => refreshSeedanceTask(job.id)}
                          disabled={isBusy(`seedance:refresh:${job.id}`)}
                        >
                          {isBusy(`seedance:refresh:${job.id}`)
                            ? 'Refreshing...'
                            : 'Refresh status'}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
