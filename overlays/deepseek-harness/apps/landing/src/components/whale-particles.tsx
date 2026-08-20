import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  scale: number
}

interface PixelData {
  particles: Particle[]
  widthUnits: number
  heightUnits: number
}

const SAMPLE_SIZE = 60
const UNIT_SCALE = 0.18
const PARTICLE_COLOR = 'rgb(37 99 235)'
const PARTICLE_ALPHA = 0.2

function sampleWhale(image: HTMLImageElement): PixelData {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { particles: [], widthUnits: 0, heightUnits: 0 }

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

  const scale = Math.min(SAMPLE_SIZE / image.width, SAMPLE_SIZE / image.height)
  const width = image.width * scale
  const height = image.height * scale
  ctx.drawImage(image, (SAMPLE_SIZE - width) / 2, (SAMPLE_SIZE - height) / 2, width, height)

  const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  const brightness = new Float32Array(SAMPLE_SIZE * SAMPLE_SIZE)
  for (let i = 0; i < SAMPLE_SIZE * SAMPLE_SIZE; i += 1) {
    const offset = i * 4
    const red = data[offset] ?? 0
    const green = data[offset + 1] ?? 0
    const blue = data[offset + 2] ?? 0
    brightness[i] = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  }

  const isIsolated = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= SAMPLE_SIZE || ny >= SAMPLE_SIZE) continue

        const neighbor = brightness[ny * SAMPLE_SIZE + nx] ?? 0
        if (neighbor > 0.2) {
          return false
        }
      }
    }
    return true
  }

  const particles: Particle[] = []
  for (let y = 0; y < SAMPLE_SIZE; y += 1) {
    for (let x = 0; x < SAMPLE_SIZE; x += 1) {
      const alpha = brightness[y * SAMPLE_SIZE + x] ?? 0
      if (alpha <= 0.2 || isIsolated(x, y)) continue

      particles.push({
        x: (x - SAMPLE_SIZE / 2) * UNIT_SCALE,
        y: (SAMPLE_SIZE / 2 - y) * UNIT_SCALE,
        scale: 0.5 + Math.random(),
      })
    }
  }

  return {
    particles,
    widthUnits: SAMPLE_SIZE * UNIT_SCALE,
    heightUnits: SAMPLE_SIZE * UNIT_SCALE,
  }
}

export function WhaleParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false

    const image = new Image()
    image.crossOrigin = 'anonymous'

    const render = (pixelData: PixelData) => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 1.7)
      const width = Math.max(1, Math.round(rect.width * dpr))
      const height = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)

      const unit = Math.min(rect.width / (pixelData.widthUnits * 1.08), rect.height / (pixelData.heightUnits * 1.05))
      const centerX = rect.width * 0.5
      const centerY = rect.height * 0.52
      ctx.fillStyle = '#000'
      ctx.globalAlpha = 1

      for (const particle of pixelData.particles) {
        const screenX = centerX + particle.x * unit
        const screenY = centerY - particle.y * unit
        const size = Math.max(2, Math.round(unit * 0.08 * particle.scale))

        ctx.fillRect(Math.round(screenX - size / 2), Math.round(screenY - size / 2), size, size)
      }

      ctx.globalCompositeOperation = 'source-in'
      ctx.globalAlpha = PARTICLE_ALPHA
      ctx.fillStyle = PARTICLE_COLOR
      ctx.fillRect(0, 0, rect.width, rect.height)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    }

    let sampled: PixelData = { particles: [], widthUnits: 0, heightUnits: 0 }

    image.onload = () => {
      if (cancelled) return
      sampled = sampleWhale(image)
      render(sampled)
    }
    image.src = `${import.meta.env.BASE_URL}hero-whale.svg`

    const resizeObserver = new ResizeObserver(() => {
      if (sampled.particles.length > 0) render(sampled)
    })
    resizeObserver.observe(canvas)

    return () => {
      cancelled = true
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <div className="api-whale-stage" aria-hidden="true">
      <div className="api-whale-glow" />
      <canvas ref={canvasRef} className="api-whale-canvas" />
    </div>
  )
}
