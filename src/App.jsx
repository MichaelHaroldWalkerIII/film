import { useState, useEffect, useRef } from 'react'

const SAMPLE_SCREENPLAY = `FADE IN:

INT. ABANDONED WAREHOUSE - NIGHT

A lone detective, JACK, 40s, weathered and determined, enters through a broken window. Rain pours through the roof. He scans the dark space, flashlight cutting through dust.

EXT. CITY ROOFTOP - NIGHT

Jack chases a shadowy figure across the rain-slicked rooftop. Neon signs flicker below. The figure leaps to the next building.

INT. UNDERGROUND PARKING GARAGE - NIGHT

The figure's car screeches around pillars. Jack's car pursues. Metal scrapes concrete. The chase ends in a dramatic crash.

EXT. ABANDONED PIER - DAWN

Jack confronts the figure at the water's edge. A tense standoff. The sun rises over the harbor. The figure surrenders.

FADE OUT.`

export default function ScreenplayToMovie() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xai_api_key') || '')
  const [showApiKey, setShowApiKey] = useState(!localStorage.getItem('xai_api_key'))
  const [screenplay, setScreenplay] = useState('')
  const [scenes, setScenes] = useState([])
  const [generatedVideos, setGeneratedVideos] = useState([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState(-1)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  
  const videoRef = useRef(null)
  const pollingRefs = useRef({})

  // Load API key from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('xai_api_key')
    if (saved) setApiKey(saved)
  }, [])

  const saveApiKey = (key) => {
    setApiKey(key)
    if (key) localStorage.setItem('xai_api_key', key)
    else localStorage.removeItem('xai_api_key')
  }

  // Parse screenplay into scenes
  const parseScreenplay = (text) => {
    if (!text.trim()) return []
    
    const lines = text.split('\n')
    const parsedScenes = []
    let currentScene = null
    let actionLines = []

    for (const line of lines) {
      const trimmed = line.trim()
      
      // Detect scene headings (INT./EXT.)
      if (/^(INT\.|EXT\.|INT\/EXT\.)/i.test(trimmed)) {
        if (currentScene) {
          currentScene.description = actionLines.join(' ').trim()
          parsedScenes.push(currentScene)
        }
        currentScene = {
          id: Date.now() + parsedScenes.length,
          heading: trimmed,
          description: '',
          prompt: ''
        }
        actionLines = []
      } 
      // Collect action/description lines
      else if (currentScene && trimmed && !trimmed.startsWith('FADE') && !trimmed.startsWith('CUT')) {
        actionLines.push(trimmed)
      }
    }

    // Push last scene
    if (currentScene) {
      currentScene.description = actionLines.join(' ').trim()
      parsedScenes.push(currentScene)
    }

    // Generate video prompts
    return parsedScenes.map((scene, idx) => ({
      ...scene,
      prompt: `Cinematic film scene: ${scene.heading}. ${scene.description || 'Dramatic action unfolds.'} Cinematic lighting, film grain, dramatic camera movement, high production value, movie quality.`
    }))
  }

  const handleParseScreenplay = () => {
    const parsed = parseScreenplay(screenplay)
    setScenes(parsed)
    setGeneratedVideos([])
    setError('')
  }

  // Call Grok Imagine Video API
  const generateVideo = async (scene) => {
    if (!apiKey) {
      throw new Error('API key required. Please enter your xAI API key.')
    }

    const response = await fetch('https://api.x.ai/v1/videos/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-imagine-video',
        prompt: scene.prompt,
        duration: 8,
        aspect_ratio: '16:9',
        resolution: '480p'
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `API error: ${response.status}`)
    }

    const data = await response.json()
    return data.request_id
  }

  // Poll for video completion
  const pollVideoStatus = async (requestId, sceneId) => {
    const maxAttempts = 60 // 5 minutes max (5s intervals)
    let attempts = 0

    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 5000))
      attempts++

      const response = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })

      if (!response.ok) {
        throw new Error(`Poll error: ${response.status}`)
      }

      const data = await response.json()
      
      // Update scene status
      setGeneratedVideos(prev => prev.map(v => 
        v.sceneId === sceneId 
          ? { ...v, status: data.status, progress: data.progress || Math.min(attempts * 2, 95) }
          : v
      ))

      if (data.status === 'done') {
        return data.video?.url || data.url
      }
      if (data.status === 'failed' || data.status === 'expired') {
        throw new Error(data.error || 'Video generation failed')
      }
    }
    throw new Error('Timeout waiting for video')
  }

  const generateAllVideos = async () => {
    if (!apiKey) {
      setError('Please enter your xAI API key first.')
      setShowApiKey(true)
      return
    }
    if (scenes.length === 0) {
      setError('Please parse a screenplay first.')
      return
    }

    setIsGenerating(true)
    setError('')
    setGeneratedVideos(scenes.map(s => ({
      sceneId: s.id,
      heading: s.heading,
      status: 'pending',
      url: null,
      progress: 0
    })))

    setProgress({ current: 0, total: scenes.length })

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]
      setProgress({ current: i + 1, total: scenes.length })

      try {
        // Update status to generating
        setGeneratedVideos(prev => prev.map(v => 
          v.sceneId === scene.id ? { ...v, status: 'generating' } : v
        ))

        const requestId = await generateVideo(scene)
        
        // Update with request ID
        setGeneratedVideos(prev => prev.map(v => 
          v.sceneId === scene.id ? { ...v, requestId, status: 'polling' } : v
        ))

        const videoUrl = await pollVideoStatus(requestId, scene.id)
        
        // Success
        setGeneratedVideos(prev => prev.map(v => 
          v.sceneId === scene.id 
            ? { ...v, status: 'done', url: videoUrl, progress: 100 }
            : v
        ))

      } catch (err) {
        console.error(`Scene ${i} failed:`, err)
        setGeneratedVideos(prev => prev.map(v => 
          v.sceneId === scene.id 
            ? { ...v, status: 'failed', error: err.message }
            : v
        ))
      }
    }

    setIsGenerating(false)
    setProgress({ current: 0, total: 0 })
  }

  const playMovie = () => {
    const doneVideos = generatedVideos.filter(v => v.status === 'done' && v.url)
    if (doneVideos.length === 0) {
      setError('No completed videos to play.')
      return
    }
    setCurrentPlayingIndex(0)
  }

  const playNext = () => {
    const doneVideos = generatedVideos.filter(v => v.status === 'done' && v.url)
    if (currentPlayingIndex < doneVideos.length - 1) {
      setCurrentPlayingIndex(currentPlayingIndex + 1)
    } else {
      setCurrentPlayingIndex(-1) // End of movie
    }
  }

  const playPrev = () => {
    if (currentPlayingIndex > 0) {
      setCurrentPlayingIndex(currentPlayingIndex - 1)
    }
  }

  // Auto-advance video on end
  useEffect(() => {
    const video = videoRef.current
    if (!video || currentPlayingIndex < 0) return

    const handleEnded = () => playNext()
    video.addEventListener('ended', handleEnded)
    return () => video.removeEventListener('ended', handleEnded)
  }, [currentPlayingIndex])

  // Load video when index changes
  useEffect(() => {
    const video = videoRef.current
    if (!video || currentPlayingIndex < 0) return

    const doneVideos = generatedVideos.filter(v => v.status === 'done' && v.url)
    const currentVideo = doneVideos[currentPlayingIndex]
    
    if (currentVideo?.url) {
      video.src = currentVideo.url
      video.load()
      video.play().catch(() => {})
    }
  }, [currentPlayingIndex, generatedVideos])

  const closePlayer = () => {
    setCurrentPlayingIndex(-1)
    if (videoRef.current) {
      videoRef.current.pause()
    }
  }

  const downloadClip = (url, heading) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `${heading.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const loadSample = () => {
    setScreenplay(SAMPLE_SCREENPLAY)
    setTimeout(() => {
      const parsed = parseScreenplay(SAMPLE_SCREENPLAY)
      setScenes(parsed)
      setGeneratedVideos([])
    }, 100)
  }

  const doneVideos = generatedVideos.filter(v => v.status === 'done' && v.url)
  const failedCount = generatedVideos.filter(v => v.status === 'failed').length

  return (
    <div style={{
      fontFamily: 'Inter, sans-serif',
      background: '#0a0a0a',
      color: '#eee',
      minHeight: '100vh',
      padding: '40px 20px'
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: 12,
            marginBottom: 8
          }}>
            <div style={{ 
              width: 48, 
              height: 48, 
              background: 'linear-gradient(135deg, #ff1a1a, #ff6b6b)', 
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24
            }}>🎥</div>
            <h1 style={{ 
              fontFamily: 'Playfair Display, serif', 
              fontSize: 42, 
              margin: 0,
              background: 'linear-gradient(90deg, #fff, #ff6b6b)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              OneShot: Screenplay → Movie
            </h1>
          </div>
        </header>

        {/* API Key Section */}
        <div style={{
          background: '#111',
          borderRadius: 12,
          padding: 20,
          marginBottom: 30,
          border: '1px solid #222'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#ff6b6b' }}>🔑 XAI API KEY</div>
            <button 
              onClick={() => setShowApiKey(!showApiKey)}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12 }}
            >
              {showApiKey ? 'HIDE' : 'SHOW'}
            </button>
          </div>
          
          {showApiKey && (
            <div style={{ display: 'flex', gap: 12 }}>
              <input
                type="password"
                placeholder="xai-..."
                value={apiKey}
                onChange={(e) => saveApiKey(e.target.value)}
                style={{
                  flex: 1,
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: 8,
                  padding: '12px 16px',
                  color: '#fff',
                  fontFamily: 'monospace',
                  fontSize: 14
                }}
              />
              <a 
                href="https://console.x.ai" 
                target="_blank" 
                style={{ 
                  color: '#ff6b6b', 
                  textDecoration: 'none', 
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 12px'
                }}
              >
                Get Key →
              </a>
            </div>
          )}
          {!showApiKey && apiKey && (
            <div style={{ color: '#4ade80', fontSize: 13 }}>
              ✓ API key saved
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30 }}>
          {/* Left: Input */}
          <div>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 18 }}>📜 Screenplay</div>
              <button 
                onClick={loadSample}
                style={{
                  background: 'none',
                  border: '1px solid #444',
                  color: '#aaa',
                  padding: '6px 14px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13
                }}
              >
                Load Sample
              </button>
            </div>

            <textarea
              value={screenplay}
              onChange={(e) => setScreenplay(e.target.value)}
              placeholder="Paste your screenplay here...&#10;&#10;INT. LOCATION - TIME&#10;&#10;Action description goes here..."
              style={{
                width: '100%',
                height: 380,
                background: '#111',
                border: '1px solid #333',
                borderRadius: 12,
                padding: 20,
                color: '#ddd',
                fontSize: 14,
                fontFamily: 'monospace',
                lineHeight: 1.6,
                resize: 'vertical'
              }}
            />

            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button 
                onClick={handleParseScreenplay}
                disabled={!screenplay.trim()}
                style={{
                  flex: 1,
                  padding: '14px 24px',
                  background: '#222',
                  border: '1px solid #444',
                  color: '#fff',
                  borderRadius: 8,
                  cursor: screenplay.trim() ? 'pointer' : 'not-allowed',
                  fontSize: 15,
                  fontWeight: 500
                }}
              >
                Parse Scenes
              </button>
              <button 
                onClick={generateAllVideos}
                disabled={isGenerating || scenes.length === 0 || !apiKey}
                style={{
                  flex: 2,
                  padding: '14px 24px',
                  background: (isGenerating || scenes.length === 0 || !apiKey) ? '#333' : 'linear-gradient(135deg, #ff1a1a, #ff6b6b)',
                  border: 'none',
                  color: '#fff',
                  borderRadius: 8,
                  cursor: (isGenerating || scenes.length === 0 || !apiKey) ? 'not-allowed' : 'pointer',
                  fontSize: 15,
                  fontWeight: 600
                }}
              >
                {isGenerating 
                  ? `Generating... (${progress.current}/${progress.total})` 
                  : '🎬 Generate Movie'}
              </button>
            </div>

            {error && (
              <div style={{ 
                marginTop: 16, 
                padding: 14, 
                background: '#3a1a1a', 
                border: '1px solid #5a2a2a',
                borderRadius: 8,
                color: '#ff8080',
                fontSize: 14
              }}>
                ⚠️ {error}
              </div>
            )}
          </div>

          {/* Right: Scenes & Progress */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 16 }}>
              🎞️ Detected Scenes {scenes.length > 0 && `(${scenes.length})`}
            </div>

            {scenes.length === 0 ? (
              <div style={{
                background: '#111',
                border: '1px dashed #333',
                borderRadius: 12,
                padding: 60,
                textAlign: 'center',
                color: '#666'
              }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎬</div>
                <p>Parse a screenplay to see scenes</p>
                <p style={{ fontSize: 13, marginTop: 8 }}>Uses standard INT./EXT. headings</p>
              </div>
            ) : (
              <div style={{ 
                background: '#111', 
                borderRadius: 12, 
                maxHeight: 420, 
                overflowY: 'auto',
                border: '1px solid #222'
              }}>
                {scenes.map((scene, idx) => {
                  const videoStatus = generatedVideos.find(v => v.sceneId === scene.id)
                  const status = videoStatus?.status || 'pending'
                  
                  return (
                    <div key={scene.id} style={{
                      padding: '16px 20px',
                      borderBottom: idx < scenes.length - 1 ? '1px solid #222' : 'none',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 14
                    }}>
                      <div style={{ 
                        width: 28, 
                        height: 28, 
                        borderRadius: 6, 
                        background: '#1a1a1a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#888',
                        flexShrink: 0,
                        marginTop: 2
                      }}>
                        {idx + 1}
                      </div>
                      
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: '#fff' }}>
                          {scene.heading}
                        </div>
                        <div style={{ fontSize: 13, color: '#999', lineHeight: 1.5 }}>
                          {scene.description || 'No description'}
                        </div>
                      </div>

                      <div style={{ flexShrink: 0 }}>
                        {status === 'pending' && (
                          <span style={{ color: '#666', fontSize: 12 }}>⏳</span>
                        )}
                        {status === 'generating' && (
                          <span style={{ color: '#ff6b6b', fontSize: 12 }}>⏳</span>
                        )}
                        {status === 'polling' && (
                          <span style={{ color: '#facc15', fontSize: 12 }}>
                            {videoStatus.progress}%
                          </span>
                        )}
                        {status === 'done' && (
                          <span style={{ color: '#4ade80', fontSize: 16 }}>✓</span>
                        )}
                        {status === 'failed' && (
                          <span style={{ color: '#ef4444', fontSize: 14 }}>✕</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {doneVideos.length > 0 && (
              <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
                <button 
                  onClick={playMovie}
                  style={{
                    flex: 1,
                    padding: '14px',
                    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                    border: 'none',
                    color: '#fff',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 15,
                    fontWeight: 600
                  }}
                >
                  ▶️ Play Full Movie ({doneVideos.length} clips)
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Generated Videos Grid */}
        {generatedVideos.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: 20 
            }}>
              <div style={{ fontWeight: 600, fontSize: 20 }}>
                🎥 Generated Clips
              </div>
              {doneVideos.length > 0 && (
                <span style={{ color: '#4ade80', fontSize: 14 }}>
                  {doneVideos.length} of {generatedVideos.length} complete
                  {failedCount > 0 && ` • ${failedCount} failed`}
                </span>
              )}
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: 20
            }}>
              {generatedVideos.map((video, idx) => {
                const scene = scenes.find(s => s.id === video.sceneId)
                return (
                  <div key={video.sceneId} style={{
                    background: '#111',
                    borderRadius: 12,
                    overflow: 'hidden',
                    border: '1px solid #222'
                  }}>
                    <div style={{ 
                      height: 190, 
                      background: '#000',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {video.status === 'done' && video.url ? (
                        <video 
                          src={video.url} 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          muted
                          loop
                          onMouseEnter={e => e.target.play()}
                          onMouseLeave={e => { e.target.pause(); e.target.currentTime = 0 }}
                        />
                      ) : video.status === 'failed' ? (
                        <div style={{ textAlign: 'center', color: '#ef4444' }}>
                          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
                          <div style={{ fontSize: 13 }}>Generation Failed</div>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', color: '#666' }}>
                          <div style={{ fontSize: 32, marginBottom: 8 }}>
                            {video.status === 'generating' || video.status === 'polling' ? '⏳' : '🎬'}
                          </div>
                          <div style={{ fontSize: 13 }}>
                            {video.status === 'generating' && 'Generating...'}
                            {video.status === 'polling' && `${video.progress || 0}%`}
                            {video.status === 'pending' && 'Waiting...'}
                          </div>
                        </div>
                      )}

                      {video.status === 'polling' && (
                        <div style={{
                          position: 'absolute',
                          bottom: 10,
                          left: 10,
                          right: 10,
                          height: 4,
                          background: '#333',
                          borderRadius: 2,
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${video.progress || 0}%`,
                            background: '#ff6b6b',
                            transition: 'width 0.3s'
                          }} />
                        </div>
                      )}
                    </div>

                    <div style={{ padding: 16 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                        {scene?.heading || `Scene ${idx + 1}`}
                      </div>
                      <div style={{ 
                        fontSize: 12, 
                        color: video.status === 'done' ? '#4ade80' : 
                               video.status === 'failed' ? '#ef4444' : '#888'
                      }}>
                        {video.status === 'done' && '✓ Ready'}
                        {video.status === 'failed' && `✕ ${video.error || 'Failed'}`}
                        {video.status === 'generating' && 'Generating with Grok Imagine...'}
                        {video.status === 'polling' && 'Processing video...'}
                        {video.status === 'pending' && 'Queued'}
                      </div>

                      {video.status === 'done' && video.url && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                          <button 
                            onClick={() => {
                              const doneVideos = generatedVideos.filter(v => v.status === 'done' && v.url)
                              const idxInDone = doneVideos.findIndex(v => v.sceneId === video.sceneId)
                              setCurrentPlayingIndex(idxInDone)
                            }}
                            style={{
                              flex: 1,
                              padding: '10px 14px',
                              background: '#222',
                              border: 'none',
                              color: '#fff',
                              borderRadius: 6,
                              cursor: 'pointer',
                              fontSize: 13
                            }}
                          >
                            ▶️ Play
                          </button>
                          <button 
                            onClick={() => downloadClip(video.url, scene?.heading || 'clip')}
                            style={{
                              flex: 1,
                              padding: '10px 14px',
                              background: '#222',
                              border: 'none',
                              color: '#fff',
                              borderRadius: 6,
                              cursor: 'pointer',
                              fontSize: 13
                            }}
                          >
                            ⬇️ Download
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Movie Player Modal */}
        {currentPlayingIndex >= 0 && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20
          }}>
            <div style={{ 
              maxWidth: 1000, 
              width: '100%',
              position: 'relative'
            }}>
              <button 
                onClick={closePlayer}
                style={{
                  position: 'absolute',
                  top: -50,
                  right: 0,
                  background: 'none',
                  border: 'none',
                  color: '#fff',
                  fontSize: 32,
                  cursor: 'pointer',
                  opacity: 0.7
                }}
              >
                ×
              </button>

              <div style={{ 
                background: '#000', 
                borderRadius: 12, 
                overflow: 'hidden',
                boxShadow: '0 0 80px rgba(255, 26, 26, 0.3)'
              }}>
                <div style={{ 
                  padding: '12px 20px', 
                  background: '#111', 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid #222'
                }}>
                  <div>
                    <div style={{ color: '#ff6b6b', fontSize: 12, fontWeight: 600 }}>NOW PLAYING</div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>
                      {generatedVideos.filter(v => v.status === 'done' && v.url)[currentPlayingIndex]?.heading}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: '#888' }}>
                    Clip {currentPlayingIndex + 1} of {doneVideos.length}
                  </div>
                </div>

                <video 
                  ref={videoRef}
                  controls 
                  autoPlay 
                  style={{ 
                    width: '100%', 
                    maxHeight: '70vh',
                    background: '#000'
                  }}
                />

                <div style={{ 
                  padding: 16, 
                  display: 'flex', 
                  gap: 12,
                  background: '#111'
                }}>
                  <button 
                    onClick={playPrev}
                    disabled={currentPlayingIndex <= 0}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: '#222',
                      border: 'none',
                      color: currentPlayingIndex <= 0 ? '#555' : '#fff',
                      borderRadius: 8,
                      cursor: currentPlayingIndex <= 0 ? 'not-allowed' : 'pointer'
                    }}
                  >
                    ← Previous
                  </button>
                  <button 
                    onClick={playNext}
                    disabled={currentPlayingIndex >= doneVideos.length - 1}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: '#222',
                      border: 'none',
                      color: currentPlayingIndex >= doneVideos.length - 1 ? '#555' : '#fff',
                      borderRadius: 8,
                      cursor: currentPlayingIndex >= doneVideos.length - 1 ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Next →
                  </button>
                  <button 
                    onClick={closePlayer}
                    style={{
                      padding: '12px 24px',
                      background: '#333',
                      border: 'none',
                      color: '#fff',
                      borderRadius: 8,
                      cursor: 'pointer'
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div style={{ 
                textAlign: 'center', 
                marginTop: 16, 
                color: '#666', 
                fontSize: 13 
              }}>
                Videos play sequentially • Press ESC to close
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

