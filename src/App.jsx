
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const STORAGE_KEY = 'guestbook-messages-v4'
const STATS_KEY = 'guestbook-stats-v4'

const CARD_THEMES = [
  { value: '#fef08a', label: '노랑' },
  { value: '#bfdbfe', label: '파랑' },
  { value: '#fbcfe8', label: '분홍' },
  { value: '#bbf7d0', label: '초록' },
  { value: '#e9d5ff', label: '보라' },
]

// 백엔드 응답 규격 데이터 방어 정규화 함수
const normalizeMessage = (msg, index) => ({
  id: msg.id ?? `local-${index}-${Date.now()}`,
  name: msg.name ?? '익명',
  content: msg.content ?? '',
  likes: Number(msg.likes ?? 0),
  likedByMe: Boolean(msg.likedByMe),
  theme: msg.theme ?? '#fef08a',
  createdAt: msg.createdAt ?? new Date().toISOString(),
  comments: Array.isArray(msg.comments)
    ? msg.comments.map((c, cIdx) => ({
        id: c.id ?? `cmt-${index}-${cIdx}-${Date.now()}`,
        name: c.name ?? '익명',
        content: c.content ?? '',
        createdAt: c.createdAt ?? new Date().toISOString(),
      }))
    : [],
  commentCount: Number(msg.commentCount ?? (Array.isArray(msg.comments) ? msg.comments.length : 0)),
})

const buildStats = (messageList) => ({
  total_messages: messageList.length,
  messages_today: messageList.filter((m) => {
    const diff = Date.now() - new Date(m.createdAt).getTime()
    return diff < 1000 * 60 * 60 * 24
  }).length,
  total_comments: messageList.reduce((sum, m) => sum + (m.comments?.length || 0), 0),
})

const persistMessages = (messageList) => {
  const normalized = messageList.map((msg, index) => normalizeMessage(msg, index))
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  const nextStats = buildStats(normalized)
  window.localStorage.setItem(STATS_KEY, JSON.stringify(nextStats))
  return { normalized, nextStats }
}

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
  
  const [searchInput, setSearchInput] = useState('')
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

  // 초기 로컬 스토리지 데이터 마이그레이션 백업 로드
  useEffect(() => {
    const storedMessages = window.localStorage.getItem(STORAGE_KEY)
    const storedStats = window.localStorage.getItem(STATS_KEY)

    if (storedMessages) {
      try {
        const parsed = JSON.parse(storedMessages)
        const normalized = Array.isArray(parsed) ? parsed.map((m, i) => normalizeMessage(m, i)) : []
        setMessages(normalized)
        if (storedStats) setStats(JSON.parse(storedStats))
      } catch {
        // 파싱 에러 방어
      }
    }
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_URL}/stats`)
      const text = await res.text()
      if (res.ok && text.trim()) {
        const data = JSON.parse(text)
        setStats({
          total_messages: Number(data.total_messages ?? 0),
          messages_today: Number(data.messages_today ?? 0),
          total_comments: Number(data.total_comments ?? 0)
        })
      }
    } catch (err) {
      console.error('통계 데이터 연동 실패', err)
    }
  }

  const fetchMessages = useCallback(async (currentOffset, isReset = false) => {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch(
        `${API_URL}/messages?search=${encodeURIComponent(search)}&sort=${sortMode}&limit=${LIMIT}&offset=${currentOffset}`
      )
      const text = await res.text()
      if (res.ok && text.trim()) {
        const data = JSON.parse(text)
        const normalized = Array.isArray(data) ? data.map((m, i) => normalizeMessage(m, i)) : []
        
        if (normalized.length < LIMIT) {
          setHasMore(false)
        }

        setMessages((prev) => {
          const next = isReset ? normalized : [...prev, ...normalized]
          persistMessages(next)
          return next
        })
        setOffset(currentOffset + normalized.length)
      }
    } catch (err) {
      console.error('서버 데이터 로드 실패', err)
    } finally {
      setLoading(false)
    }
  }, [search, sortMode, loading])

  useEffect(() => {
    setHasMore(true)
    setOffset(0)
    fetchMessages(0, true)
  }, [search, sortMode])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          fetchMessages(offset, false)
        }
      },
      { rootMargin: '100px' }
    )
    const node = sentinelRef.current
    if (node) observer.observe(node)
    return () => observer.disconnect()
  }, [offset, hasMore, loading, fetchMessages])

  const handleSearchSubmit = (event) => {
    event.preventDefault()
    setSearch(searchInput.trim())
  }

  // 방명록 포스트 작성 처리
  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!name.trim() || !content.trim()) {
      setError('이름과 내용을 입력해주세요.')
      return
    }
    setError('')

    // 낙관적 업데이트 인스턴스 생성
    const optimisticMessage = normalizeMessage({
      id: `temp-${Date.now()}`,
      name: name.trim(),
      content: content.trim(),
      theme,
      likes: 0,
      createdAt: new Date().toISOString(),
      comments: [],
      commentCount: 0
    }, 0)

    const backupMessages = [...messages]
    setMessages((prev) => [optimisticMessage, ...prev])

    setName('')
    setContent('')
    setShowComposer(false)

    try {
      const res = await fetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: optimisticMessage.name, content: optimisticMessage.content, theme }),
      })

      const text = await res.text()
      if (res.ok && text.trim()) {
        const savedData = JSON.parse(text)
        const serverMessage = normalizeMessage(savedData, 0)
        
        setMessages((prev) => {
          const updated = prev.map((m) => (m.id === optimisticMessage.id ? serverMessage : m))
          persistMessages(updated)
          return updated
        })
      } else {
        setMessages(backupMessages)
        setError('서버 등록에 실패했습니다.')
      }
      fetchStats()
    } catch (err) {
      setMessages(backupMessages)
      setError('네트워크 오류가 발생했습니다.')
      setShowComposer(true)
    }
  }

  // 좋아요 요청 처리 (중복 클릭 방어 포함)
  const handleLike = async (messageId) => {
    const target = messages.find((m) => m.id === messageId)
    if (!target || target.likedByMe) return // 백엔드가 누적 증가만 지원하므로 프론트에서 중복클릭 락 처리

    const backupMessages = [...messages]
    setMessages((prev) => {
      const updated = prev.map((m) =>
        m.id === messageId ? { ...m, likes: m.likes + 1, likedByMe: true } : m
      )
      persistMessages(updated)
      return updated
    })

    try {
      const res = await fetch(`${API_URL}/messages/${messageId}/like`, { method: 'PATCH' })
      const text = await res.text()
      if (res.ok && text.trim()) {
        const data = JSON.parse(text) // { likes: X } 형태로 반환됨
        setMessages((prev) => {
          const sync = prev.map((m) => (m.id === messageId ? { ...m, likes: Number(data.likes ?? m.likes) } : m))
          persistMessages(sync)
          return sync
        })
      } else {
        setMessages(backupMessages)
      }
      fetchStats()
    } catch (err) {
      setMessages(backupMessages)
    }
  }

  // 댓글 추가 처리
  const handleAddComment = async (messageId) => {
    const cName = commentNames[messageId]?.trim() || ''
    const cContent = commentContents[messageId]?.trim() || ''

    if (!cName || !cContent) {
      alert('닉네임과 댓글 내용을 모두 작성해주세요.')
      return
    }

    const optimisticComment = {
      id: `temp-cmt-${Date.now()}`,
      name: cName,
      content: cContent,
      createdAt: new Date().toISOString()
    }

    const backupMessages = [...messages]
    setMessages((prev) => {
      const updated = prev.map((m) => {
        if (m.id !== messageId) return m
        return {
          ...m,
          commentCount: m.commentCount + 1,
          comments: [...m.comments, optimisticComment]
        }
      })
      persistMessages(updated)
      return updated
    })

    setCommentNames((prev) => ({ ...prev, [messageId]: '' }))
    setCommentContents((prev) => ({ ...prev, [messageId]: '' }))

    try {
      const res = await fetch(`${API_URL}/messages/${messageId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cName, content: cContent })
      })
      const text = await res.text()
      if (res.ok && text.trim()) {
        const savedCmt = JSON.parse(text)
        setMessages((prev) => {
          const sync = prev.map((m) => {
            if (m.id !== messageId) return m
            return {
              ...m,
              comments: m.comments.map((c) => (c.id === optimisticComment.id ? { ...c, ...savedCmt } : c))
            }
          })
          persistMessages(sync)
          return sync
        })
      } else {
        setMessages(backupMessages)
      }
      fetchStats()
    } catch (err) {
      setMessages(backupMessages)
    }
  }

  // 메모이제이션 필터 스케줄러 (무한스크롤 스냅샷 동기화)
  const visibleMessages = useMemo(() => {
    return [...messages]
  }, [messages])

  return (
    <div className="app-container">
      <header className="main-header">
        <div>
          <span className="badge">💌 GUESTBOOK</span>
          <h1>방명록</h1>
          <p className="subtitle">방명록을 자유롭게 남겨보세요.</p>
        </div>
        <button className="theme-btn" onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
        </button>
      </header>

      <section className="stats-container">
        <div className="stat-box">
          <span className="stat-val">📌 {stats.total_messages}</span>
          <span className="stat-lbl">누적 방명록</span>
        </div>
        <div className="stat-box">
          <span className="stat-val">✨ {stats.messages_today}</span>
          <span className="stat-lbl">오늘 올라온 글</span>
        </div>
        <div className="stat-box">
          <span className="stat-val">💬 {stats.total_comments}</span>
          <span className="stat-lbl">누적 댓글 수</span>
        </div>
      </section>

      <section className="composer-box">
        <div className="composer-trigger">
          <strong>✍️ 보드에 새로운 기록 남기기</strong>
          <button className="toggle-btn" onClick={() => setShowComposer(!showComposer)}>
            {showComposer ? '닫기' : '작성하기'}
          </button>
        </div>

        {showComposer && (
          <form onSubmit={handleSubmit} className="composer-form">
            <div className="input-group">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="작성자 이름" maxLength={50} />
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                {CARD_THEMES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label} 무드</option>
                ))}
              </select>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="내용을 채워주세요 (최대 500자, 욕설이나 비속어 입력 시 자동으로 필터링됩니다.)"
              maxLength={500}
            />
            {error && <p className="error-msg">⚠️ {error}</p>}
            <button type="submit" className="submit-btn">포스트잇 보드에 부착</button>
          </form>
        )}
      </section>

      <section className="filter-toolbar">
        <form className="search-form" onSubmit={handleSearchSubmit}>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="이름 또는 키워드로 검색 후 엔터..."
          />
          <button type="submit" className="search-btn">조회</button>
        </form>
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
          <option value="latest">⏰ 최신순</option>
          <option value="likes">🔥 인기순</option>
        </select>
      </section>

      <main className="grid-layout">
        {visibleMessages.map((msg) => (
          <article key={msg.id} className="post-card" style={{ '--card-bg': msg.theme }}>
            <div className="card-header">
              <span className="author-name">👤 {msg.name}</span>
              <span className="time-stamp">{formatRelativeTime(msg.createdAt)}</span>
            </div>

            <div className="card-main">
              <p className="card-content">{msg.content}</p>
            </div>

            <div className="card-footer">
              <button 
                className={`like-action ${msg.likedByMe ? 'liked' : ''}`} 
                onClick={() => handleLike(msg.id)}
                disabled={msg.likedByMe}
              >
                {msg.likedByMe ? '❤️' : '🤍'} <span>{msg.likes}</span>
              </button>
              <span className="comment-count-tag">💬 {msg.commentCount}</span>
            </div>

            <div className="comment-section">
              {msg.comments && msg.comments.length > 0 && (
                <ul className="comment-flow">
                  {msg.comments.map((cmt) => (
                    <li key={cmt.id} className="comment-bubble">
                      <div className="comment-meta">
                        <strong className="cmt-user">@{cmt.name}</strong>
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
                <button className="c-submit-btn" onClick={() => handleAddComment(msg.id)}>등록</button>
              </div>
            </div>
          </article>
        ))}

        {loading && <div className="status-indicator">🔋 보드 데이터를 동기화하고 있습니다...</div>}
        {!loading && visibleMessages.length === 0 && <div className="status-indicator">검색된 방명록이 없습니다. 첫 포스트잇을 남겨보세요!</div>}
        <div ref={sentinelRef} className="scroll-sentinel" />
      </main>
    </div>
  )
}

export default App