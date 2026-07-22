import { useEffect, useRef, useState, useCallback } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const CARD_THEMES = [
  { value: '#fef08a', label: '노랑' },
  { value: '#bfdbfe', label: '파랑' },
  { value: '#fbcfe8', label: '분홍' },
  { value: '#bbf7d0', label: '초록' },
  { value: '#e9d5ff', label: '보라' },
]

const formatRelativeTime = (timestamp) => {
  if (!timestamp) return '방금 전'
  const diff = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
  if (diff < 60) return '방금 전'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return new Date(timestamp).toLocaleDateString('ko-KR')
}

function App() {
  const [messages, setMessages] = useState([])
  const [stats, setStats] = useState({ total_messages: 0, messages_today: 0, total_comments: 0 })
  
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [theme, setTheme] = useState('#fef08a')
  
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState('latest')
  
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  
  const [commentNames, setCommentNames] = useState({})
  const [commentContents, setCommentContents] = useState({})
  
  const [error, setError] = useState('')
  const [darkMode, setDarkMode] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  
  const sentinelRef = useRef(null)
  const LIMIT = 6

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    fetchStats()
  }, [])

  // 1. 통계 안전 파싱 로직
  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_URL}/stats`)
      const text = await res.text()
      if (res.ok && text) {
        const data = JSON.parse(text)
        setStats(data)
      }
    } catch (err) {
      console.error('통계 로드 실패', err)
    }
  }

  // 2. 메시지 로드 안전 파싱 로직
  const fetchMessages = useCallback(async (currentOffset, isReset = false) => {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch(
        `${API_URL}/messages?search=${encodeURIComponent(search)}&sort=${sortMode}&limit=${LIMIT}&offset=${currentOffset}`
      )
      const text = await res.text()
      if (res.ok && text) {
        const data = JSON.parse(text)
        if (data.length < LIMIT) setHasMore(false)
        
        setMessages((prev) => (isReset ? data : [...prev, ...data]))
        setOffset(currentOffset + data.length)
      }
    } catch (err) {
      console.error('방명록 로드 실패', err)
    } finally {
      setLoading(false)
    }
  }, [search, sortMode])

  useEffect(() => {
    setHasMore(true)
    setOffset(0)
    fetchMessages(0, true)
  }, [search, sortMode])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          fetchMessages(offset)
        }
      },
      { rootMargin: '120px' }
    )
    const node = sentinelRef.current
    if (node) observer.observe(node)
    return () => observer.disconnect()
  }, [offset, hasMore, loading, fetchMessages])

  // 3. 새 글 작성 안전 파싱 로직 (에러 캐치 보완)
  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!name.trim() || !content.trim()) {
      setError('이름과 내용을 입력해주세요.')
      return
    }
    setError('')

    try {
      const res = await fetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, theme }),
      })
      
      const text = await res.text()
      const resData = text ? JSON.parse(text) : {}

      if (!res.ok) throw new Error(resData.error || '글 작성 실패')

      if (sortMode === 'latest') {
        setMessages((prev) => [resData, ...prev])
      }
      setName('')
      setContent('')
      setShowComposer(false)
      fetchStats()
    } catch (err) {
      setError(err.message)
    }
  }

  // 4. 좋아요 안전 파싱 로직 (빈 본문 터지는 현상 방어 완료)
  const toggleLike = async (messageId) => {
    try {
      const res = await fetch(`${API_URL}/messages/${messageId}/like`, { method: 'PATCH' })
      const text = await res.text()
      
      if (!res.ok) {
        const resData = text ? JSON.parse(text) : {}
        alert(resData.error || '좋아요 실패')
        return
      }

      if (text) {
        const updated = JSON.parse(text)
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, likes: updated.likes ?? (m.likes + 1) } : m))
        )
        fetchStats()
      }
    } catch (err) {
      console.error(err)
    }
  }

  // 5. 댓글 작성 안전 파싱 로직
  const handleAddComment = async (messageId) => {
    const cName = commentNames[messageId]?.trim() || ''
    const cContent = commentContents[messageId]?.trim() || ''

    if (!cName || !cContent) {
      alert('닉네임과 댓글 내용을 모두 입력해주세요.')
      return
    }

    try {
      const res = await fetch(`${API_URL}/messages/${messageId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cName, content: cContent }),
      })
      
      const text = await res.text()
      const resData = text ? JSON.parse(text) : {}

      if (!res.ok) {
        alert(resData.error || '댓글 작성 실패')
        return
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                commentCount: (m.commentCount || 0) + 1,
                comments: [...(m.comments || []), resData],
              }
            : m
        )
      )
      
      setCommentNames((prev) => ({ ...prev, [messageId]: '' }))
      setCommentContents((prev) => ({ ...prev, [messageId]: '' }))
      fetchStats()
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="app-container">
      <header className="main-header">
        <div>
          <span className="badge">GUESTBOOK</span>
          <h1>스퀘어 타입의 미니멀 보드</h1>
          <p className="subtitle">DB 제약 조건 필터링 시스템이 적용된 안전하고 트렌디한 공간입니다.</p>
        </div>
        <button className="theme-btn" onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? '☀️ Light' : '🌙 Dark'}
        </button>
      </header>

      <section className="stats-container">
        <div className="stat-box">
          <span className="stat-val">{stats.total_messages || 0}</span>
          <span className="stat-lbl">누적 방명록</span>
        </div>
        <div className="stat-box">
          <span className="stat-val">{stats.messages_today || 0}</span>
          <span className="stat-lbl">오늘 올라온 글</span>
        </div>
        <div className="stat-box">
          <span className="stat-val">{stats.total_comments || 0}</span>
          <span className="stat-lbl">누적 댓글 수</span>
        </div>
      </section>

      <section className="composer-box">
        <div className="composer-trigger">
          <strong>보드에 새로운 글 남기기</strong>
          <button className="toggle-btn" onClick={() => setShowComposer(!showComposer)}>
            {showComposer ? '접기' : '펼치기'}
          </button>
        </div>

        {showComposer && (
          <form onSubmit={handleSubmit} className="composer-form">
            <div className="input-group">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (최대 50자)" maxLength={50} />
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                {CARD_THEMES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label} 테마색</option>
                ))}
              </select>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="전하고 싶은 메시지를 입력하세요 (최대 500자, 비속어 금지)"
              maxLength={500}
            />
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" className="submit-btn">부착하기</button>
          </form>
        )}
      </section>

      <section className="filter-toolbar">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="작성자 또는 본문 검색..." />
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
          <option value="latest">최신순</option>
          <option value="likes">인기순</option>
        </select>
      </section>

      <main className="grid-layout">
        {messages.map((msg) => (
          <article key={msg.id} className="post-card" style={{ '--card-bg': msg.theme }}>
            <div className="card-header">
              <span className="author-name">{msg.name}</span>
              <span className="time-stamp">{formatRelativeTime(msg.createdAt)}</span>
            </div>

            <div className="card-main">
              <p className="card-content">{msg.content}</p>
            </div>

            <div className="card-footer">
              <button className="like-action" onClick={() => toggleLike(msg.id)}>
                ❤️ <span>{msg.likes}</span>
              </button>
              <span className="comment-count-tag">💬 {msg.commentCount || 0}</span>
            </div>

            <div className="comment-section">
              {msg.comments && msg.comments.length > 0 && (
                <ul className="comment-flow">
                  {msg.comments.map((cmt) => (
                    <li key={cmt.id} className="comment-bubble">
                      <div className="comment-meta">
                        <strong className="cmt-user">{cmt.name}</strong>
                        <span className="cmt-time">{formatRelativeTime(cmt.createdAt)}</span>
                      </div>
                      <p className="cmt-text">{cmt.content}</p>
                    </li>
                  ))}
                </ul>
              )}
              
              <div className="comment-form-row">
                <input
                  className="c-name-input"
                  value={commentNames[msg.id] || ''}
                  onChange={(e) => setCommentNames({ ...commentNames, [msg.id]: e.target.value })}
                  placeholder="닉네임"
                  maxLength={50}
                />
                <input
                  className="c-content-input"
                  value={commentContents[msg.id] || ''}
                  onChange={(e) => setCommentContents({ ...commentContents, [msg.id]: e.target.value })}
                  placeholder="댓글 입력..."
                  maxLength={300}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddComment(msg.id)
                    }
                  }}
                />
                <button className="c-submit-btn" onClick={() => handleAddComment(msg.id)}>적용</button>
              </div>
            </div>
          </article>
        ))}

        {loading && <div className="status-indicator">콘텐츠 동기화 중...</div>}
        {!loading && messages.length === 0 && <div className="status-indicator">검색되거나 등록된 보드가 비어있습니다.</div>}
        <div ref={sentinelRef} className="scroll-sentinel" />
      </main>
    </div>
  )
}

export default App