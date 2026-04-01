import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent, WheelEvent } from 'react'
import './App.css'

const SIZE_OPTIONS = [1024, 384, 96] as const
const MAX_FILES = 10
const ZOOM_MIN = 0.2
const ZOOM_MAX = 3
const ZOOM_STEP = 0.08

type PresetSize = (typeof SIZE_OPTIONS)[number]
type ExportFormat = 'png' | 'jpeg' | 'webp'

type ImageItem = {
  id: string
  src: string
  name: string
  naturalWidth: number
  naturalHeight: number
  backgroundSrc: string | null
  backgroundName: string | null
  backgroundWidth: number | null
  backgroundHeight: number | null
  size: PresetSize
  zoom: number
  offsetX: number
  offsetY: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const getFrameMetrics = (
  naturalWidth: number,
  naturalHeight: number,
  frameSize: number,
  zoom: number,
) => {
  const baseScale = Math.max(frameSize / naturalWidth, frameSize / naturalHeight)
  const scale = baseScale * zoom
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  const travelX = Math.abs(frameSize - width) / 2
  const travelY = Math.abs(frameSize - height) / 2

  return { width, height, travelX, travelY }
}

const readImageDimensions = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = () => reject(new Error('Failed to read image dimensions.'))
    img.src = src
  })

const buildFileName = (originalName: string, size: PresetSize, format: ExportFormat) => {
  const baseName = originalName.replace(/\.[^.]+$/, '') || 'image'
  const extension =
    format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg'
  return `${baseName}-${size}x${size}.${extension}`
}

const exportImage = async (
  item: ImageItem,
  format: ExportFormat,
  quality: number,
) => {
  const backgroundSrc = item.backgroundSrc
  const backgroundImage = backgroundSrc ? new Image() : null
  const image = new Image()
  if (backgroundImage && backgroundSrc) {
    backgroundImage.src = backgroundSrc
  }
  image.src = item.src

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error(`Failed to render ${item.name}`))
    }),
    backgroundImage
      ? new Promise<void>((resolve, reject) => {
          backgroundImage.onload = () => resolve()
          backgroundImage.onerror = () => reject(new Error('Failed to render background image'))
        })
      : Promise.resolve(),
  ])

  const canvas = document.createElement('canvas')
  canvas.width = item.size
  canvas.height = item.size
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Canvas is not supported in this browser.')
  }

  const baseScale = Math.max(item.size / image.width, item.size / image.height)
  const scale = baseScale * item.zoom
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  const travelX = Math.abs(item.size - drawWidth) / 2
  const travelY = Math.abs(item.size - drawHeight) / 2
  const drawX = (item.size - drawWidth) / 2 - travelX * item.offsetX
  const drawY = (item.size - drawHeight) / 2 - travelY * item.offsetY

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, item.size, item.size)
  } else {
    ctx.clearRect(0, 0, item.size, item.size)
  }

  if (backgroundImage) {
    const backgroundScale = Math.max(
      item.size / backgroundImage.width,
      item.size / backgroundImage.height,
    )
    const backgroundWidth = backgroundImage.width * backgroundScale
    const backgroundHeight = backgroundImage.height * backgroundScale
    const backgroundX = (item.size - backgroundWidth) / 2
    const backgroundY = (item.size - backgroundHeight) / 2
    ctx.drawImage(
      backgroundImage,
      backgroundX,
      backgroundY,
      backgroundWidth,
      backgroundHeight,
    )
  }

  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)

  const mimeType =
    format === 'png'
      ? 'image/png'
      : format === 'webp'
        ? 'image/webp'
        : 'image/jpeg'
  return canvas.toDataURL(mimeType, quality)
}

function App() {
  const [items, setItems] = useState<ImageItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(0.96)
  const [isImporting, setIsImporting] = useState(false)
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const [error, setError] = useState<string>('')
  const itemsRef = useRef<ImageItem[]>([])
  const previewFrameRef = useRef<HTMLDivElement | null>(null)
  const backgroundInputRef = useRef<HTMLInputElement | null>(null)
  const dragStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startOffsetX: number
    startOffsetY: number
    frameSize: number
    travelX: number
    travelY: number
  } | null>(null)
  const [backgroundTargetId, setBackgroundTargetId] = useState<string | null>(null)
  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0] ?? null

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.src)
        if (item.backgroundSrc) {
          URL.revokeObjectURL(item.backgroundSrc)
        }
      })
    }
  }, [])

  const updateItem = (id: string, updater: (item: ImageItem) => ImageItem) => {
    setItems((current) => current.map((item) => (item.id === id ? updater(item) : item)))
  }

  const adjustZoom = (id: string, delta: number) => {
    updateItem(id, (item) => ({
      ...item,
      zoom: clamp(Number((item.zoom + delta).toFixed(2)), ZOOM_MIN, ZOOM_MAX),
    }))
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files

    if (!fileList?.length) {
      return
    }

    const chosenFiles = Array.from(fileList).slice(0, MAX_FILES)

    setIsImporting(true)
    setError('')

    try {
      const nextItems = await Promise.all(
        chosenFiles.map(async (file, index) => {
          const src = URL.createObjectURL(file)
          const dimensions = await readImageDimensions(src)

          return {
            id: `${file.name}-${file.lastModified}-${index}`,
            src,
            name: file.name,
            naturalWidth: dimensions.width,
            naturalHeight: dimensions.height,
            backgroundSrc: null,
            backgroundName: null,
            backgroundWidth: null,
            backgroundHeight: null,
            size: 1024,
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
          } satisfies ImageItem
        }),
      )

      setItems((current) => {
        current.forEach((item) => {
          URL.revokeObjectURL(item.src)
          if (item.backgroundSrc) {
            URL.revokeObjectURL(item.backgroundSrc)
          }
        })
        return nextItems
      })
      setSelectedId(nextItems[0]?.id ?? null)

      if (fileList.length > MAX_FILES) {
        setError(`Only the first ${MAX_FILES} images were loaded.`)
      }
    } catch {
      setError('One or more images could not be loaded.')
    } finally {
      setIsImporting(false)
      event.target.value = ''
    }
  }

  const applySizeToAll = (size: PresetSize) => {
    setItems((current) => current.map((item) => ({ ...item, size })))
  }

  const removeImage = (id: string) => {
    setItems((current) => {
      const target = current.find((item) => item.id === id)
      if (target) {
        URL.revokeObjectURL(target.src)
        if (target.backgroundSrc) {
          URL.revokeObjectURL(target.backgroundSrc)
        }
      }

      const nextItems = current.filter((item) => item.id !== id)
      const nextSelectedId =
        selectedId === id ? (nextItems[0]?.id ?? null) : selectedId
      setSelectedId(nextSelectedId)
      return nextItems
    })
  }

  const openBackgroundPicker = (id: string) => {
    setBackgroundTargetId(id)
    backgroundInputRef.current?.click()
  }

  const handleBackgroundFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    const targetId = backgroundTargetId

    if (!file || !targetId) {
      return
    }

    setError('')

    try {
      const src = URL.createObjectURL(file)
      const dimensions = await readImageDimensions(src)

      setItems((current) =>
        current.map((item) => {
          if (item.id !== targetId) {
            return item
          }

          if (item.backgroundSrc) {
            URL.revokeObjectURL(item.backgroundSrc)
          }

          return {
            ...item,
            backgroundSrc: src,
            backgroundName: file.name,
            backgroundWidth: dimensions.width,
            backgroundHeight: dimensions.height,
          }
        }),
      )
    } catch {
      setError('The background image could not be loaded.')
    } finally {
      setBackgroundTargetId(null)
      event.target.value = ''
    }
  }

  const removeBackground = (id: string) => {
    updateItem(id, (item) => {
      if (item.backgroundSrc) {
        URL.revokeObjectURL(item.backgroundSrc)
      }

      return {
        ...item,
        backgroundSrc: null,
        backgroundName: null,
        backgroundWidth: null,
        backgroundHeight: null,
      }
    })
  }

  const downloadOne = async (item: ImageItem) => {
    const dataUrl = await exportImage(item, format, quality)
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = buildFileName(item.name, item.size, format)
    link.click()
  }

  const downloadAll = async () => {
    setIsDownloadingAll(true)
    setError('')

    try {
      for (const item of items) {
        const dataUrl = await exportImage(item, format, quality)
        const link = document.createElement('a')
        link.href = dataUrl
        link.download = buildFileName(item.name, item.size, format)
        link.click()
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
    } catch {
      setError('At least one image failed during export.')
    } finally {
      setIsDownloadingAll(false)
    }
  }

  const previewFrameSize = selectedItem ? Math.min(selectedItem.size, 420) : 420
  const previewMetrics = selectedItem
    ? getFrameMetrics(
        selectedItem.naturalWidth,
        selectedItem.naturalHeight,
        previewFrameSize,
        selectedItem.zoom,
      )
    : null

  const handlePreviewPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!selectedItem || !previewMetrics || !previewFrameRef.current) {
      return
    }

    event.preventDefault()
    previewFrameRef.current.setPointerCapture(event.pointerId)

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: selectedItem.offsetX,
      startOffsetY: selectedItem.offsetY,
      frameSize: previewFrameSize,
      travelX: previewMetrics.travelX,
      travelY: previewMetrics.travelY,
    }
  }

  const handlePreviewPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current

    if (!selectedItem || !dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - dragState.startX
    const deltaY = event.clientY - dragState.startY

    updateItem(selectedItem.id, (item) => ({
      ...item,
      offsetX:
        dragState.travelX > 0
          ? clamp(dragState.startOffsetX - deltaX / dragState.travelX, -1, 1)
          : 0,
      offsetY:
        dragState.travelY > 0
          ? clamp(dragState.startOffsetY - deltaY / dragState.travelY, -1, 1)
          : 0,
    }))
  }

  const handlePreviewPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null
      previewFrameRef.current?.releasePointerCapture(event.pointerId)
    }
  }

  const handlePreviewWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!selectedItem) {
      return
    }

    event.preventDefault()
    adjustZoom(selectedItem.id, event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Square Image Editor</p>
          <h1>Resize, crop, preview, and export up to 10 images together.</h1>
          <p className="intro">
            Upload your photos, choose 1024 x 1024, 384 x 384, or 96 x 96,
            adjust the framing for each image, and download sharp exports in
            real time.
          </p>
        </div>

        <div className="hero-actions">
          <label className="primary-button" htmlFor="image-upload">
            {isImporting ? 'Loading images...' : 'Upload images'}
          </label>
          <input
            id="image-upload"
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
          />
          <p className="helper-text">You can import up to 10 photos at once.</p>
        </div>
        <input
          ref={backgroundInputRef}
          type="file"
          accept="image/*"
          className="hidden-input"
          onChange={handleBackgroundFileChange}
        />
      </section>

      <section className="toolbar">
        <div className="toolbar-group">
          <span className="toolbar-label">Apply size to all</span>
          <div className="chip-row">
            {SIZE_OPTIONS.map((size) => (
              <button
                key={size}
                className="chip-button"
                type="button"
                onClick={() => applySizeToAll(size)}
                disabled={!items.length}
              >
                {size} x {size}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar-group compact">
          <label className="field">
            <span>Format</span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPG</option>
              <option value="webp">WEBP</option>
            </select>
          </label>

          <label className="field quality-field">
            <span>Quality {Math.round(quality * 100)}%</span>
            <input
              type="range"
              min="0.7"
              max="1"
              step="0.01"
              value={quality}
              onChange={(event) => setQuality(Number(event.target.value))}
            />
          </label>

          <button
            className="secondary-button"
            type="button"
            disabled={!selectedItem}
            onClick={() => selectedItem && void downloadOne(selectedItem)}
          >
            Download selected
          </button>

          <button
            className="primary-button small"
            type="button"
            disabled={!items.length || isDownloadingAll}
            onClick={() => void downloadAll()}
          >
            {isDownloadingAll ? 'Exporting...' : 'Download all'}
          </button>
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="workspace">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Images</h2>
            <span>{items.length}/10</span>
          </div>

          {items.length ? (
            <div className="image-list">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`thumb-card ${selectedItem?.id === item.id ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="thumb-select"
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="thumb-preview">
                      <img src={item.src} alt={item.name} />
                    </div>
                    <div className="thumb-copy">
                      <strong>{item.name}</strong>
                      <span>
                        {item.size} x {item.size}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="remove-button"
                    onClick={() => removeImage(item.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>No images yet.</p>
              <p>Start by uploading one or more files to open the editor.</p>
            </div>
          )}
        </aside>

        <section className="editor-panel">
          {selectedItem ? (
            <>
              <div className="preview-panel">
                <div className="preview-header">
                  <div>
                    <p className="eyebrow">Live preview</p>
                    <h2>{selectedItem.name}</h2>
                  </div>
                  <span className="meta-pill">
                    {selectedItem.naturalWidth} x {selectedItem.naturalHeight} source
                  </span>
                </div>

                <div
                  ref={previewFrameRef}
                  className="preview-frame"
                  onPointerDown={handlePreviewPointerDown}
                  onPointerMove={handlePreviewPointerMove}
                  onPointerUp={handlePreviewPointerUp}
                  onPointerCancel={handlePreviewPointerUp}
                  onWheel={handlePreviewWheel}
                  style={{
                    width: previewFrameSize,
                    height: previewFrameSize,
                  }}
                >
                  {selectedItem.backgroundSrc ? (
                    <img
                      className="preview-background"
                      src={selectedItem.backgroundSrc}
                      alt=""
                    />
                  ) : null}
                  <img
                    src={selectedItem.src}
                    alt={selectedItem.name}
                    style={{
                      width: previewMetrics?.width,
                      height: previewMetrics?.height,
                      left:
                        previewMetrics
                          ? (previewFrameSize - previewMetrics.width) / 2 -
                            previewMetrics.travelX * selectedItem.offsetX
                          : 0,
                      top:
                        previewMetrics
                          ? (previewFrameSize - previewMetrics.height) / 2 -
                            previewMetrics.travelY * selectedItem.offsetY
                          : 0,
                    }}
                  />
                </div>

                <p className="preview-note">
                  Final export size: {selectedItem.size} x {selectedItem.size}
                  {' '}| Drag to reposition. Use mouse wheel or zoom buttons to scale.
                </p>
              </div>

              <div className="controls-panel">
                <div className="control-group">
                  <h3>Background image</h3>
                  <div className="action-row">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => openBackgroundPicker(selectedItem.id)}
                    >
                      {selectedItem.backgroundSrc ? 'Replace background' : 'Add background'}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={!selectedItem.backgroundSrc}
                      onClick={() => removeBackground(selectedItem.id)}
                    >
                      Remove background
                    </button>
                  </div>
                  <p className="gesture-note">
                    Add a background image behind transparent PNGs before export.
                    {selectedItem.backgroundName
                      ? ` Current background: ${selectedItem.backgroundName}.`
                      : ' No background added yet.'}
                  </p>
                </div>

                <div className="control-group">
                  <h3>Square size</h3>
                  <div className="chip-row">
                    {SIZE_OPTIONS.map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={`chip-button ${selectedItem.size === size ? 'selected' : ''}`}
                        onClick={() =>
                          updateItem(selectedItem.id, (item) => ({ ...item, size }))
                        }
                      >
                        {size} x {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="control-group">
                  <h3>Adjust image framing</h3>
                  <div className="zoom-toolbar">
                    <button
                      className="secondary-button zoom-button"
                      type="button"
                      onClick={() => adjustZoom(selectedItem.id, -ZOOM_STEP)}
                    >
                      -
                    </button>
                    <strong className="zoom-value">{selectedItem.zoom.toFixed(2)}x</strong>
                    <button
                      className="secondary-button zoom-button"
                      type="button"
                      onClick={() => adjustZoom(selectedItem.id, ZOOM_STEP)}
                    >
                      +
                    </button>
                  </div>
                  <p className="gesture-note">
                    Click and drag inside the preview to move the crop area. Use
                    the mouse wheel or the zoom buttons to zoom in and out,
                    including zooming out to fit more of the image inside the square.
                  </p>
                </div>

                <div className="control-group">
                  <h3>Quick actions</h3>
                  <div className="action-row">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        updateItem(selectedItem.id, (item) => ({
                          ...item,
                          zoom: 1,
                          offsetX: 0,
                          offsetY: 0,
                        }))
                      }
                    >
                      Reset crop
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        setItems((current) =>
                          current.map((item) => ({
                            ...item,
                            zoom: selectedItem.zoom,
                            offsetX: selectedItem.offsetX,
                            offsetY: selectedItem.offsetY,
                          })),
                        )
                      }
                    >
                      Copy framing to all
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="editor-empty">
              <h2>Ready for your first upload</h2>
              <p>
                Once you add images, you&apos;ll be able to preview each one,
                adjust the crop, and export clean square files.
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
