import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const STORAGE_KEY = 'guestbook-messages-v4'
const STATS_KEY = 'guestbook-stats-v4'

const CARD_THEMES = [
  { value: '#fff9c4', label: '노랑', bgClass: 'theme-yellow' },
  { value: '#e3f2fd', label: '파랑', bgClass: 'theme-blue' },
  { value: '#fce4ec', label: '분홍', bgClass: 'theme-pink' },
  { value: '#e8f5e9', label: '초록', bgClass: 'theme-green' },
  { value: '#f3e5f5', label: '보라', bgClass: 'theme-purple' },
]

const normalizeMessage = (msg, index) => ({
  id: msg.id ?? `local-${index}-${Date.now()}`,
  name: msg.name ?? '익명',
  content: msg.content ?? '',
  likes: Number(msg.likes ?? 0),
  likedByMe: Boolean(msg.likedByMe),
  theme: msg.theme ?? '#fff9c4',
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
  const [theme, setTheme] = useState('#fff9c4')
  
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState('latest')
  
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  
  const [commentNames, setCommentNames] = useState({})
  const [commentContents, setCommentContents] = useState({})
  const [expandedComments, setExpandedComments] = useState({})
  
  const [error, setError] = useState('')
  const [darkMode, setDarkMode] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  
  const sentinelRef = useRef(null)
  const LIMIT = 6

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

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
        // ignore
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

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!name.trim() || !content.trim()) {
      setError('이름과 내용을 입력해주세요.')
      return
    }
    setError('')

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

  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm('이 방명록을 삭제하시겠습니까?')) return

    const backupMessages = [...messages]
    
    setMessages((prev) => {
      const updated = prev.filter((m) => m.id !== messageId)
      persistMessages(updated)
      return updated
    })

    try {
      const res = await fetch(`${API_URL}/messages/${messageId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        setMessages(backupMessages)
        alert('게시글 삭제에 실패했습니다.')
      } else {
        fetchStats()
      }
    } catch (err) {
      setMessages(backupMessages)
      alert('네트워크 오류로 삭제하지 못했습니다.')
    }
  }

  const handleToggleLike = async (messageId) => {
    const target = messages.find((m) => m.id === messageId)
    if (!target) return

    const isCancel = target.likedByMe
    const nextLikes = isCancel ? Math.max(0, target.likes - 1) : target.likes + 1

    const backupMessages = [...messages]

    setMessages((prev) => {
      const updated = prev.map((m) =>
        m.id === messageId ? { ...m, likes: nextLikes, likedByMe: !isCancel } : m
      )
      persistMessages(updated)
      return updated
    })

    try {
      const endpoint = `${API_URL}/messages/${messageId}/like`
      const method = isCancel ? 'DELETE' : 'PATCH'

      const res = await fetch(endpoint, { method })
      const text = await res.text()

      if (res.ok && text.trim()) {
        const data = JSON.parse(text)
        setMessages((prev) => {
          const sync = prev.map((m) =>
            m.id === messageId ? { ...m, likes: Number(data.likes ?? m.likes) } : m
          )
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

  const toggleComments = (id) => {
    setExpandedComments((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleAddComment = async (messageId) => {
    const cName = commentNames[messageId]?.trim() || ''
    const cContent = commentContents[messageId]?.trim() || ''

    if (!cName || !cContent) {
      alert('닉네임과 댓글 내용을 작성해주세요.')
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

  const visibleMessages = useMemo(() => [...messages], [messages])

  return (
    <div className="app-container">
      {/* 대시보드 헤더 */}
      <header className="main-header">
        <div className="header-left">
          <span className="badge">💌 GUESTBOOK DASHBOARD</span>
          <h1>방명록 대시보드</h1>
          <p className="subtitle">자유롭게 메시지를 남기고 사람들과 이야기를 나눠보세요.</p>
        </div>
        <button className="theme-toggle-btn" onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? '☀️ Light' : '🌙 Dark'}
        </button>
      </header>

      {/* 모던 대시보드 통계 카드 */}
      <section className="stats-container">
        <div className="stat-card">
          <div className="stat-icon purple">📌</div>
          <div className="stat-info">
            <span className="stat-val">{stats.total_messages}</span>
            <span className="stat-lbl">누적 방명록</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange">✨</div>
          <div className="stat-info">
            <span className="stat-val">{stats.messages_today}</span>
            <span className="stat-lbl">오늘 올라온 글</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue">💬</div>
          <div className="stat-info">
            <span className="stat-val">{stats.total_comments}</span>
            <span className="stat-lbl">누적 댓글 수</span>
          </div>
        </div>
      </section>

      {/* 작성기 컴포넌트 */}
      <section className="composer-card">
        <div className="composer-header">
          <div className="composer-title">
            <span className="icon">✍️</span>
            <strong>새 방명록 남기기</strong>
          </div>
          <button className="toggle-btn" onClick={() => setShowComposer(!showComposer)}>
            {showComposer ? '접기' : '작성하기'}
          </button>
        </div>

        {showComposer && (
          <form onSubmit={handleSubmit} className="composer-form">
            <div className="form-row">
              <input
                className="modern-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="작성자 닉네임"
                maxLength={50}
              />
              <div className="color-palette">
                <span className="palette-label">테마 색상</span>
                <div className="color-chips">
                  {CARD_THEMES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={`color-chip ${theme === t.value ? 'active' : ''}`}
                      style={{ backgroundColor: t.value }}
                      onClick={() => setTheme(t.value)}
                      title={t.label}
                    />
                  ))}
                </div>
              </div>
            </div>

            <textarea
              className="modern-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="내용을 채워주세요 (최대 500자, 욕설 및 비속어는 자동으로 필터링됩니다.)"
              maxLength={500}
            />

            {error && <p className="error-msg">⚠️ {error}</p>}

            <button type="submit" className="submit-action-btn">
              보드에 등록하기
            </button>
          </form>
        )}
      </section>

      {/* 검색 & 필터 바 */}
      <section className="toolbar">
        <form className="search-form" onSubmit={handleSearchSubmit}>
          <span className="search-icon">🔍</span>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="이름 또는 키워드로 검색..."
          />
          <button type="submit" className="search-btn">검색</button>
        </form>

        <select className="sort-select" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
          <option value="latest">⏰ 최신순</option>
          <option value="likes">🔥 인기순</option>
        </select>
      </section>

      {/* 방명록 카드 그리드 */}
      <main className="grid-layout">
        {visibleMessages.map((msg) => {
          const isExpanded = Boolean(expandedComments[msg.id])

          return (
            <article key={msg.id} className="post-card" style={{ '--card-bg': msg.theme }}>
              {/* 헤더 */}
              <div className="card-header">
                <div className="user-profile">
                  <div className="avatar">👤</div>
                  <span className="author-name">{msg.name}</span>
                </div>
                
                <div className="header-meta">
                  <span className="time-stamp">{formatRelativeTime(msg.createdAt)}</span>
                  {/* 깔끔한 SVG 삭제 버튼 */}
                  <button
                    className="delete-btn"
                    onClick={() => handleDeleteMessage(msg.id)}
                    title="방명록 삭제"
                    aria-label="삭제"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18"></path>
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>

              {/* 본문 */}
              <div className="card-main">
                <p className="card-content">{msg.content}</p>
              </div>

              {/* 푸터 액션 */}
              <div className="card-footer">
                <button
                  className={`like-pill ${msg.likedByMe ? 'liked' : ''}`}
                  onClick={() => handleToggleLike(msg.id)}
                >
                  <span className="heart">{msg.likedByMe ? '❤️' : '🤍'}</span>
                  <span className="count">{msg.likes}</span>
                </button>

                <button className="cmt-toggle-btn" onClick={() => toggleComments(msg.id)}>
                  💬 댓글 <strong>{msg.commentCount}</strong> {isExpanded ? '▲' : '▼'}
                </button>
              </div>

              {/* 댓글 아코디언 */}
              {isExpanded && (
                <div className="comment-drawer">
                  {msg.comments && msg.comments.length > 0 && (
                    <ul className="comment-list">
                      {msg.comments.map((cmt) => (
                        <li key={cmt.id} className="comment-bubble">
                          <div className="cmt-meta">
                            <span className="cmt-user">@{cmt.name}</span>
                            <span className="cmt-time">{formatRelativeTime(cmt.createdAt)}</span>
                          </div>
                          <p className="cmt-text">{cmt.content}</p>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="comment-form-row">
                    <input
                      className="c-input name"
                      value={commentNames[msg.id] || ''}
                      onChange={(e) => setCommentNames({ ...commentNames, [msg.id]: e.target.value })}
                      placeholder="닉네임"
                      maxLength={30}
                    />
                    <input
                      className="c-input text"
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
                    <button className="c-send-btn" onClick={() => handleAddComment(msg.id)}>
                      등록
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}

        {loading && <div className="status-indicator">⚡ 데이터를 새로고침하고 있습니다...</div>}
        {!loading && visibleMessages.length === 0 && (
          <div className="status-indicator">검색된 방명록이 없습니다. 첫 포스트잇을 남겨보세요!</div>
        )}
        <div ref={sentinelRef} className="scroll-sentinel" />
      </main>
    </div>
  )
}

export default App