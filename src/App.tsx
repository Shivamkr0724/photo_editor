import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'

const SIZE_OPTIONS = [1024, 384, 96] as const
const MAX_FILES = 10

type PresetSize = (typeof SIZE_OPTIONS)[number]
type ExportFormat = 'png' | 'jpeg'

type ImageItem = {
  id: string
  src: string
  name: string
  naturalWidth: number
  naturalHeight: number
  size: PresetSize
  zoom: number
  offsetX: number
  offsetY: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const readImageDimensions = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = () => reject(new Error('Failed to read image dimensions.'))
    img.src = src
  })

const buildFileName = (originalName: string, size: PresetSize, format: ExportFormat) => {
  const baseName = originalName.replace(/\.[^.]+$/, '') || 'image'
  const extension = format === 'png' ? 'png' : 'jpg'
  return `${baseName}-${size}x${size}.${extension}`
}

const exportImage = async (
  item: ImageItem,
  format: ExportFormat,
  quality: number,
) => {
  const image = new Image()
  image.src = item.src

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(`Failed to render ${item.name}`))
  })

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
  const extraX = Math.max(0, drawWidth - item.size)
  const extraY = Math.max(0, drawHeight - item.size)
  const drawX = (item.size - drawWidth) / 2 - extraX * item.offsetX
  const drawY = (item.size - drawHeight) / 2 - extraY * item.offsetY

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, item.size, item.size)
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)

  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
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
  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0] ?? null

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.src))
    }
  }, [])

  const updateItem = (id: string, updater: (item: ImageItem) => ImageItem) => {
    setItems((current) => current.map((item) => (item.id === id ? updater(item) : item)))
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
            size: 1024,
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
          } satisfies ImageItem
        }),
      )

      setItems((current) => {
        current.forEach((item) => URL.revokeObjectURL(item.src))
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
      }

      const nextItems = current.filter((item) => item.id !== id)
      const nextSelectedId =
        selectedId === id ? (nextItems[0]?.id ?? null) : selectedId
      setSelectedId(nextSelectedId)
      return nextItems
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
                  className="preview-frame"
                  style={{
                    width: Math.min(selectedItem.size, 420),
                    height: Math.min(selectedItem.size, 420),
                  }}
                >
                  <img
                    src={selectedItem.src}
                    alt={selectedItem.name}
                    style={{
                      width: `${selectedItem.zoom * 100}%`,
                      height: `${selectedItem.zoom * 100}%`,
                      objectPosition: `${50 + selectedItem.offsetX * 50}% ${
                        50 + selectedItem.offsetY * 50
                      }%`,
                    }}
                  />
                </div>

                <p className="preview-note">
                  Final export size: {selectedItem.size} x {selectedItem.size}
                </p>
              </div>

              <div className="controls-panel">
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

                  <label className="slider-field">
                    <span>Zoom</span>
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="0.01"
                      value={selectedItem.zoom}
                      onChange={(event) =>
                        updateItem(selectedItem.id, (item) => ({
                          ...item,
                          zoom: Number(event.target.value),
                        }))
                      }
                    />
                    <strong>{selectedItem.zoom.toFixed(2)}x</strong>
                  </label>

                  <label className="slider-field">
                    <span>Horizontal</span>
                    <input
                      type="range"
                      min="-1"
                      max="1"
                      step="0.01"
                      value={selectedItem.offsetX}
                      onChange={(event) =>
                        updateItem(selectedItem.id, (item) => ({
                          ...item,
                          offsetX: clamp(Number(event.target.value), -1, 1),
                        }))
                      }
                    />
                    <strong>{selectedItem.offsetX.toFixed(2)}</strong>
                  </label>

                  <label className="slider-field">
                    <span>Vertical</span>
                    <input
                      type="range"
                      min="-1"
                      max="1"
                      step="0.01"
                      value={selectedItem.offsetY}
                      onChange={(event) =>
                        updateItem(selectedItem.id, (item) => ({
                          ...item,
                          offsetY: clamp(Number(event.target.value), -1, 1),
                        }))
                      }
                    />
                    <strong>{selectedItem.offsetY.toFixed(2)}</strong>
                  </label>
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
