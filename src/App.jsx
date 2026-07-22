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
  const [openComments, setOpenComments] = useState({}) // 댓글 열림/닫힘 상태
  
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
      setError('이름과 내용을 모두 입력해 주세요.')
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
    if (!window.confirm('이 포스트잇을 삭제하시겠습니까?')) return

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
        alert('게시글 삭제에 실패했습니다. (새로고침 후 시도해보세요)')
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

  const toggleCommentAccordion = (id) => {
    setOpenComments((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleAddComment = async (messageId) => {
    const cName = commentNames[messageId]?.trim() || ''
    const cContent = commentContents[messageId]?.trim() || ''

    if (!cName || !cContent) {
      alert('닉네임과 댓글 내용을 작성해 주세요.')
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
      {/* 1. 상단 헤더 영역 */}
      <header className="main-header">
        <div className="header-title">
          <span className="badge">💌 MINI GUESTBOOK</span>
          <h1>한 줄 방명록 보드</h1>
          <p className="subtitle">소중한 의견과 인사를 자유롭게 포스트잇으로 남겨주세요.</p>
        </div>
        <button className="theme-toggle-btn" onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? '☀️ 라이트 모드' : '🌙 다크 모드'}
        </button>
      </header>

      {/* 2. 대시보드 통계 카드 */}
      <section className="stats-container">
        <div className="stat-card">
          <span className="stat-label">📌 전체 방명록</span>
          <span className="stat-value">{stats.total_messages}개</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">✨ 오늘 등록된 글</span>
          <span className="stat-value">{stats.messages_today}개</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">💬 누적 댓글</span>
          <span className="stat-value">{stats.total_comments}개</span>
        </div>
      </section>

      {/* 3. 새 포스트잇 작성 영역 (접기/펼치기) */}
      <section className="composer-wrapper">
        <button 
          className={`composer-toggle-bar ${showComposer ? 'active' : ''}`}
          onClick={() => setShowComposer(!showComposer)}
        >
          <span>✍️ 새 포스트잇 작성하기</span>
          <span className="arrow-icon">{showComposer ? '▲' : '▼'}</span>
        </button>

        {showComposer && (
          <form onSubmit={handleSubmit} className="composer-form">
            <div className="form-row">
              <input 
                className="input-field"
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                placeholder="작성자 닉네임" 
                maxLength={50} 
              />
              <div className="theme-selector">
                <label>색상 선택:</label>
                <div className="color-options">
                  {CARD_THEMES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={`color-btn ${theme === t.value ? 'selected' : ''}`}
                      style={{ backgroundColor: t.value }}
                      onClick={() => setTheme(t.value)}
                      title={t.label}
                    />
                  ))}
                </div>
              </div>
            </div>
            <textarea
              className="textarea-field"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="따뜻한 한마디를 남겨주세요 (최대 500자, 부적절한 언어는 자동으로 필터링됩니다)"
              maxLength={500}
            />
            {error && <p className="error-text">⚠️ {error}</p>}
            <button type="submit" className="primary-submit-btn">보드에 부착하기 📌</button>
          </form>
        )}
      </section>

      {/* 4. 검색 & 정렬 툴바 */}
      <section className="toolbar-container">
        <form className="search-box" onSubmit={handleSearchSubmit}>
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="이름 또는 내용 검색..."
          />
          <button type="submit" className="search-action-btn">검색</button>
        </form>

        <div className="sort-dropdown">
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
            <option value="latest">⏰ 최신순 보기</option>
            <option value="likes">🔥 인기순 보기</option>
          </select>
        </div>
      </section>

      {/* 5. 방명록 포스트잇 카드 그리드 */}
      <main className="grid-layout">
        {visibleMessages.map((msg) => {
          const isCmtOpen = Boolean(openComments[msg.id])

          return (
            <article key={msg.id} className="post-card" style={{ '--card-bg': msg.theme }}>
              {/* 카드 상단: 작성자 및 삭제 버튼 */}
              <div className="card-header">
                <div className="author-info">
                  <span className="author-avatar">👤</span>
                  <span className="author-name">{msg.name}</span>
                </div>
                <div className="header-right">
                  <span className="time-stamp">{formatRelativeTime(msg.createdAt)}</span>
                  {/* UX 개선된 SVG 삭제 버튼 */}
                  <button 
                    className="delete-icon-btn" 
                    onClick={() => handleDeleteMessage(msg.id)}
                    title="이 포스트잇 삭제하기"
                    aria-label="삭제"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    <span>삭제</span>
                  </button>
                </div>
              </div>

              {/* 카드 본문 */}
              <div className="card-body">
                <p className="card-content">{msg.content}</p>
              </div>

              {/* 카드 액션 바 */}
              <div className="card-actions">
                <button 
                  className={`like-btn ${msg.likedByMe ? 'liked' : ''}`} 
                  onClick={() => handleToggleLike(msg.id)}
                >
                  <span className="heart-icon">{msg.likedByMe ? '❤️' : '🤍'}</span>
                  <span className="like-count">{msg.likes}</span>
                </button>

                <button 
                  className="comment-toggle-btn" 
                  onClick={() => toggleCommentAccordion(msg.id)}
                >
                  💬 댓글 <strong>{msg.commentCount}</strong>개 {isCmtOpen ? '▲' : '▼'}
                </button>
              </div>

              {/* 댓글 접기/펼치기 아코디언 */}
              {isCmtOpen && (
                <div className="comment-accordion">
                  {msg.comments && msg.comments.length > 0 && (
                    <ul className="comment-list">
                      {msg.comments.map((cmt) => (
                        <li key={cmt.id} className="comment-item">
                          <div className="cmt-header">
                            <span className="cmt-user">@{cmt.name}</span>
                            <span className="cmt-date">{formatRelativeTime(cmt.createdAt)}</span>
                          </div>
                          <p className="cmt-body">{cmt.content}</p>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="comment-input-group">
                    <input
                      className="cmt-name-input"
                      value={commentNames[msg.id] || ''}
                      onChange={(e) => setCommentNames({ ...commentNames, [msg.id]: e.target.value })}
                      placeholder="닉네임"
                      maxLength={30}
                    />
                    <input
                      className="cmt-text-input"
                      value={commentContents[msg.id] || ''}
                      onChange={(e) => setCommentContents({ ...commentContents, [msg.id]: e.target.value })}
                      placeholder="댓글을 남겨보세요..."
                      maxLength={200}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAddComment(msg.id)
                        }
                      }}
                    />
                    <button className="cmt-send-btn" onClick={() => handleAddComment(msg.id)}>작성</button>
                  </div>
                </div>
              )}
            </article>
          )
        })}

        {loading && <div className="status-indicator">🔄 방명록 동기화 중...</div>}
        {!loading && visibleMessages.length === 0 && (
          <div className="status-indicator empty">등록된 방명록이 없습니다. 첫 번째 포스트잇을 적어보세요!</div>
        )}
        <div ref={sentinelRef} className="scroll-sentinel" />
      </main>
    </div>
  )
}

export default App