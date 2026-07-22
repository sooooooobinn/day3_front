import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const STORAGE_KEY = 'guestbook-messages-v5'
const STATS_KEY = 'guestbook-stats-v5'

const CARD_THEMES = [
  { value: '#ffb703', label: 'Yellow' },
  { value: '#2196f3', label: 'Blue' },
  { value: '#e91e63', label: 'Pink' },
  { value: '#4caf50', label: 'Green' },
  { value: '#9c27b0', label: 'Purple' },
]

const normalizeMessage = (msg, index) => ({
  id: msg.id ?? `local-${index}-${Date.now()}`,
  name: msg.name ?? '익명',
  content: msg.content ?? '',
  likes: Number(msg.likes ?? 0),
  likedByMe: Boolean(msg.likedByMe),
  theme: msg.theme ?? '#ffb703',
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
  const [theme, setTheme] = useState('#ffb703')
  
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
  const [showModal, setShowModal] = useState(false)
  
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
    setShowModal(false)

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
      setShowModal(true)
    }
  }

  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm('이 글을 삭제할까요?')) return

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
        alert('삭제 처리에 실패했습니다.')
      } else {
        fetchStats()
      }
    } catch (err) {
      setMessages(backupMessages)
      alert('네트워크 오류가 발생했습니다.')
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
    <div className="stream-app">
      {/* 상단 네비게이션 */}
      <nav className="top-nav">
        <div className="nav-brand">
          <span className="brand-dot"></span>
          <h1>방명록 피드</h1>
        </div>
        <button className="theme-btn" onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? '☀️ Light' : '🌙 Dark'}
        </button>
      </nav>

      <main className="feed-container">
        {/* 요약 통계 - 심플 인라인 */}
        <section className="summary-bar">
          <div className="stat-inline">
            <span className="num">{stats.total_messages}</span>
            <span className="lbl">전체 글</span>
          </div>
          <span className="divider">•</span>
          <div className="stat-inline">
            <span className="num">{stats.messages_today}</span>
            <span className="lbl">오늘 작성</span>
          </div>
          <span className="divider">•</span>
          <div className="stat-inline">
            <span className="num">{stats.total_comments}</span>
            <span className="lbl">댓글</span>
          </div>
        </section>

        {/* 심플 검색 & 필터 */}
        <section className="filter-row">
          <form className="minimal-search" onSubmit={handleSearchSubmit}>
            <svg className="s-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="피드에서 찾기..."
            />
          </form>

          <div className="sort-tabs">
            <button
              className={`tab-item ${sortMode === 'latest' ? 'active' : ''}`}
              onClick={() => setSortMode('latest')}
            >
              최신순
            </button>
            <button
              className={`tab-item ${sortMode === 'likes' ? 'active' : ''}`}
              onClick={() => setSortMode('likes')}
            >
              인기순
            </button>
          </div>
        </section>

        {/* 타임라인 피드 메인 */}
        <div className="timeline">
          {visibleMessages.map((msg) => {
            const isExpanded = Boolean(expandedComments[msg.id])

            return (
              <article key={msg.id} className="feed-item" style={{ '--accent-color': msg.theme }}>
                <div className="item-main">
                  {/* 피드 헤더 */}
                  <div className="item-header">
                    <div className="user-info">
                      <span className="user-avatar" style={{ backgroundColor: msg.theme }}></span>
                      <span className="user-name">{msg.name}</span>
                      <span className="bullet">•</span>
                      <span className="time-ago">{formatRelativeTime(msg.createdAt)}</span>
                    </div>

                    <button className="icon-del-btn" onClick={() => handleDeleteMessage(msg.id)} title="삭제">
                      ✕
                    </button>
                  </div>

                  {/* 피드 본문 */}
                  <div className="item-body">
                    <p>{msg.content}</p>
                  </div>

                  {/* 박스 없는 자연스러운 액션 바 */}
                  <div className="item-actions">
                    <button
                      className={`action-btn like ${msg.likedByMe ? 'active' : ''}`}
                      onClick={() => handleToggleLike(msg.id)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill={msg.likedByMe ? '#ef4444' : 'none'} stroke={msg.likedByMe ? '#ef4444' : 'currentColor'} strokeWidth="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.72-8.72 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                      </svg>
                      <span>{msg.likes}</span>
                    </button>

                    <button className="action-btn comment" onClick={() => toggleComments(msg.id)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                      </svg>
                      <span>{msg.commentCount}</span>
                    </button>
                  </div>

                  {/* 댓글 스레드 (박스 없는 인라인 스타일) */}
                  {isExpanded && (
                    <div className="inline-comments">
                      {msg.comments && msg.comments.length > 0 && (
                        <div className="cmt-stream">
                          {msg.comments.map((cmt) => (
                            <div key={cmt.id} className="cmt-item">
                              <span className="cmt-author">{cmt.name}</span>
                              <span className="cmt-body">{cmt.content}</span>
                              <span className="cmt-time">{formatRelativeTime(cmt.createdAt)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="cmt-input-row">
                        <input
                          className="sub-input name"
                          value={commentNames[msg.id] || ''}
                          onChange={(e) => setCommentNames({ ...commentNames, [msg.id]: e.target.value })}
                          placeholder="이름"
                          maxLength={20}
                        />
                        <input
                          className="sub-input text"
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
                        <button className="cmt-submit" onClick={() => handleAddComment(msg.id)}>
                          게시
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            )
          })}

          {loading && <div className="feed-status">피드를 불러오는 중...</div>}
          {!loading && visibleMessages.length === 0 && (
            <div className="feed-status">게시글이 없습니다. 아래 버튼을 눌러 첫 글을 남겨보세요!</div>
          )}
          <div ref={sentinelRef} className="scroll-sentinel" />
        </div>
      </main>

      {/* 우측 하단 플로팅 글쓰기 버튼 */}
      <button className="floating-write-btn" onClick={() => setShowModal(true)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>글쓰기</span>
      </button>

      {/* 모달 스타일의 심플 작성 창 */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>새 방명록</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <form onSubmit={handleSubmit} className="modal-form">
              <input
                className="minimal-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="작성자 닉네임"
                maxLength={40}
              />

              <div className="color-selector">
                <span className="c-label">포인트 컬러:</span>
                <div className="c-dots">
                  {CARD_THEMES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={`c-dot ${theme === t.value ? 'selected' : ''}`}
                      style={{ backgroundColor: t.value }}
                      onClick={() => setTheme(t.value)}
                    />
                  ))}
                </div>
              </div>

              <textarea
                className="minimal-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="어떤 이야기를 남기고 싶나요?"
                maxLength={500}
              />

              {error && <p className="modal-error">{error}</p>}

              <button type="submit" className="modal-submit-btn">
                피드에 올리기
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App