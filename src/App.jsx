import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const STORAGE_KEY = 'guestbook-messages-v5'
const STATS_KEY = 'guestbook-stats-v5'

const CARD_THEMES = [
  { value: '#ff7675', idName: 'pepperoni', label: '페퍼로니 레드', icon: '🍕' },
  { value: '#fdcb6e', idName: 'cheddar', label: '체다 치즈 옐로우', icon: '🧀' },
  { value: '#ffeaa7', idName: 'sweetpotato', label: '고구마 무스 골드', icon: '🍠' },
  { value: '#55efc4', idName: 'bellpepper', label: '올리브 피망 그린', icon: '🫑' },
  { value: '#a29bfe', idName: 'onion', label: '적양파 퍼플', icon: '🧅' },
  { value: '#74b9ff', idName: 'bluecheese', label: '블루 치즈', icon: '🧀' },
]
const BAD_WORDS = ['바보', '멍청이', '쓰레기', '시발', '존나', '개새끼', '병신', '닥쳐', '꺼져', '좆같다', 'ㅅㅂ', 'ㅈㄹ', 'ㅂㅅ', 'ㅄ']
const filterBadWords = (text) => {
  let filtered = text
  BAD_WORDS.forEach((word) => {
    const regex = new RegExp(word, 'gi')
    filtered = filtered.replace(regex, '🍕맛있는 피자🍕')
  })
  return filtered
}

const normalizeMessage = (msg, index) => ({
  id: msg.id ?? `local-${index}-${Date.now()}`,
  name: msg.name ?? '익명',
  content: msg.content ?? '',
  likes: Number(msg.likes ?? 0),
  likedByMe: Boolean(msg.likedByMe),
  theme: msg.theme ?? '#ff7675',
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
  // 모드 전환 상태: 'feed' (기본 방명록) | 'pizza' (피자 모드)
  const [viewMode, setViewMode] = useState('feed')

  const [messages, setMessages] = useState([])
  const [stats, setStats] = useState({ total_messages: 0, messages_today: 0, total_comments: 0 })

  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [theme, setTheme] = useState('#ff7675')

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState('latest')

  const [commentNames, setCommentNames] = useState({})
  const [commentContents, setCommentContents] = useState({})
  const [expandedComments, setExpandedComments] = useState({})

  const [error, setError] = useState('')
  const [darkMode, setDarkMode] = useState(false)
  
  // 방명록 피드용 모달 / 피자용 컴포저
  const [showModal, setShowModal] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  const [activeMessageId, setActiveMessageId] = useState(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    document.documentElement.setAttribute('data-mode', viewMode)
  }, [darkMode, viewMode])

  const syncMessages = useCallback((nextMessages) => {
    const { normalized, nextStats } = persistMessages(nextMessages)
    setMessages(normalized)
    setStats(nextStats)
    return { normalized, nextStats }
  }, [])

  useEffect(() => {
    const storedMessages = window.localStorage.getItem(STORAGE_KEY)
    const storedStats = window.localStorage.getItem(STATS_KEY)

    if (storedMessages) {
      try {
        const parsed = JSON.parse(storedMessages)
        const normalized = Array.isArray(parsed) ? parsed.map((m, i) => normalizeMessage(m, i)) : []
        setMessages(normalized)
        if (storedStats) {
          try {
            setStats(JSON.parse(storedStats))
          } catch {
            setStats(buildStats(normalized))
          }
        }
      } catch {
        syncMessages([])
      }
      return
    }
    syncMessages([])
  }, [syncMessages])

  const handleSearchSubmit = (event) => {
    event.preventDefault()
    setSearch(searchInput.trim())
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!name.trim() || !content.trim()) {
      setError('이름과 내용을 모두 작성해주세요!')
      return
    }
    setError('')

    const cleanName = filterBadWords(name.trim())
    const cleanContent = filterBadWords(content.trim())

    const optimisticMessage = normalizeMessage({
      id: `temp-${Date.now()}`,
      name: cleanName,
      content: cleanContent,
      theme,
      likes: 0,
      createdAt: new Date().toISOString(),
      comments: [],
      commentCount: 0
    }, 0)

    const nextMessages = [optimisticMessage, ...messages]
    syncMessages(nextMessages)

    setName('')
    setContent('')
    setShowModal(false)
    setShowComposer(false)
  }

  const handleToggleLike = (event, messageId) => {
    if (event) event.stopPropagation()
    const target = messages.find((m) => m.id === messageId)
    if (!target) return

    const isCancelling = target.likedByMe
    const updated = messages.map((m) =>
      m.id === messageId
        ? { ...m, likes: Math.max(0, m.likes + (isCancelling ? -1 : 1)), likedByMe: !isCancelling }
        : m
    )
    syncMessages(updated)
  }

  const handleDeleteMessage = (event, messageId) => {
    if (event) event.stopPropagation()
    const msg = viewMode === 'pizza' ? '이 맛있는 토핑을 피자 판에서 덜어내시겠어요?' : '이 글을 삭제할까요?'
    if (!window.confirm(msg)) return

    const filtered = messages.filter((m) => m.id !== messageId)
    syncMessages(filtered)
    if (activeMessageId === messageId) setActiveMessageId(null)
  }

  const handleAddComment = (messageId) => {
    const cName = commentNames[messageId]?.trim() || ''
    const cContent = commentContents[messageId]?.trim() || ''

    if (!cName || !cContent) {
      alert('닉네임과 댓글 내용을 작성해주세요.')
      return
    }

    const cleanCName = filterBadWords(cName)
    const cleanCContent = filterBadWords(cContent)

    const optimisticComment = {
      id: `local-cmt-${Date.now()}`,
      name: cleanCName,
      content: cleanCContent,
      createdAt: new Date().toISOString()
    }

    const updated = messages.map((m) => {
      if (m.id !== messageId) return m
      return {
        ...m,
        commentCount: m.commentCount + 1,
        comments: [...m.comments, optimisticComment]
      }
    })

    syncMessages(updated)
    setCommentNames((prev) => ({ ...prev, [messageId]: '' }))
    setCommentContents((prev) => ({ ...prev, [messageId]: '' }))
  }

  const toggleComments = (id) => {
    setExpandedComments((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const visibleMessages = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = messages.filter((msg) => {
      const haystack = `${msg.name} ${msg.content}`.toLowerCase()
      return haystack.includes(query)
    })

    const sorted = [...filtered]
    if (sortMode === 'likes') {
      sorted.sort((a, b) => (b.likes - a.likes) || new Date(b.createdAt) - new Date(a.createdAt))
    } else {
      sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    }
    return sorted
  }, [messages, search, sortMode])

  const activeMessage = useMemo(() => {
    return messages.find(m => m.id === activeMessageId) || null
  }, [messages, activeMessageId])

  return (
    <div className={`app-root mode-${viewMode}`}>
      {/* 🍕/📝 왼쪽 하단 모드 전환 플로팅 스위처 버튼 */}
      <div className="mode-switcher-fixed">
        <button
          className="mode-toggle-btn"
          onClick={() => setViewMode(viewMode === 'feed' ? 'pizza' : 'feed')}
        >
          {viewMode === 'feed' ? '🍕 피자 모드 변신' : '📝 방명록 피드 보기'}
        </button>
      </div>

      {/* ==================== 1. 피자 모드 UI ==================== */}
      {viewMode === 'pizza' ? (
        <div className="app-container">
          <header className="main-header">
            <div>
              <span className="badge">🍕 PIZZA MOOD BOARD</span>
              <h1>토핑 가득 피자 판</h1>
              <p className="subtitle">여러분의 소중한 의견을 맛있게 구워지는 피자 토핑 카드로 채워보세요!</p>
            </div>
            <button className="theme-btn" onClick={() => setDarkMode(!darkMode)}>
              {darkMode ? '☀️ 낮 오븐 모드' : '🌙 밤 오븐 모드'}
            </button>
          </header>

          <section className="stats-container">
            <div className="stat-box">
              <span className="stat-val">🍕 {stats.total_messages}개</span>
              <span className="stat-lbl">판 위의 총 토핑</span>
            </div>
            <div className="stat-box">
              <span className="stat-val">🔥 {stats.messages_today}개</span>
              <span className="stat-lbl">오늘 구운 토핑</span>
            </div>
            <div className="stat-box">
              <span className="stat-val">🧀 {stats.total_comments}개</span>
              <span className="stat-lbl">뿌려진 치즈 가루</span>
            </div>
          </section>

          <section className="composer-box">
            <div className="composer-trigger">
              <strong>👨‍🍳 나만의 특별한 토핑 추가하기</strong>
              <button className="toggle-btn" onClick={() => setShowComposer(!showComposer)}>
                {showComposer ? '토핑 박스 닫기' : '토핑 올리기'}
              </button>
            </div>

            {showComposer && (
              <form onSubmit={handleSubmit} className="composer-form">
                <div className="input-group">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="토핑 메이커 이름 (닉네임)" maxLength={50} />
                  <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                    {CARD_THEMES.map((t) => (
                      <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="피자에 남길 스토리를 적어주세요 (비속어는 자동으로 맛있게 치환됩니다🍕)"
                  maxLength={500}
                />
                {error && <p className="error-msg">⚠️ {error}</p>}
                <button type="submit" className="submit-btn-pizza">🍕 오븐에 토핑 투하!</button>
              </form>
            )}
          </section>

          <section className="filter-toolbar">
            <form className="search-form" onSubmit={handleSearchSubmit}>
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="토핑 검색하기..."
              />
              <button type="submit" className="search-btn">검색</button>
            </form>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="latest">⏰ 최신 오븐 순</option>
              <option value="likes">🔥 핫한 토핑 순</option>
            </select>
          </section>

          <div className="pizza-table-center">
            <main className="giant-pizza-dough">
              {visibleMessages.map((msg) => {
                const matchedTheme = CARD_THEMES.find(t => t.value === msg.theme)
                const toppingIcon = matchedTheme ? matchedTheme.icon : '🍕'
                const shapeClass = matchedTheme ? `shape-${matchedTheme.idName}` : 'shape-pepperoni'

                return (
                  <article
                    key={msg.id}
                    className={`topping-slice ${shapeClass}`}
                    style={{ '--topping-color': msg.theme }}
                    onClick={() => setActiveMessageId(msg.id)}
                  >
                    <button className="delete-topping-btn" onClick={(e) => handleDeleteMessage(e, msg.id)} title="토핑 덜어내기">
                      ❌
                    </button>

                    <div className="card-header">
                      <span className="author-name">{toppingIcon} {msg.name}</span>
                      <span className="time-stamp">{formatRelativeTime(msg.createdAt)}</span>
                    </div>

                    <div className="card-main">
                      <p className="card-content">{msg.content}</p>
                    </div>

                    <div className="card-footer">
                      <button
                        className={`like-action ${msg.likedByMe ? 'liked' : ''}`}
                        onClick={(e) => handleToggleLike(e, msg.id)}
                      >
                        {msg.likedByMe ? '❤️' : '🤍'} {msg.likes}
                      </button>
                      <span className="comment-count-tag">💬 {msg.commentCount}</span>
                    </div>
                  </article>
                )
              })}

              {visibleMessages.length === 0 && <div className="status-indicator">피자 판이 비었습니다. 첫 토핑을 올려주세요!</div>}
            </main>
          </div>

          {activeMessage && (
            <div className="pizza-comment-modal" onClick={() => setActiveMessageId(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header-row">
                  <h3 className="modal-title">
                    {CARD_THEMES.find(t => t.value === activeMessage.theme)?.icon || '🍕'} {activeMessage.name}의 토핑 스토리
                  </h3>
                  <button className="modal-close-btn" onClick={() => setActiveMessageId(null)}>닫기</button>
                </div>

                <div className="modal-body-story">
                  {activeMessage.content}
                </div>

                <div className="comment-section">
                  <h4>🧀 뿌려진 갈릭 디핑 소스 ({activeMessage.commentCount})</h4>
                  {activeMessage.comments && activeMessage.comments.length > 0 && (
                    <ul className="comment-flow">
                      {activeMessage.comments.map((cmt) => (
                        <li key={cmt.id} className="comment-bubble topping-crumb">
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
                      value={commentNames[activeMessage.id] || ''}
                      onChange={(e) => setCommentNames({ ...commentNames, [activeMessage.id]: e.target.value })}
                      placeholder="닉네임"
                      maxLength={50}
                    />
                    <input
                      className="c-content-input"
                      value={commentContents[activeMessage.id] || ''}
                      onChange={(e) => setCommentContents({ ...commentContents, [activeMessage.id]: e.target.value })}
                      placeholder="소스 추가..."
                      maxLength={300}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAddComment(activeMessage.id)
                        }
                      }}
                    />
                    <button className="c-submit-btn" onClick={() => handleAddComment(activeMessage.id)}>뿌리기</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ==================== 2. 방명록 피드 모드 UI ==================== */
        <div className="stream-app">
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

            <div className="timeline">
              {visibleMessages.map((msg) => {
                const isExpanded = Boolean(expandedComments[msg.id])

                return (
                  <article key={msg.id} className="feed-item" style={{ '--accent-color': msg.theme }}>
                    <div className="item-main">
                      <div className="item-header">
                        <div className="user-info">
                          <span className="user-avatar" style={{ backgroundColor: msg.theme }}></span>
                          <span className="user-name">{msg.name}</span>
                          <span className="bullet">•</span>
                          <span className="time-ago">{formatRelativeTime(msg.createdAt)}</span>
                        </div>

                        <button className="icon-del-btn" onClick={(e) => handleDeleteMessage(e, msg.id)} title="삭제">
                          ✕
                        </button>
                      </div>

                      <div className="item-body">
                        <p>{msg.content}</p>
                      </div>

                      <div className="item-actions">
                        <button
                          className={`action-btn like ${msg.likedByMe ? 'active' : ''}`}
                          onClick={(e) => handleToggleLike(e, msg.id)}
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

              {visibleMessages.length === 0 && (
                <div className="feed-status">게시글이 없습니다. 아래 버튼을 눌러 첫 글을 남겨보세요!</div>
              )}
            </div>
          </main>

          <button className="floating-write-btn" onClick={() => setShowModal(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>글쓰기</span>
          </button>

          {showModal && (
            <div className="modal-overlay" onClick={() => setShowModal(false)}>
              <div className="modal-content-feed" onClick={(e) => e.stopPropagation()}>
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
      )}
    </div>
  )
}

export default App